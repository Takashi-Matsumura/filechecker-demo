import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import { detect, FINDING_LABELS, maskNames, maxLevel, redact, ruleLevel, type Finding, type Level } from "./detect";
import { extract, kindOf } from "./extract";
import { judgeFile, resolveConcurrency, type AiJudgement } from "./llm";

// ---------------------------------------------------------------- パス検証

export class PathError extends Error {}

/**
 * ユーザ入力のパスを検証して実体パスを返す。
 * シンボリックリンクを解決した上で、許可ルート配下のディレクトリであることを確認する。
 */
export async function resolveScanRoot(input: string): Promise<string> {
  if (typeof input !== "string" || !input.trim()) throw new PathError("フォルダのパスを入力してください");
  if (!path.isAbsolute(input.trim())) throw new PathError("絶対パスで指定してください");
  let real: string;
  try {
    real = await fs.realpath(input.trim());
  } catch {
    throw new PathError("フォルダが見つかりません");
  }
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new PathError("フォルダを指定してください");
  for (const root of config.allowedRoots) {
    const realRoot = await fs.realpath(root).catch(() => root);
    const rel = path.relative(realRoot, real);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return real;
  }
  throw new PathError("このフォルダはスキャン対象として許可されていません（SCAN_ALLOWED_ROOTS）");
}

// ---------------------------------------------------------------- 実行管理

/**
 * スキャンの状態:
 *   queued → walking（一覧作成）→ processing（解析）→ done
 *   実行中に「中断」→ pausing（処理中のファイルを打ち切り中）→ paused
 *   paused から「再開」→ processing（未処理のファイルだけ解析）
 *   サーバが止まった場合も paused として扱い、再開できる
 */
const RUNNING = new Set(["queued", "walking", "processing", "pausing"]);

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // シグナルは送らず存在確認だけ
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 実行プロセスが既に居ない実行中スキャンを「中断」（再開可能）にする。
 * 注意: モジュール読み込み時に実行してはいけない。Next の dev は検証用の短命ワーカーでも
 * ルートを評価するため、そこで走ると実行中のスキャンを誤って中断扱いにする。
 */
function reconcile(scan: ScanRow): ScanRow {
  if (!RUNNING.has(scan.status) || isAlive(scan.runner_pid)) return scan;
  const error = "サーバ停止により中断されました。再開できます";
  db().prepare(`UPDATE scans SET status='paused', error=? WHERE id=? AND status=?`).run(error, scan.id, scan.status);
  return { ...scan, status: "paused", error };
}

class PausedError extends Error {}

export function startScan(root: string): number {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db()
    .prepare(`INSERT INTO scans (root, status, runner_pid, created_at) VALUES (?, 'queued', ?, ?)`)
    .run(root, process.pid, now);
  const id = Number(lastInsertRowid);
  launch(id, root);
  return id;
}

/** 中断を要求する。処理中のファイルは打ち切り、未処理に戻す */
export function pauseScan(scanId: number): "ok" | "not_running" {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(scanId) as ScanRow | undefined;
  if (!row) return "not_running";
  if (reconcile(row).status === "paused") return "ok"; // 既に止まっている
  const r = db()
    .prepare(`UPDATE scans SET status='pausing' WHERE id=? AND status IN ('queued','walking','processing')`)
    .run(scanId);
  return r.changes > 0 || row.status === "pausing" ? "ok" : "not_running";
}

/** 中断したスキャンを再開する。終わったファイルはやり直さない */
export async function resumeScan(scanId: number): Promise<"ok" | "not_paused" | "not_allowed"> {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(scanId) as ScanRow | undefined;
  if (!row || reconcile(row).status !== "paused") return "not_paused";
  // 中断している間に、ルートが許可範囲の外になっていないか（リンクの差し替え・設定変更）を確認し直す
  const real = await resolveScanRoot(row.root).catch(() => null);
  if (real !== row.root) return "not_allowed";
  // 1回の UPDATE で状態を切り替え、二重に再開されないようにする
  const r = db()
    .prepare(`UPDATE scans SET status='processing', runner_pid=?, error=NULL, finished_at=NULL WHERE id=? AND status='paused'`)
    .run(process.pid, scanId);
  if (r.changes === 0) return "not_paused";
  launch(scanId, row.root);
  return "ok";
}

/** バックグラウンドで実行し、中断要求（DB の pausing）を監視して打ち切る */
function launch(scanId: number, root: string) {
  const controller = new AbortController();
  const d = db();
  const isPausing = () =>
    (d.prepare(`SELECT status FROM scans WHERE id=?`).get(scanId) as { status: string } | undefined)?.status === "pausing";
  // 別のモジュールインスタンスから中断されても止まるよう、DB を1秒ごとに確認する
  const watcher = setInterval(() => {
    if (!controller.signal.aborted && isPausing()) controller.abort(new PausedError());
  }, 1000);

  void runScan(scanId, root, controller.signal)
    .then(() => {
      const pending = (d.prepare(`SELECT COUNT(*) AS n FROM files WHERE scan_id=? AND status='pending'`).get(scanId) as { n: number }).n;
      const walked = (d.prepare(`SELECT walked FROM scans WHERE id=?`).get(scanId) as { walked: number }).walked;
      if (walked && pending === 0) {
        d.prepare(`UPDATE scans SET status='done', error=NULL, finished_at=? WHERE id=?`).run(new Date().toISOString(), scanId);
      } else {
        d.prepare(`UPDATE scans SET status='paused' WHERE id=?`).run(scanId);
      }
    })
    .catch((e) => {
      if (controller.signal.aborted) {
        d.prepare(`UPDATE scans SET status='paused' WHERE id=?`).run(scanId);
        return;
      }
      d.prepare(`UPDATE scans SET status='error', error=?, finished_at=? WHERE id=?`).run(
        e instanceof Error ? e.message : String(e),
        new Date().toISOString(),
        scanId,
      );
    })
    .finally(() => clearInterval(watcher));
}

// ---------------------------------------------------------------- 走査

interface Entry {
  abs: string;
  rel: string;
}

async function walk(root: string, signal: AbortSignal): Promise<Entry[]> {
  const out: Entry[] = [];
  async function rec(dir: string) {
    if (out.length >= config.maxFiles) return;
    signal.throwIfAborted();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 権限が無いフォルダは飛ばす
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    for (const e of entries) {
      if (out.length >= config.maxFiles) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      // シンボリックリンクは辿らない（許可ルートの外に出ないため）
      if (e.isDirectory()) await rec(abs);
      else if (e.isFile()) out.push({ abs, rel: path.relative(root, abs) });
    }
  }
  await rec(root);
  return out;
}

async function sha256(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  const fh = await fs.open(file, "r");
  try {
    for await (const chunk of fh.createReadStream()) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest("hex");
}

/** ファイル一覧を作り、ハッシュ・重複・古さを記録する。中断されたら途中の一覧は捨てて最初からやり直す */
async function buildFileList(scanId: number, root: string, signal: AbortSignal) {
  const d = db();
  d.prepare(`UPDATE scans SET status='walking' WHERE id=? AND status<>'pausing'`).run(scanId);
  d.prepare(`DELETE FROM files WHERE scan_id=?`).run(scanId);
  const entries = await walk(root, signal);

  const staleBefore = new Date();
  staleBefore.setFullYear(staleBefore.getFullYear() - config.staleYears);

  const insert = d.prepare(
    `INSERT INTO files (scan_id, rel_path, ext, kind, size, mtime, sha256, status, is_stale)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const byHash = new Map<string, { id: number; mtime: number; rel: string }[]>();
  const setDup = d.prepare(`UPDATE files SET dup_of=? WHERE id=?`);

  for (const e of entries) {
    signal.throwIfAborted();
    const st = await fs.stat(e.abs);
    const ext = path.extname(e.abs).slice(1).toLowerCase();
    const hash = await sha256(e.abs).catch(() => null);
    const { lastInsertRowid } = insert.run(
      scanId, e.rel, ext, kindOf(ext), st.size, st.mtime.toISOString(), hash, st.mtime < staleBefore ? 1 : 0,
    );
    const id = Number(lastInsertRowid);
    if (hash && st.size > 0) {
      const list = byHash.get(hash) ?? [];
      list.push({ id, mtime: st.mtime.getTime(), rel: e.rel });
      byHash.set(hash, list);
    }
  }

  // 同一内容のグループでは「更新日が最も古い → パスが短い」ものを原本とみなす
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.mtime - b.mtime || a.rel.length - b.rel.length);
    for (const dup of list.slice(1)) setDup.run(list[0].id, dup.id);
  }
  d.prepare(`UPDATE scans SET walked=1, total=? WHERE id=?`).run(entries.length, scanId);
}

async function runScan(scanId: number, root: string, signal: AbortSignal) {
  const d = db();
  const walked = (d.prepare(`SELECT walked FROM scans WHERE id=?`).get(scanId) as { walked: number }).walked;
  if (!walked) await buildFileList(scanId, root, signal);
  signal.throwIfAborted();

  // 未処理のファイルだけを対象にする。重複は原本の結果を流用するので、原本を先に処理する
  const jobs = d
    .prepare(`SELECT id, rel_path, ext, dup_of FROM files WHERE scan_id=? AND status='pending' ORDER BY (dup_of IS NOT NULL), id`)
    .all(scanId) as { id: number; rel_path: string; ext: string; dup_of: number | null }[];
  d.prepare(
    `UPDATE scans SET status='processing',
       processed=(SELECT COUNT(*) FROM files WHERE scan_id=? AND status<>'pending') WHERE id=? AND status<>'pausing'`,
  ).run(scanId, scanId);

  // LLM の並列数 + 1 本のワーカーで処理（LLM を使わないファイルを詰めるため1本多め）
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !signal.aborted) {
      const job = jobs[next++];
      try {
        // 読む直前にパスを検証する（スキャン後・再開までの間の差し替え対策）
        const abs = await safeFilePath(root, job.rel_path);
        if (!abs) throw new Error("ファイルが見つからないか、スキャン対象の範囲外に変わったため処理しませんでした");
        if (job.dup_of === null || !(await copyFromRepresentative(job.id, job.dup_of, signal))) {
          await processFile(job.id, abs, job.ext, signal);
        }
      } catch (e) {
        // 中断で打ち切ったファイルは「未処理」のまま残し、再開時にやり直す
        if (signal.aborted) return;
        d.prepare(`UPDATE files SET status='error', error=? WHERE id=?`).run(
          e instanceof Error ? e.message.slice(0, 500) : String(e),
          job.id,
        );
      }
      d.prepare(`UPDATE scans SET processed = processed + 1 WHERE id=?`).run(scanId);
    }
  };
  const concurrency = await resolveConcurrency();
  await Promise.all(Array.from({ length: concurrency + 1 }, worker));
  signal.throwIfAborted();
}

// ---------------------------------------------------------------- 重複ファイル

/**
 * 内容が同一（SHA-256 一致）のファイルは、原本の解析結果をコピーして LLM 呼び出しを省く。
 * 原本がエラーだった場合は false を返し、通常の処理に回す。
 */
async function copyFromRepresentative(id: number, repId: number, signal: AbortSignal): Promise<boolean> {
  const d = db();
  const deadline = Date.now() + config.llmTimeoutMs * 3;
  let rep: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    rep = d.prepare(`SELECT * FROM files WHERE id=?`).get(repId) as Record<string, unknown> | undefined;
    if (!rep || rep.status !== "pending") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!rep || rep.status !== "done") return false;
  const ai = rep.ai_json ? (JSON.parse(rep.ai_json as string) as Partial<AiJudgement>) : {};
  ai.recommendation = "delete";
  ai.reason = `同じ内容のファイルが「${rep.rel_path as string}」にあります（重複）`;
  d.prepare(
    `UPDATE files SET status='done', error=?, extract_method=?, text_chars=?, excerpt=?, findings_json=?,
       rule_level=?, ai_json=?, risk=? WHERE id=?`,
  ).run(
    "内容が同一のため、原本の解析結果を流用",
    rep.extract_method as string | null,
    rep.text_chars as number,
    rep.excerpt as string | null,
    rep.findings_json as string,
    rep.rule_level as string,
    JSON.stringify(ai),
    rep.risk as string,
    id,
  );
  return true;
}

// ---------------------------------------------------------------- 1ファイルの処理

const FALLBACK_REC: Record<Level, AiJudgement["recommendation"]> = {
  high: "restrict",
  medium: "review",
  low: "keep",
  none: "keep",
};

async function processFile(id: number, abs: string, ext: string, signal: AbortSignal) {
  const d = db();
  const row = d.prepare(`SELECT rel_path, size, mtime, is_stale, dup_of FROM files WHERE id=?`).get(id) as {
    rel_path: string;
    size: number;
    mtime: string;
    is_stale: number;
    dup_of: number | null;
  };

  let text = "";
  let method = "none";
  const notes: string[] = [];
  if (row.size > config.maxReadBytes) {
    notes.push("サイズが大きいため内容は未検査");
  } else {
    const buf = await readFileNoFollow(abs);
    const r = await extract(buf, ext, signal);
    text = r.text;
    method = r.method;
    if (r.note) notes.push(r.note);
  }

  const { findings, spans } = detect(text);
  let level = ruleLevel(findings);
  const ruleSummary = findings.map((f) => `${f.label}×${f.count}`).join("、");
  const masked = redact(text, spans).text;

  // AI 判定。本文はルールでマスクした版を渡す（ローカル LLM だが、出力側に生の番号を残さないため）
  let ai: AiJudgement | null = null;
  try {
    ai = await judgeFile({
      relPath: row.rel_path,
      sizeKb: Math.ceil(row.size / 1024),
      mtime: row.mtime.slice(0, 10),
      isStale: !!row.is_stale,
      isDuplicate: row.dup_of !== null,
      extractMethod: method,
      ruleSummary,
      text: masked.slice(0, 6000),
    }, signal);
  } catch (e) {
    // 中断による打ち切りは失敗扱いにせず、呼び出し元で「未処理」に戻す
    if (signal.aborted) throw e;
    notes.push(`AI 判定に失敗: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  }

  const names = (ai?.person_names ?? []).filter((n) => n.trim().length >= 2);
  // 最終的なマスク（番号類 + AI が見つけた氏名）。サンプルと抜粋はここから作る
  const final = redact(text, spans, names);
  const allFindings: Finding[] = findings.map((f) => ({ ...f, samples: final.samples.get(f.type) ?? [] }));
  if (names.length > 0) {
    allFindings.push({
      type: "person_name",
      label: FINDING_LABELS.person_name,
      level: names.length >= 5 ? "medium" : "low",
      count: names.length,
      samples: names.slice(0, 3).map((n) => `【${maskNames(n, [n])}】`),
    });
  }
  level = maxLevel(level, ruleLevel(allFindings));
  const risk: Level = ai ? maxLevel(level, ai.risk) : level;

  // 保存するのはマスク済みの抜粋のみ。AI の判定からも氏名リストは落とし、要約文中の氏名も伏せる
  const excerpt = final.text.slice(0, 1500);
  const aiStored: Partial<AiJudgement> = ai
    ? { ...ai, summary: maskNames(ai.summary, names), reason: maskNames(ai.reason, names), person_names: undefined }
    : { recommendation: FALLBACK_REC[risk], reason: "AI 判定が使えなかったため、ルール検出の結果から推定", summary: "", category: "その他", risk };
  // 同一内容のファイルが先にある場合は、AI の判断に関わらず重複として削除候補にする
  if (row.dup_of !== null) {
    const rep = d.prepare(`SELECT rel_path FROM files WHERE id=?`).get(row.dup_of) as { rel_path: string } | undefined;
    aiStored.recommendation = "delete";
    aiStored.reason = `同じ内容のファイルが「${rep?.rel_path ?? "別の場所"}」にあります（重複）`;
  }

  d.prepare(
    `UPDATE files SET status='done', error=?, extract_method=?, text_chars=?, excerpt=?, findings_json=?,
       rule_level=?, ai_json=?, risk=? WHERE id=?`,
  ).run(
    notes.length ? notes.join(" / ") : null,
    method,
    text.length,
    excerpt,
    JSON.stringify(allFindings),
    level,
    JSON.stringify(aiStored),
    risk,
    id,
  );
}

// ---------------------------------------------------------------- 参照系

export interface ScanRow {
  id: number;
  root: string;
  status: string;
  total: number;
  processed: number;
  error: string | null;
  runner_pid: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface FileRow {
  id: number;
  scan_id: number;
  rel_path: string;
  ext: string;
  kind: string;
  size: number;
  mtime: string;
  status: string;
  error: string | null;
  extract_method: string | null;
  text_chars: number;
  excerpt: string | null;
  findings: Finding[];
  rule_level: Level;
  ai: Partial<AiJudgement> | null;
  risk: Level;
  is_stale: boolean;
  dup_of: number | null;
  action_status: ActionStatus;
  action_at: string | null;
}

export type ActionStatus = "todo" | "done" | "skipped";
export const ACTION_STATUSES: readonly ActionStatus[] = ["todo", "done", "skipped"];

function toFile(r: Record<string, unknown>): FileRow {
  return {
    ...(r as unknown as FileRow),
    findings: JSON.parse((r.findings_json as string) ?? "[]"),
    ai: r.ai_json ? JSON.parse(r.ai_json as string) : null,
    is_stale: !!r.is_stale,
  };
}

export function listScans(): ScanRow[] {
  return (db().prepare(`SELECT * FROM scans ORDER BY id DESC LIMIT 50`).all() as unknown as ScanRow[]).map(reconcile);
}

export function getScan(id: number): { scan: ScanRow; files: Omit<FileRow, "excerpt">[] } | null {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(id) as ScanRow | undefined;
  if (!row) return null;
  const scan = reconcile(row);
  const rows = db()
    .prepare(`SELECT * FROM files WHERE scan_id=? ORDER BY id`)
    .all(id) as Record<string, unknown>[];
  return {
    scan,
    files: rows.map((r) => {
      const { excerpt: _excerpt, ...rest } = toFile(r);
      void _excerpt;
      return rest;
    }),
  };
}

export function getFile(scanId: number, fileId: number): FileRow | null {
  const r = db().prepare(`SELECT * FROM files WHERE id=? AND scan_id=?`).get(fileId, scanId) as
    | Record<string, unknown>
    | undefined;
  return r ? toFile(r) : null;
}

export function getDuplicates(scanId: number, file: FileRow): { id: number; rel_path: string }[] {
  const rep = file.dup_of ?? file.id;
  return db()
    .prepare(`SELECT id, rel_path FROM files WHERE scan_id=? AND (id=? OR dup_of=?) AND id<>? ORDER BY id`)
    .all(scanId, rep, rep, file.id) as { id: number; rel_path: string }[];
}

// ---------------------------------------------------------------- 社員の対応状況

/** 「対応した」「対応しない」「未対応に戻す」を記録する。ファイルそのものには触れない */
export function setActionStatus(scanId: number, fileId: number, status: ActionStatus): boolean {
  const r = db()
    .prepare(`UPDATE files SET action_status=?, action_at=? WHERE id=? AND scan_id=?`)
    .run(status, status === "todo" ? null : new Date().toISOString(), fileId, scanId);
  return r.changes > 0;
}

/**
 * ファイル ID から実体パスを求める。クライアントからパスは受け取らない。
 * スキャン時のルート配下で、かつ現在も許可ルート配下にあることを確認する（リンクの差し替え対策）。
 */
export async function resolveFilePath(scanId: number, fileId: number): Promise<string | null> {
  const row = db()
    .prepare(`SELECT s.root AS root, f.rel_path AS rel FROM files f JOIN scans s ON s.id = f.scan_id WHERE f.id=? AND f.scan_id=?`)
    .get(fileId, scanId) as { root: string; rel: string } | undefined;
  if (!row) return null;
  return safeFilePath(row.root, row.rel);
}

/**
 * スキャン時に記録した相対パスを、読む直前に検証してから実体パスを返す。
 * スキャン後（特に中断〜再開の間）に、ファイルや途中のフォルダが許可範囲の外を指す
 * シンボリックリンクに差し替えられていないかを確認する。
 *   - 実体パスがスキャンのルート配下にあること
 *   - 実体パスが現在も許可ルート配下にあること
 *   - 通常のファイルであること（最後の要素がシンボリックリンクでない）
 * 満たさなければ null。
 */
async function safeFilePath(root: string, rel: string): Promise<string | null> {
  const joined = path.resolve(root, rel);
  let real: string;
  try {
    const st = await fs.lstat(joined);
    if (!st.isFile()) return null; // シンボリックリンクやフォルダに変わっている
    real = await fs.realpath(joined);
  } catch {
    return null; // 既に移動・削除されている
  }
  const relToRoot = path.relative(root, real);
  if (relToRoot === "" || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
  try {
    await resolveScanRoot(path.dirname(real)); // 許可ルート配下かを再確認
  } catch {
    return null;
  }
  return real;
}

/** 最後の要素がシンボリックリンクなら開かない（検証から読み込みまでの間の差し替え対策） */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
async function readFileNoFollow(file: string): Promise<Buffer> {
  const fh = await fs.open(file, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}

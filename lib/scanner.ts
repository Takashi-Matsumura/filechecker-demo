import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import {
  detect,
  findNameRanges,
  findNameReadings,
  findNamesByLayout,
  FINDING_LABELS,
  maskNameRanges,
  maskNames,
  maxLevel,
  redact,
  toRedactedOffsets,
  ruleLevel,
  type Finding,
  type FindingType,
  type Level,
  type NameRange,
  type Span,
} from "./detect";
import { keepAwake } from "./keep-awake";
import { extract, kindOf, sectionsUpTo, type TextSection } from "./extract";
import {
  collectMoreNames,
  JUDGE_TEXT_CHARS,
  JUDGE_VERSION,
  judgeFile,
  resolveConcurrency,
  type AiJudgement,
  type NamesCoverage,
} from "./llm";
import { countOverlap, recordFeedback, recordFileStats, type CallContext } from "./metrics";
import { bucketOf, unreadReason, type FileItem } from "@/components/actions";

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

/**
 * 棚卸しの記録を削除する（ファイルごとの結果も消える）。実行中のものは消さない（先に中断してもらう）。
 * 動いている処理が、消した記録に結果を書き込むのを防ぐため。AI の性能分析の記録（数字だけ）は残す。
 */
export function deleteScan(scanId: number): "ok" | "not_found" | "running" {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(scanId) as ScanRow | undefined;
  if (!row) return "not_found";
  // サーバが止まって取り残された「実行中」は、中断扱いに直してから判定する
  if (RUNNING.has(reconcile(row).status)) return "running";
  // 判定と削除の間に再開されないよう、実行中でないことを条件に1回の DELETE で消す
  const placeholders = [...RUNNING].map(() => "?").join(",");
  const r = db()
    .prepare(`DELETE FROM scans WHERE id=? AND status NOT IN (${placeholders})`)
    .run(scanId, ...RUNNING);
  return r.changes > 0 ? "ok" : "running";
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
  // 棚卸しの途中で PC がスリープすると、AI の呼び出しがタイムアウトして結果が欠けるため
  const release = keepAwake();

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
    .finally(() => {
      clearInterval(watcher);
      release();
    });
}

// ---------------------------------------------------------------- 走査

interface Entry {
  abs: string;
  rel: string;
}

/**
 * 棚卸しするファイルを、見つけたそばから1件ずつ返す（全件をメモリに持たない）。
 * 上限（config.maxFiles）に達したら打ち切り、state.truncated に印を付ける。
 */
async function* walk(root: string, signal: AbortSignal, state: { count: number; truncated: boolean }): AsyncGenerator<Entry> {
  async function* rec(dir: string): AsyncGenerator<Entry> {
    signal.throwIfAborted();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 権限が無いフォルダは飛ばす
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    for (const e of entries) {
      if (state.truncated) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      // シンボリックリンクは辿らない（許可ルートの外に出ないため）
      if (e.isDirectory()) yield* rec(abs);
      else if (e.isFile()) {
        // 上限に達したあとに、まだファイルが見つかった = 棚卸ししきれないファイルがある
        if (state.count >= config.maxFiles) {
          state.truncated = true;
          return;
        }
        state.count++;
        yield { abs, rel: path.relative(root, abs) };
      }
    }
  }
  yield* rec(root);
}

/**
 * ファイルの内容のハッシュ（重複の判定用）。一覧を作ってから開くまでの間に、範囲外へのリンクや
 * FIFO（開くと書き手が来るまで戻らない）に差し替えられても読まないよう、リンクを辿らず・待たずに開き、
 * 開いたものが通常のファイルかを確かめる。
 */
async function sha256(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  const fh = await fs.open(/*turbopackIgnore: true*/ file, fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    if (!(await fh.stat()).isFile()) throw new PathChangedError("通常のファイルではありません");
    for await (const chunk of fh.createReadStream({ autoClose: false })) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest("hex");
}

/**
 * ファイル一覧を作り、ハッシュ・重複・古さを記録する。中断されたら途中の一覧は捨てて最初からやり直す。
 * ファイルは見つけたそばから DB に入れ、件数（total）も随時更新する（大きなフォルダでも進み具合が見えるように）。
 */
async function buildFileList(scanId: number, root: string, signal: AbortSignal) {
  const d = db();
  d.prepare(`UPDATE scans SET status='walking', total=0, truncated=0 WHERE id=? AND status<>'pausing'`).run(scanId);
  d.prepare(`DELETE FROM files WHERE scan_id=?`).run(scanId);

  const staleBefore = new Date();
  staleBefore.setFullYear(staleBefore.getFullYear() - config.staleYears);

  const insert = d.prepare(
    `INSERT INTO files (scan_id, rel_path, ext, kind, size, mtime, sha256, status, is_stale)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const setTotal = d.prepare(`UPDATE scans SET total=? WHERE id=?`);
  const state = { count: 0, truncated: false };
  for await (const e of walk(root, signal, state)) {
    signal.throwIfAborted();
    const st = await fs.stat(e.abs).catch(() => null);
    if (!st) continue; // 一覧づくりの間に消えたファイル
    const ext = path.extname(e.abs).slice(1).toLowerCase();
    const hash = await sha256(e.abs).catch(() => null);
    insert.run(scanId, e.rel, ext, kindOf(ext), st.size, st.mtime.toISOString(), hash, st.mtime < staleBefore ? 1 : 0);
    if (state.count % 100 === 0) setTotal.run(state.count, scanId);
  }

  // 同一内容のグループでは「更新日が最も古い → パスが短い」ものを原本とみなす（DB でまとめて判定する）
  d.prepare(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY sha256 ORDER BY mtime, length(rel_path), id) AS rn,
              FIRST_VALUE(id) OVER (PARTITION BY sha256 ORDER BY mtime, length(rel_path), id) AS rep
         FROM files WHERE scan_id=? AND sha256 IS NOT NULL AND size > 0
     )
     UPDATE files SET dup_of = (SELECT rep FROM ranked WHERE ranked.id = files.id)
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`,
  ).run(scanId);
  const total = (d.prepare(`SELECT COUNT(*) AS n FROM files WHERE scan_id=?`).get(scanId) as { n: number }).n;
  d.prepare(`UPDATE scans SET walked=1, total=?, truncated=? WHERE id=?`).run(total, state.truncated ? 1 : 0, scanId);
}

async function runScan(scanId: number, root: string, signal: AbortSignal) {
  const d = db();
  const walked = (d.prepare(`SELECT walked FROM scans WHERE id=?`).get(scanId) as { walked: number }).walked;
  if (!walked) await buildFileList(scanId, root, signal);
  signal.throwIfAborted();

  // 前回の実行（サーバの停止・中断）で残った「処理中」の印を消す
  d.prepare(`UPDATE files SET progress=NULL WHERE scan_id=? AND progress IS NOT NULL`).run(scanId);

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
      if (job.dup_of !== null) setProgress(job.id, "duplicate");
      try {
        // 読む直前にパスを検証する（スキャン後・再開までの間の差し替え対策）
        const abs = await safeFilePath(root, job.rel_path);
        if (!abs) throw new Error("ファイルが見つからないか、スキャン対象の範囲外に変わったため処理しませんでした");
        if (job.dup_of === null || !(await copyFromRepresentative(job.id, job.dup_of, signal))) {
          await processFile(job.id, root, job.ext, signal);
        }
      } catch (e) {
        // 中断で打ち切ったファイルは「未処理」のまま残し、再開時にやり直す
        if (signal.aborted) return clearProgress(job.id);
        d.prepare(`UPDATE files SET status='error', error=? WHERE id=?`).run(
          e instanceof Error ? e.message.slice(0, 500) : String(e),
          job.id,
        );
      }
      clearProgress(job.id);
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
       rule_level=?, ai_json=?, risk=?, name_ranges=?, ocr_preview=? WHERE id=?`,
  ).run(
    "内容が同一のため、原本の解析結果を流用",
    rep.extract_method as string | null,
    rep.text_chars as number,
    rep.excerpt as string | null,
    rep.findings_json as string,
    rep.rule_level as string,
    JSON.stringify(ai),
    rep.risk as string,
    // 内容が同一なので、氏名の位置もそのまま使える
    (rep.name_ranges as string | null) ?? null,
    (rep.ocr_preview as string | null) ?? null,
    id,
  );
  return true;
}

// ---------------------------------------------------------------- 1ファイルの処理

/** 空白の違いだけの重複（「高橋美咲」と「高橋 美咲」）を除き、2文字以上のものだけを残す */
function uniqueNames(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const n = raw.trim();
    const key = n.replace(/[\s　]/g, "");
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

const FALLBACK_REC: Record<Level, AiJudgement["recommendation"]> = {
  high: "restrict",
  medium: "review",
  low: "keep",
  none: "keep",
};

/**
 * AI による氏名の確認が本文の一部だけだったときの補足（最後まで確認したときは null）。
 * ルールの検出と、書式から拾う氏名は全文が対象なので、ここで示すのは AI の確認の範囲だけ
 */
function namesCoverageNote(coverage: NamesCoverage, sections: TextSection[] | undefined, masked: string, spans: Span[]): string | null {
  const sheets = sections?.filter((x) => x.label !== "コメント") ?? [];
  if (coverage.kind === "sampled") {
    return `本文が長いため、AI による氏名の確認は各シートの先頭の部分のみ（全 ${sheets.length} シート中 ${coverage.covered} シート。数字だけの並びや、既に確認した語だけの行は省いて確認）`;
  }
  if (coverage.kind === "partial") {
    const pct = Math.floor((coverage.origChars / Math.max(1, masked.length)) * 100);
    // Excel は、どのシートまで届いたかも示す（シートの位置は伏せる前の本文のものなので、伏せた後の位置に直して比べる）
    let upTo = "";
    if (sheets.length > 1) {
      const starts = toRedactedOffsets(spans, sheets.map((x) => x.start));
      upTo = `、全 ${sheets.length} シート中 ${sectionsUpTo(sheets.map((x, i) => ({ label: x.label, start: starts[i] })), coverage.origChars)} シート目まで`;
    }
    return `本文が長いため、AI による氏名の確認は先頭から約 ${pct}% まで（${coverage.origChars.toLocaleString()} / ${coverage.total.toLocaleString()} 字${upTo}。数字だけの並びや、既に確認した語だけの行は省いて確認）`;
  }
  return null;
}

async function processFile(id: number, root: string, ext: string, signal: AbortSignal) {
  const d = db();
  const row = d.prepare(`SELECT scan_id, rel_path, size, mtime, is_stale, dup_of FROM files WHERE id=?`).get(id) as {
    scan_id: number;
    rel_path: string;
    size: number;
    mtime: string;
    is_stale: number;
    dup_of: number | null;
  };

  // 性能分析の記録（lib/metrics.ts）に残す、どの棚卸しのどのファイルの処理か
  const ctx: CallContext = { scanId: row.scan_id, fileId: id, ext };
  setProgress(id, "read");
  let text = "";
  let method = "none";
  let sections: TextSection[] | undefined;
  const notes: string[] = [];
  // パスは検証つきで開き、開いたファイルが範囲内の実体と同じであることを確かめてから読む
  const buf = row.size > config.maxReadBytes ? "too_large" : await readValidatedFile(root, row.rel_path);
  if (buf === "too_large") {
    notes.push("サイズが大きいため内容は未検査");
  } else {
    const r = await extract(buf, ext, signal, { ctx });
    text = r.text;
    method = r.method;
    sections = r.sections;
    if (r.note) notes.push(r.note);
  }

  const { findings, spans } = detect(text);
  let level = ruleLevel(findings);
  const ruleSummary = findings.map((f) => `${f.label}×${f.count}`).join("、");
  const masked = redact(text, spans).text;

  // AI 判定。本文はルールでマスクした版を渡す（ローカル LLM だが、出力側に生の番号を残さないため）
  let ai: AiJudgement | null = null;
  setProgress(id, "judge");
  try {
    ai = await judgeFile({
      relPath: row.rel_path,
      sizeKb: Math.ceil(row.size / 1024),
      mtime: row.mtime.slice(0, 10),
      isStale: !!row.is_stale,
      isDuplicate: row.dup_of !== null,
      extractMethod: method,
      ruleSummary,
      text: masked.slice(0, JUDGE_TEXT_CHARS),
    }, signal, ctx);
  } catch (e) {
    // 中断による打ち切りは失敗扱いにせず、呼び出し元で「未処理」に戻す
    if (signal.aborted) throw e;
    notes.push(`AI 判定に失敗: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  }

  // 判定は先頭の本文しか見ず、氏名も20件までなので、上限に達したときや本文が長いときは氏名だけを聞き直して補う
  // （文章の中に20人以上の氏名がある議事録など、書式のルールでは拾えない氏名を伏せ漏らさないため）
  let more = { names: [] as string[], readings: [] as string[] };
  if (text.trim()) {
    try {
      // シートの位置は、番号を伏せた本文の位置に直して渡す（伏せ字で長さが変わるため）
      const starts = sections ? toRedactedOffsets(spans, sections.map((x) => x.start)) : [];
      const r = await collectMoreNames(
        masked,
        ai ? { names: ai.person_names ?? [], readings: ai.name_readings ?? [] } : null,
        signal,
        ctx,
        (step, total) => setProgress(id, "names", step, total),
        sections?.map((x, i) => ({ label: x.label, start: starts[i] })),
      );
      more = r;
      const note = namesCoverageNote(r.coverage, sections, masked, spans);
      if (note) notes.push(note);
    } catch (e) {
      if (signal.aborted) throw e;
      notes.push(`氏名の補完に失敗: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  }
  const aiNameList = [...(ai?.person_names ?? []), ...more.names];
  const aiReadingList = [...(ai?.name_readings ?? []), ...more.readings];

  // 氏名は AI の推定に、書式（名簿の「氏名」列など）から拾ったものを足す。大きな名簿でも全員を伏せるため
  const layoutNames = findNamesByLayout(text);
  const names = uniqueNames([...aiNameList, ...layoutNames]);
  // 読み仮名（「ヤマダ タロウ」など）も伏せる。AI の結果に、書式から拾ったものを足す（件数には数えない）
  const layoutReadings = findNameReadings(text);
  const readings = uniqueNames([...aiReadingList, ...layoutReadings]);
  const maskTargets = [...names, ...readings];
  // プレビューで同じ箇所を伏せ直せるよう、氏名の「位置」だけを残す（マスク後テキスト上の座標）
  const nameRanges = findNameRanges(masked, maskTargets);
  // 最終的なマスク（番号類 + 氏名 + 読み仮名）。サンプルと抜粋はここから作る
  const final = redact(text, spans, maskTargets);
  const allFindings: Finding[] = findings.map((f) => ({ ...f, samples: final.samples.get(f.type) ?? [] }));
  // 件数は氏名で数える。読み仮名しか見つからなかったときは読み仮名で数える
  const counted = names.length > 0 ? names : readings;
  if (counted.length > 0) {
    allFindings.push({
      type: "person_name",
      label: FINDING_LABELS.person_name,
      level: counted.length >= 5 ? "medium" : "low",
      count: counted.length,
      samples: counted.slice(0, 3).map((n) => `【${maskNames(n, [n])}】`),
    });
  }
  level = maxLevel(level, ruleLevel(allFindings));
  const risk: Level = ai ? maxLevel(level, ai.risk) : level;

  // 保存するのはマスク済みの抜粋のみ。AI の判定からも氏名リストは落とし、要約文中の氏名も伏せる
  const excerpt = final.text.slice(0, 1500);
  // OCR したものは、プレビューのたびに OCR し直すと遅いので、伏せた全文と検出位置をここで残す
  const ocrPreview: OcrPreview | null =
    method === "ocr" ? { text: final.text, marks: buildMarks(final.placed, allFindings, nameRanges) } : null;
  const aiStored: Partial<AiJudgement> = ai
    ? {
        ...ai,
        summary: maskNames(ai.summary, maskTargets),
        reason: maskNames(ai.reason, maskTargets),
        person_names: undefined,
        name_readings: undefined,
      }
    : { recommendation: FALLBACK_REC[risk], reason: "AI 判定が使えなかったため、ルール検出の結果から推定", summary: "", category: "その他", risk };
  // 同一内容のファイルが先にある場合は、AI の判断に関わらず重複として削除候補にする
  if (row.dup_of !== null) {
    const rep = d.prepare(`SELECT rel_path FROM files WHERE id=?`).get(row.dup_of) as { rel_path: string } | undefined;
    aiStored.recommendation = "delete";
    aiStored.reason = `同じ内容のファイルが「${rep?.rel_path ?? "別の場所"}」にあります（重複）`;
  }

  d.prepare(
    `UPDATE files SET status='done', error=?, extract_method=?, text_chars=?, excerpt=?, findings_json=?,
       rule_level=?, ai_json=?, risk=?, name_ranges=?, ocr_preview=? WHERE id=?`,
  ).run(
    notes.length ? notes.join(" / ") : null,
    method,
    text.length,
    excerpt,
    JSON.stringify(allFindings),
    level,
    JSON.stringify(aiStored),
    risk,
    JSON.stringify(nameRanges),
    ocrPreview ? JSON.stringify(ocrPreview) : null,
    id,
  );

  // 性能分析: ルール・AI・書式の判断を並べて記録する（本文や氏名そのものは残さない）
  const aiNames = uniqueNames(aiNameList);
  const aiReadings = uniqueNames(aiReadingList);
  const uLayoutNames = uniqueNames(layoutNames);
  const uLayoutReadings = uniqueNames(layoutReadings);
  recordFileStats({
    scanId: row.scan_id,
    fileId: id,
    ext,
    extractMethod: method,
    ruleLevel: ruleLevel(findings),
    aiOk: ai !== null,
    aiRisk: ai?.risk ?? null,
    finalRisk: risk,
    aiRecommendation: ai?.recommendation ?? null,
    finalRecommendation: aiStored.recommendation ?? null,
    namesAi: aiNames.length,
    namesLayout: uLayoutNames.length,
    namesBoth: countOverlap(aiNames, uLayoutNames),
    readingsAi: aiReadings.length,
    readingsLayout: uLayoutReadings.length,
    readingsBoth: countOverlap(aiReadings, uLayoutReadings),
    findingTypes: findings.map((f) => f.type),
    promptVersion: ai ? JUDGE_VERSION : null,
  });
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
  /** 1 = ファイル数の上限に達し、棚卸ししていないファイルが残っている */
  truncated: number;
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

/** 一覧に必要な列だけ（OCR の全文・氏名の位置・抜粋など、重い列や一覧で使わない列は読まない） */
const LIST_COLUMNS = `id, scan_id, rel_path, ext, kind, size, mtime, status, error, extract_method, text_chars,
  findings_json, rule_level, ai_json, risk, is_stale, dup_of, action_status, action_at`;

/** 棚卸しのファイル一覧（画面の集計・表示用） */
export function listFileItems(scanId: number): Omit<FileRow, "excerpt">[] {
  const rows = db().prepare(`SELECT ${LIST_COLUMNS} FROM files WHERE scan_id=? ORDER BY id`).all(scanId) as Record<string, unknown>[];
  return rows.map((r) => {
    const { excerpt: _excerpt, ...rest } = toFile(r);
    void _excerpt;
    return rest;
  });
}

export function getScan(id: number): { scan: ScanRow; files: Omit<FileRow, "excerpt">[] } | null {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(id) as ScanRow | undefined;
  if (!row) return null;
  return { scan: reconcile(row), files: listFileItems(id) };
}

/** 棚卸しの記録だけを返す（ファイルの一覧は含めない）。棚卸しの最中に、進み具合を軽く取るため */
// ---------------------------------------------------------------- 処理中の様子

/** 処理の段階。read=中身の読み取り（画像は AI の文字起こしを含む）/ judge=AI の判定 / names=氏名の確認 / duplicate=重複（原本の結果を待つ） */
export type ProgressStage = "read" | "judge" | "names" | "duplicate";

interface ProgressRecord {
  stage: ProgressStage;
  step?: number;
  total?: number;
  startedAt: string;
  updatedAt: string;
}

/** 処理中のファイルの段階を記録する。startedAt（そのファイルの処理を始めた時刻）は引き継ぐ */
function setProgress(fileId: number, stage: ProgressStage, step?: number, total?: number) {
  const d = db();
  const now = new Date().toISOString();
  const prev = d.prepare(`SELECT progress FROM files WHERE id=?`).get(fileId) as { progress: string | null } | undefined;
  const startedAt = (prev?.progress ? (JSON.parse(prev.progress) as ProgressRecord).startedAt : null) ?? now;
  const rec: ProgressRecord = { stage, step, total, startedAt, updatedAt: now };
  d.prepare(`UPDATE files SET progress=? WHERE id=?`).run(JSON.stringify(rec), fileId);
}

function clearProgress(fileId: number) {
  db().prepare(`UPDATE files SET progress=NULL WHERE id=?`).run(fileId);
}

export interface ScanActivity {
  /** 処理中のファイル（段階と、そのファイルにかかっている時間） */
  files: { id: number; relPath: string; stage: ProgressStage; step: number | null; total: number | null; elapsedSec: number }[];
  /** 最後に動きがあってからの秒数（段階の変化・AI の呼び出しの完了）。動きの記録がなければ null */
  idleSec: number | null;
}

/** 棚卸しの画面に出す「いま何をしているか」。ファイルが大きいと、1件終わるまで件数が動かないため */
export function getScanActivity(scanId: number): ScanActivity {
  const d = db();
  const now = Date.now();
  const rows = d
    .prepare(`SELECT id, rel_path, progress FROM files WHERE scan_id=? AND status='pending' AND progress IS NOT NULL ORDER BY id`)
    .all(scanId) as { id: number; rel_path: string; progress: string }[];
  let last = 0;
  const files = rows.map((r) => {
    const p = JSON.parse(r.progress) as ProgressRecord;
    last = Math.max(last, Date.parse(p.updatedAt));
    return {
      id: r.id,
      relPath: r.rel_path,
      stage: p.stage,
      step: p.step ?? null,
      total: p.total ?? null,
      elapsedSec: Math.max(0, Math.round((now - Date.parse(p.startedAt)) / 1000)),
    };
  });
  // AI の呼び出しが終わった時刻も「動き」に数える（1回の呼び出しが数十秒かかるため）
  const call = d
    .prepare(`SELECT max(julianday(started_at) * 86400000 + duration_ms - 210866760000000) AS t FROM ai_calls WHERE scan_id=?`)
    .get(scanId) as { t: number | null } | undefined;
  if (call?.t) last = Math.max(last, call.t);
  return { files, idleSec: last ? Math.max(0, Math.round((now - last) / 1000)) : null };
}

export function getScanSummary(id: number): ScanRow | null {
  const row = db().prepare(`SELECT * FROM scans WHERE id=?`).get(id) as ScanRow | undefined;
  return row ? reconcile(row) : null;
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
  if (r.changes === 0) return false;
  // 性能分析: 担当者の判断を、そのときの区分・推奨と並べて記録する（本文・ファイル名は残さない）
  const f = getFile(scanId, fileId) as FileItem | null;
  if (f) {
    const bucket = bucketOf(f);
    if (bucket !== "ok") {
      recordFeedback({
        scanId,
        fileId,
        bucket,
        finalRecommendation: f.ai?.recommendation ?? null,
        risk: f.risk,
        unread: unreadReason(f) !== null,
        status,
      });
    }
  }
  return true;
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

// ---------------------------------------------------------------- 検証つきの読み込み

/** 最後の要素がシンボリックリンクなら開かない */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
/** FIFO などを開いたときに待たない（通常のファイルには影響しない）。Windows には無い */
const O_NONBLOCK = fsConstants.O_NONBLOCK ?? 0;

export class PathChangedError extends Error {}

/** ファイルの同一性（デバイス番号 + inode 番号） */
interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

/**
 * パスを検証してから O_NOFOLLOW で開き、開いたファイルの同一性を返す。
 * 途中のフォルダの差し替えは O_NOFOLLOW では防げないので、呼び出し側は
 * 開いたあとに stillSameFile() で確かめ直すこと。
 */
export async function openValidated(root: string, rel: string) {
  const abs = await safeFilePath(root, rel);
  if (!abs) throw new PathChangedError("ファイルが見つからないか、スキャン対象の範囲外に変わったため処理しませんでした");
  const fh = await fs.open(/*turbopackIgnore: true*/ abs, fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) throw new PathChangedError("通常のファイルではないため処理しませんでした");
    return { fh, abs, identity: { dev: st.dev, ino: st.ino } as FileIdentity, size: Number(st.size) };
  } catch (e) {
    await fh.close();
    throw e;
  }
}

/**
 * 開いたあとにパスを検証し直し、その実体が「開いたファイル」と同じかを確かめる。
 * 検証から open までの間に途中のフォルダが範囲外へのリンクに差し替えられていた場合、
 * 開いたファイルの同一性が、範囲内の実体と一致しなくなるので検出できる。
 */
export async function stillSameFile(root: string, rel: string, abs: string, identity: FileIdentity): Promise<boolean> {
  const again = await safeFilePath(root, rel);
  if (again !== abs) return false;
  try {
    const st = await fs.stat(/*turbopackIgnore: true*/ again, { bigint: true });
    return st.dev === identity.dev && st.ino === identity.ino;
  } catch {
    return false;
  }
}

/** 検証つきでファイルを読む。サイズの上限は、開いたファイルの実際のサイズで判定する */
async function readValidatedFile(root: string, rel: string): Promise<Buffer | "too_large"> {
  const { fh, abs, identity, size } = await openValidated(root, rel);
  try {
    if (!(await stillSameFile(root, rel, abs, identity))) {
      throw new PathChangedError("読み込み中にファイルの場所が変わったため処理しませんでした");
    }
    if (size > config.maxReadBytes) return "too_large";
    // 開いたときの大きさまでしか読まない（判定のあとにファイルが大きくなっても、上限を超えて読み込まない）
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const { bytesRead } = await fh.read(buf, off, size - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- プレビュー

export interface PreviewMark {
  type: FindingType;
  label: string;
  level: Level;
  start: number;
  end: number;
}

export type Preview =
  | {
      available: true;
      /** 検出した番号などを伏せたテキスト */
      text: string;
      marks: PreviewMark[];
      /** スキャン後に内容が変わっている */
      changed: boolean;
      note: string | null;
      /** live: いまファイルを読み直して作った / ocr: 棚卸しのときに画像から読み取って保存した文字 */
      source: "live" | "ocr";
    }
  | { available: false; reason: string };

/**
 * ファイルを読み直して、検出箇所の位置つきでマスク済みテキストを返す。
 * 結果は保存しない（生のテキストを DB に残さないため）。
 * OCR が必要なもの（画像・スキャン PDF）は時間がかかるので対象外にする。
 */
export async function buildPreview(scanId: number, fileId: number): Promise<Preview | null> {
  const row = db()
    .prepare(
      `SELECT s.root AS root, f.rel_path AS rel, f.ext AS ext, f.sha256 AS sha256, f.status AS status, f.extract_method AS method,
              f.findings_json AS findings, f.name_ranges AS nameRanges, f.ocr_preview AS ocrPreview, f.text_chars AS textChars
         FROM files f JOIN scans s ON s.id = f.scan_id WHERE f.id=? AND f.scan_id=?`,
    )
    .get(fileId, scanId) as
    | { root: string; rel: string; ext: string; sha256: string | null; status: string; method: string | null; findings: string; nameRanges: string | null; ocrPreview: string | null; textChars: number }
    | undefined;
  if (!row) return null;
  if (row.status !== "done") return { available: false, reason: "まだ解析が終わっていません" };
  if (row.method === "ocr") {
    const saved = parseOcrPreview(row.ocrPreview);
    if (!saved) {
      return { available: false, reason: "画像から読み取った文字を保存していない以前の棚卸しのため、保存済みの抜粋を表示しています。もう一度棚卸しするとプレビューできます" };
    }
    return { available: true, ...saved, changed: false, note: null, source: "ocr" };
  }
  if (row.method === "none" || !row.method) return { available: false, reason: "このファイルの形式は内容を読み取れません" };

  // 氏名が見つかったファイルは、スキャン時に残した位置で伏せ直す。伏せられる保証がなければ表示しない
  const person = (JSON.parse(row.findings) as Finding[]).find((f) => f.type === "person_name");
  const savedRanges = parseNameRanges(row.nameRanges);
  // 氏名か読み仮名の位置があれば、伏せる必要がある
  const needsNames = !!person || (savedRanges?.length ?? 0) > 0;
  const ranges = needsNames ? savedRanges : [];
  if (needsNames && !ranges) {
    return { available: false, reason: "氏名を伏せるための情報がない以前の棚卸しのため、保存済みの抜粋を表示しています。もう一度棚卸しするとプレビューできます" };
  }

  let buf: Buffer | "too_large";
  try {
    buf = await readValidatedFile(row.root, row.rel);
  } catch {
    return { available: false, reason: "ファイルを開けませんでした（移動・削除された可能性があります）" };
  }
  if (buf === "too_large") return { available: false, reason: "サイズが大きいためプレビューできません" };

  let changed = row.sha256 === null || crypto.createHash("sha256").update(buf).digest("hex") !== row.sha256;
  if (needsNames && changed) {
    return { available: false, reason: "棚卸しのあとに内容が変わり、氏名を確実に伏せられないため、保存済みの抜粋を表示しています" };
  }
  const r = await extract(buf, row.ext, undefined, { allowOcr: false });
  if (r.method === "none") return { available: false, reason: r.note ?? "内容を読み取れませんでした" };
  // ファイルが同じでも、取り出し方の改良で本文が変わると、保存した氏名の位置が合わなくなる。
  // 棚卸し時と文字数が違えば「変わった」とみなす（伏せる必要があれば抜粋の表示に切り替える）
  if (r.text.length !== row.textChars) {
    if (needsNames) {
      return { available: false, reason: "棚卸しのあとに読み取り方が変わり、氏名を確実に伏せられないため、保存済みの抜粋を表示しています。もう一度棚卸しするとプレビューできます" };
    }
    changed = true;
  }

  const { findings, spans } = detect(r.text);
  const red = redact(r.text, spans);
  const nameRanges = ranges ?? [];
  if (nameRanges.some(([, end]) => end > red.text.length)) {
    return { available: false, reason: "氏名の位置が本文と合わないため、保存済みの抜粋を表示しています" };
  }
  const allFindings: Finding[] = person ? [...findings, person] : findings;
  // 伏せたあとの本文から、先頭だけを画面に送る（検査は全文に対して済んでいる。巨大な本文でブラウザが重くならないように）
  const masked = maskNameRanges(red.text, nameRanges);
  const cut = masked.length > config.maxPreviewChars;
  const marks = buildMarks(red.placed, allFindings, nameRanges).filter((m) => !cut || m.end <= config.maxPreviewChars);
  const previewNote = cut ? `本文が長いため、先頭 ${config.maxPreviewChars.toLocaleString()} 字を表示しています` : null;
  return {
    available: true,
    text: cut ? masked.slice(0, config.maxPreviewChars) : masked,
    marks,
    changed,
    note: [r.note, previewNote].filter(Boolean).join(" / ") || null,
    source: "live",
  };
}

type OcrPreview = { text: string; marks: PreviewMark[] };

/**
 * ハイライトする箇所を組み立てる。番号などの検出箇所に、氏名の位置を加える
 * （番号などと重なる氏名は除く）。位置はどれも伏せたあとの本文上の座標。
 */
function buildMarks(
  placed: { type: FindingType; start: number; end: number }[],
  findings: Pick<Finding, "type" | "label" | "level">[],
  nameRanges: NameRange[],
): PreviewMark[] {
  const meta = new Map(findings.map((f) => [f.type, f]));
  const marks: PreviewMark[] = placed.map((p) => ({
    ...p,
    label: meta.get(p.type)?.label ?? FINDING_LABELS[p.type],
    level: meta.get(p.type)?.level ?? "low",
  }));
  const person = meta.get("person_name");
  for (const [start, end] of nameRanges) {
    if (marks.some((m) => start < m.end && end > m.start)) continue;
    marks.push({ type: "person_name", label: person?.label ?? FINDING_LABELS.person_name, level: person?.level ?? "low", start, end });
  }
  return marks.sort((a, b) => a.start - b.start);
}

/** 保存した OCR のプレビューを読む。形が正しくなければ null（抜粋の表示に切り替える） */
function parseOcrPreview(json: string | null): OcrPreview | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<OcrPreview>;
    if (typeof v.text !== "string" || !Array.isArray(v.marks)) return null;
    const len = v.text.length;
    const sorted = v.marks.every(
      (m, i, all) =>
        Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start && m.end <= len && (i === 0 || m.start >= all[i - 1].end),
    );
    return sorted ? { text: v.text, marks: v.marks } : null;
  } catch {
    return null;
  }
}

/** 保存した氏名の位置を読む。形が正しくなければ null（伏せられないものとして扱う） */
function parseNameRanges(json: string | null): NameRange[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return null;
    const ok = v.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] > r[0]);
    return ok ? (v as NameRange[]) : null;
  } catch {
    return null;
  }
}

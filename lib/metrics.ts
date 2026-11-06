/**
 * AI の性能分析のための記録。
 * 個人情報を残さないため、本文や AI の入出力そのものは保存せず、数字と種類だけを記録する。
 * 棚卸しの記録とは切り離してためる（棚卸しを消しても残る）。
 */
import crypto from "node:crypto";
import { db } from "./db";

export type CallKind = "ocr" | "judge" | "names";
export type ErrorKind = "timeout" | "http" | "network" | "parse" | "aborted";

/** どの棚卸しのどのファイルの処理か（分かる範囲で） */
export interface CallContext {
  scanId?: number;
  fileId?: number;
  ext?: string;
}

export interface CallRecord extends CallContext {
  kind: CallKind;
  model: string | null;
  promptVersion: string;
  startedAt: string;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  ok: boolean;
  errorKind: ErrorKind | null;
  inputChars: number | null;
}

/** 指示文と出力形式から作る短い識別子。指示文を書き換えると変わるので、変更の前後を比べられる */
export function promptVersion(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\n---\n")).digest("hex").slice(0, 8);
}

/** AI の呼び出し1回を記録する。記録に失敗しても棚卸しは止めない。記録の ID を返す */
export function recordAiCall(r: CallRecord): number | null {
  try {
    const res = db()
      .prepare(
        `INSERT INTO ai_calls (scan_id, file_id, ext, kind, model, prompt_version, started_at, duration_ms,
           prompt_tokens, completion_tokens, ok, error_kind, input_chars)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.scanId ?? null, r.fileId ?? null, r.ext ?? null, r.kind, r.model, r.promptVersion, r.startedAt, Math.round(r.durationMs),
        r.promptTokens, r.completionTokens, r.ok ? 1 : 0, r.errorKind, r.inputChars,
      );
    return Number(res.lastInsertRowid);
  } catch {
    return null;
  }
}

/** 応答は届いたが JSON として読めなかったときに、記録を失敗に直す */
export function markParseError(callId: number | null) {
  if (callId === null) return;
  try {
    db().prepare(`UPDATE ai_calls SET ok=0, error_kind='parse' WHERE id=?`).run(callId);
  } catch {
    // 記録の失敗は無視する
  }
}

export interface FileStatsRecord {
  scanId: number;
  fileId: number;
  ext: string;
  extractMethod: string;
  ruleLevel: string;
  aiOk: boolean;
  aiRisk: string | null;
  finalRisk: string;
  aiRecommendation: string | null;
  finalRecommendation: string | null;
  namesAi: number;
  namesLayout: number;
  namesBoth: number;
  readingsAi: number;
  readingsLayout: number;
  readingsBoth: number;
  findingTypes: string[];
  promptVersion: string | null;
}

/** ファイルごとの「ルール・AI・書式」の判断を並べて記録する。記録に失敗しても棚卸しは止めない */
export function recordFileStats(r: FileStatsRecord) {
  try {
    db()
      .prepare(
        `INSERT INTO ai_file_stats (scan_id, file_id, ext, extract_method, rule_level, ai_ok, ai_risk, final_risk,
           ai_recommendation, final_recommendation, names_ai, names_layout, names_both, readings_ai, readings_layout,
           readings_both, finding_types, prompt_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.scanId, r.fileId, r.ext, r.extractMethod, r.ruleLevel, r.aiOk ? 1 : 0, r.aiRisk, r.finalRisk,
        r.aiRecommendation, r.finalRecommendation, r.namesAi, r.namesLayout, r.namesBoth, r.readingsAi, r.readingsLayout,
        r.readingsBoth, r.findingTypes.join(","), r.promptVersion, new Date().toISOString(),
      );
  } catch {
    // 記録の失敗は無視する
  }
}

export interface FeedbackRecord {
  scanId: number;
  fileId: number;
  bucket: string;
  finalRecommendation: string | null;
  risk: string | null;
  unread: boolean;
  status: string;
}

/**
 * 担当者の判断（「済」「対応しない」「戻す」）を記録する。記録に失敗しても操作は止めない。
 * 指示文の版は、そのファイルを判定したときの記録（ai_file_stats）から引く。
 */
export function recordFeedback(r: FeedbackRecord) {
  try {
    const d = db();
    const pv = d
      .prepare(`SELECT prompt_version FROM ai_file_stats WHERE scan_id=? AND file_id=? ORDER BY id DESC LIMIT 1`)
      .get(r.scanId, r.fileId) as { prompt_version: string | null } | undefined;
    d.prepare(
      `INSERT INTO ai_feedback (scan_id, file_id, bucket, final_recommendation, risk, unread, status, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.scanId, r.fileId, r.bucket, r.finalRecommendation, r.risk, r.unread ? 1 : 0, r.status, pv?.prompt_version ?? null, new Date().toISOString());
  } catch {
    // 記録の失敗は無視する
  }
}

/** 空白の違いを無視して、2つの名前の一覧に共通するものの数を数える */
export function countOverlap(a: string[], b: string[]): number {
  const key = (s: string) => s.replace(/[\s　]/g, "");
  const set = new Set(a.map(key));
  return new Set(b.map(key).filter((k) => set.has(k))).size;
}

// ---------------------------------------------------------------- 集計

export interface CallSummary {
  kind: CallKind;
  model: string | null;
  promptVersion: string;
  /** 中断を除いた呼び出し回数 */
  calls: number;
  failures: number;
  failuresByKind: Partial<Record<ErrorKind, number>>;
  aborted: number;
  avgMs: number | null;
  p90Ms: number | null;
  /** 成功した呼び出しの、生成トークン数 ÷ 時間 */
  tokensPerSec: number | null;
  avgCompletionTokens: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

export interface FeedbackSummary {
  done: number;
  skipped: number;
}

export interface AiStats {
  since: string | null;
  /** テストデータでの評価の結果（新しい順。期間の絞り込みは効かない） */
  evals: EvalRun[];
  /** 担当者の判断（ファイルごとに最後の操作。未対応に戻したものは数えない） */
  feedback: {
    total: FeedbackSummary;
    byBucket: Record<string, FeedbackSummary>;
    byRecommendation: Record<string, FeedbackSummary>;
    byVersion: { promptVersion: string; done: number; skipped: number }[];
    /** 中身を確認できなかったファイル（AI は中身を見ていない）の判断 */
    unread: FeedbackSummary;
  };
  byKind: CallSummary[];
  byVersion: CallSummary[];
  byExt: { kind: CallKind; ext: string; calls: number; avgMs: number | null }[];
  files: {
    total: number;
    aiFailed: number;
    /** ルールのリスク × AI のリスク（AI の判定が取れたファイル） */
    riskMatrix: Record<string, Record<string, number>>;
    /** AI がルールより低いリスクと判定した件数（見落としの疑い） */
    aiLowerThanRule: number;
    aiHigherThanRule: number;
    recommendations: Record<string, number>;
    names: { ai: number; layout: number; both: number; aiOnlyFiles: number };
    readings: { ai: number; layout: number; both: number };
  };
}

const RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

type CallRow = {
  kind: CallKind;
  model: string | null;
  prompt_version: string;
  ext: string | null;
  started_at: string;
  duration_ms: number;
  completion_tokens: number | null;
  ok: number;
  error_kind: ErrorKind | null;
};

function summarize(rows: CallRow[]): Omit<CallSummary, "kind" | "model" | "promptVersion"> {
  const counted = rows.filter((r) => r.error_kind !== "aborted");
  const okRows = counted.filter((r) => r.ok);
  const failuresByKind: Partial<Record<ErrorKind, number>> = {};
  for (const r of counted) if (!r.ok && r.error_kind) failuresByKind[r.error_kind] = (failuresByKind[r.error_kind] ?? 0) + 1;
  const durations = okRows.map((r) => r.duration_ms).sort((a, b) => a - b);
  const tokRows = okRows.filter((r) => r.completion_tokens !== null);
  const tokSum = tokRows.reduce((n, r) => n + (r.completion_tokens ?? 0), 0);
  const tokMs = tokRows.reduce((n, r) => n + r.duration_ms, 0);
  const times = rows.map((r) => r.started_at).sort();
  return {
    calls: counted.length,
    failures: counted.length - okRows.length,
    failuresByKind,
    aborted: rows.length - counted.length,
    avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    p90Ms: durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.9))] : null,
    tokensPerSec: tokMs > 0 ? (tokSum / tokMs) * 1000 : null,
    avgCompletionTokens: tokRows.length ? tokSum / tokRows.length : null,
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
  };
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

/** AI の性能の集計。since（ISO 日時）以降の記録だけを対象にする（null ならすべて） */
export function aiStats(since: string | null): AiStats {
  const d = db();
  const calls = d
    .prepare(
      `SELECT kind, model, prompt_version, ext, started_at, duration_ms, completion_tokens, ok, error_kind
         FROM ai_calls WHERE started_at >= ? ORDER BY started_at`,
    )
    .all(since ?? "") as CallRow[];

  const byKind = [...groupBy(calls, (r) => r.kind)].map(([kind, rows]) => ({
    kind: kind as CallKind,
    model: null,
    promptVersion: "",
    ...summarize(rows),
  }));
  const byVersion = [...groupBy(calls, (r) => `${r.kind}\t${r.model ?? ""}\t${r.prompt_version}`)]
    .map(([, rows]) => ({ kind: rows[0].kind, model: rows[0].model, promptVersion: rows[0].prompt_version, ...summarize(rows) }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const byExt = [...groupBy(calls.filter((r) => r.error_kind !== "aborted"), (r) => `${r.kind}\t${r.ext ?? ""}`)]
    .map(([, rows]) => ({ kind: rows[0].kind, ext: rows[0].ext ?? "", calls: rows.length, avgMs: summarize(rows).avgMs }))
    .sort((a, b) => b.calls - a.calls);

  const fileRows = d
    .prepare(
      `SELECT rule_level, ai_ok, ai_risk, final_recommendation, names_ai, names_layout, names_both,
              readings_ai, readings_layout, readings_both
         FROM ai_file_stats WHERE created_at >= ?`,
    )
    .all(since ?? "") as {
    rule_level: string;
    ai_ok: number;
    ai_risk: string | null;
    final_recommendation: string | null;
    names_ai: number;
    names_layout: number;
    names_both: number;
    readings_ai: number;
    readings_layout: number;
    readings_both: number;
  }[];
  const levels = ["high", "medium", "low", "none"];
  const riskMatrix = Object.fromEntries(levels.map((r) => [r, Object.fromEntries(levels.map((a) => [a, 0]))])) as Record<
    string,
    Record<string, number>
  >;
  let lower = 0;
  let higher = 0;
  const recommendations: Record<string, number> = {};
  const names = { ai: 0, layout: 0, both: 0, aiOnlyFiles: 0 };
  const readings = { ai: 0, layout: 0, both: 0 };
  for (const f of fileRows) {
    if (f.ai_ok && f.ai_risk && riskMatrix[f.rule_level]) {
      riskMatrix[f.rule_level][f.ai_risk] = (riskMatrix[f.rule_level][f.ai_risk] ?? 0) + 1;
      if (RANK[f.ai_risk] < RANK[f.rule_level]) lower++;
      if (RANK[f.ai_risk] > RANK[f.rule_level]) higher++;
    }
    if (f.final_recommendation) recommendations[f.final_recommendation] = (recommendations[f.final_recommendation] ?? 0) + 1;
    names.ai += f.names_ai;
    names.layout += f.names_layout;
    names.both += f.names_both;
    if (f.names_ai > 0 && f.names_layout === 0) names.aiOnlyFiles++;
    readings.ai += f.readings_ai;
    readings.layout += f.readings_layout;
    readings.both += f.readings_both;
  }

  // 担当者の判断: ファイルごとに最後の操作だけを数える（「戻す」で未対応に戻したものは除く）
  const fb = d
    .prepare(
      `SELECT f.bucket, f.final_recommendation, f.unread, f.status, f.prompt_version
         FROM ai_feedback f
        WHERE f.id = (SELECT max(id) FROM ai_feedback g WHERE g.scan_id = f.scan_id AND g.file_id = f.file_id)
          AND f.status <> 'todo' AND f.created_at >= ?`,
    )
    .all(since ?? "") as { bucket: string; final_recommendation: string | null; unread: number; status: string; prompt_version: string | null }[];
  const empty = (): FeedbackSummary => ({ done: 0, skipped: 0 });
  const add = (m: FeedbackSummary, status: string) => (status === "done" ? m.done++ : m.skipped++);
  const feedback: AiStats["feedback"] = { total: empty(), byBucket: {}, byRecommendation: {}, byVersion: [], unread: empty() };
  const versions = new Map<string, FeedbackSummary>();
  for (const r of fb) {
    add(feedback.total, r.status);
    add((feedback.byBucket[r.bucket] ??= empty()), r.status);
    if (r.final_recommendation) add((feedback.byRecommendation[r.final_recommendation] ??= empty()), r.status);
    if (r.unread) add(feedback.unread, r.status);
    else if (r.prompt_version) {
      const v = versions.get(r.prompt_version) ?? empty();
      add(v, r.status);
      versions.set(r.prompt_version, v);
    }
  }
  feedback.byVersion = [...versions].map(([promptVersion, v]) => ({ promptVersion, ...v }));

  return {
    since,
    evals: listEvals(),
    feedback,
    byKind,
    byVersion,
    byExt,
    files: {
      total: fileRows.length,
      aiFailed: fileRows.filter((f) => !f.ai_ok).length,
      riskMatrix,
      aiLowerThanRule: lower,
      aiHigherThanRule: higher,
      recommendations,
      names,
      readings,
    },
  };
}

// ---------------------------------------------------------------- テストデータでの評価（npm run eval、lib/eval.ts）

/** 正解と比べた数（再現率 = tp / (tp + fn)、適合率 = tp / (tp + fp)） */
export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export interface EvalMetrics {
  names: Counts;
  readings: Counts;
  /** ルール検出の種類（ファイル単位） */
  rules: Counts;
  risk: { ok: number; total: number; under: number };
  recommendation: { ok: number; total: number };
  /** 伏せたあとに残った正解の氏名・読み仮名の数 */
  leaks: { leaked: number; total: number };
  ocr: { found: number; total: number };
  aiFailures: number;
  /** ファイルごとの結果（氏名そのものは残さない） */
  files: {
    rel: string;
    names: Counts;
    readings: Counts;
    rulesMissed: string[];
    rulesExtra: string[];
    risk: string | null;
    riskOk: boolean | null;
    recommendation: string | null;
    recommendationOk: boolean | null;
    leaked: number;
    ocr: { found: number; total: number } | null;
    error: string | null;
  }[];
}

export interface EvalRun {
  id: number;
  /** 評価に使ったテストデータ（sample = 標準 / hard = 難しい） */
  dataset: string;
  createdAt: string;
  model: string | null;
  judgeVersion: string;
  ocrVersion: string;
  files: number;
  durationMs: number;
  metrics: EvalMetrics;
}

/** これまでの評価の結果（新しい順） */
export function listEvals(limit = 20): EvalRun[] {
  let rows;
  try {
    rows = db()
    .prepare(`SELECT * FROM ai_evals ORDER BY id DESC LIMIT ?`)
    .all(limit) as { id: number; created_at: string; dataset: string; model: string | null; judge_version: string; ocr_version: string; files: number; duration_ms: number; metrics_json: string }[];
  } catch {
    return []; // 表がまだ無い（起動し直す前）など
  }
  return rows.map((r) => ({
    id: r.id,
    dataset: r.dataset ?? "sample",
    createdAt: r.created_at,
    model: r.model,
    judgeVersion: r.judge_version,
    ocrVersion: r.ocr_version,
    files: r.files,
    durationMs: r.duration_ms,
    metrics: JSON.parse(r.metrics_json) as EvalMetrics,
  }));
}

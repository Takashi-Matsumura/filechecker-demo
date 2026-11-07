/**
 * テストデータの正解を使った AI の評価（npm run eval）。
 *
 * testdata/sample-files の各ファイルを、アプリと同じ処理（文字の取り出し → ルール検出 → AI の判定 → 伏せる処理）に通し、
 * testdata/expected.json の正解と比べる。テストデータはすべて架空なので、評価の間だけは AI が返した氏名と正解を突き合わせる。
 * DB に残すのは集計した数字だけ（ai_evals）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import { detect, findNameReadings, findNamesByLayout, redact, toRedactedOffsets, type Level } from "./detect";
import { extract } from "./extract";
import { keepAwake } from "./keep-awake";
import { collectMoreNames, JUDGE_TEXT_CHARS, JUDGE_VERSION, judgeFile, llmStatus, OCR_VERSION, type AiJudgement } from "./llm";
import type { Counts, EvalMetrics } from "./metrics";

interface Expected {
  types?: string[];
  names?: string[];
  readings?: string[];
  risk?: Level[];
  recommendation?: string[];
  ocr?: string[];
  /** 伏せられるべき番号（ファイルに書かれた表記のまま） */
  secrets?: string[];
  skip_ai?: boolean;
}

const RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
/** 照合用に正規化する（半角・全角の違いと空白を無視する。ﾔﾏﾀﾞ → ヤマダ、０９０ → 090） */
const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
const addCounts = (a: Counts, b: Counts) => ((a.tp += b.tp), (a.fp += b.fp), (a.fn += b.fn));

/** 名前の一覧を正解と比べる（空白の違いは無視する） */
function compare(found: string[], truth: string[]): Counts {
  const t = new Set(truth.map(norm));
  const f = new Set(found.map(norm).filter((x) => x.length >= 2));
  let tp = 0;
  for (const x of f) if (t.has(x)) tp++;
  return { tp, fp: f.size - tp, fn: t.size - tp };
}

/** 空白を無視して、本文に文字列が含まれるか */
const containsLoose = (text: string, s: string) => norm(text).includes(norm(s));

export interface EvalResult {
  id: number | null;
  dataset: Dataset;
  model: string | null;
  judgeVersion: string;
  ocrVersion: string;
  durationMs: number;
  metrics: EvalMetrics;
}

/** 評価に使うテストデータ（フォルダと正解ファイル） */
export const DATASETS = {
  sample: { dir: "sample-files", expected: "expected.json", label: "標準" },
  hard: { dir: "hard-files", expected: "expected-hard.json", label: "難しい" },
} as const;
export type Dataset = keyof typeof DATASETS;

/** 評価を実行する。進み具合は log に1行ずつ渡す */
export async function runEval(root: string, dataset: Dataset = "sample", log: (line: string) => void = () => {}): Promise<EvalResult> {
  // 評価は数十分かかることがある。途中で PC がスリープすると AI の呼び出しがタイムアウトし、評価が正しく測れない
  const release = keepAwake();
  try {
    return await evaluate(root, dataset, log);
  } finally {
    release();
  }
}

async function evaluate(root: string, dataset: Dataset, log: (line: string) => void): Promise<EvalResult> {
  const status = await llmStatus();
  if (!status.ok) throw new Error(`ローカル LLM に接続できません: ${status.error ?? ""}`);
  const ds = DATASETS[dataset];
  const expected = JSON.parse(await fs.readFile(path.join(root, ds.expected), "utf8")) as Record<string, Expected>;
  const dir = path.join(root, ds.dir);
  const staleBefore = new Date();
  staleBefore.setFullYear(staleBefore.getFullYear() - config.staleYears);

  const m: EvalMetrics = {
    names: zero(),
    readings: zero(),
    rules: zero(),
    risk: { ok: 0, total: 0, under: 0 },
    recommendation: { ok: 0, total: 0 },
    leaks: { leaked: 0, total: 0 },
    secretLeaks: { leaked: 0, total: 0 },
    ocr: { found: 0, total: 0 },
    aiFailures: 0,
    files: [],
  };
  // 古い記録との互換のため EvalMetrics では省略可能にしているが、評価では必ず数える
  const secretLeaks = (m.secretLeaks = { leaked: 0, total: 0 });
  const t0 = performance.now();
  const entries = Object.entries(expected).filter(([, e]) => !e.skip_ai);
  for (const [i, [rel, e]] of entries.entries()) {
    const abs = path.join(dir, rel);
    const ext = path.extname(rel).slice(1).toLowerCase();
    const st = await fs.stat(abs);
    const r = await extract(await fs.readFile(abs), ext, undefined, { ctx: { ext } });
    const { findings, spans } = detect(r.text);

    // ルール検出（ファイル単位で種類を比べる）
    const truthTypes = new Set(e.types ?? []);
    const foundTypes = new Set<string>(findings.map((f) => f.type));
    const rules: Counts = { tp: [...foundTypes].filter((t) => truthTypes.has(t)).length, fp: 0, fn: 0 };
    rules.fp = foundTypes.size - rules.tp;
    rules.fn = truthTypes.size - rules.tp;
    addCounts(m.rules, rules);

    // AI の判定（アプリと同じ入力）
    let ai: AiJudgement | null = null;
    let error: string | null = null;
    try {
      ai = await judgeFile(
        {
          relPath: rel,
          sizeKb: Math.ceil(st.size / 1024),
          mtime: st.mtime.toISOString().slice(0, 10),
          isStale: st.mtime < staleBefore,
          isDuplicate: false,
          extractMethod: r.method,
          ruleSummary: findings.map((f) => `${f.label}×${f.count}`).join("、"),
          text: redact(r.text, spans).text.slice(0, JUDGE_TEXT_CHARS),
        },
        undefined,
        { ext },
      );
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 120) : String(err);
      m.aiFailures++;
    }

    // アプリと同じく、判定で拾いきれない氏名を補う
    let more = { names: [] as string[], readings: [] as string[] };
    if (r.text.trim()) {
      try {
        // 棚卸しと同じく、シートの位置は伏せた後の本文の位置に直して渡す
        const starts = r.sections ? toRedactedOffsets(spans, r.sections.map((x) => x.start)) : [];
        more = await collectMoreNames(
          redact(r.text, spans).text,
          ai ? { names: ai.person_names ?? [], readings: ai.name_readings ?? [] } : null,
          undefined,
          { ext },
          undefined,
          r.sections?.map((x, i) => ({ label: x.label, start: starts[i] })),
        );
      } catch (err) {
        error = error ?? (err instanceof Error ? err.message.slice(0, 120) : String(err));
      }
    }
    const aiNames = [...(ai?.person_names ?? []), ...more.names];
    const aiReadings = [...(ai?.name_readings ?? []), ...more.readings];
    const names = compare(aiNames, e.names ?? []);
    const readings = compare(aiReadings, e.readings ?? []);
    addCounts(m.names, names);
    addCounts(m.readings, readings);

    // 伏せる処理（AI と書式のルールを合わせる）のあとに、正解の氏名・読み仮名が残っていないか
    const targets = [...aiNames, ...findNamesByLayout(r.text), ...aiReadings, ...findNameReadings(r.text)];
    const masked = redact(r.text, spans, targets.filter((n) => norm(n).length >= 2)).text;
    const truthNames = [...(e.names ?? []), ...(e.readings ?? [])].filter((n) => containsLoose(r.text, n));
    const leaked = truthNames.filter((n) => containsLoose(masked, n)).length;
    m.leaks.leaked += leaked;
    m.leaks.total += truthNames.length;
    // 伏せられるべき番号（電話番号など）が、伏せたあとの本文に残っていないか（半角・全角の違いは無視して照合）
    const secrets = (e.secrets ?? []).filter((x) => containsLoose(r.text, x));
    const secretsLeaked = secrets.filter((x) => containsLoose(masked, x)).length;
    secretLeaks.leaked += secretsLeaked;
    secretLeaks.total += secrets.length;

    // リスクと推奨
    let riskOk: boolean | null = null;
    let recOk: boolean | null = null;
    if (ai && e.risk?.length) {
      riskOk = e.risk.includes(ai.risk);
      m.risk.total++;
      if (riskOk) m.risk.ok++;
      else if (RANK[ai.risk] < Math.min(...e.risk.map((x) => RANK[x]))) m.risk.under++;
    }
    if (ai && e.recommendation?.length) {
      recOk = e.recommendation.includes(ai.recommendation);
      m.recommendation.total++;
      if (recOk) m.recommendation.ok++;
    }

    // 文字の読み取り（画像のみ）
    let ocr: { found: number; total: number } | null = null;
    if (e.ocr?.length) {
      ocr = { found: e.ocr.filter((s) => containsLoose(r.text, s)).length, total: e.ocr.length };
      m.ocr.found += ocr.found;
      m.ocr.total += ocr.total;
    }

    m.files.push({
      rel,
      names,
      readings,
      rulesMissed: [...truthTypes].filter((t) => !foundTypes.has(t)),
      rulesExtra: [...foundTypes].filter((t) => !truthTypes.has(t)),
      risk: ai?.risk ?? null,
      riskOk,
      recommendation: ai?.recommendation ?? null,
      recommendationOk: recOk,
      leaked,
      secretsLeaked,
      ocr,
      error,
    });
    log(
      `[${i + 1}/${entries.length}] ${rel}  氏名 ${names.tp}/${names.tp + names.fn}` +
        `${names.fp ? ` (誤り${names.fp})` : ""}  リスク ${ai?.risk ?? "-"}${riskOk === false ? " ✗" : ""}` +
        `  推奨 ${ai?.recommendation ?? "-"}${recOk === false ? " ✗" : ""}${leaked ? `  伏せ漏れ ${leaked}` : ""}` +
        `${secretsLeaked ? `  番号の伏せ漏れ ${secretsLeaked}` : ""}` +
        `${ocr ? `  読み取り ${ocr.found}/${ocr.total}` : ""}${error ? `  エラー: ${error}` : ""}`,
    );
  }

  const durationMs = performance.now() - t0;
  let id: number | null = null;
  try {
    id = Number(
      db()
        .prepare(
          `INSERT INTO ai_evals (created_at, dataset, model, judge_version, ocr_version, files, duration_ms, metrics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(new Date().toISOString(), dataset, status.model ?? null, JUDGE_VERSION, OCR_VERSION, entries.length, Math.round(durationMs), JSON.stringify(m))
        .lastInsertRowid,
    );
  } catch {
    // 記録できなくても、結果は画面（コンソール）に出す
  }
  return { id, dataset, model: status.model ?? null, judgeVersion: JUDGE_VERSION, ocrVersion: OCR_VERSION, durationMs, metrics: m };
}

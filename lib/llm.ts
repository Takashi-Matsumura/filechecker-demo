import { config } from "./config";
import { markParseError, promptVersion, recordAiCall, type CallContext, type CallKind, type ErrorKind } from "./metrics";

/**
 * ローカル LLM（llama-server の OpenAI 互換 API）クライアント。
 * 外部には一切通信しない。接続先は config.llmBaseUrl のみ。
 */

type Content =
  | string
  | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

interface ChatOptions {
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
  /** 中断用。接続を切ると llama-server 側の生成も止まる */
  signal?: AbortSignal;
  /** 性能分析の記録（lib/metrics.ts）に残す情報 */
  track: { kind: CallKind; version: string; ctx?: CallContext; inputChars?: number };
}

interface ChatResult {
  content: string;
  /** 性能分析の記録の ID（JSON として読めなかったときに失敗へ直すため） */
  callId: number | null;
}

function errorKind(e: unknown, signal?: AbortSignal): ErrorKind {
  if (signal?.aborted) return "aborted"; // 中断（一時停止）による打ち切りは失敗に数えない
  if (e instanceof Error && e.name === "TimeoutError") return "timeout";
  if (e instanceof Error && e.message.startsWith("LLM HTTP")) return "http";
  return "network";
}

// llama-server の --parallel を超えないための簡易セマフォ
let concurrency = config.llmConcurrency ?? 2;

/** 同時実行数を決める（環境変数 > llama-server のスロット数 > 2） */
export async function resolveConcurrency(): Promise<number> {
  if (config.llmConcurrency) return (concurrency = config.llmConcurrency);
  try {
    const res = await fetch(`${config.llmBaseUrl}/props`, { signal: AbortSignal.timeout(3000) });
    const slots = ((await res.json()) as { total_slots?: number }).total_slots;
    if (slots && slots > 0) concurrency = slots;
  } catch {
    // 取れなければ前回値のまま
  }
  return concurrency;
}

let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < concurrency) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

/** llama-server のエラー応答（{"error":{"message":…}}）の message を短く取り出す。読めなければ空 */
async function llmErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: unknown } };
    const msg = typeof j.error?.message === "string" ? j.error.message : "";
    // 本文の引用を含まない、短い定型の説明だけを想定している。長いものは切る
    return msg ? `: ${msg.slice(0, 80)}` : "";
  } catch {
    return "";
  }
}

async function chat(system: string, user: Content, opts: ChatOptions): Promise<ChatResult> {
  opts.signal?.throwIfAborted();
  await acquire();
  // 順番待ちの間に中断された場合は、LLM に投げずに終える（記録もしない）
  if (opts.signal?.aborted) {
    release();
    opts.signal.throwIfAborted();
  }
  // 順番待ちの時間は含めず、LLM に投げてから返るまでを測る
  const startedAt = new Date();
  const t0 = performance.now();
  const record = (r: { ok: boolean; errorKind: ErrorKind | null; model?: string | null; usage?: { prompt_tokens?: number; completion_tokens?: number } }) =>
    recordAiCall({
      ...opts.track.ctx,
      kind: opts.track.kind,
      promptVersion: opts.track.version,
      inputChars: opts.track.inputChars ?? null,
      startedAt: startedAt.toISOString(),
      durationMs: performance.now() - t0,
      model: r.model ? r.model.split(/[\\/]/).pop()! : null,
      promptTokens: r.usage?.prompt_tokens ?? null,
      completionTokens: r.usage?.completion_tokens ?? null,
      ok: r.ok,
      errorKind: r.errorKind,
    });
  try {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: opts.maxTokens ?? 1024,
      // gemma4 の思考モードを切る。入れないと出力前に数百トークン考えて10倍以上遅くなる
      chat_template_kwargs: { enable_thinking: false },
    };
    if (opts.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "result", schema: opts.jsonSchema },
      };
    }
    const res = await fetch(`${config.llmBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(config.llmTimeoutMs)])
        : AbortSignal.timeout(config.llmTimeoutMs),
    });
    // 応答本文は保存先（画面・DB）に入ってもよい形に限る。llama-server のエラーの message だけを短く添える
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}${await llmErrorMessage(res)}`);
    const json = (await res.json()) as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices: { message: { content: string } }[];
    };
    const callId = record({ ok: true, errorKind: null, model: json.model, usage: json.usage });
    return { content: json.choices[0]?.message?.content ?? "", callId };
  } catch (e) {
    record({ ok: false, errorKind: errorKind(e, opts.signal) });
    throw e;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------- 状態確認

export interface LlmStatus {
  ok: boolean;
  model?: string;
  multimodal?: boolean;
  error?: string;
}

export async function llmStatus(): Promise<LlmStatus> {
  try {
    const res = await fetch(`${config.llmBaseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as {
      models?: { name: string; capabilities?: string[] }[];
      data?: { id: string }[];
    };
    const m = json.models?.[0];
    const model = m?.name ?? json.data?.[0]?.id;
    return {
      ok: true,
      model: model?.split("/").pop(),
      multimodal: m?.capabilities?.includes("multimodal") ?? false,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- OCR

const OCR_SYSTEM =
  "あなたは OCR エンジンです。画像に写っている文字を、読み取れる範囲ですべて書き起こしてください。表は1行1項目で「項目 値」の形にしてください。説明や前置きは書かないでください。";
const OCR_USER = "この画像の文字をすべて書き起こしてください。";
/** OCR の指示文の版（性能分析で、指示文の変更前後を比べるため） */
export const OCR_VERSION = promptVersion(OCR_SYSTEM, OCR_USER);

export async function ocrImage(jpeg: Uint8Array, signal?: AbortSignal, ctx?: CallContext): Promise<string> {
  const url = `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  const r = await chat(
    OCR_SYSTEM,
    [
      { type: "text", text: OCR_USER },
      { type: "image_url", image_url: { url } },
    ],
    { maxTokens: 2048, signal, track: { kind: "ocr", version: OCR_VERSION, ctx } },
  );
  return r.content;
}

// ---------------------------------------------------------------- 分類

export interface AiJudgement {
  summary: string;
  category: string;
  contains_personal_info: boolean;
  contains_confidential: boolean;
  risk: "high" | "medium" | "low" | "none";
  recommendation: "keep" | "restrict" | "archive" | "delete" | "review";
  reason: string;
  person_names: string[];
  /** 本文に書かれた氏名の読み仮名・ローマ字表記（伏せる対象。件数には数えない） */
  name_readings?: string[];
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    // 生成速度が律速なので出力長を抑える（12B で約 12 tok/s）
    summary: { type: "string", maxLength: 80, description: "ファイルの内容を60字以内で" },
    category: {
      type: "string",
      enum: ["名簿・顧客情報", "人事・労務", "経理・請求", "契約・法務", "営業資料", "議事録・社内文書", "身分証・申込書", "メモ", "その他"],
    },
    contains_personal_info: { type: "boolean" },
    contains_confidential: { type: "boolean" },
    risk: { type: "string", enum: ["high", "medium", "low", "none"] },
    recommendation: { type: "string", enum: ["keep", "restrict", "archive", "delete", "review"] },
    reason: { type: "string", maxLength: 60, description: "推奨アクションの理由を40字以内で" },
    person_names: { type: "array", items: { type: "string", maxLength: 20 }, maxItems: 20 },
    name_readings: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 20 },
  },
  required: ["summary", "category", "contains_personal_info", "contains_confidential", "risk", "recommendation", "reason", "person_names", "name_readings"],
};

export interface JudgeInput {
  relPath: string;
  sizeKb: number;
  mtime: string;
  isStale: boolean;
  isDuplicate: boolean;
  extractMethod: string;
  ruleSummary: string;
  text: string;
}

const JUDGE_SYSTEM = `あなたは社内ファイルの棚卸しを手伝うアシスタントです。
与えられたファイル情報と本文（一部マスク済み）から、内容の要約・分類・個人情報や機密情報の有無・推奨アクションを判断します。

推奨アクションの基準:
- restrict: 個人情報や機密を含み、業務上は必要そう。アクセス制限・暗号化された場所へ移す
- delete: 個人情報等を含むが目的を終えていそう（古い、重複、一時的なコピー）。削除を検討
- archive: 個人情報等は無いが古い・使われていない。アーカイブへ（古いかどうかは更新日で判断する。「長期間更新なし」と書かれたファイルだけに使い、本文中の日付からは判断しない）
- keep: 問題なし。そのまま
- review: 判断材料が足りない。人が確認

risk の基準: high=マイナンバー・カード番号・口座・身分証、または5人分以上の連絡先（電話・メール・住所）が並ぶ名簿・一覧 / medium=1〜4人分の連絡先、連絡先のない氏名だけの一覧（議事録の出席者・担当者名など）、機密表示 / low=軽微 / none=なし
person_names には本文中に出てくる個人の氏名だけを入れる（会社名・部署名・〔会社名〕のような空欄は入れない）。無ければ空配列。
name_readings には、本文にカタカナ・ひらがな・ローマ字で実際に書かれている氏名の読み（「フリガナ」「ふりがな」欄など）だけを、本文の表記どおりに書き写す。漢字の氏名から読みを推測して作ってはいけない。たとえば本文に「山田 太郎」とだけあり読みが書かれていなければ、name_readings は空配列にする。
出力は改行やインデントを入れない1行の JSON にする。summary は60字以内、reason は40字以内で簡潔に。summary と reason には個人の氏名や連絡先を書かない（「顧客1名の申込書」のように一般化する）。
見積金額や取引条件など通常の業務情報だけなら機密扱いにしない（「社外秘」等の明示や契約金額がある場合は機密）。
予算・実績・売上・経費・達成率などの社内の数値の表や集計も、金額の大小や入力の有無にかかわらず、「社外秘」等の明示が無ければ機密扱いにしない（risk は none、推奨は keep）。明示があれば medium で restrict。
本文に書かれていない事実を推測で補わないこと。`;
/** 判定の指示文と出力形式の版（性能分析で、指示文の変更前後を比べるため） */
export const JUDGE_VERSION = promptVersion(JUDGE_SYSTEM, JSON.stringify(JUDGE_SCHEMA));

export async function judgeFile(input: JudgeInput, signal?: AbortSignal, ctx?: CallContext): Promise<AiJudgement> {
  const system = JUDGE_SYSTEM;
  const user = `パス: ${input.relPath}
サイズ: ${input.sizeKb} KB / 更新日: ${input.mtime}${input.isStale ? "（長期間更新なし）" : ""}${input.isDuplicate ? " / 同一内容のファイルが他にもある" : ""}
抽出方法: ${input.extractMethod}
ルール検出: ${input.ruleSummary || "なし"}

本文:
"""
${input.text || "（本文なし）"}
"""`;
  const r = await chat(system, user, {
    maxTokens: 700,
    jsonSchema: JUDGE_SCHEMA,
    signal,
    track: { kind: "judge", version: JUDGE_VERSION, ctx, inputChars: input.text.length },
  });
  try {
    return parseJudgement(r.content);
  } catch (e) {
    markParseError(r.callId);
    throw e;
  }
}

/**
 * AI の応答を読む。JSON でない応答のエラー文には応答の先頭（氏名を含みうる）がそのまま入るので、
 * 中身を含まない文面に置き換える（エラーは画面と DB に残るため）。
 */
function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI の応答を JSON として読み取れませんでした");
  }
}

const RISKS = ["high", "medium", "low", "none"] as const;
const RECS = ["keep", "restrict", "archive", "delete", "review"] as const;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, max)) : [];

/**
 * 判定の応答を、出力形式（JUDGE_SCHEMA）どおりかを確かめながら読む。
 * llama-server は形式を守らせるが、守られなかった場合に想定外の値で後の処理が誤動作しないよう、
 * リスクと推奨が決められた値でなければ失敗として扱う（ルールの結果から推定する経路に回る）。
 */
export function parseJudgement(content: string): AiJudgement {
  const v = parseJson(content) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") throw new Error("AI の応答の形式が想定と異なります");
  const risk = RISKS.find((x) => x === v.risk);
  const recommendation = RECS.find((x) => x === v.recommendation);
  if (!risk || !recommendation) throw new Error("AI の応答のリスクまたは推奨が想定外の値です");
  return {
    summary: str(v.summary, 200),
    category: str(v.category, 40) || "その他",
    contains_personal_info: v.contains_personal_info === true,
    contains_confidential: v.contains_confidential === true,
    risk,
    recommendation,
    reason: str(v.reason, 200),
    person_names: strList(v.person_names, 100),
    name_readings: strList(v.name_readings, 100),
  };
}

// ---------------------------------------------------------------- 氏名の補完

/** 判定（judgeFile）が返す氏名・読み仮名の上限（JUDGE_SCHEMA の maxItems） */
export const JUDGE_NAME_CAP = 20;
/** 判定が見る本文の長さ（呼び出し側が本文をこの長さで切って渡す） */
export const JUDGE_TEXT_CHARS = 6000;
/** 氏名の補完で、1回に返せる氏名・読み仮名の上限 */
const NAMES_CAP = 40;
/** 氏名の補完で見る区切りの数の上限（時間がかかりすぎないように。6000字 × 10 = 6万字） */
export const MAX_NAME_CHUNKS = 10;
/** 区切りの境目で氏名が切れないよう、前の区切りと重ねる文字数 */
const CHUNK_OVERLAP = 60;

const NAMES_SCHEMA = {
  type: "object",
  properties: {
    person_names: { type: "array", items: { type: "string", maxLength: 20 }, maxItems: NAMES_CAP },
    name_readings: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: NAMES_CAP },
  },
  required: ["person_names", "name_readings"],
};

const NAMES_SYSTEM = `あなたは文書から個人の氏名を書き出すアシスタントです。
本文（一部マスク済み）に出てくる個人の氏名を、本文の表記どおりにすべて person_names に入れる（会社名・部署名・〔会社名〕のような空欄は入れない）。
name_readings には、本文にカタカナ・ひらがな・ローマ字で実際に書かれている氏名の読み（「フリガナ」欄など）だけを書き写す。漢字の氏名から読みを推測して作ってはいけない。
「見つけ済み」に挙げた氏名と読みは入れず、それ以外をすべて入れる。無ければ空配列。
出力は改行やインデントを入れない1行の JSON にする。`;
/** 氏名の補完の指示文の版（性能分析で、指示文の変更前後を比べるため） */
export const NAMES_VERSION = promptVersion(NAMES_SYSTEM, JSON.stringify(NAMES_SCHEMA));

async function extractNames(
  text: string,
  found: string[],
  signal?: AbortSignal,
  ctx?: CallContext,
): Promise<{ person_names: string[]; name_readings: string[] }> {
  const user = `見つけ済み: ${found.length ? found.join("、") : "なし"}

本文:
"""
${text}
"""`;
  const r = await chat(NAMES_SYSTEM, user, {
    // 氏名1件で十数トークン。上限いっぱいでも収まる長さにする
    maxTokens: 1200,
    jsonSchema: NAMES_SCHEMA,
    signal,
    track: { kind: "names", version: NAMES_VERSION, ctx, inputChars: text.length },
  });
  try {
    const v = parseJson(r.content) as { person_names?: unknown; name_readings?: unknown } | null;
    return { person_names: strList(v?.person_names, 100), name_readings: strList(v?.name_readings, 100) };
  } catch (e) {
    markParseError(r.callId);
    throw e;
  }
}

/**
 * 判定（judgeFile）で拾いきれない氏名・読み仮名を補う。
 * 判定は本文の先頭 JUDGE_TEXT_CHARS 字しか見ず、氏名も JUDGE_NAME_CAP 件までしか返さないため、
 * 判定が上限に達したとき・本文がそれより長いとき・判定に失敗したときに、本文を区切って氏名だけを聞き直す。
 * 区切りごとに、見つけ済みの氏名を除いて聞き、上限に達したら同じ区切りを最大3回まで聞き直す。
 * truncated: 本文が長く、先頭 MAX_NAME_CHUNKS 区切りまでしか見ていない
 */
export async function collectMoreNames(
  maskedText: string,
  judged: { names: string[]; readings: string[] } | null,
  signal?: AbortSignal,
  ctx?: CallContext,
  /** 区切りを1つ聞き始めるたびに呼ぶ（棚卸しの画面に「氏名の確認 3 / 10」と出すため） */
  onStep?: (step: number, total: number) => void,
): Promise<{ names: string[]; readings: string[]; truncated: boolean }> {
  const capped = !judged || judged.names.length >= JUDGE_NAME_CAP || judged.readings.length >= JUDGE_NAME_CAP;
  const names: string[] = [];
  const readings: string[] = [];
  const key = (s: string) => s.replace(/[\s　]/g, "");
  const seen = new Set([...(judged?.names ?? []), ...(judged?.readings ?? [])].map(key));
  const add = (list: string[], into: string[]) => {
    let added = 0;
    for (const n of list) {
      const k = key(n);
      if (k.length < 2 || seen.has(k)) continue;
      seen.add(k);
      into.push(n.trim());
      added++;
    }
    return added;
  };

  const chunks: string[] = [];
  for (let start = 0; start < maskedText.length; start += JUDGE_TEXT_CHARS) {
    chunks.push(maskedText.slice(Math.max(0, start - CHUNK_OVERLAP), start + JUDGE_TEXT_CHARS));
  }
  const targets = chunks.slice(0, MAX_NAME_CHUNKS);
  // 聞き直す区切りの数（先頭の区切りは、判定が上限に達していなければ聞き直さない）
  const steps = targets.length - (capped ? 0 : 1);
  let step = 0;
  for (const [i, chunk] of targets.entries()) {
    // 先頭の区切りは判定が見ているので、判定が上限に達していなければ聞き直さない
    if (i === 0 && !capped) continue;
    onStep?.(++step, steps);
    for (let round = 0; round < 3; round++) {
      signal?.throwIfAborted();
      const r = await extractNames(chunk, [...(judged?.names ?? []), ...(judged?.readings ?? []), ...names, ...readings], signal, ctx);
      const added = add(r.person_names, names) + add(r.name_readings, readings);
      // 上限に達していなければ、この区切りは聞き終わり。新しく見つからなくなったときも打ち切る
      if ((r.person_names.length < NAMES_CAP && r.name_readings.length < NAMES_CAP) || added === 0) break;
    }
  }
  return { names, readings, truncated: chunks.length > MAX_NAME_CHUNKS };
}

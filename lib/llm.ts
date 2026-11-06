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
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
- archive: 個人情報等は無いが古い・使われていない。アーカイブへ
- keep: 問題なし。そのまま
- review: 判断材料が足りない。人が確認

risk の基準: high=マイナンバー・カード番号・口座・身分証や大量の個人情報 / medium=少数の連絡先や機密表示 / low=軽微 / none=なし
person_names には本文中に出てくる個人の氏名だけを入れる（会社名・部署名・〔会社名〕のような空欄は入れない）。無ければ空配列。
name_readings には、本文中に書かれている氏名の読み仮名（フリガナ・ふりがな）やローマ字表記を、本文の表記どおりに入れる。本文に無い読みを推測で作らない。無ければ空配列。
出力は改行やインデントを入れない1行の JSON にする。summary は60字以内、reason は40字以内で簡潔に。summary と reason には個人の氏名や連絡先を書かない（「顧客1名の申込書」のように一般化する）。
見積金額や取引条件など通常の業務情報だけなら機密扱いにしない（「社外秘」等の明示や契約金額がある場合は機密）。
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
    return JSON.parse(r.content) as AiJudgement;
  } catch (e) {
    markParseError(r.callId);
    throw e;
  }
}

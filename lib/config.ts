import os from "node:os";
import path from "node:path";

/** アプリ全体の設定。すべて環境変数で上書きできる。 */
export const config = {
  /** ローカル LLM（llama-server, OpenAI 互換 API） */
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:8080",
  /** LLM への同時リクエスト数。未指定なら llama-server の /props（total_slots）から自動で決める */
  llmConcurrency: process.env.LLM_CONCURRENCY ? Number(process.env.LLM_CONCURRENCY) : null,
  /** 1リクエストのタイムアウト(ms)。OCR は時間がかかるので長め */
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180_000),

  /**
   * スキャンを許可するルート。ここ配下以外のフォルダは指定できない。
   * 既定はホームディレクトリ。複数指定は OS のパス区切り（: ）で連結する。
   */
  allowedRoots: (process.env.SCAN_ALLOWED_ROOTS ?? os.homedir())
    .split(path.delimiter)
    .filter(Boolean)
    .map((p) => path.resolve(p)),

  /** 1スキャンで扱う最大ファイル数 */
  maxFiles: Number(process.env.SCAN_MAX_FILES ?? 2000),
  /** 内容を読む最大ファイルサイズ(byte)。超えるものはメタ情報だけ */
  maxReadBytes: Number(process.env.SCAN_MAX_READ_BYTES ?? 30 * 1024 * 1024),
  /** 検出対象にするテキストの最大文字数 */
  maxTextChars: 200_000,
  /** OCR する PDF の最大ページ数 */
  maxOcrPages: 3,
  /** この年数以上更新のないファイルを「古い」とみなす */
  staleYears: 3,

  /** SQLite の保存先 */
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), "data", "filechecker.db"),
} as const;

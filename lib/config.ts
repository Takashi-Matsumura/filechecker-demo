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

  /**
   * 1スキャンで扱う最大ファイル数。極端に大きなフォルダのときだけ働く安全のための上限。
   * 10万件で結果画面の集計は約0.6秒、棚卸しは1件4〜5秒として約5日かかる。
   * 超えた分は棚卸しせず、画面に「上限で打ち切り」と表示する
   */
  maxFiles: Number(process.env.SCAN_MAX_FILES ?? 100_000),
  /** 内容を読む最大ファイルサイズ(byte)。超えるものはメタ情報だけ */
  maxReadBytes: Number(process.env.SCAN_MAX_READ_BYTES ?? 30 * 1024 * 1024),
  /** 検出対象にするテキストの最大文字数 */
  maxTextChars: 200_000,
  /** OCR する PDF の最大ページ数 */
  maxOcrPages: 3,
  /** Office の ZIP 展開で許す、展開後サイズ（ヘッダ申告値）の合計上限 */
  maxUnzippedBytes: 50 * 1024 * 1024,
  /** Office の ZIP で展開対象にする XML の最大数 */
  maxZipEntries: 500,
  /** デコードを許す画像の最大画素数（ピクセル爆弾対策） */
  maxImagePixels: 50_000_000,
  /** PDF を OCR 用に描画するときの最大画素数（LLM には 1600px に縮めて渡すので小さくてよい） */
  maxRenderPixels: 4_000_000,
  /** この年数以上更新のないファイルを「古い」とみなす */
  staleYears: 3,

  /** SQLite の保存先 */
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), "data", "filechecker.db"),
} as const;

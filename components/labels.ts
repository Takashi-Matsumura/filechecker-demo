export type Level = "high" | "medium" | "low" | "none";

export const RISK: Record<Level, { label: string; badge: string; dot: string }> = {
  high: { label: "高", badge: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  medium: { label: "中", badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  low: { label: "低", badge: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  none: { label: "なし", badge: "bg-stone-100 text-stone-600 ring-stone-200", dot: "bg-stone-300" },
};

export const RISK_ORDER: Record<Level, number> = { high: 3, medium: 2, low: 1, none: 0 };

export const RECOMMENDATION: Record<string, { label: string; hint: string; className: string }> = {
  restrict: { label: "アクセス制限", hint: "保護された場所へ移す", className: "text-red-700" },
  delete: { label: "削除を検討", hint: "目的を終えた可能性", className: "text-orange-700" },
  archive: { label: "アーカイブ", hint: "古い資料として退避", className: "text-sky-700" },
  review: { label: "要確認", hint: "人の判断が必要", className: "text-amber-700" },
  keep: { label: "そのまま", hint: "問題なし", className: "text-stone-500" },
};

export const METHOD: Record<string, string> = {
  text: "テキスト",
  office: "Office",
  "pdf-text": "PDF",
  ocr: "OCR",
  none: "—",
};

export const STATUS: Record<string, string> = {
  queued: "待機中",
  walking: "ファイル一覧を作成中",
  processing: "解析中",
  pausing: "中断しています…",
  paused: "中断中",
  done: "完了",
  error: "エラー",
};

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

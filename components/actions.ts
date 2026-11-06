import type { Level } from "./labels";

/** 画面で使うファイル情報（/api/scans/[id] の files の要素） */
export interface FileItem {
  id: number;
  rel_path: string;
  ext: string;
  kind: string;
  size: number;
  mtime: string;
  status: string;
  error: string | null;
  extract_method: string | null;
  findings: { type: string; label: string; level: Level; count: number }[];
  ai: { summary?: string; category?: string; recommendation?: string; reason?: string } | null;
  risk: Level;
  is_stale: boolean;
  dup_of: number | null;
  action_status: "todo" | "done" | "skipped";
  action_at: string | null;
}

export interface ScanData {
  scan: {
    id: number;
    root: string;
    status: string;
    total: number;
    processed: number;
    error: string | null;
    created_at: string;
    finished_at: string | null;
  };
  files: FileItem[];
  /** サーバ（= 社員の PC）の OS に応じた表示 */
  platform?: { os: "mac" | "windows" | "linux"; revealLabel: string; sep: string };
}

export type Bucket = "move" | "remove" | "tidy" | "check" | "ok";

/**
 * 社員に見せる「やること」の区分。
 * 文面は短く、何をすればよいかだけを書く。保存先の指定はしない（保存先アプリが用意できたら差し替える）。
 */
export const BUCKETS: Record<Exclude<Bucket, "ok">, { verb: string; hint: string; dot: string; ring: string; text: string }> = {
  move: {
    verb: "移す",
    hint: "個人情報や機密情報があります。共有フォルダやデスクトップに置かないでください",
    dot: "bg-red-500",
    ring: "ring-red-200",
    text: "text-red-700",
  },
  remove: {
    verb: "消す",
    hint: "重複しているか、役目を終えています。不要なら削除してください",
    // 「移す」の赤と取り違えないよう、色相の離れた紫にする
    dot: "bg-violet-500",
    ring: "ring-violet-200",
    text: "text-violet-700",
  },
  tidy: {
    verb: "整理する",
    hint: "3年以上使っていません。不要なら削除してください",
    dot: "bg-sky-500",
    ring: "ring-sky-200",
    text: "text-sky-700",
  },
  check: {
    verb: "確認する",
    hint: "判断がつきませんでした。中身を見てください",
    dot: "bg-amber-500",
    ring: "ring-amber-200",
    text: "text-amber-700",
  },
};

export const BUCKET_ORDER: Exclude<Bucket, "ok">[] = ["move", "remove", "tidy", "check"];

/**
 * 中身を確認できなかった理由。確認できていれば null。
 * 読み込みに失敗したファイルと、形式が未対応・大きすぎるなどで中身を読まなかったファイル。
 */
export function unreadReason(f: FileItem): string | null {
  if (f.status === "error") return "読み込みエラー";
  if (f.status === "done" && (f.extract_method === "none" || f.extract_method === null)) return "中身未確認";
  return null;
}

export function bucketOf(f: FileItem): Bucket {
  // 中身を確認できなかったファイル（読み込みエラー・未対応の形式・大きすぎる）は、常に人に確かめてもらう。
  // 名前や日付だけでは、安全とも、消してよいとも言えないため（AI の推奨や重複・古さより優先する）
  if (unreadReason(f) !== null) return "check";
  if (f.status !== "done") return "ok"; // 解析中はやることに含めない
  switch (f.ai?.recommendation) {
    case "restrict":
      return "move";
    case "delete":
      return "remove";
    case "archive":
      return "tidy";
    case "review":
      return "check";
    case "keep":
      return "ok";
  }
  // AI の判定が無い場合はルールの結果から決める
  if (f.dup_of !== null) return "remove";
  if (f.risk === "high") return "move";
  if (f.risk === "medium") return "check";
  if (f.is_stale) return "tidy";
  return "ok";
}

const LEVEL_RANK: Record<Level, number> = { high: 3, medium: 2, low: 1, none: 0 };

/**
 * 理由タグ。先頭がいちばん効く理由（区分の理由）で、残りは補足。
 * 区分は1つに決まるため、隠れてしまう理由（重複・古い・個人情報）を補足として見せる。
 */
export function reasonTags(f: FileItem): string[] {
  const tags: string[] = [];
  if (f.dup_of !== null) tags.push("重複");
  const top = [...f.findings]
    .filter((x) => x.type !== "person_name")
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.count - a.count)[0];
  if (top) tags.push(`${top.label} ${top.count}件`);
  else if (f.findings.some((x) => x.type === "person_name")) tags.push("氏名あり");
  if (f.is_stale) tags.push(`${new Date(f.mtime).getFullYear()}年から更新なし`);
  // 中身を確認できなかったことは必ず見せる（ほかに理由がなければ、これが区分の理由になる）
  const unread = unreadReason(f);
  if (unread) tags.push(unread);
  return tags.length > 0 ? tags : [f.ai?.category ?? "要確認"];
}

/** 漏れたときの影響が特に大きい情報。件数より種類を優先して並べる */
const CRITICAL = new Set(["mynumber", "credit_card", "bank_account", "id_document"]);

/** 優先度（大きいほど先）: リスク → 重大な情報の件数 → その他の検出件数 → 区分 */
export function priority(f: FileItem): number {
  const bucketWeight: Record<Bucket, number> = { move: 4, remove: 3, check: 2, tidy: 1, ok: 0 };
  const critical = f.findings.filter((x) => CRITICAL.has(x.type)).reduce((n, x) => n + x.count, 0);
  const others = f.findings.filter((x) => !CRITICAL.has(x.type)).reduce((n, x) => n + x.count, 0);
  return LEVEL_RANK[f.risk] * 1_000_000 + Math.min(critical, 99) * 10_000 + Math.min(others, 99) * 10 + bucketWeight[bucketOf(f)];
}

// Windows ではパス区切りが \ になるので両方で分割する
export const fileName = (rel: string) => rel.split(/[\\/]/).pop() ?? rel;
export const folderOf = (rel: string) => rel.split(/[\\/]/).slice(0, -1).join(" / ") || "（直下）";

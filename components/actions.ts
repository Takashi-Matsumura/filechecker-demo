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
    dot: "bg-orange-500",
    ring: "ring-orange-200",
    text: "text-orange-700",
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

export function bucketOf(f: FileItem): Bucket {
  if (f.status !== "done") return "ok"; // 解析中・エラーはやることに含めない
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

/** 理由タグは1つだけ。いちばん効く理由を選ぶ */
export function reasonTag(f: FileItem): string {
  if (f.dup_of !== null) return "重複";
  const top = [...f.findings]
    .filter((x) => x.type !== "person_name")
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.count - a.count)[0];
  if (top) return `${top.label} ${top.count}件`;
  if (f.findings.some((x) => x.type === "person_name")) return "氏名あり";
  if (f.is_stale) return `${new Date(f.mtime).getFullYear()}年から更新なし`;
  return f.ai?.category ?? "要確認";
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

export const fileName = (rel: string) => rel.split("/").pop() ?? rel;
export const folderOf = (rel: string) => rel.split("/").slice(0, -1).join("/") || ".";

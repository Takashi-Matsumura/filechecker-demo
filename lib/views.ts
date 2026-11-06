/**
 * 棚卸し結果の画面用の集計（サーバ側）。
 * ファイルが何万件あっても画面が重くならないよう、集計と1ページ分の行だけを返す。
 * 区分・優先度の判定は画面と同じ処理（components/actions.ts）を使う。
 */
import { BUCKET_ORDER, bucketOf, priority, unreadReason, type Bucket, type FileItem } from "@/components/actions";
import { RISK_ORDER } from "@/components/labels";
import { listFileItems } from "./scanner";

export const PAGE_SIZE = 50;

type ActionBucket = Exclude<Bucket, "ok">;
type Entry = { f: FileItem; bucket: ActionBucket };

export const ACTION_FILTERS = ["all", "move", "remove", "tidy", "check", "handled"] as const;
export type ActionFilter = (typeof ACTION_FILTERS)[number];

export interface Page<T> {
  rows: T[];
  page: number;
  pages: number;
  /** 絞り込み後の件数 */
  count: number;
}

function paginate<T>(list: T[], page: number): Page<T> {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { rows: list.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), page: p, pages, count: list.length };
}

export interface ActionsView extends Page<Entry> {
  /** 対応が必要なファイルの総数（対応済み・対応しないを含む） */
  total: number;
  todoCount: number;
  handledCount: number;
  okCount: number;
  unreadCount: number;
  /** 「まずこの3件」以外の、区分ごとの残り件数 */
  counts: Record<ActionBucket, number>;
  restCount: number;
  top: Entry[];
}

/** やること画面: 進み具合・まずこの3件・区分ごとの件数と、表の1ページ分 */
export function actionsView(scanId: number, filter: ActionFilter, page: number): ActionsView {
  const files = listFileItems(scanId) as FileItem[];
  const actionable: Entry[] = [];
  let okCount = 0;
  for (const f of files) {
    const bucket = bucketOf(f);
    if (bucket === "ok") {
      if (f.status === "done") okCount++;
    } else actionable.push({ f, bucket });
  }
  const todo = actionable.filter((x) => x.f.action_status === "todo").sort((a, b) => priority(b.f) - priority(a.f));
  // 新しく対応したものが上に来るように
  const handled = actionable
    .filter((x) => x.f.action_status !== "todo")
    .sort((a, b) => (b.f.action_at ?? "").localeCompare(a.f.action_at ?? ""));
  const top = todo.slice(0, 3);
  // 表は区分ごとにまとめ、区分の中は優先度順
  const rest = todo
    .slice(3)
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || priority(b.f) - priority(a.f));
  const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, rest.filter((x) => x.bucket === b).length])) as Record<ActionBucket, number>;
  const list = filter === "all" ? rest : filter === "handled" ? handled : rest.filter((x) => x.bucket === filter);
  return {
    ...paginate(list, page),
    total: actionable.length,
    todoCount: todo.length,
    handledCount: handled.length,
    okCount,
    unreadCount: todo.filter((x) => unreadReason(x.f) !== null).length,
    counts,
    restCount: rest.length,
    top,
  };
}

export const ANALYSIS_FILTERS = ["all", "high", "medium", "personal", "dup", "stale", "issue"] as const;
export type AnalysisFilter = (typeof ANALYSIS_FILTERS)[number];

const hasPersonal = (f: FileItem) => f.findings.some((x) => x.type !== "confidential");

function matches(f: FileItem, filter: AnalysisFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "high":
      return f.risk === "high";
    case "medium":
      return f.risk === "medium";
    case "personal":
      return hasPersonal(f);
    case "dup":
      return f.dup_of !== null;
    case "stale":
      return f.is_stale;
    case "issue":
      return f.status === "error" || f.extract_method === "none";
  }
}

export interface AnalysisView extends Page<FileItem> {
  stats: {
    total: number;
    high: number;
    medium: number;
    personal: number;
    dup: number;
    stale: number;
    ocr: number;
    byType: { label: string; files: number; count: number }[];
    byRec: Record<string, number>;
  };
}

/** 詳しい分析: 全体の集計と、絞り込み・検索した一覧の1ページ分 */
export function analysisView(scanId: number, filter: AnalysisFilter, q: string, page: number): AnalysisView {
  const files = listFileItems(scanId) as FileItem[];
  const done = files.filter((f) => f.status !== "pending");
  const byType = new Map<string, { label: string; files: number; count: number }>();
  const byRec: Record<string, number> = {};
  for (const f of done) {
    for (const x of f.findings) {
      const cur = byType.get(x.type) ?? { label: x.label, files: 0, count: 0 };
      cur.files++;
      cur.count += x.count;
      byType.set(x.type, cur);
    }
    const r = f.ai?.recommendation;
    if (r) byRec[r] = (byRec[r] ?? 0) + 1;
  }
  const needle = q.trim().toLowerCase();
  const list = files
    .filter((f) => matches(f, filter))
    .filter((f) => !needle || f.rel_path.toLowerCase().includes(needle) || f.ai?.summary?.toLowerCase().includes(needle))
    .sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.rel_path.localeCompare(b.rel_path, "ja"));
  return {
    ...paginate(list, page),
    stats: {
      total: files.length,
      high: done.filter((f) => f.risk === "high").length,
      medium: done.filter((f) => f.risk === "medium").length,
      personal: done.filter(hasPersonal).length,
      dup: files.filter((f) => f.dup_of !== null).length,
      stale: files.filter((f) => f.is_stale).length,
      ocr: done.filter((f) => f.extract_method === "ocr").length,
      byType: [...byType.values()].sort((a, b) => b.files - a.files),
      byRec,
    },
  };
}

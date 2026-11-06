"use client";

/** 表のページ送り。「51–100件 / 230件」と前後のボタン */
export function Pager({
  page,
  pages,
  count,
  pageSize,
  onPage,
}: {
  page: number;
  pages: number;
  count: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(count, (page + 1) * pageSize);
  const btn =
    "rounded-md bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav className="flex items-center justify-end gap-2 text-xs text-stone-500" aria-label="ページ送り">
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()}件 / {count.toLocaleString()}件
      </span>
      <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 0}>
        前へ
      </button>
      <span className="tabular-nums">
        {page + 1} / {pages}
      </span>
      <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>
        次へ
      </button>
    </nav>
  );
}

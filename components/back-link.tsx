import Link from "next/link";

/**
 * 1つ前の画面へ戻るアイコンボタン。見出しの左隣に置く。
 * 行き先は aria-label とツールチップ（title）で伝える。
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </Link>
  );
}

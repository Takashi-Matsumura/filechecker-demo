/**
 * ロゴマーク（書類とルーペ）。書類の1行がハイライトされ、ルーペで見つけている。
 * ブラウザのタブのアイコン（app/icon.svg）と同じ絵柄。
 */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="48" height="48" rx="11" fill="#0f766e" />
      <rect x="10" y="8.5" width="21" height="28" rx="3" fill="#ffffff" />
      <path d="M14.5 15h12M14.5 25.5h7" stroke="#0f766e" strokeWidth={2.4} strokeLinecap="round" />
      <rect x="13.2" y="18.2" width="14.6" height="4" rx="2" fill="#fbbf24" />
      <circle cx="30" cy="30" r="6.5" fill="#0f766e" stroke="#ffffff" strokeWidth={3} />
      <path d="M34.8 34.8l4.2 4.2" stroke="#ffffff" strokeWidth={3.4} strokeLinecap="round" />
    </svg>
  );
}

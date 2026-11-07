"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * トップ画面に置く紹介動画のサムネイル。押すと「紹介動画」の画面（/guide）に移って再生する。
 * 動画（とサムネイル）がまだ作られていなければ、何も表示しない。
 */
export function IntroVideoCard() {
  const [missing, setMissing] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // 画面が動き出す前に画像の読み込みに失敗していると onError が呼ばれないので、表示した時点でも確かめる
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) setMissing(true);
  }, []);
  if (missing) return null;

  return (
    <Link
      href="/guide"
      aria-label="紹介動画を見る（約 6 分）"
      title="紹介動画を見る"
      className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
    >
      {/* サムネイルは build.mjs が作る静止画。next/image の最適化は不要なので img を使う */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={img} src="/api/intro-video/thumbnail" alt="" className="h-full w-full object-cover transition group-hover:opacity-90" onError={() => setMissing(true)} />
      {/* サムネイルの下側は、再生ボタンのために空けてある（build.mjs） */}
      <span className="absolute inset-x-0 bottom-[12%] flex items-center justify-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-700/90 shadow-lg ring-4 ring-white/70 transition group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 text-white" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      </span>
    </Link>
  );
}

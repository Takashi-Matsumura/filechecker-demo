"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * トップ画面に置く紹介動画のサムネイル。押すと、その場で動画を再生する。
 * 動画（とサムネイル）がまだ作られていなければ、何も表示しない。
 */
export function IntroVideoCard() {
  const [state, setState] = useState<"thumb" | "playing" | "missing">("thumb");
  const img = useRef<HTMLImageElement>(null);
  // 画面が動き出す前に画像の読み込みに失敗していると onError が呼ばれないので、表示した時点でも確かめる
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) setState("missing");
  }, []);
  if (state === "missing") return null;

  return (
    <div className="w-full space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-stone-200 bg-stone-900 shadow-sm">
        {state === "playing" ? (
          <video src="/api/intro-video" controls autoPlay playsInline className="h-full w-full" onError={() => setState("missing")} />
        ) : (
          <button type="button" onClick={() => setState("playing")} className="group block h-full w-full" aria-label="紹介動画を再生する">
            {/* サムネイルは build.mjs が作る静止画。next/image の最適化は不要なので img を使う */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={img} src="/api/intro-video/thumbnail" alt="" className="h-full w-full object-cover transition group-hover:opacity-90" onError={() => setState("missing")} />
            {/* サムネイルの下側は、再生ボタンのために空けてある（build.mjs） */}
            <span className="absolute inset-x-0 bottom-[12%] flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-700/90 shadow-lg ring-4 ring-white/70 transition group-hover:scale-105">
                <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 text-white" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-stone-600">
        <span className="font-semibold text-stone-800">はじめての方へ：紹介動画（約 6 分）</span>
        <br />
        AI に任せきりにしてはいけない理由も説明しています。
        <Link href="/guide" className="ml-1 text-teal-700 underline-offset-2 hover:underline">
          大きな画面で見る
        </Link>
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * 紹介動画の再生。動画は /api/intro-video から配信する（docs/video/build.mjs で作ったもの）。
 * まだ作られていなければ、作り方を案内する。
 */
export function IntroVideo() {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-sm leading-relaxed text-amber-900">
        <p className="font-semibold">紹介動画がまだ作られていません。</p>
        <p className="mt-1">
          このアプリのフォルダで <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">node docs/video/build.mjs</code>{" "}
          を実行すると作られます（VOICEVOX か macOS の読み上げ音声、Google Chrome、ffmpeg が必要です）。
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-black shadow-sm">
      {/* 字幕は動画に焼き込んであるので、字幕トラックは付けない */}
      <video src="/api/intro-video" controls preload="metadata" playsInline className="aspect-video w-full" onError={() => setMissing(true)} />
    </div>
  );
}

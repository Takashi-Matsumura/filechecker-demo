import type { Metadata } from "next";
import { IntroVideo } from "@/components/intro-video";

export const metadata: Metadata = {
  title: "紹介動画 | ファイル棚卸しアシスタント",
};

/** 紹介動画の画面。使い始める前に見てもらう（何ができるか・なぜローカル AI か・AI の限界・責任は利用者にあること） */
export default function GuidePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">紹介動画（約 6 分）</h1>
        <p className="mt-1 text-sm text-stone-600">使い始める前に、一度ご覧ください。このアプリで何ができるか、なぜローカル AI を使うのか、そして AI に任せきりにしてはいけない理由を説明しています。</p>
      </div>
      <IntroVideo />
      <section className="rounded-xl border border-stone-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-stone-800">動画で伝えている大事なこと</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-stone-700">
          <li>AI は見つける手伝いです。最後に判断し、責任を持つのは、ファイルを持っている一人ひとりです。</li>
          <li>AI は間違えます。氏名の見落としや、かすれた文字の読み違い、判断のゆれがあります。</li>
          <li>「問題が見つからなかった」は、入っていないことの保証ではありません。</li>
          <li>やることリストの推奨は提案です。アプリがファイルを消したり移したりすることはありません。</li>
        </ul>
      </section>
    </div>
  );
}

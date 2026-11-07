import { IntroVideoCard } from "@/components/intro-video-card";
import { ScanHistory } from "@/components/scan-history";
import { ScanStarter } from "@/components/scan-starter";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="grid items-start gap-6 md:grid-cols-[1fr_20rem]">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">フォルダを棚卸しする</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-stone-600">
            指定したフォルダの中身を読み取り、個人情報・機密情報が含まれていそうなファイル、重複や古いファイルを洗い出します。
            Office・PDF に加えて、スキャンした書類や画像もローカル LLM で文字を読み取ります。
            ファイルの中身がこの PC の外に送られることはありません。
          </p>
        </div>
        {/* 紹介動画のサムネイル。押すとその場で再生する（動画が無ければ表示しない） */}
        <IntroVideoCard />
      </section>
      <ScanStarter />
      <ScanHistory />
    </div>
  );
}

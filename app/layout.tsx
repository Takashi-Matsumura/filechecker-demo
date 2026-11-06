import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "ファイル棚卸しアシスタント",
  description: "ローカル LLM でフォルダ内のファイルを棚卸しし、個人情報や機密情報の所在を見える化するデモ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Logo />
              ファイル棚卸しアシスタント
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/ai" className="text-xs text-stone-600 underline-offset-2 hover:text-teal-700 hover:underline">
                AI の分析
              </Link>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-800 ring-1 ring-teal-200">
                完全ローカル処理 · 外部送信なし
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}

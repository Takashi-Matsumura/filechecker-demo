"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime, STATUS } from "./labels";

interface Scan {
  id: number;
  root: string;
  status: string;
  total: number;
  processed: number;
  /** 1 = ファイル数の上限に達し、棚卸ししていないファイルが残っている */
  truncated?: number;
  created_at: string;
}

/** 実行中（削除できない）状態。サーバ側でも同じ判定をする */
const RUNNING = new Set(["queued", "walking", "processing", "pausing"]);

export function ScanHistory() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  // 削除の確認を出している行（1回押しただけでは消さない）
  const [confirming, setConfirming] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((j) => setScans(j.scans))
      .catch(() => setScans([]));
  }, []);

  const remove = async (id: number) => {
    setDeleting(id);
    setError(null);
    const res = await fetch(`/api/scans/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) {
      // 404 は既に消えている（別のタブで消したなど）。どちらも一覧から外す
      setScans((list) => list?.filter((s) => s.id !== id) ?? null);
    } else {
      setError((await res?.json().catch(() => null))?.error ?? "削除できませんでした");
    }
    setConfirming(null);
    setDeleting(null);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-stone-700">これまでの棚卸し</h2>
      {scans === null && <p className="text-sm text-stone-400">読み込み中…</p>}
      {scans?.length === 0 && <p className="text-sm text-stone-400">まだありません。</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {scans && scans.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {scans.map((s) => {
            const running = RUNNING.has(s.status);
            return (
              <li key={s.id} className="flex items-center hover:bg-stone-50">
                <Link href={`/scans/${s.id}`} className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 text-sm">
                  <span className="w-32 shrink-0 text-xs text-stone-500">{formatDateTime(s.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.root}</span>
                  {!!s.truncated && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-300">
                      上限で打ち切り
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-stone-500">
                    {STATUS[s.status] ?? s.status}
                    {s.total > 0 && ` · ${s.processed}/${s.total}`}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-2 px-3">
                  {confirming === s.id ? (
                    <>
                      <span className="text-xs text-stone-600">この記録を削除しますか？</span>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        disabled={deleting === s.id}
                        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleting === s.id ? "削除しています…" : "削除する"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={deleting === s.id}
                        className="rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
                      >
                        やめる
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirming(s.id);
                      }}
                      disabled={running}
                      aria-label="この棚卸しの記録を削除"
                      title={running ? "実行中は削除できません（先に中断してください）" : "この棚卸しの記録を削除（ファイルは消えません）"}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-400"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
                      </svg>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {scans && scans.length > 0 && (
        <p className="text-xs text-stone-500">
          削除するのはこのアプリの棚卸しの記録だけです。フォルダの中のファイルは消えません。AI の分析画面の数字（性能の記録）は残ります。
        </p>
      )}
    </section>
  );
}

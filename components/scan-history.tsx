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

export function ScanHistory() {
  const [scans, setScans] = useState<Scan[] | null>(null);

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((j) => setScans(j.scans))
      .catch(() => setScans([]));
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-stone-700">これまでの棚卸し</h2>
      {scans === null && <p className="text-sm text-stone-400">読み込み中…</p>}
      {scans?.length === 0 && <p className="text-sm text-stone-400">まだありません。</p>}
      {scans && scans.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {scans.map((s) => (
            <li key={s.id}>
              <Link href={`/scans/${s.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-stone-50">
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

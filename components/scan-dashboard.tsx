"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FileItem, ScanData } from "./actions";
import { formatDate, METHOD, RECOMMENDATION, RISK, RISK_ORDER, type Level } from "./labels";

type Filter = "all" | "high" | "medium" | "personal" | "dup" | "stale" | "issue";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "high", label: "リスク高" },
  { key: "medium", label: "リスク中" },
  { key: "personal", label: "個人情報あり" },
  { key: "dup", label: "重複" },
  { key: "stale", label: "古い" },
  { key: "issue", label: "未対応・エラー" },
];

const hasPersonal = (f: FileItem) => f.findings.some((x) => x.type !== "confidential");

function matches(f: FileItem, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "high":
      return f.risk === "high";
    case "medium":
      return f.risk === "medium";
    case "personal":
      return hasPersonal(f);
    case "dup":
      return f.dup_of !== null;
    case "stale":
      return f.is_stale;
    case "issue":
      return f.status === "error" || f.extract_method === "none";
  }
}

/** 詳しい分析（集計とファイル一覧）。データの取得は親の ScanView が行う */
export function ScanAnalysis({ data }: { data: ScanData }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    const files = data?.files ?? [];
    const done = files.filter((f) => f.status !== "pending");
    const byType = new Map<string, { label: string; files: number; count: number }>();
    for (const f of done) {
      for (const x of f.findings) {
        const cur = byType.get(x.type) ?? { label: x.label, files: 0, count: 0 };
        cur.files++;
        cur.count += x.count;
        byType.set(x.type, cur);
      }
    }
    const byRec = new Map<string, number>();
    for (const f of done) {
      const r = f.ai?.recommendation;
      if (r) byRec.set(r, (byRec.get(r) ?? 0) + 1);
    }
    return {
      total: files.length,
      high: done.filter((f) => f.risk === "high").length,
      medium: done.filter((f) => f.risk === "medium").length,
      personal: done.filter(hasPersonal).length,
      dup: files.filter((f) => f.dup_of !== null).length,
      stale: files.filter((f) => f.is_stale).length,
      ocr: done.filter((f) => f.extract_method === "ocr").length,
      byType: [...byType.values()].sort((a, b) => b.files - a.files),
      byRec,
    };
  }, [data]);

  const rows = useMemo(() => {
    const files = data?.files ?? [];
    const needle = q.trim().toLowerCase();
    return files
      .filter((f) => matches(f, filter))
      .filter((f) => !needle || f.rel_path.toLowerCase().includes(needle) || f.ai?.summary?.toLowerCase().includes(needle))
      .sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.rel_path.localeCompare(b.rel_path, "ja"));
  }, [data, filter, q]);

  const { scan } = data;
  const maxTypeFiles = Math.max(1, ...stats.byType.map((t) => t.files));

  return (
    <div className="space-y-8">
      {/* サマリ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="ファイル数" value={stats.total} />
        <Stat label="リスク高" value={stats.high} tone="red" onClick={() => setFilter("high")} />
        <Stat label="リスク中" value={stats.medium} tone="amber" onClick={() => setFilter("medium")} />
        <Stat label="個人情報あり" value={stats.personal} onClick={() => setFilter("personal")} />
        <Stat label="重複" value={stats.dup} onClick={() => setFilter("dup")} />
        <Stat label="3年以上更新なし" value={stats.stale} onClick={() => setFilter("stale")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">検出された情報の種類</h2>
          {stats.byType.length === 0 ? (
            <p className="text-sm text-stone-400">まだ検出されていません。</p>
          ) : (
            <ul className="space-y-2.5">
              {stats.byType.map((t) => (
                <li key={t.label} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                  <span className="truncate text-stone-700">{t.label}</span>
                  <span className="h-2 rounded-full bg-stone-100">
                    <span
                      className="block h-full rounded-full bg-teal-600"
                      style={{ width: `${(t.files / maxTypeFiles) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-xs text-stone-500">{t.files} ファイル</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">AI の推奨アクション</h2>
          <ul className="space-y-2">
            {Object.entries(RECOMMENDATION).map(([key, r]) => (
              <li key={key} className="flex items-center justify-between text-sm">
                <span>
                  <span className={`font-medium ${r.className}`}>{r.label}</span>
                  <span className="ml-2 text-xs text-stone-400">{r.hint}</span>
                </span>
                <span className="tabular-nums text-stone-600">{stats.byRec.get(key) ?? 0}</span>
              </li>
            ))}
          </ul>
          {stats.ocr > 0 && (
            <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
              スキャン書類・画像 {stats.ocr} 件はローカル LLM で文字を読み取りました。
            </p>
          )}
        </section>
      </div>

      {/* 一覧 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs ring-1 transition ${
                  filter === f.key ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-200 hover:bg-stone-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="パス・要約で絞り込み"
            className="w-56 rounded-lg border border-stone-300 px-3 py-1.5 text-xs outline-none focus:border-teal-600"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">リスク</th>
                <th className="px-4 py-2 font-medium">ファイル</th>
                <th className="px-4 py-2 font-medium">検出</th>
                <th className="px-4 py-2 font-medium">推奨</th>
                <th className="px-4 py-2 font-medium">更新日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((f) => (
                <tr key={f.id} className="align-top hover:bg-stone-50/70">
                  <td className="px-4 py-3">
                    {f.status === "pending" ? (
                      <span className="text-xs text-stone-400">解析待ち</span>
                    ) : (
                      <RiskBadge level={f.risk} />
                    )}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/scans/${scan.id}/files/${f.id}`} className="font-medium text-stone-900 hover:text-teal-700 hover:underline">
                      {f.rel_path.split("/").pop()}
                    </Link>
                    <div className="truncate text-xs text-stone-400">{f.rel_path}</div>
                    {f.ai?.summary && <div className="mt-1 line-clamp-2 text-xs text-stone-600">{f.ai.summary}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.ai?.category && <Tag>{f.ai.category}</Tag>}
                      {f.extract_method && f.extract_method !== "none" && <Tag>{METHOD[f.extract_method]}</Tag>}
                      {f.dup_of !== null && <Tag tone="violet">重複</Tag>}
                      {f.is_stale && <Tag tone="sky">古い</Tag>}
                      {f.status === "error" && <Tag tone="red">エラー</Tag>}
                      {f.extract_method === "none" && f.status === "done" && <Tag>内容未検査</Tag>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {f.findings.map((x) => (
                        <span key={x.type} className={`rounded px-1.5 py-0.5 text-xs ring-1 ${RISK[x.level].badge}`}>
                          {x.label}
                          <span className="ml-1 tabular-nums opacity-70">{x.count}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {f.ai?.recommendation && RECOMMENDATION[f.ai.recommendation] && (
                      <span className={`font-medium ${RECOMMENDATION[f.ai.recommendation].className}`}>
                        {RECOMMENDATION[f.ai.recommendation].label}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-stone-500">{formatDate(f.mtime)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-stone-400">
                    該当するファイルはありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone?: "red" | "amber"; onClick?: () => void }) {
  const color = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-stone-900";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-xl border border-stone-200 bg-white p-4 text-left transition enabled:hover:border-stone-300 enabled:hover:shadow-sm"
    >
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </button>
  );
}

export function RiskBadge({ level }: { level: Level }) {
  const r = RISK[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${r.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} aria-hidden />
      {r.label}
    </span>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "violet" | "sky" | "red" }) {
  const cls =
    tone === "violet"
      ? "bg-violet-50 text-violet-700"
      : tone === "sky"
        ? "bg-sky-50 text-sky-700"
        : tone === "red"
          ? "bg-red-50 text-red-700"
          : "bg-stone-100 text-stone-600";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

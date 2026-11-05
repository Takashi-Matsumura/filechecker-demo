"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ActionList } from "./action-list";
import type { FileItem, ScanData } from "./actions";
import { formatDateTime, STATUS } from "./labels";
import { ScanAnalysis } from "./scan-dashboard";

type Tab = "actions" | "analysis";

/** 棚卸し結果のページ。データ取得とポーリングを受け持ち、「やること」と「詳しい分析」を切り替える */
export function ScanView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ScanData | null>(null);
  // 「元に戻す」などで後から呼ばれても、常に最新の状態を参照できるようにする
  const dataRef = useRef<ScanData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [notFound, setNotFound] = useState(false);
  // URL の #analysis で「詳しい分析」タブを直接開ける。サーバ側ではデータ未取得のため描画されず、不一致は起きない
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window !== "undefined" && window.location.hash === "#analysis" ? "analysis" : "actions",
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, "", t === "analysis" ? "#analysis" : window.location.pathname);
  };

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch(`/api/scans/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const j: ScanData = await res.json();
      if (stop) return;
      setData(j);
      if (j.scan.status !== "done" && j.scan.status !== "error") timer = setTimeout(load, 2000);
    };
    load().catch(() => {});
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  // 押した瞬間に画面へ反映し、保存に失敗したら元に戻す
  const setStatus = useCallback(
    async (fileId: number, status: FileItem["action_status"]) => {
      const prev = dataRef.current?.files.find((f) => f.id === fileId)?.action_status ?? "todo";
      setData((d) => d && { ...d, files: d.files.map((f) => (f.id === fileId ? { ...f, action_status: status } : f)) });
      const res = await fetch(`/api/scans/${id}/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => null);
      if (!res?.ok) {
        setData((d) => d && { ...d, files: d.files.map((f) => (f.id === fileId ? { ...f, action_status: prev } : f)) });
      }
    },
    [id],
  );

  if (notFound) return <p className="text-sm text-stone-500">このスキャンは見つかりません。</p>;
  if (!data) return <p className="text-sm text-stone-400">読み込み中…</p>;

  const { scan } = data;
  const analyzing = scan.status !== "done" && scan.status !== "error";
  const pct = scan.total ? Math.round((scan.processed / scan.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/" className="text-xs text-teal-700 underline underline-offset-2">
          ← ホーム
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">棚卸し結果</h1>
            <p className="truncate font-mono text-xs text-stone-500">{scan.root}</p>
          </div>
          <p className="text-xs text-stone-500">
            {formatDateTime(scan.created_at)}
            {scan.finished_at && ` 〜 ${formatDateTime(scan.finished_at).slice(-5)}`}
          </p>
        </div>

        {analyzing && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3">
            <div className="mb-1.5 flex justify-between text-xs text-teal-900">
              <span>{STATUS[scan.status] ?? scan.status}</span>
              <span className="tabular-nums">
                {scan.processed} / {scan.total || "?"}
              </span>
            </div>
            <div
              className="aqua-progress"
              role="progressbar"
              aria-label="解析の進み具合"
              aria-valuemin={0}
              aria-valuemax={scan.total || 1}
              aria-valuenow={scan.processed}
            >
              {pct > 0 && <div className="aqua-progress-bar aqua-teal" style={{ width: `${pct}%` }} />}
            </div>
          </div>
        )}
        {scan.status === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">エラー: {scan.error}</p>
        )}

        <div role="tablist" className="flex gap-1 border-b border-stone-200">
          {(
            [
              ["actions", "やること"],
              ["analysis", "詳しい分析"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                tab === key ? "border-stone-900 font-semibold text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "actions" ? (
        <ActionList data={data} onStatus={setStatus} analyzing={analyzing} />
      ) : (
        <ScanAnalysis data={data} />
      )}
    </div>
  );
}

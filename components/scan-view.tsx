"use client";

import { BackLink } from "./back-link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ActionList } from "./action-list";
import type { FileItem, ScanData } from "./actions";
import { formatDateTime, STATUS } from "./labels";
import { ScanAnalysis } from "./scan-dashboard";

type Tab = "actions" | "analysis";

/** 残り時間を「約2時間10分」のように表す */
function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "1分未満";
  if (min < 60) return `約${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `約${h}時間${m}分` : `約${h}時間`;
  const d = Math.floor(h / 24);
  return h % 24 ? `約${d}日${h % 24}時間` : `約${d}日`;
}

/** 実行中（ポーリングを続ける）状態 */
const RUNNING = new Set(["queued", "walking", "processing", "pausing"]);

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
  // 再開したときにポーリングをやり直すためのキー
  const [pollKey, setPollKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  // URL の #analysis で「詳しい分析」タブを直接開ける。サーバ側ではデータ未取得のため描画されず、不一致は起きない
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window !== "undefined" && window.location.hash === "#analysis" ? "analysis" : "actions",
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, "", t === "analysis" ? "#analysis" : window.location.pathname);
  };

  // 残り時間の目安（解析中の進み具合から計算する）
  const [eta, setEta] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let tick = 0;
    // 解析が進んだ件数と時刻の記録（残り時間の計算用）。再開するたびに取り直す
    let first: { t: number; done: number } | null = null;

    /** ファイルの一覧も含めて取り直す（やることの表示を更新する） */
    const loadFull = async (): Promise<ScanData["scan"] | null> => {
      const res = await fetch(`/api/scans/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return null;
      }
      const j: ScanData = await res.json();
      if (stop) return null;
      setData(j);
      return j.scan;
    };
    /** 進み具合だけを取り直す（ファイルが多くても軽い） */
    const loadSummary = async (): Promise<ScanData["scan"] | null> => {
      const res = await fetch(`/api/scans/${id}?files=0`);
      if (!res.ok) return null;
      const j: { scan: ScanData["scan"] } = await res.json();
      if (stop) return null;
      setData((prev) => (prev ? { ...prev, scan: j.scan } : prev));
      return j.scan;
    };
    const updateEta = (scan: ScanData["scan"]) => {
      if (scan.status !== "processing" || !scan.total) return setEta(null);
      const now = Date.now();
      if (!first) first = { t: now, done: scan.processed };
      const rate = (scan.processed - first.done) / (now - first.t); // 件 / ミリ秒
      setEta(rate > 0 ? (scan.total - scan.processed) / rate : null);
    };

    // 進み具合は2秒ごと、ファイルの一覧は20秒ごとに取り直す
    const step = async (full: boolean) => {
      const scan = full ? await loadFull() : await loadSummary();
      if (!scan || stop) return;
      updateEta(scan);
      if (RUNNING.has(scan.status)) {
        tick++;
        timer = setTimeout(() => void step(tick % 10 === 0).catch(() => {}), 2000);
      } else if (!full) {
        await loadFull(); // 終わったら、最終的な結果を取り直す
      }
    };
    step(true).catch(() => {});
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, pollKey]);

  /** 中断 / 再開。状態はサーバが持つので、操作後はポーリングで最新を取り直す */
  const control = useCallback(
    async (action: "pause" | "resume") => {
      setBusy(true);
      setOpError(null);
      const res = await fetch(`/api/scans/${id}/${action}`, { method: "POST" }).catch(() => null);
      if (!res?.ok) setOpError((await res?.json().catch(() => null))?.error ?? "操作できませんでした");
      setPollKey((k) => k + 1);
      setBusy(false);
    },
    [id],
  );

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
  const analyzing = RUNNING.has(scan.status);
  const paused = scan.status === "paused";
  const pct = scan.total ? Math.round((scan.processed / scan.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BackLink href="/" label="ホームに戻る" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">棚卸し結果</h1>
              <p className="truncate font-mono text-xs text-stone-500">{scan.root}</p>
            </div>
          </div>
          <p className="text-xs text-stone-500">
            {formatDateTime(scan.created_at)}
            {scan.finished_at && ` 〜 ${formatDateTime(scan.finished_at).slice(-5)}`}
          </p>
        </div>

        {analyzing && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-teal-900">
              <span>{STATUS[scan.status] ?? scan.status}</span>
              <span className="ml-auto tabular-nums">
                {scan.processed} / {scan.total || "?"}
              </span>
              <button
                type="button"
                onClick={() => control("pause")}
                disabled={busy || scan.status === "pausing"}
                className="rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scan.status === "pausing" ? "中断しています…" : "中断"}
              </button>
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
            <div className="mt-2 space-y-1 text-xs text-teal-900">
              {scan.status === "walking" && (
                <p>
                  ファイルを数えています（<span className="tabular-nums">{scan.total.toLocaleString()}</span>件まで確認）。数え終わると解析を始めます。
                </p>
              )}
              {eta !== null && <p>残り {formatDuration(eta)}（これまでの進み具合からの目安）</p>}
              <p className="text-teal-800/80">
                ファイルが多いと時間がかかります。PC がスリープすると処理が止まるので、終わるまでスリープしない設定にしてください。途中で止まっても、あとから「再開」で続きから進められます。
              </p>
            </div>
          </div>
        )}
        {paused && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">
                中断中 <span className="ml-1 font-normal tabular-nums">{scan.processed} / {scan.total || "?"} 件 完了</span>
              </p>
              <p className="text-xs text-amber-800">
                {scan.error ?? "再開すると、残りのファイルだけを解析します。"}
              </p>
            </div>
            <button type="button" onClick={() => control("resume")} disabled={busy} className="aqua aqua-teal px-6 py-1.5 text-sm">
              <span>{busy ? "再開しています…" : "再開"}</span>
            </button>
          </div>
        )}
        {opError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{opError}</p>}
        {scan.status === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">エラー: {scan.error}</p>
        )}
        {!!scan.truncated && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">ファイルが多いため、すべては棚卸ししていません</p>
            <p className="mt-1 text-xs leading-relaxed">
              このフォルダには、一度に棚卸しできる上限を超えるファイルがあります。フォルダ名の順で先頭の
              <span className="mx-0.5 font-semibold tabular-nums">{scan.total.toLocaleString()}</span>
              件だけを棚卸しし、残りのファイルは見ていません。「対応が必要なファイルはありません」と出ていても、残りに問題のあるファイルがあるかもしれません。中のフォルダを1つずつ指定して、分けて棚卸ししてください。
            </p>
          </div>
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
        <ActionList data={data} onStatus={setStatus} incomplete={analyzing || paused} paused={paused} />
      ) : (
        <ScanAnalysis data={data} />
      )}
    </div>
  );
}

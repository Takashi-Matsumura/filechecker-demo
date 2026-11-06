"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ActionsView } from "@/lib/views";
import { BUCKET_ORDER, BUCKETS, fileName, folderOf, reasonTags, type Bucket, type FileItem, type ScanData } from "./actions";
import { Pager } from "./pager";

type Status = FileItem["action_status"];

/** サーバ（lib/views.ts の PAGE_SIZE）と同じ。ページの件数表示に使う */
const PAGE_SIZE = 50;

interface Props {
  scanId: number;
  root: string;
  platform: NonNullable<ScanData["platform"]>;
  /** 値が変わったら取り直す（解析中の定期更新・解析の完了時） */
  refreshKey: number;
  /** 解析が終わっていない（実行中または中断中） */
  incomplete: boolean;
  paused: boolean;
}

/** 押した直後に、その行の対応状況を画面上で切り替える（保存後に取り直すまでの間） */
function withStatus(v: ActionsView, fileId: number, status: Status): ActionsView {
  const map = (e: Entry) => (e.f.id === fileId ? { ...e, f: { ...e.f, action_status: status } } : e);
  return { ...v, top: v.top.map(map), rows: v.rows.map(map) };
}

/**
 * 「次に何をすればいいか」だけを見せる画面。
 * 集計と表の1ページ分をサーバ（/api/scans/[id]/actions）から受け取るので、ファイルが多くても重くならない。
 */
export function ActionList({ scanId, root, platform, refreshKey, incomplete, paused }: Props) {
  const [filter, setFilterState] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ActionsView | null>(null);
  // 対応状況を変えたあとに取り直すためのキー
  const [rev, setRev] = useState(0);
  const [toast, setToast] = useState<{ id: number; msg: string; undo?: () => void } | null>(null);

  const setFilter = (f: Filter) => {
    setFilterState(f);
    setPage(0);
  };

  useEffect(() => {
    let stop = false;
    fetch(`/api/scans/${scanId}/actions?filter=${filter}&page=${page}`)
      .then((r) => (r.ok ? (r.json() as Promise<ActionsView>) : null))
      .then((v) => {
        if (stop || !v) return;
        setView(v);
        // 対応して件数が減り、今のページが無くなったときは、サーバが返したページに合わせる
        if (v.page !== page) setPage(v.page);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [scanId, filter, page, refreshKey, rev]);

  // 「元に戻す」付きの通知は長めに表示する
  const notify: Notify = useCallback((msg, undo) => {
    const id = Date.now() + Math.random();
    setToast({ id, msg, undo });
    setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), undo ? 6000 : 2500);
  }, []);

  // 押した瞬間に画面へ反映し、保存したら最新を取り直す
  const onStatus = useCallback(
    async (fileId: number, status: Status) => {
      setView((v) => v && withStatus(v, fileId, status));
      const res = await fetch(`/api/scans/${scanId}/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => null);
      if (!res?.ok) notify("保存できませんでした。もう一度お試しください");
      setRev((r) => r + 1);
    },
    [scanId, notify],
  );

  if (!view) return <p className="text-sm text-stone-400">読み込み中…</p>;

  const total = view.total;
  const doneCount = view.handledCount;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const allDone = !incomplete && total > 0 && view.todoCount === 0;

  return (
    <div className="space-y-6">
      {/* やること: 進捗 + まずこの3件（ここを順に片付けていけば作業が終わる） */}
      <section className="rounded-xl border-2 border-stone-900/80 bg-white p-5">
        {allDone ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700" aria-hidden>
              ✓
            </span>
            <div>
              <p className="font-semibold">すべて対応しました</p>
              <p className="text-xs text-stone-500">{total}件を確認しました。おつかれさまでした。</p>
            </div>
          </div>
        ) : total === 0 && !incomplete ? (
          <p className="font-semibold">対応が必要なファイルはありません</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-lg font-bold">
                やること <span className="tabular-nums">{view.todoCount.toLocaleString()}</span>件
              </p>
              <p className="text-xs tabular-nums text-stone-500">
                {doneCount.toLocaleString()} / {total.toLocaleString()} 完了
              </p>
            </div>
            <div
              className="aqua-progress mt-3"
              role="progressbar"
              aria-label="対応の進み具合"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={doneCount}
            >
              {pct > 0 && <div className="aqua-progress-bar" style={{ width: `${pct}%` }} />}
            </div>
            {view.unreadCount > 0 && (
              <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700">
                このうち <span className="font-semibold tabular-nums">{view.unreadCount}</span>
                件は、形式が未対応・大きすぎる・読み込みに失敗したなどの理由で、中身を確認できなかったファイルです（「中身未確認」「読み込みエラー」のタグ）。開いて中身を確かめてください。
              </p>
            )}

            {view.top.length > 0 && (
              <div className="mt-5 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="text-sm font-bold">
                    まずこの{view.top.length}件<span className="ml-1.5 font-medium text-stone-500">（優先度の高い順）</span>
                  </h2>
                  <p className="text-xs text-stone-500">
                    リスクの高さ → マイナンバーなど重要な情報の件数 → 区分 の順に並べています。対応すると次のファイルが繰り上がります
                  </p>
                </div>
                <ul className="overflow-hidden rounded-lg border border-stone-200">
                  {view.top.map(({ f, bucket }) => (
                    <Row key={f.id} f={f} bucket={bucket} scanId={scanId} root={root} platform={platform} onStatus={onStatus} notify={notify} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* 残り（区分・対応済みをフィルタで切り替える表） */}
      {(view.restCount > 0 || view.handledCount > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">残りのやること</h2>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="表示の絞り込み">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              すべて <span className="tabular-nums">{view.restCount.toLocaleString()}</span>
            </Chip>
            {BUCKET_ORDER.filter((b) => view.counts[b] > 0 || filter === b).map((b) => (
              <Chip key={b} active={filter === b} onClick={() => setFilter(b)}>
                <span className={filter === b ? "" : BUCKETS[b].text}>
                  <BucketIcon bucket={b} />
                </span>
                {BUCKETS[b].verb} <span className="tabular-nums">{view.counts[b].toLocaleString()}</span>
              </Chip>
            ))}
            {(view.handledCount > 0 || filter === "handled") && (
              <Chip active={filter === "handled"} onClick={() => setFilter("handled")}>
                対応済み・対応しない <span className="tabular-nums">{view.handledCount.toLocaleString()}</span>
              </Chip>
            )}
          </div>
          <p className="text-xs text-stone-500">
            {filter === "all"
              ? "「まずこの3件」以外のやることです。"
              : filter === "handled"
                ? "対応済み・対応しないにしたファイルです。「戻す」でやることに戻せます。"
                : BUCKETS[filter].hint}
          </p>
          <ActionTable
            rows={view.rows}
            handled={filter === "handled"}
            scanId={scanId}
            root={root}
            platform={platform}
            onStatus={onStatus}
            notify={notify}
          />
          <Pager page={view.page} pages={view.pages} count={view.count} pageSize={PAGE_SIZE} onPage={setPage} />
        </section>
      )}

      {incomplete && (
        <p className="text-xs text-stone-500">
          {paused
            ? "解析が中断されています。再開すると、残りのファイルも解析してここに追加します。"
            : "解析中です。見つかったものから順に追加されます。"}
        </p>
      )}

      {view.okCount > 0 && <p className="text-sm text-stone-500">問題なし {view.okCount.toLocaleString()}件（何もしなくて大丈夫です）</p>}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg"
        >
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
              className="font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
            >
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 共通

type Notify = (msg: string, undo?: () => void) => void;
type Entry = { f: FileItem; bucket: Exclude<Bucket, "ok"> };
type Filter = "all" | Exclude<Bucket, "ok"> | "handled";

interface Ctx {
  scanId: number;
  root: string;
  platform: NonNullable<ScanData["platform"]>;
  onStatus: (fileId: number, status: Status) => void;
  notify: Notify;
}

function useFileActions(f: FileItem, { scanId, root, platform, onStatus, notify }: Ctx) {
  async function reveal() {
    const res = await fetch(`/api/scans/${scanId}/files/${f.id}/reveal`, { method: "POST" });
    if (!res.ok) notify((await res.json().catch(() => null))?.error ?? "開けませんでした");
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(`${root}${platform.sep}${f.rel_path}`);
      notify("パスをコピーしました");
    } catch {
      notify("コピーできませんでした");
    }
  }

  // 押した直後に「元に戻す」を出す（間違えて押したとき用）
  function mark(status: Exclude<Status, "todo">) {
    const prev = f.action_status;
    onStatus(f.id, status);
    notify(`「${fileName(f.rel_path)}」を${status === "done" ? "対応済み" : "対応しない"}にしました`, () => onStatus(f.id, prev));
  }

  return { reveal, copyPath, mark, restore: () => onStatus(f.id, "todo") };
}

/** 先頭（区分の理由）は区分の色、補足は控えめな灰色 */
function Reasons({ f, bucket }: Entry) {
  const b = BUCKETS[bucket];
  const [main, ...extra] = reasonTags(f);
  return (
    <>
      <span className={`whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-xs ring-1 ${b.ring} ${b.text}`}>{main}</span>
      {extra.map((t) => (
        <span key={t} className="whitespace-nowrap rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
          {t}
        </span>
      ))}
    </>
  );
}

/**
 * プレビューのアイコン（目の形）。押すとファイル詳細画面に移り、
 * AI の判断（要約・推奨アクション・理由）と、検出箇所に色を付けた内容のプレビューを見られる。
 */
function PreviewLink({ f, scanId, small }: { f: FileItem; scanId: number; small?: boolean }) {
  const label = `「${fileName(f.rel_path)}」の詳細とプレビューを見る`;
  return (
    <Link
      href={`/scans/${scanId}/files/${f.id}`}
      aria-label={label}
      title="詳細とプレビューを見る"
      className={`flex shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 ${
        small ? "h-7 w-7" : "h-8 w-8"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    </Link>
  );
}

// ---------------------------------------------------------------- まずこの3件の1行

function Row({ f, bucket, ...ctx }: Entry & Ctx) {
  const b = BUCKETS[bucket];
  const { reveal, copyPath, mark } = useFileActions(f, ctx);

  return (
    <li className="border-b border-stone-100 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pl-2 pr-4">
        <PreviewLink f={f} scanId={ctx.scanId} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.text}`}>
              <BucketIcon bucket={bucket} />
              {b.verb}
            </span>
            <span className="truncate font-medium">{fileName(f.rel_path)}</span>
            <Reasons f={f} bucket={bucket} />
          </div>
          <div className="truncate text-xs text-stone-400">{folderOf(f.rel_path)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <IconBtn onClick={reveal} label={ctx.platform.revealLabel} icon="folder" />
          <IconBtn onClick={copyPath} label="パスをコピー" icon="copy" />
          <DoneBtn onClick={() => mark("done")} />
          <SkipBtn onClick={() => mark("skipped")} />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- 表

function ActionTable({ rows, handled, ...ctx }: { rows: Entry[]; handled: boolean } & Ctx) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
          <tr>
            <th className="w-10 px-1 py-2" aria-label="プレビュー" />
            <th className="px-2 py-2 font-medium">区分</th>
            <th className="px-2 py-2 font-medium">ファイル</th>
            <th className="px-2 py-2 font-medium">理由</th>
            <th className="px-3 py-2 text-right font-medium">{handled ? "状態" : "操作"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((x) => (
            <TableRow key={x.f.id} {...x} {...ctx} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-sm text-stone-400">
                {handled ? "まだ対応したファイルはありません。" : "この区分のやることは残っていません。"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ f, bucket, ...ctx }: Entry & Ctx) {
  const b = BUCKETS[bucket];
  const handled = f.action_status !== "todo";
  const { reveal, copyPath, mark, restore } = useFileActions(f, ctx);

  return (
    <tr className="hover:bg-stone-50/70">
      <td className="px-1 py-1.5">
        <PreviewLink f={f} scanId={ctx.scanId} small />
      </td>
      <td className={`whitespace-nowrap px-2 py-1.5 ${handled ? "opacity-50" : ""}`}>
        <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.text}`}>
          <BucketIcon bucket={bucket} />
          {b.verb}
        </span>
      </td>
      <td className={`max-w-xs px-2 py-1.5 ${handled ? "opacity-50" : ""}`}>
        <div className={`truncate font-medium ${handled ? "line-through" : ""}`} title={fileName(f.rel_path)}>
          {fileName(f.rel_path)}
        </div>
        <div className="truncate text-xs text-stone-400">{folderOf(f.rel_path)}</div>
      </td>
      <td className={`px-2 py-1.5 ${handled ? "opacity-50" : ""}`}>
        <div className="flex flex-wrap items-center gap-1">
          <Reasons f={f} bucket={bucket} />
        </div>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
          {!handled ? (
            <>
              <IconBtn onClick={reveal} label={ctx.platform.revealLabel} icon="folder" />
              <IconBtn onClick={copyPath} label="パスをコピー" icon="copy" />
              <DoneBtn onClick={() => mark("done")} small />
              <SkipBtn onClick={() => mark("skipped")} small />
            </>
          ) : (
            <>
              <span className="text-xs text-stone-500">{f.action_status === "done" ? "対応済み" : "対応しない"}</span>
              <Btn onClick={restore}>戻す</Btn>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
        active ? "bg-stone-900 font-semibold text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 区分のアイコン。色だけに頼らず形でも見分けられるようにする
 * （移す＝矢印 / 消す＝ゴミ箱 / 整理する＝箱 / 確認する＝？）。色は親の文字色を使う。
 */
function BucketIcon({ bucket }: { bucket: Exclude<Bucket, "ok"> }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {bucket === "move" && <path d="M4 12h14M13 6l6 6-6 6" />}
      {bucket === "remove" && <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />}
      {bucket === "tidy" && <path d="M3.5 4.5h17v4h-17zM5 8.5v11h14v-11M10 12.5h4" />}
      {bucket === "check" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4M12 17h.01" />
        </>
      )}
    </svg>
  );
}

/** アイコンだけのボタン。名前は aria-label と、ホバー時のツールチップ（title）で伝える */
function IconBtn({ onClick, label, icon }: { onClick: () => void; label: string; icon: "folder" | "copy" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-stone-900"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon === "folder" ? (
          // フォルダ（ファイルの場所を開く）
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
        ) : (
          // 重なった2枚の紙（コピー）
          <>
            <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
            <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Aqua 風の円形ジェルボタン（globals.css の .aqua） */
function AquaBtn({
  onClick,
  label,
  tone,
  small,
  children,
}: {
  onClick: () => void;
  label: string;
  tone: "green" | "graphite";
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`aqua aqua-${tone} mx-0.5 flex shrink-0 items-center justify-center ${small ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"}`}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

function DoneBtn({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <AquaBtn onClick={onClick} label="対応済みにする" tone="green" small={small}>
      済
    </AquaBtn>
  );
}

/** 「対応しない」= スキップ（状態の値も skipped）。▶| のアイコンで表す */
function SkipBtn({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <AquaBtn onClick={onClick} label="対応しない" tone="graphite" small={small}>
      <svg viewBox="0 0 24 24" className={small ? "h-3.5 w-3.5" : "h-4 w-4"} fill="currentColor">
        <path d="M6 5.5v13l9.5-6.5z" />
        <rect x="16.5" y="5.5" width="2.5" height="13" rx="1" />
      </svg>
    </AquaBtn>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
    >
      {children}
    </button>
  );
}

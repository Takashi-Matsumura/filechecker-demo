"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BUCKET_ORDER,
  BUCKETS,
  bucketOf,
  fileName,
  folderOf,
  priority,
  reasonTag,
  type Bucket,
  type FileItem,
  type ScanData,
} from "./actions";

type Status = FileItem["action_status"];

interface Props {
  data: ScanData;
  onStatus: (fileId: number, status: Status) => void;
  analyzing: boolean;
}

/** 「次に何をすればいいか」だけを見せる画面 */
export function ActionList({ data, onStatus, analyzing }: Props) {
  const [showDone, setShowDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const view = useMemo(() => {
    const actionable = data.files
      .map((f) => ({ f, bucket: bucketOf(f) }))
      .filter((x): x is { f: FileItem; bucket: Exclude<Bucket, "ok"> } => x.bucket !== "ok");
    const todo = actionable.filter((x) => x.f.action_status === "todo").sort((a, b) => priority(b.f) - priority(a.f));
    const handled = actionable.filter((x) => x.f.action_status !== "todo");
    const top = todo.slice(0, 3);
    const topIds = new Set(top.map((x) => x.f.id));
    const groups = BUCKET_ORDER.map((b) => ({
      bucket: b,
      items: todo.filter((x) => x.bucket === b && !topIds.has(x.f.id)),
    })).filter((g) => g.items.length > 0);
    const okCount = data.files.filter((f) => f.status === "done" && bucketOf(f) === "ok").length;
    return { actionable, todo, handled, top, groups, okCount };
  }, [data]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  };

  const total = view.actionable.length;
  const doneCount = view.handled.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const allDone = !analyzing && total > 0 && view.todo.length === 0;

  return (
    <div className="space-y-6">
      {/* 進捗 */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
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
        ) : total === 0 && !analyzing ? (
          <p className="font-semibold">対応が必要なファイルはありません</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-lg font-bold">
                やること <span className="tabular-nums">{view.todo.length}</span>件
              </p>
              <p className="text-xs tabular-nums text-stone-500">
                {doneCount} / {total} 完了
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </section>

      {/* まずこの3件 */}
      {view.top.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">まずこの{view.top.length}件</h2>
          <ul className="overflow-hidden rounded-xl border-2 border-stone-900/80 bg-white">
            {view.top.map(({ f, bucket }) => (
              <Row key={f.id} f={f} bucket={bucket} scanId={data.scan.id} root={data.scan.root} onStatus={onStatus} notify={notify} showVerb />
            ))}
          </ul>
        </section>
      )}

      {/* 区分ごと */}
      {view.groups.map((g) => {
        const b = BUCKETS[g.bucket];
        return (
          <section key={g.bucket} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${b.dot}`} aria-hidden />
              <h2 className="text-sm font-bold">
                {b.verb} <span className="tabular-nums">{g.items.length}</span>件
              </h2>
              <p className="truncate text-xs text-stone-500">{b.hint}</p>
            </div>
            <ul className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              {g.items.map(({ f, bucket }) => (
                <Row key={f.id} f={f} bucket={bucket} scanId={data.scan.id} root={data.scan.root} onStatus={onStatus} notify={notify} />
              ))}
            </ul>
          </section>
        );
      })}

      {analyzing && <p className="text-xs text-stone-500">解析中です。見つかったものから順に追加されます。</p>}

      {/* 問題なし・対応済み */}
      <div className="space-y-2 text-sm text-stone-500">
        {view.okCount > 0 && <p>問題なし {view.okCount}件（何もしなくて大丈夫です）</p>}
        {view.handled.length > 0 && (
          <div>
            <button onClick={() => setShowDone((v) => !v)} className="text-stone-600 underline underline-offset-2">
              {showDone ? "▾" : "▸"} 対応済み・対応しない {view.handled.length}件
            </button>
            {showDone && (
              <ul className="mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white">
                {view.handled.map(({ f, bucket }) => (
                  <Row key={f.id} f={f} bucket={bucket} scanId={data.scan.id} root={data.scan.root} onStatus={onStatus} notify={notify} showVerb />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 1行

interface RowProps {
  f: FileItem;
  bucket: Exclude<Bucket, "ok">;
  scanId: number;
  root: string;
  onStatus: (fileId: number, status: Status) => void;
  notify: (msg: string) => void;
  showVerb?: boolean;
}

function Row({ f, bucket, scanId, root, onStatus, notify, showVerb }: RowProps) {
  const [open, setOpen] = useState(false);
  const b = BUCKETS[bucket];
  const handled = f.action_status !== "todo";

  async function reveal() {
    const res = await fetch(`/api/scans/${scanId}/files/${f.id}/reveal`, { method: "POST" });
    if (!res.ok) notify((await res.json().catch(() => null))?.error ?? "開けませんでした");
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(`${root}/${f.rel_path}`);
      notify("パスをコピーしました");
    } catch {
      notify("コピーできませんでした");
    }
  }

  return (
    <li className="border-b border-stone-100 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="理由を表示"
          className="w-4 shrink-0 text-xs text-stone-400 hover:text-stone-700"
        >
          {open ? "▾" : "▸"}
        </button>
        <div className={`min-w-0 flex-1 ${handled ? "opacity-50" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            {showVerb && (
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.text}`}>
                <span className={`h-2 w-2 rounded-full ${b.dot}`} aria-hidden />
                {b.verb}
              </span>
            )}
            <span className={`truncate font-medium ${handled ? "line-through" : ""}`}>{fileName(f.rel_path)}</span>
            <span className={`rounded-full bg-white px-2 py-0.5 text-xs ring-1 ${b.ring} ${b.text}`}>{reasonTag(f)}</span>
          </div>
          <div className="truncate text-xs text-stone-400">{folderOf(f.rel_path)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {!handled ? (
            <>
              <Btn onClick={reveal}>Finderで表示</Btn>
              <Btn onClick={copyPath}>パスをコピー</Btn>
              <Btn onClick={() => onStatus(f.id, "done")} primary>
                済
              </Btn>
              <Btn onClick={() => onStatus(f.id, "skipped")}>対応しない</Btn>
            </>
          ) : (
            <>
              <span className="text-xs text-stone-500">{f.action_status === "done" ? "対応済み" : "対応しない"}</span>
              <Btn onClick={() => onStatus(f.id, "todo")}>戻す</Btn>
            </>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-1 bg-stone-50 px-11 py-3 text-xs text-stone-600">
          {f.ai?.reason && <p>{f.ai.reason}</p>}
          {f.ai?.summary && <p className="text-stone-500">{f.ai.summary}</p>}
          <Link href={`/scans/${scanId}/files/${f.id}`} className="inline-block text-teal-700 underline underline-offset-2">
            詳しく見る
          </Link>
        </div>
      )}
    </li>
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
          : "rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
      }
    >
      {children}
    </button>
  );
}

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
  reasonTags,
  type Bucket,
  type FileItem,
  type ScanData,
} from "./actions";

type Status = FileItem["action_status"];

interface Props {
  data: ScanData;
  onStatus: (fileId: number, status: Status) => void;
  /** 解析が終わっていない（実行中または中断中） */
  incomplete: boolean;
  paused: boolean;
}

/** 「次に何をすればいいか」だけを見せる画面 */
export function ActionList({ data, onStatus, incomplete, paused }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<{ id: number; msg: string; undo?: () => void } | null>(null);

  const view = useMemo(() => {
    const actionable = data.files
      .map((f) => ({ f, bucket: bucketOf(f) }))
      .filter((x): x is Entry => x.bucket !== "ok");
    const todo = actionable.filter((x) => x.f.action_status === "todo").sort((a, b) => priority(b.f) - priority(a.f));
    // 新しく対応したものが上に来るように
    const handled = actionable
      .filter((x) => x.f.action_status !== "todo")
      .sort((a, b) => (b.f.action_at ?? "").localeCompare(a.f.action_at ?? ""));
    const top = todo.slice(0, 3);
    const topIds = new Set(top.map((x) => x.f.id));
    // 表は区分ごとにまとめ、区分の中は優先度順
    const rest = todo
      .filter((x) => !topIds.has(x.f.id))
      .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || priority(b.f) - priority(a.f));
    const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, rest.filter((x) => x.bucket === b).length])) as Record<
      Exclude<Bucket, "ok">,
      number
    >;
    const okCount = data.files.filter((f) => f.status === "done" && bucketOf(f) === "ok").length;
    return { actionable, todo, handled, top, rest, counts, okCount };
  }, [data]);

  const tableRows = filter === "all" ? view.rest : filter === "handled" ? view.handled : view.rest.filter((x) => x.bucket === filter);

  // 「元に戻す」付きの通知は長めに表示する
  const notify: Notify = (msg, undo) => {
    const id = Date.now() + Math.random();
    setToast({ id, msg, undo });
    setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), undo ? 6000 : 2500);
  };
  const platform = data.platform ?? { os: "mac" as const, revealLabel: "Finderで表示", sep: "/" };

  const total = view.actionable.length;
  const doneCount = view.handled.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const allDone = !incomplete && total > 0 && view.todo.length === 0;

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
        ) : total === 0 && !incomplete ? (
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
          </>
        )}
      </section>

      {/* まずこの3件 */}
      {view.top.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-bold">
              まずこの{view.top.length}件<span className="ml-1.5 font-medium text-stone-500">（優先度の高い順）</span>
            </h2>
            <p className="text-xs text-stone-500">リスクの高さ → マイナンバーなど重要な情報の件数 → 区分 の順に並べています</p>
          </div>
          <ul className="overflow-hidden rounded-xl border-2 border-stone-900/80 bg-white">
            {view.top.map(({ f, bucket }) => (
              <Row key={f.id} f={f} bucket={bucket} scanId={data.scan.id} root={data.scan.root} platform={platform} onStatus={onStatus} notify={notify} />
            ))}
          </ul>
        </section>
      )}

      {/* 残り（区分・対応済みをフィルタで切り替える表） */}
      {(view.rest.length > 0 || view.handled.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">残りのやること</h2>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="表示の絞り込み">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              すべて <span className="tabular-nums">{view.rest.length}</span>
            </Chip>
            {BUCKET_ORDER.filter((b) => view.counts[b] > 0 || filter === b).map((b) => (
              <Chip key={b} active={filter === b} onClick={() => setFilter(b)}>
                <span className={`h-2 w-2 rounded-full ${BUCKETS[b].dot}`} aria-hidden />
                {BUCKETS[b].verb} <span className="tabular-nums">{view.counts[b]}</span>
              </Chip>
            ))}
            {(view.handled.length > 0 || filter === "handled") && (
              <Chip active={filter === "handled"} onClick={() => setFilter("handled")}>
                対応済み・対応しない <span className="tabular-nums">{view.handled.length}</span>
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
            rows={tableRows}
            handled={filter === "handled"}
            scanId={data.scan.id}
            root={data.scan.root}
            platform={platform}
            onStatus={onStatus}
            notify={notify}
          />
        </section>
      )}

      {incomplete && (
        <p className="text-xs text-stone-500">
          {paused
            ? "解析が中断されています。再開すると、残りのファイルも解析してここに追加します。"
            : "解析中です。見つかったものから順に追加されます。"}
        </p>
      )}

      {view.okCount > 0 && <p className="text-sm text-stone-500">問題なし {view.okCount}件（何もしなくて大丈夫です）</p>}

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

function Detail({ f, scanId }: { f: FileItem; scanId: number }) {
  return (
    <>
      {f.ai?.reason && <p>{f.ai.reason}</p>}
      {f.ai?.summary && <p className="text-stone-500">{f.ai.summary}</p>}
      <Link href={`/scans/${scanId}/files/${f.id}`} className="inline-block text-teal-700 underline underline-offset-2">
        詳しく見る
      </Link>
    </>
  );
}

// ---------------------------------------------------------------- まずこの3件の1行

function Row({ f, bucket, ...ctx }: Entry & Ctx) {
  const [open, setOpen] = useState(false);
  const b = BUCKETS[bucket];
  const { reveal, copyPath, mark } = useFileActions(f, ctx);

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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.text}`}>
              <span className={`h-2 w-2 rounded-full ${b.dot}`} aria-hidden />
              {b.verb}
            </span>
            <span className="truncate font-medium">{fileName(f.rel_path)}</span>
            <Reasons f={f} bucket={bucket} />
          </div>
          <div className="truncate text-xs text-stone-400">{folderOf(f.rel_path)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Btn onClick={reveal}>{ctx.platform.revealLabel}</Btn>
          <Btn onClick={copyPath}>パスをコピー</Btn>
          <Btn onClick={() => mark("done")} primary>
            済
          </Btn>
          <Btn onClick={() => mark("skipped")}>対応しない</Btn>
        </div>
      </div>
      {open && (
        <div className="space-y-1 bg-stone-50 px-11 py-3 text-xs text-stone-600">
          <Detail f={f} scanId={ctx.scanId} />
        </div>
      )}
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
            <th className="w-8 px-2 py-2" aria-label="理由" />
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
  const [open, setOpen] = useState(false);
  const b = BUCKETS[bucket];
  const handled = f.action_status !== "todo";
  const { reveal, copyPath, mark, restore } = useFileActions(f, ctx);

  return (
    <>
      <tr className="hover:bg-stone-50/70">
        <td className="px-2 py-1.5 text-center">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="理由を表示"
            className="w-4 text-xs text-stone-400 hover:text-stone-700"
          >
            {open ? "▾" : "▸"}
          </button>
        </td>
        <td className={`whitespace-nowrap px-2 py-1.5 ${handled ? "opacity-50" : ""}`}>
          <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.text}`}>
            <span className={`h-2 w-2 rounded-full ${b.dot}`} aria-hidden />
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
                <Btn onClick={reveal}>{ctx.platform.revealLabel}</Btn>
                <Btn onClick={copyPath}>パスをコピー</Btn>
                <Btn onClick={() => mark("done")} primary small>
                  済
                </Btn>
                <Btn onClick={() => mark("skipped")}>対応しない</Btn>
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
      {open && (
        <tr>
          <td colSpan={5} className="space-y-1 bg-stone-50 px-10 py-2.5 text-xs text-stone-600">
            <Detail f={f} scanId={ctx.scanId} />
          </td>
        </tr>
      )}
    </>
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

function Btn({ children, onClick, primary, small }: { children: React.ReactNode; onClick: () => void; primary?: boolean; small?: boolean }) {
  if (primary) {
    // 「済」: Aqua 風の円形ジェルボタン（globals.css の .aqua）
    return (
      <button
        type="button"
        onClick={onClick}
        className={`aqua aqua-green mx-0.5 flex shrink-0 items-center justify-center ${small ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"}`}
      >
        <span>{children}</span>
      </button>
    );
  }
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

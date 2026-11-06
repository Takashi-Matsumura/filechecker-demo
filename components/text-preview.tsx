"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Level } from "./labels";

interface Mark {
  type: string;
  label: string;
  level: Level;
  start: number;
  end: number;
}

type Preview =
  | { available: true; text: string; marks: Mark[]; changed: boolean; note: string | null; source: "live" | "ocr" }
  | { available: false; reason: string };

const HIGHLIGHT: Record<Level, string> = {
  high: "bg-red-100 text-red-900 ring-red-300",
  medium: "bg-amber-100 text-amber-900 ring-amber-300",
  low: "bg-sky-100 text-sky-900 ring-sky-300",
  none: "bg-stone-200 text-stone-900 ring-stone-300",
};

const DOT: Record<Level, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-sky-500", none: "bg-stone-300" };

/**
 * ファイルの内容をプレビューし、検出した箇所に色を付ける。
 * 種類のボタンを押すと、その種類の箇所へ順に移動する。
 * プレビューを作れない形式（画像など）は、保存済みのマスク済み抜粋を表示する。
 */
export function TextPreview({ scanId, fileId, excerpt }: { scanId: string; fileId: string; excerpt: string | null }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/scans/${scanId}/files/${fileId}/preview`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Preview) => alive && setPreview(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [scanId, fileId]);

  const marks = useMemo(() => (preview?.available ? preview.marks : []), [preview]);

  // 種類ごとに、出てくる順の位置（marks の添字）をまとめる
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; level: Level; indexes: number[] }>();
    marks.forEach((m, i) => {
      const g = map.get(m.type) ?? { label: m.label, level: m.level, indexes: [] };
      g.indexes.push(i);
      map.set(m.type, g);
    });
    return [...map.entries()].map(([type, g]) => ({ type, ...g }));
  }, [marks]);

  // 本文を「ふつうの文字」と「検出箇所」に分ける
  const segments = useMemo(() => {
    if (!preview?.available) return [];
    const out: { text: string; mark?: number }[] = [];
    let pos = 0;
    preview.marks.forEach((m, i) => {
      if (m.start > pos) out.push({ text: preview.text.slice(pos, m.start) });
      out.push({ text: preview.text.slice(m.start, m.end), mark: i });
      pos = m.end;
    });
    if (pos < preview.text.length) out.push({ text: preview.text.slice(pos) });
    return out;
  }, [preview]);

  function jump(i: number) {
    setActive(i);
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-mark="${i}"]`);
    // ページ全体は動かさず、プレビューの枠の中だけをスクロールする
    if (box && el) box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 2), behavior: "smooth" });
  }

  function nextOf(indexes: number[]) {
    const cur = active === null ? -1 : indexes.indexOf(active);
    jump(indexes[(cur + 1) % indexes.length]);
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">内容のプレビュー</h2>
        <span className="text-xs text-stone-400">
          {!preview?.available
            ? "検出した番号や連絡先、AI が推定した氏名を伏せて保存した抜粋です"
            : preview.source === "ocr"
              ? "棚卸しのときに画像から読み取った文字です。検出した箇所に色を付け、番号や氏名は伏せて保存しています"
              : "検出した箇所に色を付けています。番号や氏名は伏せて表示し、この内容は保存しません"}
        </span>
      </div>

      {!preview && !failed && <p className="text-sm text-stone-400">プレビューを読み込み中…</p>}

      {preview?.available ? (
        <div className="space-y-3">
          {preview.changed && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              スキャンのあとにファイルが変更されています。ハイライトは現在の内容で検出し直したものです。
            </p>
          )}
          {groups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="検出箇所へ移動">
              {groups.map((g) => {
                const pos = active !== null ? g.indexes.indexOf(active) : -1;
                return (
                  <button
                    key={g.type}
                    type="button"
                    onClick={() => nextOf(g.indexes)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
                      pos >= 0 ? "bg-stone-900 font-semibold text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${DOT[g.level]}`} aria-hidden />
                    {g.label}
                    <span className="tabular-nums">{pos >= 0 ? `${pos + 1} / ${g.indexes.length}` : `${g.indexes.length}件`}</span>
                  </button>
                );
              })}
              <span className="text-xs text-stone-400">押すたびに次の箇所へ移動します</span>
            </div>
          ) : (
            <p className="text-xs text-stone-500">個人情報や機密表示の検出箇所はありません。</p>
          )}
          <div
            ref={boxRef}
            className="relative max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-50 p-4 font-mono text-xs leading-relaxed text-stone-700"
          >
            {segments.map((s, i) =>
              s.mark === undefined ? (
                <span key={i}>{s.text}</span>
              ) : (
                <mark
                  key={i}
                  data-mark={s.mark}
                  title={marks[s.mark].label}
                  className={`rounded px-0.5 ring-1 ${HIGHLIGHT[marks[s.mark].level]} ${active === s.mark ? "outline-2 outline-offset-1 outline-stone-900" : ""}`}
                >
                  {s.text}
                </mark>
              ),
            )}
          </div>
          {preview.note && <p className="text-xs text-stone-400">{preview.note}</p>}
        </div>
      ) : (
        (preview || failed) && (
          <div className="space-y-3">
            <p className="text-xs text-stone-500">{preview && !preview.available ? preview.reason : "プレビューを作れませんでした。保存済みの抜粋を表示しています"}</p>
            {excerpt && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-4 font-mono text-xs leading-relaxed text-stone-700">
                {excerpt}
              </pre>
            )}
          </div>
        )
      )}
    </section>
  );
}

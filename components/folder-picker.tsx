"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FolderRoot {
  path: string;
  label: string;
  kind: "allowed" | "network";
  selectable: boolean;
  source?: string;
}

interface FolderListing {
  path: string;
  parent: string | null;
  folders: { name: string; path: string }[];
  files: number;
  truncated: boolean;
}

/**
 * 棚卸しするフォルダを選ぶ画面（Finder のような一覧）。左に起点（ホーム・共有フォルダ）、右に中のフォルダを並べる。
 * 一覧はサーバ（/api/folders）が、棚卸しを許可した範囲の中だけを返す。
 */
export function FolderPicker({ initial, onSelect, onClose }: { initial: string; onSelect: (path: string) => void; onClose: () => void }) {
  const [roots, setRoots] = useState<FolderRoot[] | null>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const open = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders?path=${encodeURIComponent(p)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "開けませんでした");
      setListing(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 起点を取得し、入力欄のフォルダ（開けなければ最初の起点）を開く
  useEffect(() => {
    let cancelled = false;
    fetch("/api/folders")
      .then((r) => r.json())
      .then(async (j: { roots: FolderRoot[] }) => {
        if (cancelled) return;
        setRoots(j.roots);
        const first = j.roots.find((r) => r.selectable)?.path;
        const res = initial.trim() ? await fetch(`/api/folders?path=${encodeURIComponent(initial.trim())}`) : null;
        if (cancelled) return;
        if (res?.ok) setListing(await res.json());
        else if (first) void open(first);
      })
      .catch(() => setError("フォルダの一覧を取得できませんでした"));
    return () => {
      cancelled = true;
    };
  }, [initial, open]);

  // Esc で閉じる。開いたら選択画面にフォーカスを移す
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const network = roots?.filter((r) => r.kind === "network") ?? [];
  const allowed = roots?.filter((r) => r.kind === "allowed") ?? [];
  const inRoot = (r: FolderRoot) => listing && (listing.path === r.path || listing.path.startsWith(r.path.endsWith("/") ? r.path : `${r.path}/`));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        tabIndex={-1}
        className="flex h-[min(36rem,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 id="folder-picker-title" className="text-sm font-semibold">
            棚卸しするフォルダを選ぶ
          </h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 起点 */}
          <nav aria-label="場所" className="w-56 shrink-0 space-y-4 overflow-y-auto border-r border-stone-200 bg-stone-50 p-3 text-sm">
            <div>
              <p className="mb-1 px-2 text-[11px] font-semibold text-stone-500">この PC</p>
              {allowed.map((r) => (
                <RootButton key={r.path} root={r} active={!!inRoot(r)} onClick={() => open(r.path)} />
              ))}
            </div>
            <div>
              <p className="mb-1 px-2 text-[11px] font-semibold text-stone-500">共有フォルダ（ネットワーク）</p>
              {roots && network.length === 0 && (
                <p className="px-2 text-xs leading-relaxed text-stone-500">
                  接続中の共有フォルダはありません。Finder の「サーバへ接続」（⌘K）で接続すると、ここに出ます。
                </p>
              )}
              {network.map((r) => (
                <RootButton key={r.path} root={r} active={!!inRoot(r)} onClick={() => r.selectable && open(r.path)} />
              ))}
              {network.some((r) => !r.selectable) && (
                <p className="mt-2 px-2 text-xs leading-relaxed text-amber-800">
                  灰色の共有フォルダは、棚卸しを許可した範囲（環境変数 SCAN_ALLOWED_ROOTS）に加えると選べます。
                </p>
              )}
            </div>
          </nav>

          {/* 中のフォルダ */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2">
              <button
                type="button"
                onClick={() => listing?.parent && open(listing.parent)}
                disabled={!listing?.parent || loading}
                aria-label="1つ上のフォルダへ"
                title="1つ上のフォルダへ"
                className="rounded-md p-1 text-stone-600 hover:bg-stone-100 disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-stone-700" title={listing?.path}>
                {listing?.path ?? "…"}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
              {error && <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {!listing && !error && <p className="p-4 text-sm text-stone-400">読み込み中…</p>}
              {listing && listing.folders.length === 0 && !error && (
                <p className="p-4 text-sm text-stone-500">中にフォルダはありません。</p>
              )}
              {listing && listing.folders.length > 0 && (
                <ul className="divide-y divide-stone-100">
                  {listing.folders.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => open(f.path)}
                        disabled={loading}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-teal-50"
                      >
                        <FolderIcon />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {listing?.truncated && (
                <p className="px-4 py-2 text-xs text-amber-800">フォルダが多いため、先頭の 2,000 件だけを表示しています。</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3">
          <p className="text-xs text-stone-500">
            {listing ? `このフォルダの直下: フォルダ ${listing.folders.length.toLocaleString()} 件・ファイル ${listing.files.toLocaleString()} 件（中のフォルダも含めて棚卸しします）` : ""}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md bg-white px-3 py-1.5 text-sm text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50">
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => listing && onSelect(listing.path)}
              disabled={!listing || loading}
              className="aqua aqua-teal px-5 py-1.5 text-sm"
            >
              <span>このフォルダを選ぶ</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RootButton({ root, active, onClick }: { root: FolderRoot; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!root.selectable}
      title={root.selectable ? root.path : `${root.path}（SCAN_ALLOWED_ROOTS に加えると選べます）`}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? "bg-teal-100 text-teal-900" : "text-stone-700 hover:bg-stone-200/60"
      } disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:bg-transparent`}
    >
      {root.kind === "network" ? <ShareIcon /> : <FolderIcon />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{root.label}</span>
        {root.source && <span className="block truncate font-mono text-[10px] text-stone-500">{root.source}</span>}
      </span>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-teal-700" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

/** ネットワークの共有フォルダ（サーバの形） */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-sky-700" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <path d="M8 7h.01M8 17h.01" />
    </svg>
  );
}

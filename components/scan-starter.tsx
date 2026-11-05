"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Health {
  llm: { ok: boolean; model?: string; multimodal?: boolean; error?: string };
}

export function ScanStarter() {
  const router = useRouter();
  const [root, setRoot] = useState("");
  const [sampleDir, setSampleDir] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/scans")
      .then((r) => r.json())
      .then((j) => {
        setSampleDir(j.sampleDir);
        setAllowed(j.allowedRoots ?? []);
        if (j.sampleDir) setRoot((cur) => cur || j.sampleDir);
      })
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ llm: { ok: false, error: "取得できませんでした" } }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "開始できませんでした");
      router.push(`/scans/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const llm = health?.llm;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium">スキャンするフォルダ（絶対パス）</span>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="/Users/you/Documents/共有フォルダ"
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={busy || !root.trim()}
              className="aqua aqua-teal px-7 py-2 text-sm"
            >
              {/* Aqua 風のカプセル形ジェルボタン（globals.css の .aqua） */}
              <span>{busy ? "開始中…" : "棚卸しを開始"}</span>
            </button>
          </div>
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-stone-500">
          {sampleDir && (
            <button type="button" onClick={() => setRoot(sampleDir)} className="text-teal-700 underline underline-offset-2">
              デモ用サンプルフォルダを指定
            </button>
          )}
          {allowed.length > 0 && <span>許可されている範囲: {allowed.join(", ")}</span>}
        </div>
      </form>

      <div className="mt-5 flex items-center gap-2 border-t border-stone-100 pt-4 text-xs">
        <span
          className={`inline-block h-2 w-2 rounded-full ${!llm ? "bg-stone-300" : llm.ok ? "bg-emerald-500" : "bg-red-500"}`}
          aria-hidden
        />
        {!llm && <span className="text-stone-500">ローカル LLM を確認中…</span>}
        {llm?.ok && (
          <span className="text-stone-600">
            ローカル LLM 接続中: <span className="font-mono">{llm.model}</span>
            {llm.multimodal ? "（画像の文字読み取り対応）" : "（画像入力なし: スキャン書類は読めません）"}
          </span>
        )}
        {llm && !llm.ok && (
          <span className="text-red-700">
            ローカル LLM に接続できません。ルール検出のみで動作します（{llm.error}）
          </span>
        )}
      </div>
    </section>
  );
}

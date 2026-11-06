"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { RiskBadge } from "./scan-dashboard";
import { formatDate, formatSize, METHOD, RECOMMENDATION, RISK, type Level } from "./labels";
import { TextPreview } from "./text-preview";

interface Finding {
  type: string;
  label: string;
  level: Level;
  count: number;
  samples: string[];
}

interface Detail {
  file: {
    id: number;
    rel_path: string;
    ext: string;
    size: number;
    mtime: string;
    status: string;
    error: string | null;
    extract_method: string | null;
    text_chars: number;
    excerpt: string | null;
    findings: Finding[];
    rule_level: Level;
    risk: Level;
    is_stale: boolean;
    dup_of: number | null;
    ai: {
      summary?: string;
      category?: string;
      recommendation?: string;
      reason?: string;
      risk?: Level;
      contains_personal_info?: boolean;
      contains_confidential?: boolean;
    } | null;
  };
  duplicates: { id: number; rel_path: string }[];
}

export function FileDetail({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/scans/${id}/files/${fileId}`)
      .then(async (r) => {
        if (r.status === 404) setNotFound(true);
        else setData(await r.json());
      })
      .catch(() => setNotFound(true));
  }, [id, fileId]);

  if (notFound) return <p className="text-sm text-stone-500">ファイルが見つかりません。</p>;
  if (!data) return <p className="text-sm text-stone-400">読み込み中…</p>;

  const { file, duplicates } = data;
  const rec = file.ai?.recommendation ? RECOMMENDATION[file.ai.recommendation] : undefined;

  return (
    <div className="space-y-6">
      <Link href={`/scans/${id}`} className="text-xs text-teal-700 underline underline-offset-2">
        ← 棚卸し結果に戻る
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{file.rel_path.split("/").pop()}</h1>
          {file.status !== "pending" && <RiskBadge level={file.risk} />}
        </div>
        <p className="font-mono text-xs text-stone-500">{file.rel_path}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-600">
          <Meta k="形式" v={file.ext.toUpperCase() || "—"} />
          <Meta k="サイズ" v={formatSize(file.size)} />
          <Meta k="更新日" v={formatDate(file.mtime) + (file.is_stale ? "（3年以上前）" : "")} />
          <Meta k="読み取り" v={METHOD[file.extract_method ?? "none"]} />
          <Meta k="文字数" v={file.text_chars.toLocaleString()} />
        </dl>
      </div>

      {file.status === "pending" && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">まだ解析中です。</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">AI の判断</h2>
          {file.ai?.summary ? (
            <div className="space-y-4 text-sm">
              <p className="leading-relaxed">{file.ai.summary}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {file.ai.category && <span className="rounded bg-stone-100 px-2 py-0.5">{file.ai.category}</span>}
                {file.ai.contains_personal_info && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">個人情報あり</span>}
                {file.ai.contains_confidential && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">機密情報あり</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-400">AI の要約はありません。</p>
          )}
          {rec && (
            <div className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4">
              <div className="text-xs text-stone-500">推奨アクション</div>
              <div className={`mt-0.5 text-base font-semibold ${rec.className}`}>{rec.label}</div>
              {file.ai?.reason && <p className="mt-1 text-sm text-stone-600">{file.ai.reason}</p>}
            </div>
          )}
          <p className="mt-4 text-xs text-stone-400">
            AI の判断は参考情報です。最終的な扱いは担当者が決めてください。
          </p>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">検出された情報</h2>
          {file.findings.length === 0 ? (
            <p className="text-sm text-stone-400">個人情報・機密表示は検出されませんでした。</p>
          ) : (
            <ul className="space-y-4">
              {file.findings.map((f) => (
                <li key={f.type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <span className={`h-2 w-2 rounded-full ${RISK[f.level].dot}`} aria-hidden />
                      {f.label}
                    </span>
                    <span className="tabular-nums text-xs text-stone-500">{f.count} 件</span>
                  </div>
                  {f.samples.map((s, i) => (
                    <p key={i} className="rounded bg-stone-50 px-2 py-1 font-mono text-xs text-stone-600 break-all">
                      {s}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {(duplicates.length > 0 || file.error) && (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
          {duplicates.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">同じ内容のファイル</h2>
              <ul className="space-y-1 text-sm">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link href={`/scans/${id}/files/${d.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                      {d.rel_path}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {file.error && (
            <div>
              <h2 className="mb-1 text-sm font-semibold">補足</h2>
              <p className="text-xs text-stone-600">{file.error}</p>
            </div>
          )}
        </section>
      )}

      {file.status === "done" && (file.excerpt || file.text_chars > 0) && (
        <TextPreview scanId={id} fileId={fileId} excerpt={file.excerpt} />
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-stone-400">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

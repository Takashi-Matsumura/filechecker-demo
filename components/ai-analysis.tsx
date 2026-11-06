"use client";

import { useEffect, useState } from "react";
import type { AiStats, CallSummary, Counts, FeedbackSummary, JudgeVersion, ScanOption } from "@/lib/metrics";
import { BUCKET_ORDER, BUCKETS } from "./actions";
import { BackLink } from "./back-link";
import { RECOMMENDATION, RISK, type Level } from "./labels";

type Period = "all" | "30" | "7";
type StatsResponse = AiStats & { versions: JudgeVersion[]; scans: ScanOption[]; currentVersion: string };

/** 棚卸しの選択肢の表示（例: #42 sample-files 11/6 19:42・21件） */
function scanLabel(s: ScanOption): string {
  if (!s.root) return `#${s.id}（削除済み）・AI ${s.calls}回`;
  const folder = s.root.split(/[\\/]/).filter(Boolean).pop() ?? s.root;
  return `#${s.id} ${folder} ${date(s.createdAt)}・${s.total ?? "?"}件`;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "30", label: "直近30日" },
  { key: "7", label: "直近7日" },
];

const KIND_LABEL: Record<string, string> = {
  ocr: "文字の読み取り（OCR）",
  judge: "判定（要約・リスク・推奨）",
  names: "氏名の補完（判定で拾いきれない氏名）",
};
const KIND_SHORT: Record<string, string> = { ocr: "読み取り", judge: "判定", names: "氏名の補完" };
const ERROR_LABEL: Record<string, string> = { timeout: "時間切れ", http: "HTTP エラー", network: "接続できない", parse: "JSON の形の誤り" };
const LEVELS: Level[] = ["high", "medium", "low", "none"];

const sec = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}秒`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const num = (n: number | null, digits = 0) => (n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits }));
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/**
 * AI の分析。AI の処理の記録（本文は保存していない）から、速さ・失敗・判断の傾向を集計して見せる。
 */
export function AiAnalysis() {
  const [period, setPeriod] = useState<Period>("all");
  // 判定の指示文の版（空 = すべて）
  const [version, setVersion] = useState("");
  // 棚卸しの番号（空 = すべて）
  const [scan, setScan] = useState("");
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    let stop = false;
    const params = new URLSearchParams({ days: period });
    if (version) params.set("version", version);
    if (scan) params.set("scan", scan);
    fetch(`/api/ai-stats?${params}`)
      .then((r) => (r.ok ? (r.json() as Promise<StatsResponse>) : null))
      .then((s) => !stop && s && setStats(s))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [period, version, scan]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <BackLink href="/" label="ホームに戻る" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">AI の分析</h1>
            <p className="text-xs text-stone-500">
              棚卸しで AI を使った記録から、速さ・失敗・判断の傾向を集計しています。ファイルの本文や氏名は記録していません。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-stone-600">
            棚卸し
            <select
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              className="max-w-[16rem] rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 focus:border-teal-600 focus:outline-none"
            >
              <option value="">すべて</option>
              {stats?.scans.map((sc) => (
                <option key={sc.id} value={String(sc.id)}>
                  {scanLabel(sc)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            判定の指示文の版
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-xs text-stone-800 focus:border-teal-600 focus:outline-none"
            >
              <option value="">すべて</option>
              {stats?.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.version === stats.currentVersion ? "（現在）" : ""}　{date(v.firstAt)}〜{date(v.lastAt)}・{v.calls}回
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5" role="group" aria-label="期間">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                aria-pressed={period === p.key}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${
                  period === p.key ? "bg-stone-900 font-semibold text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {(version || scan) && stats && (
        <div className="-mt-4 space-y-1 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900 ring-1 ring-teal-200">
          {scan && (
            <p>
              棚卸し <span className="font-semibold">#{scan}</span> の記録だけを表示しています。テストデータでの評価は棚卸しに属さないので表示しません。
            </p>
          )}
          {version && (
            <p>
              判定の指示文の版 <span className="font-mono font-semibold">{version}</span>
              {version === stats.currentVersion ? "（現在の版）" : ""} で処理した記録だけを表示しています。文字の読み取りと氏名の補完は、この版で判定したファイルの処理だけを数えています。
            </p>
          )}
        </div>
      )}

      {!stats ? (
        <p className="text-sm text-stone-400">読み込み中…</p>
      ) : stats.byKind.length === 0 && stats.files.total === 0 && stats.feedback.total.done + stats.feedback.total.skipped === 0 && stats.evals.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-500">
          まだ記録がありません。棚卸しをすると、AI の処理の記録がたまっていきます。
        </p>
      ) : (
        <>
          <Speed stats={stats} />
          <Versions rows={stats.byVersion} />
          <Evals stats={stats} scanned={!!scan} />
          <Judgements stats={stats} />
          <Feedback stats={stats} />
          <ByExt stats={stats} />
        </>
      )}
    </div>
  );
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-stone-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${tone === "red" ? "text-red-700" : "text-stone-900"}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

/** 種類ごとの速さと失敗 */
function Speed({ stats }: { stats: AiStats }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {stats.byKind.map((k) => (
        <Card key={k.kind} title={KIND_LABEL[k.kind] ?? k.kind}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="呼び出し" value={`${num(k.calls)}回`} sub={k.aborted ? `ほかに中断 ${num(k.aborted)}回` : undefined} />
            <Metric
              label="失敗"
              value={pct(k.failures, k.calls)}
              sub={`${num(k.failures)}回${failureDetail(k)}`}
              tone={k.failures > 0 ? "red" : undefined}
            />
            <Metric label="1回の時間" value={sec(k.avgMs)} sub={`遅いほう1割は ${sec(k.p90Ms)} 以上`} />
            <Metric label="生成の速さ" value={k.tokensPerSec === null ? "—" : `${num(k.tokensPerSec, 1)}`} sub="トークン/秒" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function failureDetail(k: CallSummary): string {
  const parts = Object.entries(k.failuresByKind).map(([e, n]) => `${ERROR_LABEL[e] ?? e} ${n}`);
  return parts.length ? `（${parts.join("・")}）` : "";
}

/** モデル・指示文の版ごとの比較 */
function Versions({ rows }: { rows: CallSummary[] }) {
  return (
    <Card title="モデル・指示文の版ごと" note="指示文を書き換えると「版」が変わります。モデルや指示文を変えた前後を比べられます。">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">種類</th>
              <th className="py-2 pr-3 font-medium">モデル</th>
              <th className="py-2 pr-3 font-medium">指示文の版</th>
              <th className="py-2 pr-3 font-medium">期間</th>
              <th className="py-2 pr-3 text-right font-medium">回数</th>
              <th className="py-2 pr-3 text-right font-medium">失敗</th>
              <th className="py-2 pr-3 text-right font-medium">1回の時間</th>
              <th className="py-2 pr-3 text-right font-medium">遅いほう1割</th>
              <th className="py-2 text-right font-medium">トークン/秒</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.model}-${r.promptVersion}`}>
                <td className="py-2 pr-3 text-xs">{KIND_SHORT[r.kind] ?? r.kind}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.model ?? "—"}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.promptVersion}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-stone-500">
                  {date(r.firstAt)} 〜 {date(r.lastAt)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.calls)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${r.failures ? "text-red-700" : ""}`}>{pct(r.failures, r.calls)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{sec(r.avgMs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{sec(r.p90Ms)}</td>
                <td className="py-2 text-right tabular-nums">{num(r.tokensPerSec, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** ルール・AI・書式の判断の比較 */
function Judgements({ stats }: { stats: AiStats }) {
  const f = stats.files;
  const judged = f.total - f.aiFailed;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="リスクの判断：ルールと AI"
        note="行がルールの判定、列が AI の判定です。対角線から外れるほど判断が食い違っています（最終的なリスクは高いほうを採ります）。"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-stone-500">
              <th className="py-1.5 pr-2 text-left font-medium">ルール ＼ AI</th>
              {LEVELS.map((l) => (
                <th key={l} className="py-1.5 text-center font-medium">
                  {RISK[l].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((r) => (
              <tr key={r} className="border-t border-stone-100">
                <th className="py-1.5 pr-2 text-left text-xs font-medium text-stone-500">{RISK[r].label}</th>
                {LEVELS.map((a) => {
                  const n = f.riskMatrix[r]?.[a] ?? 0;
                  const lower = LEVELS.indexOf(a) > LEVELS.indexOf(r);
                  return (
                    <td
                      key={a}
                      className={`py-1.5 text-center tabular-nums ${r === a ? "bg-stone-50 font-semibold" : ""} ${
                        n > 0 && lower ? "text-red-700" : n === 0 ? "text-stone-300" : ""
                      }`}
                    >
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Metric label="AI が判定したファイル" value={num(judged)} sub={f.aiFailed ? `判定できなかった ${num(f.aiFailed)}件` : undefined} />
          <Metric label="AI がルールより低い" value={num(f.aiLowerThanRule)} sub={`${pct(f.aiLowerThanRule, judged)}（見落としの疑い）`} tone={f.aiLowerThanRule ? "red" : undefined} />
          <Metric label="AI がルールより高い" value={num(f.aiHigherThanRule)} sub={`${pct(f.aiHigherThanRule, judged)}（ルールで拾えない内容）`} />
        </div>
      </Card>

      <Card title="氏名・読み仮名：AI と書式のルール" note="書式のルール（名簿の「氏名」「フリガナ」列など）で拾えたもののうち、AI も見つけられた割合です。">
        <div className="grid grid-cols-2 gap-4">
          <Metric
            label="氏名"
            value={pct(f.names.both, f.names.layout)}
            sub={`書式で拾った ${num(f.names.layout)} 件のうち AI も ${num(f.names.both)} 件`}
          />
          <Metric
            label="読み仮名"
            value={pct(f.readings.both, f.readings.layout)}
            sub={`書式で拾った ${num(f.readings.layout)} 件のうち AI も ${num(f.readings.both)} 件`}
          />
          <Metric label="AI が見つけた氏名" value={`${num(f.names.ai)}件`} sub={`書式のルールでは拾えなかったファイル ${num(f.names.aiOnlyFiles)}件`} />
          <Metric label="AI が見つけた読み仮名" value={`${num(f.readings.ai)}件`} />
        </div>
        <h3 className="mt-6 text-xs font-semibold text-stone-500">最終的な推奨アクション</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {Object.entries(RECOMMENDATION).map(([key, r]) => (
            <li key={key} className="flex justify-between">
              <span className={r.className}>{r.label}</span>
              <span className="tabular-nums text-stone-600">{num(f.recommendations[key] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** 再現率（拾えた割合）と適合率（拾ったものが正しい割合）を並べて見せる */
function RecallPrecision({ c }: { c: Counts }) {
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const fmt = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <span className="tabular-nums">
      <span className={recall !== null && recall < 1 ? "text-red-700" : ""}>{fmt(recall)}</span>
      <span className="text-stone-400"> / </span>
      <span className={precision !== null && precision < 0.9 ? "text-amber-700" : ""}>{fmt(precision)}</span>
    </span>
  );
}

/** テストデータの正解を使った評価（npm run eval）の履歴 */
function Evals({ stats, scanned }: { stats: AiStats; scanned: boolean }) {
  return (
    <Card
      title="テストデータでの評価"
      note="テストデータ（すべて架空）の正解と比べた結果です。「標準」はデモ用のサンプル、「難しい」は画像の劣化・表の崩れ・上限を超える人数などを集めたものです。モデルや指示文を変えたら npm run eval で評価し、同じ物差しで比べられます（期間の絞り込みは効きません）。氏名・読み仮名・ルール検出は「拾えた割合 / 拾ったものが正しい割合」です。"
    >
      {scanned ? (
        <p className="text-sm text-stone-400">棚卸しで絞り込んでいる間は、テストデータでの評価を表示しません（評価はどの棚卸しにも属さないため）。</p>
      ) : stats.evals.length === 0 ? (
        <p className="text-sm text-stone-400">
          まだ評価していません。<code className="rounded bg-stone-100 px-1 py-0.5 text-xs">npm run testdata</code> のあと{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">npm run eval</code> を実行すると、ここに結果が並びます。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1140px] text-sm">
            <thead className="border-b border-stone-200 text-left text-xs text-stone-500">
              <tr className="whitespace-nowrap">
                <th className="py-2 pr-3 font-medium">日時</th>
                <th className="py-2 pr-3 font-medium">データ</th>
                <th className="py-2 pr-3 font-medium">モデル</th>
                <th className="py-2 pr-3 font-medium">判定 / 読み取りの版</th>
                <th className="py-2 pr-3 text-right font-medium">氏名</th>
                <th className="py-2 pr-3 text-right font-medium">読み仮名</th>
                <th className="py-2 pr-3 text-right font-medium">リスク一致</th>
                <th className="py-2 pr-3 text-right font-medium">推奨一致</th>
                <th className="py-2 pr-3 text-right font-medium">伏せ漏れ</th>
                <th className="py-2 pr-3 text-right font-medium">読み取り</th>
                <th className="py-2 pr-3 text-right font-medium">ルール検出</th>
                <th className="py-2 text-right font-medium">時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {stats.evals.map((e) => {
                const m = e.metrics;
                return (
                  <tr key={e.id} className="whitespace-nowrap">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-stone-500">{date(e.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {e.dataset === "hard" ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">難しい</span>
                      ) : (
                        <span className="text-stone-500">標準</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.model ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {e.judgeVersion} / {e.ocrVersion}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <RecallPrecision c={m.names} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <RecallPrecision c={m.readings} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {pct(m.risk.ok, m.risk.total)}
                      {m.risk.under > 0 && <span className="ml-1 text-xs text-red-700">（低い {m.risk.under}）</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(m.recommendation.ok, m.recommendation.total)}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${m.leaks.leaked ? "font-semibold text-red-700" : ""}`}>
                      {m.leaks.leaked} / {m.leaks.total}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(m.ocr.found, m.ocr.total)}</td>
                    <td className="py-2 pr-3 text-right">
                      <RecallPrecision c={m.rules} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{Math.round(e.durationMs / 1000)}秒</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 「対応しない」の割合（担当者が AI の指摘を受け入れなかった割合）を、数字と帯で見せる */
function SkipRate({ v }: { v: FeedbackSummary | undefined }) {
  const total = (v?.done ?? 0) + (v?.skipped ?? 0);
  const rate = total ? (v!.skipped / total) * 100 : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="h-2 w-24 rounded-full bg-stone-100" aria-hidden>
        <span className={`block h-full rounded-full ${rate >= 30 ? "bg-red-500" : "bg-stone-400"}`} style={{ width: `${rate}%` }} />
      </span>
      <span className={`w-10 text-right tabular-nums ${rate >= 30 ? "text-red-700" : ""}`}>{total ? `${Math.round(rate)}%` : "—"}</span>
    </div>
  );
}

/** 担当者の判断（「済」「対応しない」）との比較 */
function Feedback({ stats }: { stats: AiStats }) {
  const fb = stats.feedback;
  const total = fb.total.done + fb.total.skipped;
  return (
    <Card
      title="担当者の判断との比較"
      note="やることリストで担当者が押した「済」「対応しない」を、区分ごとに集計しています（ファイルごとに最後の操作。「戻す」で未対応に戻したものは数えません）。「対応しない」が多い区分は、指摘が見当違いになっている可能性があります。"
    >
      {total === 0 ? (
        <p className="text-sm text-stone-400">まだ担当者の判断の記録がありません。やることリストで「済」「対応しない」を押すと、ここに集計されます。</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead className="border-b border-stone-200 text-left text-xs text-stone-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">区分</th>
                  <th className="py-2 pr-3 text-right font-medium">済</th>
                  <th className="py-2 pr-3 text-right font-medium">対応しない</th>
                  <th className="py-2 text-right font-medium">「対応しない」の割合</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {BUCKET_ORDER.map((b) => {
                  const v = fb.byBucket[b];
                  return (
                    <tr key={b}>
                      <td className={`py-2 pr-3 font-medium ${BUCKETS[b].text}`}>{BUCKETS[b].verb}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(v?.done ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(v?.skipped ?? 0)}</td>
                      <td className="py-2">
                        <SkipRate v={v} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-stone-200 font-semibold">
                  <td className="py-2 pr-3">合計</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{num(fb.total.done)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{num(fb.total.skipped)}</td>
                  <td className="py-2">
                    <SkipRate v={fb.total} />
                  </td>
                </tr>
              </tbody>
            </table>
            {fb.unread.done + fb.unread.skipped > 0 && (
              <p className="mt-2 text-xs text-stone-500">
                うち中身を確認できなかったファイル（AI は中身を見ていない）：済 {num(fb.unread.done)}・対応しない {num(fb.unread.skipped)}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead className="border-b border-stone-200 text-left text-xs text-stone-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">判定の指示文の版</th>
                  <th className="py-2 pr-3 text-right font-medium">済</th>
                  <th className="py-2 pr-3 text-right font-medium">対応しない</th>
                  <th className="py-2 text-right font-medium">「対応しない」の割合</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {fb.byVersion.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-xs text-stone-400">
                      AI が判定したファイルの記録がありません
                    </td>
                  </tr>
                ) : (
                  fb.byVersion.map((v) => (
                    <tr key={v.promptVersion}>
                      <td className="py-2 pr-3 font-mono text-xs">{v.promptVersion}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(v.done)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(v.skipped)}</td>
                      <td className="py-2">
                        <SkipRate v={v} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-stone-500">指示文を変えたときに、担当者に受け入れられる指摘が増えたかを比べられます。</p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** ファイルの形式ごとの時間 */
function ByExt({ stats }: { stats: AiStats }) {
  return (
    <Card title="ファイルの形式ごとの時間">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">種類</th>
              <th className="py-2 pr-3 font-medium">形式</th>
              <th className="py-2 pr-3 text-right font-medium">回数</th>
              <th className="py-2 text-right font-medium">1回の時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {stats.byExt.map((r) => (
              <tr key={`${r.kind}-${r.ext}`}>
                <td className="py-2 pr-3 text-xs">{KIND_SHORT[r.kind] ?? r.kind}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.ext ? `.${r.ext}` : "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{num(r.calls)}</td>
                <td className="py-2 text-right tabular-nums">{sec(r.avgMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

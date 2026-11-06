"use client";

import { useEffect, useState } from "react";
import type { AiStats, CallSummary } from "@/lib/metrics";
import { BackLink } from "./back-link";
import { RECOMMENDATION, RISK, type Level } from "./labels";

type Period = "all" | "30" | "7";

const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "30", label: "直近30日" },
  { key: "7", label: "直近7日" },
];

const KIND_LABEL: Record<string, string> = { ocr: "文字の読み取り（OCR）", judge: "判定（要約・リスク・推奨）" };
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
  const [stats, setStats] = useState<AiStats | null>(null);

  useEffect(() => {
    let stop = false;
    fetch(`/api/ai-stats?days=${period}`)
      .then((r) => (r.ok ? (r.json() as Promise<AiStats>) : null))
      .then((s) => !stop && s && setStats(s))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [period]);

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

      {!stats ? (
        <p className="text-sm text-stone-400">読み込み中…</p>
      ) : stats.byKind.length === 0 && stats.files.total === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-500">
          まだ記録がありません。棚卸しをすると、AI の処理の記録がたまっていきます。
        </p>
      ) : (
        <>
          <Speed stats={stats} />
          <Versions rows={stats.byVersion} />
          <Judgements stats={stats} />
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
                <td className="py-2 pr-3 text-xs">{r.kind === "ocr" ? "読み取り" : "判定"}</td>
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
                <td className="py-2 pr-3 text-xs">{r.kind === "ocr" ? "読み取り" : "判定"}</td>
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

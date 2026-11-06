// テストデータの正解を使った AI の評価（npm run eval）
// 事前に npm run testdata でテストデータと正解（testdata/expected.json）を作り、llama-server を起動しておく。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { runEval, DATASETS } = await jiti.import(path.join(root, "lib/eval.ts"));

// npm run eval -- --set hard のように、片方のデータだけを評価できる（既定は両方）
const i = process.argv.indexOf("--set");
const sets = i >= 0 ? [process.argv[i + 1]] : Object.keys(DATASETS);
for (const s of sets) {
  if (!DATASETS[s]) {
    console.error(`--set には ${Object.keys(DATASETS).join(" / ")} のいずれかを指定してください`);
    process.exit(1);
  }
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const pr = (c) => `再現率 ${pct(c.tp, c.tp + c.fn)}（${c.tp}/${c.tp + c.fn}）  適合率 ${pct(c.tp, c.tp + c.fp)}（誤り ${c.fp}）`;

try {
  for (const set of sets) {
    console.log(`\n### ${DATASETS[set].label}のテストデータ（${DATASETS[set].dir}）で AI を評価します（ファイルごとに AI を呼ぶので数分かかります）\n`);
    const r = await runEval(path.join(root, "testdata"), set, (line) => console.log(line));
    const m = r.metrics;
    console.log(`\n=== 結果: ${DATASETS[set].label}（モデル ${r.model ?? "?"} / 判定の版 ${r.judgeVersion} / 読み取りの版 ${r.ocrVersion} / ${Math.round(r.durationMs / 1000)}秒）`);
    console.log(`氏名       ${pr(m.names)}`);
    console.log(`読み仮名   ${pr(m.readings)}`);
    console.log(`リスク     一致 ${pct(m.risk.ok, m.risk.total)}（${m.risk.ok}/${m.risk.total}）  正解より低い ${m.risk.under}`);
    console.log(`推奨       一致 ${pct(m.recommendation.ok, m.recommendation.total)}（${m.recommendation.ok}/${m.recommendation.total}）`);
    console.log(`伏せ漏れ   氏名 ${m.leaks.leaked}/${m.leaks.total}  番号 ${m.secretLeaks.leaked}/${m.secretLeaks.total}`);
    console.log(`読み取り   ${pct(m.ocr.found, m.ocr.total)}（${m.ocr.found}/${m.ocr.total}）`);
    console.log(`ルール検出 ${pr(m.rules)}`);
    if (m.aiFailures) console.log(`AI の失敗  ${m.aiFailures}件`);
    console.log(r.id ? `結果を記録しました（「AI の分析」画面で見られます）` : `結果を DB に記録できませんでした`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

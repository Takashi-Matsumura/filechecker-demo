/**
 * AI の応答の読み取り（lib/llm.ts の parseJudgement）の単体テスト。実行: npm test
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { parseJudgement } = await jiti.import<typeof import("../lib/llm.ts")>(path.join(root, "lib/llm.ts"));

const valid = {
  summary: "顧客1名の申込書",
  category: "身分証・申込書",
  contains_personal_info: true,
  contains_confidential: false,
  risk: "high",
  recommendation: "restrict",
  reason: "個人番号を含む",
  person_names: ["山田 太郎"],
  name_readings: [],
};

describe("parseJudgement", () => {
  it("形式どおりの応答を読む", () => {
    assert.deepEqual(parseJudgement(JSON.stringify(valid)), valid);
  });
  it("JSON でない応答のエラー文に、応答の中身（氏名など）を含めない", () => {
    assert.throws(() => parseJudgement("山田太郎の申込書です"), (e: Error) => !e.message.includes("山田"));
  });
  it("リスクや推奨が決められた値でなければ失敗にする", () => {
    assert.throws(() => parseJudgement(JSON.stringify({ ...valid, risk: "critical" })));
    assert.throws(() => parseJudgement(JSON.stringify({ ...valid, recommendation: "ignore" })));
    assert.throws(() => parseJudgement("null"));
  });
  it("型の違う項目は安全な値にそろえる", () => {
    const r = parseJudgement(JSON.stringify({ ...valid, summary: 1, person_names: ["佐藤", 2, null], name_readings: "x" }));
    assert.equal(r.summary, "");
    assert.deepEqual(r.person_names, ["佐藤"]);
    assert.deepEqual(r.name_readings, []);
  });
});

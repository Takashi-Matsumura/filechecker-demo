/**
 * 氏名の確認に使う見本づくり（lib/extract.ts の sampleSections）と、伏せ字の前後の位置の変換
 * （lib/detect.ts の toRedactedOffsets）の単体テスト。実行: npm test
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { sampleSections } = await jiti.import<typeof import("../lib/extract.ts")>(path.join(root, "lib/extract.ts"));
const { detect, redact, toRedactedOffsets } = await jiti.import<typeof import("../lib/detect.ts")>(path.join(root, "lib/detect.ts"));

/** シート名と本文から、抽出結果と同じ形の本文と区切りを作る */
function book(sheets: { name: string; body: string }[]) {
  let text = "";
  const sections = sheets.map((s) => {
    const start = text.length;
    text += `【シート: ${s.name}】\n${s.body}\n\n`;
    return { label: s.name, start };
  });
  return { text, sections };
}

describe("sampleSections", () => {
  it("先頭に加えて、すべてのシートの頭が見本に入る", () => {
    const sheets = Array.from({ length: 50 }, (_, i) => ({ name: `S${i + 1}`, body: `名簿${i + 1} ` + "x".repeat(5000) }));
    const { text, sections } = book(sheets);
    const s = sampleSections(text, sections, 6000, 54000);
    for (let i = 2; i <= 50; i++) assert.ok(s.text.includes(`【シート: S${i}】\n名簿${i} `), `S${i} が入っていない`);
    assert.equal(s.covered, 50);
    assert.ok(s.text.startsWith(text.slice(0, 6000)), "先頭 6000 字はそのまま");
    assert.ok(s.text.length <= 60000, `見本が長すぎる: ${s.text.length}`);
  });

  it("短いシートは全文が入り、余りは長いシートに回る", () => {
    const { text, sections } = book([
      { name: "表紙", body: "a".repeat(7000) },
      { name: "短い", body: "短いシートの末尾" },
      { name: "長い", body: "b".repeat(30000) + "長いシートの末尾" },
    ]);
    const s = sampleSections(text, sections, 6000, 20000);
    assert.ok(s.text.includes("短いシートの末尾"));
    assert.ok(s.text.includes("【表紙（続き）】"), "先頭からはみ出したシートの続きに見出しを付ける");
    assert.ok(s.perSection > 9000, `長いシートへの割り振りが少ない: ${s.perSection}`);
    assert.equal(s.covered, 3);
  });

  it("シートが多すぎるときは、前から入るだけ入れる", () => {
    const sheets = Array.from({ length: 300 }, (_, i) => ({ name: `S${i + 1}`, body: "y".repeat(2000) }));
    const { text, sections } = book(sheets);
    const s = sampleSections(text, sections, 6000, 54000);
    assert.ok(s.covered < 300 && s.covered > 100, `covered=${s.covered}`);
    assert.ok(s.text.length <= 60000);
  });
});

describe("toRedactedOffsets", () => {
  it("番号を伏せて長さが変わっても、シートの頭を指す", () => {
    const { text, sections } = book([
      { name: "一", body: "電話 03-1234-5678 / 090-1111-2222" },
      { name: "二", body: "メール taro.yamada@example.co.jp" },
      { name: "三", body: "なし" },
    ]);
    const { spans } = detect(text);
    assert.ok(spans.length > 0);
    const masked = redact(text, spans).text;
    const starts = toRedactedOffsets(spans, sections.map((x) => x.start));
    for (const [i, s] of sections.entries()) assert.ok(masked.startsWith(`【シート: ${s.label}】`, starts[i]), `シート ${s.label} の位置がずれた`);
  });

  it("伏せた範囲の途中の位置は、伏せ字の先頭に寄せる", () => {
    const spans = [{ type: "phone" as const, start: 5, end: 15, masked: "***" }];
    assert.deepEqual(toRedactedOffsets(spans, [0, 5, 10, 15, 20]), [0, 5, 5, 8, 13]);
  });
});

/**
 * Office の文字抽出（lib/extract.ts）の単体テスト。正しく読めることと、細工したファイルでも
 * 処理が長引かない（正規表現が線形時間で終わる）ことを確かめる。実行: npm test
 * lib/ のモジュールは拡張子なしで import し合うので、jiti で読み込む。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { extract } = await jiti.import<typeof import("../lib/extract.ts")>(path.join(root, "lib/extract.ts"));

function office(files: Record<string, string>): Buffer {
  const entries = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]));
  return Buffer.from(zipSync(entries, { level: 9 }));
}
const W = (body: string) => `<w:document><w:body>${body}</w:body></w:document>`;

/** 処理にかかった時間（ミリ秒）と結果 */
async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t = performance.now();
  const r = await fn();
  return [performance.now() - t, r];
}

describe("Office の文字抽出", () => {
  it("docx の段落と文字参照を読む（範囲外の文字参照で失敗しない）", async () => {
    const buf = office({ "word/document.xml": W(`<w:p><w:r><w:t xml:space="preserve">氏名 &#x5c71;田</w:t></w:r></w:p><w:p><w:r><w:t>&#x110000;&amp;</w:t></w:r></w:p>`) });
    const r = await extract(buf, "docx");
    assert.equal(r.method, "office");
    assert.equal(r.text, "氏名 山田\n�&");
  });
  it("xlsx のセルを列の位置どおりに読む", async () => {
    const buf = office({
      "xl/sharedStrings.xml": `<sst><si><t>氏名</t></si><si><t>山田 太郎</t></si></sst>`,
      "xl/worksheets/sheet1.xml":
        `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>電話</t></is></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"/><c r="C2"><v>123</v></c></row></sheetData></worksheet>`,
    });
    const r = await extract(buf, "xlsx");
    assert.equal(r.text, "氏名\t\t電話\n山田 太郎\t\t123");
  });

  // 以前の正規表現では、ここで数十秒〜それ以上かかっていた（長さの二乗で増える）
  const LIMIT_MS = 2000;
  it("閉じない <w:t の繰り返し（docx）でも長引かない", async () => {
    const buf = office({ "word/document.xml": W("<w:t a".repeat(400_000)) });
    const [ms] = await timed(() => extract(buf, "docx"));
    assert.ok(ms < LIMIT_MS, `${Math.round(ms)}ms`);
  });
  it("閉じない <c の繰り返し（xlsx）と閉じない <t の繰り返し（共有文字列）でも長引かない", async () => {
    const buf = office({
      "xl/sharedStrings.xml": `<sst><si>${"<t a".repeat(400_000)}</si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row>${'<c r="A1">x'.repeat(400_000)}</row></sheetData></worksheet>`,
    });
    const [ms] = await timed(() => extract(buf, "xlsx"));
    assert.ok(ms < LIMIT_MS, `${Math.round(ms)}ms`);
  });
});

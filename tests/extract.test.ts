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
const { config } = await jiti.import<typeof import("../lib/config.ts")>(path.join(root, "lib/config.ts"));

function office(files: Record<string, string>): Buffer {
  const entries = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]));
  return Buffer.from(zipSync(entries, { level: 9 }));
}
/** 文字だけの簡単な PDF を作る（ページごとの文字列。改行で行を分ける） */
function pdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) ; // 番号は 1 始まり
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // 2: Pages（あとで埋める）
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3
  const kids: number[] = [];
  for (const text of pages) {
    // 行ごとに Tj と T*（次の行へ）を並べる。1行が長すぎるとページの外にはみ出して読まれないため
    const lines = text.split("\n").map((l) => `(${l}) Tj T*`).join(" ");
    const stream = `BT /F1 10 Tf 12 TL 36 760 Td ${lines} ET`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentId = objs.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
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
    // workbook.xml がなければ、シートは番号順・名前は「シート N」
    assert.equal(r.text, "【シート: シート 1】\n氏名\t\t電話\n山田 太郎\t\t123");
  });
  it("すべてのシートを Excel のタブの順に、シート名つきで読み、セルのコメントも読む（.xlsm も同じ）", async () => {
    const sheet = (v: string) => `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row></sheetData></worksheet>`;
    const files = {
      // タブの順は「社員名簿 → 集計 → 予算」。ファイルの番号順（sheet1, 2, 3）とは違う
      "xl/workbook.xml":
        `<workbook><sheets><sheet name="社員名簿" sheetId="3" r:id="rId3"/><sheet name="集計" sheetId="1" r:id="rId1"/>` +
        `<sheet name="予算&amp;実績" sheetId="2" r:id="rId2"/><sheet name="グラフ" sheetId="4" r:id="rId4"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels":
        `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/>` +
        `<Relationship Id="rId3" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Target="chartsheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": sheet("集計の中身"),
      "xl/worksheets/sheet2.xml": sheet("予算の中身"),
      "xl/worksheets/sheet3.xml": sheet("名簿の中身"),
      "xl/worksheets/sheet4.xml": sheet("workbook に載っていないシート"),
      "xl/comments1.xml": `<comments><commentList><comment ref="B2" authorId="0"><text><r><t>電話 03-1234-5678</t></r></text></comment></commentList></comments>`,
      // Excel 以外のソフトが書くコメントの置き場所
      "xl/comments/comment2.xml": `<comments><commentList><comment ref="D4" authorId="0"><text><t>前年比 3% 増</t></text></comment></commentList></comments>`,
      "xl/threadedComments/threadedComment1.xml": `<ThreadedComments><threadedComment ref="C3" id="{x}"><text>要確認</text></threadedComment></ThreadedComments>`,
    };
    for (const ext of ["xlsx", "xlsm"]) {
      const r = await extract(office(files), ext);
      assert.equal(r.method, "office", ext);
      assert.equal(
        r.text,
        [
          "【シート: 社員名簿】", "名簿の中身", "",
          "【シート: 集計】", "集計の中身", "",
          "【シート: 予算&実績】", "予算の中身", "",
          "【シート: シート 4】", "workbook に載っていないシート", "",
          "【コメント】", "B2: 電話 03-1234-5678", "D4: 前年比 3% 増", "C3: 要確認",
        ].join("\n"),
        ext,
      );
      assert.deepEqual(r.sections?.map((x) => x.label), ["社員名簿", "集計", "予算&実績", "シート 4", "コメント"]);
      assert.equal(r.note, "全 4 シートを検査");
      // 区切りの開始位置は、本文の中のシート名の行を指す
      for (const sec of r.sections ?? []) assert.ok(r.text.startsWith("【", sec.start), sec.label);
    }
  });
  it("文字数の上限を超えたら、どのシートまで検査したかを示す", async () => {
    const saved = config.maxTextChars;
    (config as { maxTextChars: number }).maxTextChars = 60;
    try {
      const sheet = (v: string) => `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row></sheetData></worksheet>`;
      const r = await extract(office({ "xl/worksheets/sheet1.xml": sheet("あ".repeat(30)), "xl/worksheets/sheet2.xml": sheet("い".repeat(30)), "xl/worksheets/sheet3.xml": sheet("う") }), "xlsx");
      assert.equal(r.note, "先頭 60 文字のみ検査（全 3 シート中 2 シート目まで）");
    } finally {
      (config as { maxTextChars: number }).maxTextChars = saved;
    }
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

describe("PDF の文字抽出", () => {
  const line = (i: number) => `Page ${i} contact taro@example.com ${"x".repeat(40)}`;
  it("ページの文字を読む", async () => {
    const r = await extract(pdf([line(1), line(2)]), "pdf", undefined, { allowOcr: false });
    assert.equal(r.method, "pdf-text");
    assert.match(r.text, /Page 1 [^]*Page 2 /);
    assert.equal(r.note, undefined);
  });
  it("ページ数が多い PDF は、先頭 500 ページまでで打ち切って知らせる", async () => {
    const [ms, r] = await timed(() => extract(pdf(Array.from({ length: 1500 }, (_, i) => line(i + 1))), "pdf", undefined, { allowOcr: false }));
    assert.equal(r.method, "pdf-text");
    assert.match(r.note ?? "", /全1500ページ中、先頭500ページのみ検査/);
    assert.match(r.text, /Page 500 /);
    assert.doesNotMatch(r.text, /Page 501 /);
    assert.ok(ms < 20_000, `${Math.round(ms)}ms`);
  });
  it("文字数が上限を超えたら、それ以上のページは読まない", async () => {
    const long = (i: number) => [`Page ${i}`, ...Array.from({ length: 20 }, () => "y".repeat(80))].join("\n");
    const saved = config.maxTextChars;
    (config as { maxTextChars: number }).maxTextChars = 200_000;
    let r;
    try {
      r = await extract(pdf(Array.from({ length: 300 }, (_, i) => long(i + 1))), "pdf", undefined, { allowOcr: false });
    } finally {
      (config as { maxTextChars: number }).maxTextChars = saved;
    }
    assert.match(r.note ?? "", /文字数が多いため、全300ページ中、先頭\d+ページまで読み取り/);
    assert.doesNotMatch(r.text, /Page 300 /);
  });
});

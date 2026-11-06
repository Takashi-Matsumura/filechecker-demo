/**
 * アプリの正規表現が、どんな入力でも極端に遅くならないこと（長さの二乗以上の時間がかからないこと）を確かめる。
 * 検出のルールや Office の読み取りは、社員のファイルの中身という信頼できない入力を読み、同期処理なので、
 * 遅い正規表現が1つあるとサーバ全体が止まる。手で考えた入力では見落としやすい（実際に3回見落とした）ので、
 * recheck（正規表現の静的解析と探索）で、アプリの正規表現をすべて調べる。
 *
 * 集め方（正規表現を足すたびに、ここへ手で登録しなくてよいように）:
 * - リテラル（/…/）: ソースコードを TypeScript で構文解析して、すべて拾う
 * - new RegExp(…) で組み立てるもの: lib/ のモジュールを読み込んで動かし、作られた正規表現を記録する
 * 実行: npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { createJiti } from "jiti";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { checkSync } = require("recheck") as typeof import("recheck");

/** 調べた正規表現（重複は1つにまとめる）。キーは /source/flags、値はどこで見つけたか */
const patterns = new Map<string, { source: string; flags: string; where: string }>();
const add = (source: string, flags: string, where: string) => {
  const key = `/${source}/${flags}`;
  if (!patterns.has(key)) patterns.set(key, { source, flags, where });
};

// ---- リテラル: アプリのソースコードから拾う（テストやスクリプトは対象外）
const SOURCE_DIRS = ["lib", "components", "app"];
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}
for (const rel of [...SOURCE_DIRS.flatMap(sourceFiles), "proxy.ts"]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const lit = node.getText(sf);
      const end = lit.lastIndexOf("/");
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      add(lit.slice(1, end), lit.slice(end + 1), `${rel}:${line}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---- new RegExp(…): lib/ のモジュールを動かして、作られた正規表現を記録する
const NativeRegExp = RegExp;
const libDir = `${path.join(root, "lib")}${path.sep}`;
class RecordingRegExp extends NativeRegExp {
  constructor(pattern: string | RegExp, flags?: string) {
    super(pattern, flags);
    // lib/ のコードから作られたものだけを記録する（jiti などの内部で作られるものは除く）
    const caller = new Error().stack?.split("\n").slice(2).find((l) => !l.includes("RecordingRegExp"));
    if (caller?.includes(libDir)) {
      // スタックの行（"at fn (…/lib/detect.ts:110:18)"）から、ファイルと行番号だけを取り出す
      const at = caller.slice(caller.indexOf(libDir) + root.length + 1).replace(/:(\d+):\d+\)?$/, ":$1");
      add(this.source, this.flags, `new RegExp（${at}）`);
    }
  }
}
globalThis.RegExp = RecordingRegExp as RegExpConstructor;
try {
  const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` }, moduleCache: false });
  const detect = await jiti.import<typeof import("../lib/detect.ts")>(path.join(root, "lib/detect.ts"));
  const { extract } = await jiti.import<typeof import("../lib/extract.ts")>(path.join(root, "lib/extract.ts"));
  // 関数の中で作るものも記録されるよう、ひととおり動かす
  const text = "氏名 山田 太郎\nフリガナ ヤマダ タロウ\n東京都千代田区架空町1-2-3\nTEL 03-1234-5678\n生年月日 1983/12/03";
  const { spans } = detect.detect(text);
  detect.redact(text, spans, ["山田 太郎"]);
  detect.findNamesByLayout(text);
  detect.findNameReadings(text);
  const zip = (files: Record<string, string>) =>
    Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  await extract(zip({ "word/document.xml": "<w:p><w:t>a</w:t></w:p>" }), "docx");
  await extract(zip({ "ppt/slides/slide1.xml": "<a:p><a:t>a</a:t></a:p>" }), "pptx");
  await extract(zip({ "xl/worksheets/sheet1.xml": '<row><c r="A1"><v>1</v></c></row>' }), "xlsx");
} finally {
  globalThis.RegExp = NativeRegExp;
}

describe("正規表現が極端に遅くならない", () => {
  it("十分な数の正規表現を集めている（集め方が壊れていないこと）", () => {
    const dynamic = [...patterns.values()].filter((p) => p.where.startsWith("new RegExp")).length;
    // 2026-11-07 時点で、リテラル 42 件・new RegExp 17 件。大きく減っていたら集め方が壊れている
    assert.ok(patterns.size >= 50, `${patterns.size} 件`);
    assert.ok(dynamic >= 15, `new RegExp で作られたもの ${dynamic} 件`);
  });

  for (const [key, p] of patterns) {
    const shown = key.replace(/\s+/g, " ");
    it(`${p.where}  ${shown.length > 80 ? shown.slice(0, 80) + "…" : shown}`, () => {
      const r = checkSync(p.source, p.flags, { timeout: 10_000 });
      // unknown（時間内に判定できなかった）も失敗にする。安全と言い切れない正規表現は書き直す
      assert.equal(
        r.status,
        "safe",
        r.status === "vulnerable" ? `${r.complexity.type} の遅さ。攻撃に使える入力の例: ${r.attack.pattern}` : `判定できない: ${JSON.stringify(r)}`,
      );
    });
  }
});

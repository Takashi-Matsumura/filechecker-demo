/**
 * 氏名の確認に使う本文の縮め方（lib/name-text.ts）と、氏名の補完（lib/llm.ts の collectMoreNames）の単体テスト。
 * 氏名の補完は、偽の llama-server を立てて、AI に渡した本文と呼び出し回数を確かめる。実行: npm test
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createJiti } from "jiti";

// 偽の llama-server。受け取った本文を記録し、本文に「★」で始まる語があれば氏名として返す
const received: string[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/props") return res.end(JSON.stringify({ total_slots: 1 }));
    const user = JSON.parse(body).messages[1].content as string;
    const text = user.slice(user.indexOf('"""'));
    received.push(text);
    const names = [...new Set(text.match(/★[^\s,]+/g) ?? [])];
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ person_names: names, name_readings: [] }) } }] }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.LLM_CONCURRENCY = "1";
process.env.DB_PATH = path.join(await import("node:fs/promises").then((f) => f.mkdtemp(path.join((process.env.TMPDIR ?? "/tmp"), "fc-names-"))), "t.db");

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const nt = await jiti.import<typeof import("../lib/name-text.ts")>(path.join(root, "lib/name-text.ts"));
const { collectMoreNames, judgeTextOf, JUDGE_TEXT_CHARS, MAX_NAME_CHUNKS } = await jiti.import<typeof import("../lib/llm.ts")>(path.join(root, "lib/llm.ts"));

after(() => server.close());

/** i ごとに違う2文字の漢字（行ごとに新しい語を作るため） */
const kanji = (i: number) => String.fromCharCode(0x4e00 + (i % 150), 0x5000 + (Math.floor(i / 150) % 5000));

/** 数字と同じ科目名がくり返される予算表 */
function budget(rows: number) {
  const lines = ["科目名称,前期実績,4月予算,実績"];
  for (let i = 0; i < rows; i++) lines.push(`${8100 + (i % 6) * 10} 事業部${i % 6},${i * 13},${i * 7},"=IF(C${i} = 0, """", D${i}/C${i}*100)"`);
  return lines.join("\n");
}

describe("condenseForNames", () => {
  it("新しい語の無い行を省き、新しい語のある行は残す", () => {
    const text = [budget(2000), "担当者 ★山田 太郎", budget(2000)].join("\n");
    const c = nt.condenseForNames(text);
    assert.ok(c.text.length < 1000, `縮んでいない: ${c.text.length}`);
    assert.ok(c.text.includes("★山田 太郎"));
  });

  it("語はどれも既出でも、組み合わせが新しい氏名の行は残す", () => {
    const c = nt.condenseForNames("田中 一郎\n山田 太郎\n田中 太郎\n山田 太郎");
    assert.equal(c.text, "田中 一郎\n山田 太郎\n田中 太郎");
  });

  it("1文字ずつの氏名（林 学）も新しい語として数え、縮めるときにも消さない", () => {
    const c = nt.condenseForNames(`林 一郎\n山田 学\n1,2,3\n林 学\n${"9".repeat(40)} 李 ${"9".repeat(40)}`);
    assert.ok(c.text.includes("林 学"), c.text);
    assert.ok(c.text.includes("李"), c.text);
  });

  it("半角カナ・ローマ字の氏名も新しい語として数える", () => {
    const c = nt.condenseForNames("1,2,3\nﾔﾏﾀﾞ ﾀﾛｳ\n4,5,6\nDaisuke Matsumoto\n7,8,9");
    assert.equal(c.text, "ﾔﾏﾀﾞ ﾀﾛｳ\nDaisuke Matsumoto");
  });

  it("大文字だけのローマ字の氏名は語として数え、Excel の数式の関数名とセル番地は数えない", () => {
    const c = nt.condenseForNames('売上 =IF(AA2 > 0, AB2/AA2*100, "")\n売上 =SUM(C3:C9)\nTARO YAMADA');
    assert.equal(c.text.split("\n").length, 2, c.text);
    assert.ok(c.text.endsWith("TARO YAMADA"));
  });

  it("残した行も、語と語のあいだの長い数字・数式は縮め、電話番号程度の区切りは残す", () => {
    const row = `8160 コンサルティング,${Array.from({ length: 40 }, (_, i) => `${i * 1000},"=IF(C${i} = 0, """", D${i}/C${i}*100)"`).join(",")}`;
    const c = nt.condenseForNames(`${row}\n山田 太郎,03-1234-5678,taro@example.jp`);
    assert.ok(c.text.length < 80, c.text);
    assert.ok(c.text.includes("山田 太郎,03-1234-5678,taro@example.jp"));
  });

  it("シートの見出しは新しい語が無くても残し、位置を対応づけられる", () => {
    const text = "【シート: 表】\n予算 1\n予算 2\n【シート: 表】\n予算 3\n名簿 鈴木";
    const c = nt.condenseForNames(text);
    assert.equal(c.text, "【シート: 表】\n予算 1\n【シート: 表】\n名簿 鈴木");
    const second = text.indexOf("【シート: 表】", 1);
    assert.equal(nt.toCondensedOffset(c, second), c.text.indexOf("【シート: 表】", 1));
    assert.equal(nt.toOriginalOffset(c, c.text.indexOf("鈴木")), text.indexOf("鈴木"));
  });
});

describe("collectMoreNames", () => {
  before(() => (received.length = 0));

  it("数字の多い長い表は、少ない呼び出しで最後まで確認する", async () => {
    received.length = 0;
    const text = [budget(3000), "承認 ★佐藤 花子", budget(3000)].join("\n");
    assert.ok(text.length > JUDGE_TEXT_CHARS * MAX_NAME_CHUNKS * 3);
    const r = await collectMoreNames(text, { names: [], readings: [], text: text.slice(0, JUDGE_TEXT_CHARS) });
    assert.deepEqual(r.names, ["★佐藤"]);
    assert.deepEqual(r.coverage, { kind: "full" });
    assert.equal(received.length, 1, `呼び出しが多い: ${received.length}`);
  });

  it("判定が見た行は聞き直さず、判定が見ていない行は聞く", async () => {
    received.length = 0;
    const head = Array.from({ length: 1000 }, (_, i) => `議題 担当 ★${kanji(i)}`).join("\n");
    const text = head + "\n" + budget(100);
    const r = await collectMoreNames(text, { names: [], readings: [], text: judgeTextOf(text).text });
    assert.ok(!received.some((t) => t.includes(`★${kanji(0)}\n`)), "判定が見た行を聞き直している");
    assert.ok(r.names.length > 0, "境目より後の氏名を聞いていない");
  });

  it("新しい語ばかりの長い文章は、先頭からの範囲を返す", async () => {
    received.length = 0;
    const text = Array.from({ length: 20000 }, (_, i) => `第${i}項 ★${kanji(i)} 記載`).join("\n");
    const r = await collectMoreNames(text, null);
    assert.equal(r.coverage.kind, "partial");
    // 区切りは最大 MAX_NAME_CHUNKS 個（1区切りで氏名が上限に達すると、最大3回まで聞き直す）
    assert.ok(received.length <= MAX_NAME_CHUNKS * 3, `呼び出しが多い: ${received.length}`);
    if (r.coverage.kind === "partial") assert.ok(r.coverage.origChars > 0 && r.coverage.origChars < text.length);
  });

  it("シートが多くて縮めても長いときは、各シートの頭から確認する", async () => {
    received.length = 0;
    let text = "";
    const sections: { label: string; start: number }[] = [];
    for (let s = 0; s < 30; s++) {
      sections.push({ label: `S${s}`, start: text.length });
      text += `【シート: S${s}】\n担当 ★${kanji(500000 + s)}\n` + Array.from({ length: 600 }, (_, i) => `記録 ${kanji(s * 1000 + i)}`).join("\n") + "\n";
    }
    const r = await collectMoreNames(text, null, undefined, undefined, undefined, sections);
    assert.equal(r.coverage.kind, "sampled");
    for (let s = 0; s < 30; s++) assert.ok(r.names.includes(`★${kanji(500000 + s)}`), `S${s} の氏名を確認していない`);
  });
});

describe("judgeTextOf", () => {
  it("短い本文はそのまま渡す", () => {
    assert.deepEqual(judgeTextOf("会議メモ\n山田"), { text: "会議メモ\n山田", condensedFrom: null });
  });

  it("長い表は縮めて、後ろのほうにある名簿も判定に見せる", () => {
    const text = [budget(3000), "連絡先一覧", "山田 太郎,03-1234-5678", "佐藤 花子,03-2345-6789"].join("\n");
    const j = judgeTextOf(text);
    assert.equal(j.condensedFrom, text.length);
    assert.ok(j.text.length <= JUDGE_TEXT_CHARS);
    assert.ok(j.text.includes("連絡先一覧") && j.text.includes("佐藤 花子,03-2345-6789"), j.text);
  });

  it("縮めても長い Excel は、後ろのシートの頭も判定に見せる", () => {
    let text = "";
    const sections: { label: string; start: number }[] = [];
    for (let s = 0; s < 20; s++) {
      sections.push({ label: `S${s}`, start: text.length });
      text += `【シート: S${s}】\n` + Array.from({ length: 200 }, (_, i) => `記録 ${kanji(s * 1000 + i)}`).join("\n") + "\n";
    }
    const j = judgeTextOf(text, sections);
    assert.ok(j.text.length <= JUDGE_TEXT_CHARS);
    assert.ok(j.text.includes("【シート: S19】"), "最後のシートが入っていない");
  });
});

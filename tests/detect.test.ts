/**
 * ルール検出（lib/detect.ts）の単体テスト。AI を使わずに決まる部分（番号の検出・検証・伏せ方、氏名の伏せ方、
 * 総合レベル）を確かめる。実行: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detect,
  findNameRanges,
  findNameReadings,
  findNamesByLayout,
  isLuhn,
  isValidMyNumber,
  maskNameRanges,
  maskNames,
  redact,
  ruleLevel,
  type FindingType,
} from "../lib/detect.ts";

/** マイナンバーのチェックデジットを付ける（検証側とは別に、仕様どおりに計算する） */
function myNumber(base11: string): string {
  const p = base11.split("").reverse().map(Number); // P1 = 右端
  const sum = p.reduce((s, d, i) => s + d * (i + 1 <= 6 ? i + 2 : i - 4), 0);
  const r = sum % 11;
  return base11 + String(r <= 1 ? 0 : 11 - r);
}
const toFullWidth = (s: string) => s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/-/g, "－");

/** 検出された種類と、その一致部分 */
function found(text: string): { type: FindingType; text: string; masked: string }[] {
  return detect(text).spans.map((s) => ({ type: s.type, text: text.slice(s.start, s.end), masked: s.masked }));
}
const typesOf = (text: string) => found(text).map((f) => f.type);

const MYNUMBER = myNumber("12345678901");
const CARD = "4111111111111111"; // Luhn に通るテスト用番号

describe("検証ロジック", () => {
  it("マイナンバーのチェックデジット", () => {
    assert.equal(isValidMyNumber(MYNUMBER), true);
    const wrong = MYNUMBER.slice(0, 11) + String((Number(MYNUMBER[11]) + 1) % 10);
    assert.equal(isValidMyNumber(wrong), false);
    assert.equal(isValidMyNumber("12345"), false);
  });
  it("カード番号の Luhn", () => {
    assert.equal(isLuhn(CARD), true);
    assert.equal(isLuhn("4111111111111112"), false);
  });
});

describe("番号の検出", () => {
  it("マイナンバー（半角・全角、区切りあり・なし）", () => {
    const spaced = `${MYNUMBER.slice(0, 4)} ${MYNUMBER.slice(4, 8)} ${MYNUMBER.slice(8)}`;
    for (const s of [MYNUMBER, spaced, toFullWidth(spaced), toFullWidth(MYNUMBER)]) {
      const f = found(`個人番号：${s}`);
      assert.deepEqual(f.map((x) => x.type), ["mynumber"], s);
      assert.doesNotMatch(f[0].masked, /[0-9０-９]/, "マイナンバーはすべて伏せる");
    }
  });
  it("チェックデジットが合わない12桁はマイナンバーとしない", () => {
    assert.deepEqual(typesOf("受注番号: 1234 5678 9010"), []);
  });
  it("カード番号は末尾4桁だけ残す（全角も）", () => {
    const f = found(`カード：${toFullWidth("4111-1111-1111-1111")}`);
    assert.deepEqual(f.map((x) => x.type), ["credit_card"]);
    assert.equal(f[0].masked.replace(/[^0-9０-９]/g, ""), "１１１１");
    assert.deepEqual(typesOf("追跡番号: 4111 1111 1111 1112"), [], "Luhn に通らない番号は拾わない");
  });
  it("口座番号（半角・全角）", () => {
    for (const t of ["普通 1234567", `普通　${toFullWidth("1234567")}`, "口座番号：7654321"]) {
      const f = found(t);
      assert.deepEqual(f.map((x) => x.type), ["bank_account"], t);
      assert.doesNotMatch(f[0].masked, /[0-9０-９]/);
    }
  });
  it("電話番号（国内・国際・全角・長音記号の区切り）は末尾4桁を残す", () => {
    const cases = ["03-1234-5678", "09012345678", "+81-80-1234-5678", "+81 3 1234 5678", toFullWidth("090-1234-5678"), "０９０ー１２３４ー５６７８"];
    for (const t of cases) {
      const f = found(`TEL ${t}`);
      assert.deepEqual(f.map((x) => x.type), ["phone"], t);
      assert.equal(f[0].masked.replace(/[^0-9０-９]/g, "").length, 4, t);
    }
  });
  it("電話番号に似た製品コードやロット番号は拾わない", () => {
    assert.deepEqual(typesOf("製品コード: 0120-345-678-9"), []);
    assert.deepEqual(typesOf("ロット: 2025-0520-0001"), []);
  });
  it("郵便番号（半角・全角）", () => {
    for (const t of ["〒220-0001", "〒２２０－０００１", "〒２２０ー０００１", "〒2200001"]) {
      const f = found(t);
      assert.deepEqual(f.map((x) => x.type), ["postal_code"], t);
      assert.doesNotMatch(f[0].masked, /[0-9０-９]/, t);
    }
    assert.deepEqual(typesOf("〒1234-56789"), [], "桁が多いものは郵便番号としない");
  });
  it("生年月日（半角・全角・和暦）", () => {
    for (const t of ["生年月日: 1983/12/03", "生年月日：１９８３年１２月３日", "生年月日　１９８３／１２／０３", "生年月日 昭和58年 5月 20日生"]) {
      const f = found(t);
      assert.deepEqual(f.map((x) => x.type), ["birthdate"], t);
      assert.doesNotMatch(f[0].masked, /[0-9０-９]/, t);
    }
  });
  it("見出しがなくても「生」「生まれ」が続く日付は生年月日として拾う", () => {
    for (const t of ["昭和58年12月3日生", "1983年12月3日生まれ", "１９８３年１２月３日生、男性", "誕生日 2001/4/5"]) {
      const f = found(t);
      assert.deepEqual(f.map((x) => x.type), ["birthdate"], t);
      assert.doesNotMatch(f[0].masked, /[0-9０-９]/, t);
    }
  });
  it("生年月日でない日付は拾わない", () => {
    for (const t of ["2025年4月15日生産分", "2025年4月15日生成", "受付日 2025年4月15日", "2025/4/15 生産"]) assert.deepEqual(typesOf(t), [], t);
  });
  it("メールアドレス・住所・身分証・機密表示", () => {
    assert.deepEqual(typesOf("連絡先 taro.yamada@example.co.jp"), ["email"]);
    assert.deepEqual(typesOf("東京都千代田区架空町1-2-3"), ["address"]);
    assert.deepEqual(typesOf("運転免許証のコピー"), ["id_document"]);
    assert.deepEqual(typesOf("この資料は社外秘です"), ["confidential"]);
  });
  it("カード番号と重なる一致は、ほかの種類として数えない", () => {
    assert.deepEqual(typesOf(`カード ${CARD}`), ["credit_card"]);
  });
});

describe("処理時間（どんな中身でも線形時間で終わる）", () => {
  // 以前のメールアドレスのルールは、@ のない英数字の連続で開始位置ごとに末尾まで読み直し、20万文字で約30秒かかっていた
  const N = 200_000;
  const cases: Record<string, string> = {
    英字の連続: "a".repeat(N),
    数字の連続: "1".repeat(N),
    数字とハイフン: "0-".repeat(N / 2),
    "@ の後の長い連続": "a@" + "a".repeat(N),
    "@ の後のドットの連続": "a@" + "a.".repeat(N / 2) + "1",
    base64風: "QUJD".repeat(N / 4),
    数字の後の長い空白: "1" + " ".repeat(N),
    日付の形の繰り返し: "1/1/1 ".repeat(N / 6),
    // 以前の生年月日のルール（\s*日?\s*）では、ここで約24秒かかっていた
    "年月日の後の長い空白（生が続かない）": "1年1月1" + " ".repeat(N) + "x",
    "日付の後の長い空白": "1/1/1" + " ".repeat(N),
  };
  for (const [name, text] of Object.entries(cases)) {
    it(name, () => {
      const t = performance.now();
      detect(text);
      findNameReadings(text);
      findNamesByLayout(text);
      const ms = performance.now() - t;
      assert.ok(ms < 1000, `${Math.round(ms)}ms`);
    });
  }
  it("メールアドレスは引き続き検出する（ローカル部は64文字まで）", () => {
    assert.deepEqual(found("連絡先：taro.yamada+tag@mail.example.co.jp。").map((x) => x.text), ["taro.yamada+tag@mail.example.co.jp"]);
    assert.deepEqual(typesOf(`${"x".repeat(65)}@example.com`), []);
  });
});

describe("機密表示のレベル", () => {
  const level = (text: string) => detect(text).findings.find((f) => f.type === "confidential")?.level;
  it("「社外秘」「取扱注意」などの表示があれば「中」", () => {
    assert.equal(level("本書は社外秘です"), "medium");
    assert.equal(level("※取扱注意"), "medium");
    assert.equal(level("CONFIDENTIAL"), "medium");
    assert.equal(level("第3条（秘密保持）… 本書は部外秘とする"), "medium");
  });
  it("「秘密保持」「機密情報」だけ（契約書のひな形など）は「低」", () => {
    assert.equal(level("秘密保持契約書（ひな形）"), "low");
    assert.equal(level("受領者は機密情報を第三者に開示しない"), "low");
  });
});

describe("総合レベル", () => {
  it("連絡先が5件以上あると名簿とみなして「高」", () => {
    const text = Array.from({ length: 5 }, (_, i) => `user${i}@example.com`).join("\n");
    const { findings } = detect(text);
    assert.equal(findings[0].level, "high");
    assert.equal(ruleLevel(findings), "high");
  });
  it("3種類以上で住所か生年月日を含むと「高」", () => {
    const { findings } = detect("東京都千代田区架空町1-2-3\nTEL 03-1234-5678\nmail a@example.com");
    assert.equal(ruleLevel(findings), "high");
    assert.equal(ruleLevel(detect("TEL 03-1234-5678").findings), "medium");
  });
});

describe("氏名の伏せ方", () => {
  it("先頭の1文字だけ残し、空白の有無にかかわらず伏せる", () => {
    assert.equal(maskNames("担当 高橋 美咲 / 高橋美咲", ["高橋 美咲"]), "担当 高＊ ＊＊ / 高＊＊＊");
  });
  it("姓だけ・名だけの記述も伏せる", () => {
    assert.equal(maskNames("高橋さんと美咲さん", ["高橋 美咲"]), "高＊さんと美＊さん");
  });
  it("改行をまたいだ氏名も伏せる（OCR で行が分かれる場合）", () => {
    assert.equal(maskNames("山田\n太郎", ["山田太郎"]), "山＊\n＊＊");
  });
  it("重なり合う一致は1つの範囲にまとめる", () => {
    const text = "田佐藤花子";
    assert.deepEqual(findNameRanges(text, ["田佐", "佐藤 花子"]), [[0, 5]]);
    assert.doesNotMatch(maskNames(text, ["田佐", "佐藤 花子"]), /[佐藤花子]/);
  });
  it("保存した範囲が重なっていても、伏せ漏れや文字の重複を起こさない", () => {
    assert.equal(maskNameRanges("あいうえおかき", [[1, 4], [2, 6]]), "あい＊＊＊＊き");
    assert.equal(maskNameRanges("あいう", [[0, 9]]), "あいう", "本文より長い範囲は無視する");
  });
  it("長い名前（上限の30文字を超える）も最後まで伏せる", () => {
    const long = "ア".repeat(10) + "イ".repeat(40);
    const masked = maskNames(`名前 ${long} 様`, [long]);
    assert.equal(masked, `名前 ア${"＊".repeat(long.length - 1)} 様`);
  });
  it("名前が多くても全員を伏せる", () => {
    const names = Array.from({ length: 500 }, (_, i) => `試験${String.fromCharCode(0x4e00 + i)}${String.fromCharCode(0x4f00 + i)}`);
    const masked = maskNames(names.join("、"), names);
    for (const n of names) assert.ok(!masked.includes(n));
  });
});

describe("書式から拾う氏名・読み仮名", () => {
  it("名簿の氏名列と、見出しの直後の名前", () => {
    const csv = "社員番号,氏名,部署\n1,山田 太郎,営業部\n2,株式会社テスト,総務\n";
    assert.deepEqual(findNamesByLayout(csv), ["山田 太郎"]);
    assert.deepEqual(findNamesByLayout("お名前：高橋 美咲"), ["高橋 美咲"]);
  });
  it("フリガナ列と、見出しの直後の読み仮名（カナダなどは拾わない）", () => {
    assert.deepEqual(findNameReadings("氏名\tフリガナ\n山田 太郎\tヤマダ タロウ\n"), ["ヤマダ タロウ"]);
    assert.deepEqual(findNameReadings("ふりがな：やまだ たろう"), ["やまだ たろう"]);
    assert.deepEqual(findNameReadings("カナダ 出張"), []);
  });
});

describe("redact", () => {
  it("番号と氏名を伏せ、元の値が本文にもサンプルにも残らない", () => {
    const text = `氏名 山田 太郎\n個人番号 ${MYNUMBER}\nTEL 090-1234-5678\n〒２２０－０００１`;
    const r = redact(text, detect(text).spans, ["山田 太郎"]);
    for (const secret of ["山田", "太郎", MYNUMBER, "090-1234", "２２０－０００１"]) {
      assert.ok(!r.text.includes(secret), secret);
      for (const list of r.samples.values()) for (const s of list) assert.ok(!s.includes(secret), secret);
    }
    // ハイライト用の位置は、伏せたあとの本文を指す
    for (const p of r.placed) assert.ok(r.text.slice(p.start, p.end).includes("*"));
  });
});

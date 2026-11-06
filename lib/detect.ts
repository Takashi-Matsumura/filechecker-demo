/**
 * ルールベースの一次検出。
 * LLM に回す前に、確実に判定できるもの（チェックデジット・Luhn など）をここで拾う。
 */

export type Level = "high" | "medium" | "low" | "none";

export type FindingType =
  | "mynumber"
  | "credit_card"
  | "bank_account"
  | "id_document"
  | "phone"
  | "email"
  | "address"
  | "postal_code"
  | "birthdate"
  | "person_name"
  | "confidential";

export interface Finding {
  type: FindingType;
  label: string;
  level: Level;
  count: number;
  /** マスク済みの前後文脈（最大3件） */
  samples: string[];
}

export const FINDING_LABELS: Record<FindingType, string> = {
  mynumber: "マイナンバー",
  credit_card: "クレジットカード番号",
  bank_account: "銀行口座",
  id_document: "身分証明書",
  phone: "電話番号",
  email: "メールアドレス",
  address: "住所",
  postal_code: "郵便番号",
  birthdate: "生年月日",
  person_name: "氏名（AI推定）",
  confidential: "機密表示",
};

const PREFS =
  "北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県";

// ---------------------------------------------------------------- 検証ロジック

export function isValidMyNumber(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const p = d[11 - n];
    const q = n <= 6 ? n + 1 : n - 5;
    sum += p * q;
  }
  const r = sum % 11;
  const check = r <= 1 ? 0 : 11 - r;
  return check === d[11];
}

export function isLuhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let v = digits.charCodeAt(i) - 48;
    if (dbl) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------- マスク

/** 数字（半角・全角）を、末尾 n 桁を残して伏せる。全角の数字も伏せないと、全角で書かれた番号がそのまま残る */
function maskDigitsKeepLast(s: string, n: number): string {
  const total = (s.match(/[0-9０-９]/g) ?? []).length;
  let seen = 0;
  return s.replace(/[0-9０-９]/g, (c) => (++seen <= total - n ? "*" : c));
}

function maskEmail(s: string): string {
  const [local, domain] = s.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskAddress(s: string): string {
  const m = s.match(new RegExp(`^(${PREFS})(.{1,6}?[市区町村郡])`));
  return m ? `${m[1]}${m[2]}****` : "****";
}

// ---------------------------------------------------------------- 電話番号

/*
 * 電話番号。国内の形（03-1234-5678 / 09012345678）と、国際の形（+81-80-1234-5678。先頭の 0 を取るのが正式）。
 * 名簿や手入力では全角で書かれることがあるので、数字は全角（０-９）、区切りは全角のハイフン（－）や
 * 長音記号（ー。ハイフンの代わりに入力されがち）も受け付ける。前後が数字や区切りに続く場合は拾わない。
 */
const PD = "[0-9０-９]"; // 数字
const PH = "[-－‐−ー]"; // 区切り（ハイフン類）
const PS = "[\\s　\\-－‐−ー]"; // 国際の形の区切り（空白も可）
const NOT_BEFORE = "(?<![0-9０-９\\-－‐−ー])";
const NOT_AFTER = "(?![0-9０-９\\-－‐−ー])";
const PLUS81 = "[+＋][8８][1１]";
const PHONE_RE = new RegExp(
  [
    `${NOT_BEFORE}(?:${PLUS81}${PS}?)?[0０]${PD}{1,4}${PH}${PD}{1,4}${PH}${PD}{3,4}${NOT_AFTER}`,
    `(?<![0-9０-９+＋])${PLUS81}${PS}?[1-9１-９]${PD}{0,3}${PS}${PD}{1,4}${PS}${PD}{3,4}${NOT_AFTER}`,
    `(?<![0-9０-９])[0０][7-9７-９][0０]${PD}{8}(?![0-9０-９])`,
  ].join("|"),
  "g",
);

// ---------------------------------------------------------------- ルール定義

interface Rule {
  type: FindingType;
  level: Level;
  re: RegExp;
  /** 一致を採用するか（チェックデジットなど） */
  accept?: (m: RegExpExecArray, text: string) => boolean;
  mask: (s: string) => string;
  /** 一致した文字列からレベルを決める（指定がなければ level のまま） */
  levelOf?: (matches: string[]) => Level;
}

/** 文書そのものに付ける機密の表示。これがあれば、その文書は機密として扱われている */
const CONFIDENTIAL_MARK = /社外秘|部外秘|関係者外秘|極秘|取扱注意|confidential/i;

/** 番号の数字（半角・全角）と区切り（空白・ハイフン類・長音記号。全角を含む） */
const ND = "[0-9０-９]";
const NS = "[\\s　\\-－‐−ー]";
/** 番号から数字だけを取り出す（全角の数字は半角にそろえる。チェックデジットなどの検査用） */
const digitsOf = (s: string) => s.normalize("NFKC").replace(/\D/g, "");
/** 日付の区切り（年 / . - と、その全角） */
const DATE_SEP = "[年/.\\-／．－‐−]";

const RULES: Rule[] = [
  {
    type: "mynumber",
    level: "high",
    // 名簿や手入力では全角で書かれることがあるので、全角の数字・区切りも受け付ける（電話番号と同じ）
    re: new RegExp(`(?<!${ND}${NS}?)${ND}{4}${NS}?${ND}{4}${NS}?${ND}{4}(?!${NS}?${ND})`, "g"),
    accept: (m) => isValidMyNumber(digitsOf(m[0])),
    mask: (s) => maskDigitsKeepLast(s, 0),
  },
  {
    type: "credit_card",
    level: "high",
    re: new RegExp(`(?<!${ND}${NS}?)[3-6３-６](?:${ND}${NS}?){12,17}${ND}(?!${NS}?${ND})`, "g"),
    accept: (m) => {
      const d = digitsOf(m[0]);
      return d.length >= 14 && d.length <= 16 && isLuhn(d);
    },
    mask: (s) => maskDigitsKeepLast(s, 4),
  },
  {
    type: "bank_account",
    level: "high",
    re: new RegExp(`(?:普通|当座|口座番号?)[\\s　:：,，]*${ND}{7}(?!${ND})`, "g"),
    mask: (s) => maskDigitsKeepLast(s, 0),
  },
  {
    type: "id_document",
    level: "high",
    re: /運転免許証|免許証番号|パスポート|旅券番号|在留カード|健康保険証|保険者番号/g,
    mask: (s) => s,
  },
  {
    type: "email",
    level: "medium",
    // 線形時間で終わる形にする。長さの上限がないと、@ のない英数字の連続（base64・ログなど）で
    // 開始位置ごとに末尾まで読み直し、20万文字で数十秒かかる（その間サーバ全体が止まる）。
    // ローカル部は英数字の並びの先頭からだけ始め（後読み）、各部分の長さは RFC の上限で抑える
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z])/g,
    mask: maskEmail,
  },
  {
    type: "phone",
    level: "medium",
    re: PHONE_RE,
    mask: (s) => maskDigitsKeepLast(s, 4),
  },
  {
    type: "address",
    level: "medium",
    re: new RegExp(`(?:${PREFS})[^\\s,、。]{1,6}?[市区町村郡][^\\s,、。]{0,20}`, "g"),
    mask: maskAddress,
  },
  {
    type: "postal_code",
    level: "low",
    // 全角の数字・ハイフン類（〒２２０－０００１）も受け付ける
    re: new RegExp(`〒\\s?${ND}{3}${PH}?${ND}{4}(?!${ND})`, "g"),
    mask: (s) => maskDigitsKeepLast(s, 0),
  },
  {
    type: "birthdate",
    level: "medium",
    // 全角の数字・区切り（１９８３年１２月３日、１９８３／１２／０３）も受け付け、伏せるときも全角の数字を伏せる
    re: new RegExp(
      `生年月日[\\s:：]*[^\\n]{0,20}?${ND}{1,4}\\s*${DATE_SEP}\\s*${ND}{1,2}\\s*${DATE_SEP.replace("年", "月")}\\s*${ND}{1,2}`,
      "g",
    ),
    mask: (s) => s.replace(/[0-9０-９]/g, "*"),
  },
  {
    type: "confidential",
    level: "medium",
    re: /社外秘|部外秘|関係者外秘|極秘|機密情報|秘密保持|取扱注意|confidential/gi,
    mask: (s) => s,
    // 「秘密保持」「機密情報」は、契約書のひな形や規程などで話題として出てくることが多く、
    // それだけでは文書が機密とは限らない。「社外秘」などの表示がなければ「低」にする
    levelOf: (matches) => (matches.some((m) => CONFIDENTIAL_MARK.test(m)) ? "medium" : "low"),
  },
];

// ---------------------------------------------------------------- 検出本体

export interface Span {
  type: FindingType;
  start: number;
  end: number;
  masked: string;
}

export interface DetectResult {
  /** samples は空。マスク後に redact() で埋める */
  findings: Finding[];
  spans: Span[];
}

export function detect(text: string): DetectResult {
  const findings: Finding[] = [];
  const spans: Span[] = [];
  const overlaps = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let count = 0;
    const matched: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      // 先に採用された上位ルール（カード番号など）と重なる一致は数えない
      if (overlaps(start, end)) continue;
      if (rule.accept && !rule.accept(m, text)) continue;
      count++;
      matched.push(m[0]);
      spans.push({ type: rule.type, start, end, masked: rule.mask(m[0]) });
    }
    if (count > 0) {
      const level = rule.levelOf ? rule.levelOf(matched) : rule.level;
      findings.push({ type: rule.type, label: FINDING_LABELS[rule.type], level, count, samples: [] });
    }
  }

  // 連絡先が大量にある = 名簿の可能性が高いので一段上げる
  for (const f of findings) {
    if ((f.type === "phone" || f.type === "email" || f.type === "address") && f.count >= 5) f.level = "high";
  }
  return { findings, spans };
}

// ---------------------------------------------------------------- マスク

/**
 * 氏名のマスク対象（空白を除いた形）。
 * 「高橋 美咲」→ 高橋美咲 / 高橋 / 美咲、「高橋美咲」→ 高橋美咲 / 高橋（4文字以上は先頭2文字を姓とみなす）
 */
function nameVariants(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const parts = raw.trim().split(/[\s　]+/).filter(Boolean);
    const full = parts.join("");
    // 2文字未満は伏せすぎになるので対象外。長すぎるものも飛ばさずに、区切って伏せる
    if (full.length < 2) continue;
    addChunked(out, full);
    if (parts.length > 1) {
      for (const p of parts) if (p.length >= 2) addChunked(out, p);
    } else if (full.length >= 4 && !KANA_ONLY.test(full)) {
      // 推定の姓（AI が要約などで姓だけ書くことがあるため）。
      // カナだけの読み仮名は先頭2文字が他の語と重なりやすい（「ヤマ」→「ヤマト」）ので対象外
      out.add(full.slice(0, 2));
    }
  }
  // 長いものから置換しないと部分一致が先に潰れる
  return [...out].sort((a, b) => b.length - a.length);
}

const KANA_ONLY = /^[ぁ-ゖァ-ヶｦ-ﾟー・･]+$/;
/**
 * 照合に使う1件の長さの上限（空白を除く）。照合の手間はこの長さに比例するので抑える。
 * これより長い名前は飛ばさず、1文字ずつ重ねて区切った断片をすべて照合に使う。
 * 断片どうしは重なるので、一致した範囲は1つにまとまり、名前全体が伏せられる。
 */
const MAX_NAME_LENGTH = 30;

function addChunked(out: Set<string>, v: string) {
  if (v.length <= MAX_NAME_LENGTH) {
    out.add(v);
    return;
  }
  for (let start = 0; ; start += MAX_NAME_LENGTH - 1) {
    const end = Math.min(start + MAX_NAME_LENGTH, v.length);
    out.add(v.slice(end - MAX_NAME_LENGTH, end));
    if (end === v.length) break;
  }
}

// ---------------------------------------------------------------- 書式から拾う氏名・読み仮名

// 1語の長さに上限は設けない（長い読み仮名も飛ばさずに伏せる。照合は区切って行うので遅くならない）
const KANA_WORD = "(?:[ァ-ヶｦ-ﾟー・･]+|[ぁ-ゖー]+)";
const READING_LABEL = "(?:フリガナ|ふりがな|ﾌﾘｶﾞﾅ|よみがな|ヨミガナ|読み仮名|カナ氏名|氏名カナ|氏名[（(]カナ[）)]|カナ)";
// 見出しの前が文字でなく（「カナダ」を拾わない）、見出しと値の間に空白かコロンがあること
const SEP = "(?:[ 　]*[:：][ 　]*|[ 　]+)";
/** 「フリガナ ヤマダ タロウ」「ふりがな：やまだ たろう」 */
const READING_INLINE = new RegExp(`(?<![ぁ-ゖァ-ヶｦ-ﾟー])${READING_LABEL}${SEP}(${KANA_WORD}(?:[ 　]${KANA_WORD})?)`, "g");
const READING_HEADER = new RegExp(`^${READING_LABEL}$`);
const KANA_CELL = new RegExp(`^${KANA_WORD}(?:[ 　]${KANA_WORD})?$`);

const NAME_LABEL = "(?:氏名|お名前|名前|姓名|フルネーム)";
/** 「氏名 山田 太郎」「お名前：高橋 美咲」。誤って拾わないよう、値は漢字だけに限る */
const NAME_INLINE = new RegExp(`(?<![\\p{L}])${NAME_LABEL}${SEP}(\\p{Script=Han}{1,5}(?:[ 　]\\p{Script=Han}{1,5})?)(?![\\p{Script=Han}])`, "gu");
/** 名簿の氏名の列。完全一致の見出しだけを対象にする */
const NAME_HEADER =
  /^(?:氏名|氏名（漢字）|お名前|名前|姓名|フルネーム|社員名|従業員名|職員名|顧客名|会員名|担当者|担当者名|受講者名|参加者名|姓|名|名字|苗字|name|full ?name|first ?name|last ?name)$/i;
/** 「顧客名」などの列には会社や部署も入るので、それらしい値は氏名として扱わない */
const NOT_PERSON = /株式会社|有限会社|合同会社|㈱|（株）|\(株\)|法人|協会|組合|事務所|センター|部$|課$|店$|支社|本社|営業所/;
const NAME_CELL = new RegExp(
  "^(?:[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々]{1,8}(?:[ 　][\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々]{1,8})?" +
    "|[A-Za-z][A-Za-z.'-]{1,20}(?: [A-Za-z][A-Za-z.'-]{1,20}){0,2})$",
  "u",
);

const enough = (v: string) => v.replace(/[\s　]/g, "").length >= 2;
const unquote = (c: string) => c.trim().replace(/^"|"$/g, "");

/**
 * 表（タブ区切り / カンマ区切り）で、見出しが headerRe に合う列の値を集める。
 * 見出し行から下を1回だけ読み、読んだ行は飛ばす（同じ行を読み直さない）。
 */
function columnValues(lines: string[], headerRe: RegExp, cellRe: RegExp, out: Set<string>, reject?: RegExp) {
  for (let i = 0; i < lines.length; i++) {
    for (const sep of ["\t", ","]) {
      const header = lines[i].split(sep).map(unquote);
      if (header.length < 2) continue;
      const cols = header.flatMap((c, k) => (headerRe.test(c) ? [k] : []));
      if (cols.length === 0) continue;
      let j = i + 1;
      for (; j < lines.length && lines[j].trim(); j++) {
        const cells = lines[j].split(sep);
        for (const k of cols) {
          const cell = unquote(cells[k] ?? "");
          if (cellRe.test(cell) && enough(cell) && !reject?.test(cell)) out.add(cell);
        }
      }
      i = j - 1;
      break;
    }
  }
}

/** 表の行（タブ・カンマ区切り）以外の行で、見出しの直後の値を集める */
function inlineValues(lines: string[], re: RegExp, out: Set<string>) {
  for (const line of lines) {
    if (/[\t,]/.test(line)) continue;
    for (const m of line.matchAll(re)) if (enough(m[1])) out.add(m[1].trim());
  }
}

/**
 * 本文から氏名の読み仮名を拾う（AI の拾い漏れに備えたルール。件数の上限なし）。
 * - 見出しの直後に書かれたカナ（申込書・提出書の OCR など）
 * - 表の「フリガナ」列のカナ（Excel・CSV の名簿）
 */
export function findNameReadings(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out = new Set<string>();
  inlineValues(lines, READING_INLINE, out);
  columnValues(lines, READING_HEADER, KANA_CELL, out);
  return [...out];
}

/**
 * 本文から氏名を書式で拾う。AI が返す氏名は20件までなので、大きな名簿でも全員を伏せるために使う。
 * - 表の「氏名」「社員名」「姓」「名」などの列の値
 * - 「氏名 山田 太郎」のような見出しの直後の漢字の名前
 */
export function findNamesByLayout(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out = new Set<string>();
  inlineValues(lines, NAME_INLINE, out);
  columnValues(lines, NAME_HEADER, NAME_CELL, out, NOT_PERSON);
  return [...out];
}

/** 1つの氏名の一致を伏せる（先頭の1文字と空白は残す） */
function maskMatch(m: string): string {
  let first = true;
  return m.replace(/[^\s　]/g, (c) => {
    if (first) {
      first = false;
      return c;
    }
    return "＊";
  });
}

/** 氏名の範囲 [start, end)。同じ長さで伏せるので、伏せる前後で位置は変わらない */
export type NameRange = [number, number];

type TrieNode = { next: Map<string, TrieNode>; end: boolean };
const isSpace = (c: string) => /[\s　]/.test(c);

/**
 * テキスト中で氏名が出てくる範囲を返す。
 * 表記ゆれ（「高橋美咲」と「高橋 美咲」）に対応するため、文字間の空白を無視して照合する。
 * すべての名前を1つの木（トライ）にまとめ、本文を1回だけ走査するので、
 * 名前が何千件あっても時間は本文の長さにほぼ比例する（件数の上限は設けない）。
 * 照合に使う1件は MAX_NAME_LENGTH 文字までなので、最悪でも「本文の長さ × その文字数」で終わる。
 * 改行やタブをまたぐ一致も拾う（OCR で「山田\n太郎」のように行が分かれることがあるため）。
 * 重なり合う一致はすべて拾って1つの範囲にまとめる（例: 「田佐」と「佐藤花子」→「田＊＊＊＊」）。
 * 氏名の文字列そのものを保存せずに、あとで同じ箇所を伏せ直すために使う。
 */
export function findNameRanges(text: string, names: string[]): NameRange[] {
  const variants = nameVariants(names);
  if (variants.length === 0) return [];
  const root: TrieNode = { next: new Map(), end: false };
  for (const v of variants) {
    let node = root;
    for (let k = 0; k < v.length; k++) {
      let child = node.next.get(v[k]);
      if (!child) node.next.set(v[k], (child = { next: new Map(), end: false }));
      node = child;
    }
    node.end = true;
  }
  // 空白を除いた文字の並びと、それぞれの元の位置
  const chars: string[] = [];
  const pos: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i])) continue;
    chars.push(text[i]);
    pos.push(i);
  }
  const ranges: NameRange[] = [];
  // 照合に使う1件は MAX_NAME_LENGTH 文字までなので、1つの開始位置から辿るのは最大でその文字数
  for (let s = 0; s < chars.length; s++) {
    let node: TrieNode | undefined = root;
    let longest = -1;
    for (let e = s; e < chars.length; e++) {
      node = node.next.get(chars[e]);
      if (!node) break;
      if (node.end) longest = e;
    }
    // 同じ開始位置の短い一致は最長の一致に含まれ、どうせ1つにまとめるので、最長だけを残す
    if (longest >= 0) ranges.push([pos[s], pos[longest] + 1]);
  }
  const merged: NameRange[] = [];
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** findNameRanges で得た範囲を伏せる */
export function maskNameRanges(text: string, ranges: NameRange[]): string {
  let out = "";
  let pos = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (end > text.length) continue;
    if (start < pos) {
      // 前の範囲と重なる分は、まだ伏せていない残りをすべて伏せる（飛ばすと伏せ漏れになる）
      if (end > pos) out += text.slice(pos, end).replace(/[^\s　]/g, "＊");
    } else {
      out += text.slice(pos, start) + maskMatch(text.slice(start, end));
    }
    pos = Math.max(pos, end);
  }
  return out + text.slice(pos);
}

export function maskNames(text: string, names: string[]): string {
  return maskNameRanges(text, findNameRanges(text, names));
}

export interface Redacted {
  text: string;
  /** 種類ごとのマスク済み文脈（最大3件） */
  samples: Map<FindingType, string[]>;
  /** マスク後のテキスト上での検出範囲（プレビューのハイライト用） */
  placed: { type: FindingType; start: number; end: number }[];
}

/**
 * 検出範囲と氏名をマスクしたテキストと、そこから切り出した文脈サンプルを返す。
 * サンプルは必ずマスク後のテキストから作る（隣の項目の生データが文脈に混ざらないように）。
 */
export function redact(text: string, spans: Span[], names: string[] = []): Redacted {
  let out = "";
  let pos = 0;
  const placed: { type: FindingType; start: number; end: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos) continue;
    out += text.slice(pos, s.start);
    placed.push({ type: s.type, start: out.length, end: out.length + s.masked.length });
    out += s.masked;
    pos = s.end;
  }
  out += text.slice(pos);
  // 氏名マスクは同じ長さで置換するので placed の位置はずれない
  out = maskNames(out, names);

  const samples = new Map<FindingType, string[]>();
  for (const p of placed) {
    const list = samples.get(p.type) ?? [];
    if (list.length >= 3) continue;
    const before = out.slice(Math.max(0, p.start - 15), p.start).replace(/\s+/g, " ");
    const after = out.slice(p.end, p.end + 15).replace(/\s+/g, " ");
    list.push(`…${before}【${out.slice(p.start, p.end)}】${after}…`);
    samples.set(p.type, list);
  }
  return { text: out, samples, placed };
}

const RANK: Record<Level, number> = { none: 0, low: 1, medium: 2, high: 3 };
export const maxLevel = (...ls: Level[]): Level => ls.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none");

/** ルール検出結果から総合レベルを出す */
export function ruleLevel(findings: Finding[]): Level {
  let lv = maxLevel(...findings.map((f) => f.level));
  const types = new Set(findings.filter((f) => f.type !== "confidential").map((f) => f.type));
  // 氏名・連絡先に加えて住所や生年月日まで揃うと個人を特定できるので「高」
  if (types.size >= 3 && (types.has("address") || types.has("birthdate"))) lv = maxLevel(lv, "high");
  return lv;
}

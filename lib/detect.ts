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

function maskDigitsKeepLast(s: string, n: number): string {
  const total = (s.match(/\d/g) ?? []).length;
  let seen = 0;
  return s.replace(/\d/g, (c) => (++seen <= total - n ? "*" : c));
}

function maskEmail(s: string): string {
  const [local, domain] = s.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskAddress(s: string): string {
  const m = s.match(new RegExp(`^(${PREFS})(.{1,6}?[市区町村郡])`));
  return m ? `${m[1]}${m[2]}****` : "****";
}

// ---------------------------------------------------------------- ルール定義

interface Rule {
  type: FindingType;
  level: Level;
  re: RegExp;
  /** 一致を採用するか（チェックデジットなど） */
  accept?: (m: RegExpExecArray, text: string) => boolean;
  mask: (s: string) => string;
}

const RULES: Rule[] = [
  {
    type: "mynumber",
    level: "high",
    re: /(?<!\d[\s-]?)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?![\s-]?\d)/g,
    accept: (m) => isValidMyNumber(m[0].replace(/\D/g, "")),
    mask: (s) => maskDigitsKeepLast(s, 0),
  },
  {
    type: "credit_card",
    level: "high",
    re: /(?<!\d[\s-]?)[3-6](?:\d[\s-]?){12,17}\d(?![\s-]?\d)/g,
    accept: (m) => {
      const d = m[0].replace(/\D/g, "");
      return d.length >= 14 && d.length <= 16 && isLuhn(d);
    },
    mask: (s) => maskDigitsKeepLast(s, 4),
  },
  {
    type: "bank_account",
    level: "high",
    re: /(?:普通|当座|口座番号?)[\s:：,]*\d{7}(?!\d)/g,
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
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    mask: maskEmail,
  },
  {
    type: "phone",
    level: "medium",
    re: /(?<![\d-])(?:\+81[\s-]?)?0\d{1,4}-\d{1,4}-\d{3,4}(?![\d-])|(?<!\d)0[789]0\d{8}(?!\d)/g,
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
    re: /〒\s?\d{3}-?\d{4}/g,
    mask: (s) => maskDigitsKeepLast(s, 0),
  },
  {
    type: "birthdate",
    level: "medium",
    re: /生年月日[\s:：]*[^\n]{0,20}?\d{1,4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}/g,
    mask: (s) => s.replace(/\d/g, "*"),
  },
  {
    type: "confidential",
    level: "medium",
    re: /社外秘|部外秘|関係者外秘|極秘|機密情報|秘密保持|取扱注意|confidential/gi,
    mask: (s) => s,
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
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      // 先に採用された上位ルール（カード番号など）と重なる一致は数えない
      if (overlaps(start, end)) continue;
      if (rule.accept && !rule.accept(m, text)) continue;
      count++;
      spans.push({ type: rule.type, start, end, masked: rule.mask(m[0]) });
    }
    if (count > 0) {
      findings.push({ type: rule.type, label: FINDING_LABELS[rule.type], level: rule.level, count, samples: [] });
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
    if (full.length < 2) continue;
    out.add(full);
    if (parts.length > 1) {
      for (const p of parts) if (p.length >= 2) out.add(p);
    } else if (full.length >= 4) {
      out.add(full.slice(0, 2)); // 推定の姓（AI が要約などで姓だけ書くことがあるため）
    }
  }
  // 長いものから置換しないと部分一致が先に潰れる
  return [...out].sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 氏名を伏せる。表記ゆれ（「高橋美咲」と「高橋 美咲」）に対応するため文字間の空白を許して照合し、
 * 先頭1文字と空白を残して他を＊にする。長さが変わらないので、検出位置はずれない。
 */
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

/**
 * テキスト中で氏名が出てくる範囲を返す。maskNames と同じ順・同じ規則で探す。
 * 氏名の文字列そのものを保存せずに、あとで同じ箇所を伏せ直すために使う。
 */
export function findNameRanges(text: string, names: string[]): NameRange[] {
  let out = text;
  const ranges: NameRange[] = [];
  for (const v of nameVariants(names)) {
    const re = new RegExp([...v].map(escapeRe).join("[\\s\\u3000]*"), "g");
    out = out.replace(re, (m: string, offset: number) => {
      ranges.push([offset, offset + m.length]);
      return maskMatch(m);
    });
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** findNameRanges で得た範囲を伏せる */
export function maskNameRanges(text: string, ranges: NameRange[]): string {
  let out = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos || end > text.length) continue;
    out += text.slice(pos, start) + maskMatch(text.slice(start, end));
    pos = end;
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

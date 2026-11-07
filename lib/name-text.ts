/**
 * AI に氏名を確認してもらう本文を、むだなく短くする。
 * 予算表のように数字や同じ科目名がくり返される本文は、ほとんどの行に新しい語が無く、氏名が入りようがない。
 * それまでに AI に見せていない語（漢字・かなの並び、英単語）を含む行だけを残せば、同じ回数の呼び出しで本文のずっと先まで確認できる。
 * 残さなかった行の語は、どれも残した行（か判定が見た先頭）に出てきたものなので、そこに氏名があれば AI は既に見ている。
 * 残した行も、語と語のあいだの長い数字・記号の並び（金額や Excel の数式）は「…」に縮める。1行に科目名1つと
 * 千字を超える数字が並ぶ表では、行を省くだけでは縮まないため。
 */

import type { TextSection } from "./extract";

/**
 * 氏名になり得る語。漢字・ひらがな・カタカナ（半角を含む）の2文字以上の並びと、2文字以上の英単語（ローマ字の氏名。
 * 「TARO YAMADA」のような大文字だけの表記も含む。ただし Excel の数式の関数名（IF( など）とセル番地（AA2 など）は除く）
 */
const WORD = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ｦ-ﾟー々〆]{2,}|[A-Za-z][a-z]+|(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9(])/gu;

/** 語と語のあいだがこの文字数を超えたら「…」に縮める（電話番号やメールの区切り程度は残す） */
const GAP_MAX = 24;

/** 語と語のあいだの長い数字・記号の並びを「…」に縮める */
function compressLine(line: string): string {
  let out = "";
  let pos = 0;
  for (const m of line.matchAll(WORD)) {
    const gap = line.slice(pos, m.index);
    out += gap.length > GAP_MAX ? " … " : gap;
    out += m[0];
    pos = m.index + m[0].length;
  }
  const tail = line.slice(pos);
  return out + (tail.length > GAP_MAX ? " …" : tail);
}

/**
 * 行の中の語と、隣り合う2語の組。組も数えるのは、「田中 一郎」「山田 太郎」の後の「田中 太郎」のように、
 * 語はどれも既出でも組み合わせが新しい氏名を見落とさないため
 */
function tokensOf(line: string): string[] {
  const words = line.match(WORD) ?? [];
  const pairs = words.slice(1).map((w, i) => `${words[i]}\u0000${w}`);
  return [...words, ...pairs];
}

/** 本文に出てくる語（と隣り合う2語の組）の集合 */
export function wordsOf(text: string): Set<string> {
  const seen = new Set<string>();
  for (const line of text.split("\n")) for (const t of tokensOf(line)) seen.add(t);
  return seen;
}

/** 区切りの見出しの行（シート名・コメント）。新しい語が無くても残し、シートの位置を保つ */
const isHeading = (line: string) => line.startsWith("【シート: ") || line.startsWith("【コメント】");

export interface CondensedText {
  text: string;
  /** 残した行の、元の本文での開始・終了位置と、短くした本文での開始位置（どれも昇順） */
  map: { orig: number; origEnd: number; cond: number }[];
  /** 元の本文の長さ */
  origLength: number;
}

/**
 * 新しい語を含む行（と区切りの見出し）だけを残す。seen は既に AI に見せた語で、この関数の中で書き足す。
 * base は text が元の本文の何文字目から始まるか（位置の対応表を、元の本文の位置で持つため）
 */
export function condenseForNames(text: string, seen: Set<string> = new Set(), base = 0): CondensedText {
  const kept: string[] = [];
  const map: { orig: number; origEnd: number; cond: number }[] = [];
  let cond = 0;
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(pos, end);
    let fresh = false;
    for (const w of tokensOf(line)) {
      if (!seen.has(w)) {
        seen.add(w);
        fresh = true;
      }
    }
    if (fresh || isHeading(line)) {
      const short = compressLine(line);
      map.push({ orig: base + pos, origEnd: base + end, cond });
      kept.push(short);
      cond += short.length + 1;
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  return { text: kept.join("\n"), map, origLength: base + text.length };
}

/** 元の本文の位置を、短くした本文の位置に直す（その位置を含む行か、それより後で最初に残した行の先頭） */
export function toCondensedOffset(c: CondensedText, orig: number): number {
  let lo = 0;
  let hi = c.map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.map[mid].orig < orig) lo = mid + 1;
    else hi = mid;
  }
  return lo < c.map.length ? c.map[lo].cond : c.text.length;
}

/** 短くした本文の位置を、元の本文の位置に直す（行の中は縮めてあるので、その行の中のおおよその位置） */
export function toOriginalOffset(c: CondensedText, cond: number): number {
  if (cond >= c.text.length) return c.origLength;
  let lo = 0;
  let hi = c.map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.map[mid].cond <= cond) lo = mid + 1;
    else hi = mid;
  }
  const m = c.map[lo - 1];
  return m ? Math.min(m.orig + (cond - m.cond), m.origEnd) : 0;
}

export interface SectionSample {
  text: string;
  /** 見本に（一部でも）入った区切りの数 */
  covered: number;
  /** 区切り1つあたりに割り振った文字数（短い区切りは全文が入るので、これより短い） */
  perSection: number;
}

/**
 * 長い本文から、AI に渡す見本を作る。先頭 head 字はそのまま入れ、残りは各区切り（Excel のシート）の頭から、
 * budget 字を区切りの間で公平に割り振って切り出す（短い区切りは全文、余った分は長い区切りに回す）。
 * 先頭だけを見ると、シートが多い Excel では1シート目しか確認できないため。
 * 区切りが多すぎて1つあたり minPerSection 字に満たないときは、前から順に入るだけ入れる。
 */
export function sampleSections(text: string, sections: TextSection[], head: number, budget: number, minPerSection = 400): SectionSample {
  const sorted = [...sections].filter((s) => s.start < text.length).sort((a, b) => a.start - b.start);
  const regions: { label: string; start: number; end: number; cont: boolean }[] = [];
  sorted.forEach((s, i) => {
    const end = Math.min(sorted[i + 1]?.start ?? text.length, text.length);
    const start = Math.max(s.start, head);
    if (end > start) regions.push({ label: s.label, start, end, cont: s.start < head });
  });
  // 先頭 head 字の中に収まっている区切り（見本に全文が入る）
  const inHead = sorted.filter((_, i) => (sorted[i + 1]?.start ?? text.length) <= head).length;
  // 区切りの見出し（「（続き）」など）の分を差し引いてから割り振る
  const SEP = 30;
  const max = Math.max(0, Math.floor(budget / (minPerSection + SEP)));
  const picked = regions.slice(0, max);
  let rest = budget - picked.length * SEP;
  // 短い順に、残りを均等に割り振る（短い区切りは全文が入り、余りが長い区切りに回る）
  const alloc = new Map<number, number>();
  const byLen = picked.map((r, i) => ({ i, len: r.end - r.start })).sort((a, b) => a.len - b.len);
  let perSection = 0;
  byLen.forEach((r, k) => {
    const share = Math.floor(rest / (byLen.length - k));
    const n = Math.min(r.len, share);
    alloc.set(r.i, n);
    rest -= n;
    perSection = Math.max(perSection, n);
  });
  const parts = [text.slice(0, head)];
  picked.forEach((r, i) => {
    const body = text.slice(r.start, r.start + (alloc.get(i) ?? 0));
    // シートの頭から切り出したときは、本文の中の「【シート: 名前】」の行がそのまま入る
    parts.push(r.cont ? `【${r.label}（続き）】\n${body}` : body);
  });
  return { text: parts.join("\n"), covered: inHead + picked.length, perSection };
}

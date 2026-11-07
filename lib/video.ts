/**
 * 紹介動画の配信で使う、Range ヘッダの読み取り。
 * ブラウザの動画は、早送りや途中からの再生のときに「bytes=開始-終了」で一部だけを求めるので、その範囲を返す。
 */

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Range ヘッダ（単一の範囲だけに対応）を、ファイルの大きさ size の中の [start, end] に直す。
 * ヘッダが無い・読めない形なら null（全体を返す）。範囲がファイルの外なら "unsatisfiable"（416 を返す）
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const eq = header.indexOf("=");
  if (eq < 0 || header.slice(0, eq).trim().toLowerCase() !== "bytes") return null;
  const spec = header.slice(eq + 1).trim();
  // 複数の範囲（"0-1, 5-6"）には対応しない。全体を返す
  if (spec.includes(",")) return null;
  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const a = spec.slice(0, dash).trim();
  const b = spec.slice(dash + 1).trim();
  const isNum = (s: string) => s.length > 0 && s.length <= 16 && [...s].every((c) => c >= "0" && c <= "9");
  if (a === "") {
    // "bytes=-500" は末尾の 500 バイト
    if (!isNum(b)) return null;
    const n = Number(b);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  if (!isNum(a) || (b !== "" && !isNum(b))) return null;
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/**
 * 画像をデコードせずにヘッダだけ読んで幅・高さを返す（PNG / JPEG / GIF / BMP / WebP）。
 * 巨大な画素数の画像（ピクセル爆弾）をデコード前に弾くために使う。読めなければ null。
 */
export function probeImageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const has = (n: number) => b.length >= n;

  // PNG: 先頭チャンクが IHDR であることも確認する
  if (has(24) && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (dv.getUint32(12) !== 0x49484452) return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // GIF: 論理画面サイズより大きいフレームもあり得るので、各フレームの大きさも見て最大を採る
  if (has(13) && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    let width = dv.getUint16(6, true);
    let height = dv.getUint16(8, true);
    let i = 13;
    if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1)); // グローバルカラーテーブル
    while (i < b.length) {
      const block = b[i];
      if (block === 0x3b) break; // 終端
      if (block === 0x2c) {
        // イメージディスクリプタ: 位置 + 大きさ
        if (i + 10 > b.length) return null;
        width = Math.max(width, dv.getUint16(i + 1, true) + dv.getUint16(i + 5, true));
        height = Math.max(height, dv.getUint16(i + 3, true) + dv.getUint16(i + 7, true));
        const flags = b[i + 9];
        i += 10;
        if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1)); // ローカルカラーテーブル
        i += 1; // LZW 最小コードサイズ
      } else if (block === 0x21) {
        i += 2; // 拡張ブロック: 導入子 + ラベル
      } else {
        return null; // 想定外の構造は読めないものとして扱う（呼び出し側で処理しない）
      }
      // データサブブロックを読み飛ばす
      while (i < b.length && b[i] !== 0) i += b[i] + 1;
      i += 1;
    }
    return { width, height };
  }
  // BMP
  if (has(26) && b[0] === 0x42 && b[1] === 0x4d) {
    return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) };
  }
  // WebP (RIFF....WEBP)
  if (has(30) && dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") {
      return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const v = dv.getUint32(21, true);
      return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) };
    }
    return null;
  }
  // JPEG: SOFn マーカーを探す
  if (has(4) && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // SOF0〜SOF15（DHT=C4, JPG=C8, DAC=CC を除く）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      // SOS 以降は画像データ。SOF が見つからないまま SOS に達したら読めないものとして扱う
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}

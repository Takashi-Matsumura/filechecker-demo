import { unzipSync, strFromU8 } from "fflate";
import { config } from "./config";
import { probeImageSize } from "./image-size";
import { ocrImage } from "./llm";
import type { CallContext } from "./metrics";

/** 安全上の上限に引っかかったことを表す（ファイルは「内容未検査」として扱う） */
export class ExtractLimitError extends Error {}

/** Office 形式ごとに展開する XML（これ以外は展開しない） */
const WANTED_ENTRIES: Record<string, RegExp> = {
  docx: /^word\/(document|header\d*|footer\d*)\.xml$/,
  pptx: /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/,
  xlsx: /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
};

/**
 * ファイルからテキストを取り出す。
 * - Office (docx/xlsx/pptx): ZIP 内の XML から直接抜く
 * - PDF: テキスト層を抜き、無ければページを画像化してローカル LLM で OCR
 * - 画像: ローカル LLM で OCR
 */

export type Kind = "office" | "pdf" | "image" | "text" | "other";

const TEXT_EXT = new Set(["txt", "csv", "tsv", "md", "log", "json", "xml", "html", "htm"]);
const OFFICE_EXT = new Set(["docx", "xlsx", "pptx"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif"]);

export function kindOf(ext: string): Kind {
  if (OFFICE_EXT.has(ext) || ["doc", "xls", "ppt"].includes(ext)) return "office";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (TEXT_EXT.has(ext)) return "text";
  return "other";
}

export interface Extracted {
  text: string;
  method: "text" | "office" | "pdf-text" | "ocr" | "none";
  note?: string;
}

// ---------------------------------------------------------------- テキスト

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    // 社内の古い CSV は Shift_JIS が多い
    return new TextDecoder("shift_jis").decode(buf);
  }
}

// ---------------------------------------------------------------- Office

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** <w:p> / <a:p> を改行、<w:t> / <a:t> の中身を連結 */
function paragraphsText(xml: string, ns: "w" | "a"): string {
  return xml
    .split(new RegExp(`</${ns}:p>`))
    .map((p) => {
      const parts: string[] = [];
      const re = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>|<${ns}:tab/>`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p))) parts.push(m[1] === undefined ? "\t" : decodeXml(m[1]));
      return parts.join("");
    })
    .filter((l) => l.trim())
    .join("\n");
}

const byNumber = (a: string, b: string) =>
  Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

function extractOffice(buf: Buffer, ext: string): string {
  // ZIP 爆弾対策: 必要な XML だけを展開し、申告された展開後サイズの合計と件数に上限を設ける。
  // fflate は申告サイズ分しか出力しないので、申告値を偽られても展開量はこの上限を超えない。
  const wanted = WANTED_ENTRIES[ext];
  let total = 0;
  let count = 0;
  const zip = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (!wanted.test(f.name)) return false;
      // 0=無圧縮, 8=deflate 以外は扱わない
      if (f.compression !== 0 && f.compression !== 8) {
        throw new ExtractLimitError("未対応の圧縮形式のため内容は未検査");
      }
      // 無圧縮エントリは originalSize ではなく size 分が出力される。両者が食い違うものは不正とみなす
      if (f.compression === 0 && f.size !== f.originalSize) {
        throw new ExtractLimitError("ZIP の構造が不正なため内容は未検査");
      }
      // 実際に確保される量の大きい方で数える（エントリを重ねて同じデータを何度も指させる手口にも効く）
      total += Math.max(f.size, f.originalSize);
      count++;
      if (total > config.maxUnzippedBytes || count > config.maxZipEntries) {
        throw new ExtractLimitError("展開後のサイズが大きすぎるため内容は未検査（ZIP 爆弾の可能性）");
      }
      return true;
    },
  });
  const read = (name: string) => (zip[name] ? strFromU8(zip[name]) : "");
  const names = Object.keys(zip);

  if (ext === "docx") {
    const parts = ["word/document.xml", ...names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))];
    return parts.map((n) => paragraphsText(read(n), "w")).join("\n");
  }

  if (ext === "pptx") {
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
    const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).sort(byNumber);
    return [...slides, ...notes].map((n) => paragraphsText(read(n), "a")).join("\n");
  }

  // xlsx
  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  for (const si of sst.split("</si>")) {
    const ts = [...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1]));
    if (si.includes("<si")) shared.push(ts.join(""));
  }
  const sheets = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber);
  const lines: string[] = [];
  for (const s of sheets) {
    for (const row of read(s).split("</row>")) {
      const cells: string[] = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const t = attrs.match(/\bt="(\w+)"/)?.[1];
        const v = inner.match(/<v>([^<]*)<\/v>/)?.[1];
        let value: string | undefined;
        if (t === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
        else if (v !== undefined) value = decodeXml(v);
        if (value === undefined) continue;
        // セルの位置（C5 の「C」）どおりに並べる。空のセルを詰めると、行ごとに列がずれて
        // 「氏名」列などを正しく読めなくなるため
        const col = columnIndex(attrs.match(/\br="([A-Z]+)\d+"/)?.[1]);
        if (col !== null && col > cells.length && col < MAX_COLUMNS) while (cells.length < col) cells.push("");
        cells.push(value);
      }
      if (cells.some((x) => x.trim())) lines.push(cells.join("\t"));
    }
  }
  return lines.join("\n");
}

/** 列の記号（A, B, …, AA）を 0 始まりの番号にする */
function columnIndex(letters: string | undefined): number | null {
  if (!letters || letters.length > 3) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** 空のセルを埋める列の上限（極端に右の列にあるセルで、空の列を大量に作らないため） */
const MAX_COLUMNS = 200;

// ---------------------------------------------------------------- 画像の正規化

/** 長辺を抑えて JPEG に揃える（LLM に渡すトークン量と形式差を吸収） */
async function toJpeg(buf: Uint8Array, maxSide = 1600): Promise<Uint8Array> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  // ピクセル爆弾対策: デコード前にヘッダから画素数を確認する
  const dim = probeImageSize(buf);
  if (!dim) throw new ExtractLimitError("画像のサイズを読み取れないため内容は未検査");
  if (dim.width * dim.height > config.maxImagePixels) {
    throw new ExtractLimitError(`画素数が大きすぎるため内容は未検査（${dim.width}×${dim.height}）`);
  }
  const img = await loadImage(Buffer.from(buf));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.encode("jpeg", 85);
}

// ---------------------------------------------------------------- PDF

let pdfjsReady: Promise<typeof import("unpdf")> | null = null;
function unpdf() {
  pdfjsReady ??= import("unpdf").then((m) => {
    // 日本語の CID フォントを読むには pdfjs-dist 同梱の CMap が要る
    m.definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
    return m;
  });
  return pdfjsReady;
}

async function extractPdf(buf: Buffer, signal?: AbortSignal, allowOcr = true, ctx?: CallContext): Promise<Extracted> {
  const { getDocumentProxy, extractText, renderPageAsImage } = await unpdf();
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(doc, { mergePages: false });
  const joined = text.join("\n");
  // 1ページあたりの文字数が少なければスキャン PDF とみなす
  if (joined.replace(/\s/g, "").length >= 30 * totalPages) {
    return { text: joined, method: "pdf-text" };
  }
  if (!allowOcr) throw new ExtractLimitError("文字情報のない PDF のため OCR が必要です");
  const pages = Math.min(totalPages, config.maxOcrPages);
  const out: string[] = [];
  for (let i = 1; i <= pages; i++) {
    signal?.throwIfAborted();
    // 描画サイズに上限を設ける（ページサイズを巨大に申告した PDF 対策）
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    const scale = Math.min(1.5, Math.sqrt(config.maxRenderPixels / Math.max(1, vp.width * vp.height)));
    const png = await renderPageAsImage(doc, i, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale,
    });
    out.push(await ocrImage(await toJpeg(png), signal, ctx));
  }
  return {
    text: out.join("\n"),
    method: "ocr",
    note: totalPages > pages ? `全${totalPages}ページ中、先頭${pages}ページのみ OCR` : undefined,
  };
}

// ---------------------------------------------------------------- 入口

export interface ExtractOptions {
  /** false のとき OCR（AI による画像の読み取り）を行わない。時間がかかる処理を避けたい場面用 */
  allowOcr?: boolean;
  /** 性能分析の記録に残す、どの棚卸しのどのファイルの処理か */
  ctx?: CallContext;
}

export async function extract(buf: Buffer, ext: string, signal?: AbortSignal, opts: ExtractOptions = {}): Promise<Extracted> {
  try {
    return await extractInner(buf, ext, signal, opts.allowOcr ?? true, opts.ctx);
  } catch (e) {
    if (e instanceof ExtractLimitError) return { text: "", method: "none", note: e.message };
    throw e;
  }
}

async function extractInner(
  buf: Buffer,
  ext: string,
  signal: AbortSignal | undefined,
  allowOcr: boolean,
  ctx?: CallContext,
): Promise<Extracted> {
  const kind = kindOf(ext);
  let r: Extracted;
  switch (kind) {
    case "text":
      r = { text: decodeText(buf), method: "text" };
      break;
    case "office":
      if (!OFFICE_EXT.has(ext)) return { text: "", method: "none", note: `旧形式 .${ext} は未対応（メタ情報のみ）` };
      r = { text: extractOffice(buf, ext), method: "office" };
      break;
    case "pdf":
      r = await extractPdf(buf, signal, allowOcr, ctx);
      break;
    case "image":
      if (!allowOcr) return { text: "", method: "none", note: "画像のため OCR が必要です" };
      r = { text: await ocrImage(await toJpeg(buf), signal, ctx), method: "ocr" };
      break;
    default:
      return { text: "", method: "none", note: "未対応の形式（メタ情報のみ）" };
  }
  if (r.text.length > config.maxTextChars) {
    r.text = r.text.slice(0, config.maxTextChars);
    r.note = [r.note, `先頭 ${config.maxTextChars.toLocaleString()} 文字のみ検査`].filter(Boolean).join(" / ");
  }
  return r;
}

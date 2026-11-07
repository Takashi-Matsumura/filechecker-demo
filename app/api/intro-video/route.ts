import fs from "node:fs";
import { Readable } from "node:stream";
import { config } from "@/lib/config";
import { parseRange } from "@/lib/video";

/**
 * 紹介動画（docs/video/build.mjs で作った mp4）を配信する。早送りや途中からの再生のため、Range（一部だけの取得）に対応する。
 * 配信するのは設定（INTRO_VIDEO_PATH）で決めた 1 ファイルだけで、リクエストからパスは受け取らない。
 */
export async function GET(req: Request) {
  const file = config.introVideoPath;
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json({ error: "紹介動画がまだ作られていません" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const size = stat.size;
  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  // 視聴者が途中で閉じたら読み出しをやめる（toWeb のストリームを取り消すと、元のファイルの読み出しも閉じる）
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    // 作り直したら新しい動画が出るように、ブラウザには残させない
    "Cache-Control": "no-store",
    "Last-Modified": stat.mtime.toUTCString(),
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

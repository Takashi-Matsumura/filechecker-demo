import fs from "node:fs";
import { config } from "@/lib/config";

/**
 * 紹介動画のサムネイル（docs/video/build.mjs が動画と同じフォルダに書き出す .jpg）。トップ画面に表示する。
 * 配信するのは設定で決まる 1 ファイルだけで、リクエストからパスは受け取らない。
 */
export async function GET() {
  const data = await fs.promises.readFile(config.introThumbnailPath).catch(() => null);
  if (!data) return Response.json({ error: "サムネイルがありません" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}

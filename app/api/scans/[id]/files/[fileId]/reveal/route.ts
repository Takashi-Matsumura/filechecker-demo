import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { resolveFilePath } from "@/lib/scanner";

const run = promisify(execFile);

/**
 * Finder でファイルの場所を開く（選択状態にするだけで、移動・削除はしない）。
 * パスはクライアントから受け取らず、ファイル ID から DB 上の記録を引いて検証したものだけを使う。
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]/reveal">) {
  if (process.platform !== "darwin") {
    return Response.json({ error: "この機能は macOS でのみ使えます" }, { status: 501 });
  }
  const { id, fileId } = await ctx.params;
  const scanId = Number(id);
  const fid = Number(fileId);
  if (!Number.isInteger(scanId) || !Number.isInteger(fid)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const file = await resolveFilePath(scanId, fid);
  if (!file) {
    return Response.json({ error: "ファイルが見つかりません（移動・削除された可能性があります）" }, { status: 404 });
  }
  // シェルを介さず引数で渡す。"--" 以降はオプションとして解釈させない
  await run("/usr/bin/open", ["-R", "--", file]);
  return Response.json({ ok: true });
}

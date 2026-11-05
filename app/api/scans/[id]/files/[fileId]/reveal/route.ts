import { execFile } from "node:child_process";
import type { NextRequest } from "next/server";
import { revealCommand } from "@/lib/platform";
import { resolveFilePath } from "@/lib/scanner";

/**
 * ファイルの場所をファイラー（Finder / エクスプローラー など）で開く。移動・削除はしない。
 * パスはクライアントから受け取らず、ファイル ID から DB 上の記録を引いて検証したものだけを使う。
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]/reveal">) {
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
  const cmd = revealCommand(file);
  // シェルを介さず、引数として渡す
  const ok = await new Promise<boolean>((resolve) => {
    execFile(cmd.file, cmd.args, { windowsVerbatimArguments: cmd.windowsVerbatimArguments, timeout: 10_000 }, (err) => {
      if (!err) return resolve(true);
      const exitOnly = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number";
      resolve(Boolean(cmd.ignoreExitCode && exitOnly));
    });
  });
  if (!ok) return Response.json({ error: "ファイルの場所を開けませんでした" }, { status: 500 });
  return Response.json({ ok: true });
}

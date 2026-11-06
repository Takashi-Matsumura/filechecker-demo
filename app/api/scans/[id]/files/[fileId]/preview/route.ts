import type { NextRequest } from "next/server";
import { buildPreview } from "@/lib/scanner";

/**
 * 検出箇所のハイライトつきプレビュー（番号などはマスク済み）。
 * パスはクライアントから受け取らず、ファイル ID から DB 上の記録を引いて検証したものだけを読む。
 * 内容を含むのでキャッシュさせない。
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]/preview">) {
  const { id, fileId } = await ctx.params;
  const scanId = Number(id);
  const fid = Number(fileId);
  if (!Number.isInteger(scanId) || !Number.isInteger(fid)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const preview = await buildPreview(scanId, fid);
  if (!preview) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
}

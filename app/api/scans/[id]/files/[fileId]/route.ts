import type { NextRequest } from "next/server";
import { getDuplicates, getFile } from "@/lib/scanner";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]">) {
  const { id, fileId } = await ctx.params;
  const scanId = Number(id);
  const fid = Number(fileId);
  if (!Number.isInteger(scanId) || !Number.isInteger(fid)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const file = getFile(scanId, fid);
  if (!file) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ file, duplicates: getDuplicates(scanId, file) });
}

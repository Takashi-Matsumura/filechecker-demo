import type { NextRequest } from "next/server";
import { platformInfo } from "@/lib/platform";
import { getScan, getScanSummary } from "@/lib/scanner";

/** ?files=0 のときは棚卸しの記録（進み具合）だけを返す。ファイルが多いときのポーリングを軽くするため */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("files") === "0") {
    const scan = getScanSummary(n);
    if (!scan) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ scan });
  }
  const data = getScan(n);
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...data, platform: platformInfo() });
}

import type { NextRequest } from "next/server";
import { platformInfo } from "@/lib/platform";
import { deleteScan, getScan, getScanSummary } from "@/lib/scanner";

/** ?files=0 のときは棚卸しの記録（進み具合）だけを返す。ファイルが多いときのポーリングを軽くするため */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("files") === "0") {
    const scan = getScanSummary(n);
    if (!scan) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ scan, platform: platformInfo() });
  }
  const data = getScan(n);
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...data, platform: platformInfo() });
}

/** 棚卸しの記録を削除する。ファイル自体には触れない。実行中のものは 409（先に中断してもらう） */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  const r = deleteScan(n);
  if (r === "not_found") return Response.json({ error: "この棚卸しは見つかりません" }, { status: 404 });
  if (r === "running") return Response.json({ error: "実行中の棚卸しは削除できません。先に中断してください" }, { status: 409 });
  return Response.json({ ok: true });
}

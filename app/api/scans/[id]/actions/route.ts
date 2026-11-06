import type { NextRequest } from "next/server";
import { getScanSummary } from "@/lib/scanner";
import { ACTION_FILTERS, actionsView, type ActionFilter } from "@/lib/views";

/** やること画面の集計と、表の1ページ分。?filter=all|move|remove|tidy|check|handled&page=0 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]/actions">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !getScanSummary(n)) return Response.json({ error: "not found" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const filter = (ACTION_FILTERS as readonly string[]).includes(sp.get("filter") ?? "") ? (sp.get("filter") as ActionFilter) : "all";
  const page = Math.max(0, Math.floor(Number(sp.get("page")) || 0));
  return Response.json(actionsView(n, filter, page), { headers: { "Cache-Control": "no-store" } });
}

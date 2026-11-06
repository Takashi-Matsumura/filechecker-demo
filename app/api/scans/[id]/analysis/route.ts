import type { NextRequest } from "next/server";
import { getScanSummary } from "@/lib/scanner";
import { ANALYSIS_FILTERS, analysisView, type AnalysisFilter } from "@/lib/views";

/** 詳しい分析の集計と、一覧の1ページ分。?filter=all|high|…&q=検索語&page=0 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/scans/[id]/analysis">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !getScanSummary(n)) return Response.json({ error: "not found" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const filter = (ANALYSIS_FILTERS as readonly string[]).includes(sp.get("filter") ?? "") ? (sp.get("filter") as AnalysisFilter) : "all";
  const q = (sp.get("q") ?? "").slice(0, 200);
  const page = Math.max(0, Math.floor(Number(sp.get("page")) || 0));
  return Response.json(analysisView(n, filter, q, page), { headers: { "Cache-Control": "no-store" } });
}

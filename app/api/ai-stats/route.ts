import type { NextRequest } from "next/server";
import { aiStats } from "@/lib/metrics";

/** AI の性能の集計。?days=7|30|all（既定は all） */
export async function GET(req: NextRequest) {
  const days = req.nextUrl.searchParams.get("days");
  const n = days === "7" || days === "30" ? Number(days) : null;
  const since = n ? new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString() : null;
  return Response.json(aiStats(since), { headers: { "Cache-Control": "no-store" } });
}

import type { NextRequest } from "next/server";
import { JUDGE_VERSION } from "@/lib/llm";
import { aiStats, judgeVersions } from "@/lib/metrics";

/**
 * AI の性能の集計。?days=7|30|all（既定は all）、?version=判定の指示文の版（8桁の16進。既定はすべて）
 * あわせて、絞り込みの選択肢（版の一覧）と、今使っている判定の版を返す。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = sp.get("days");
  const n = days === "7" || days === "30" ? Number(days) : null;
  const since = n ? new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString() : null;
  const v = sp.get("version");
  const version = v && /^[0-9a-f]{8}$/.test(v) ? v : null;
  return Response.json(
    { ...aiStats(since, version), versions: judgeVersions(), currentVersion: JUDGE_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}

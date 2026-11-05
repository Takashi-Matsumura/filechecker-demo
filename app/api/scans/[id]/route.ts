import type { NextRequest } from "next/server";
import { getScan } from "@/lib/scanner";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  const data = getScan(n);
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(data);
}

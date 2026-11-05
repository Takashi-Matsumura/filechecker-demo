import type { NextRequest } from "next/server";
import { resumeScan } from "@/lib/scanner";

/** 中断したスキャンを再開する。終わったファイルはやり直さない */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/resume">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  const r = await resumeScan(n);
  if (r === "not_allowed") {
    return Response.json({ error: "スキャン対象のフォルダが見つからないか、許可された範囲外になっています" }, { status: 403 });
  }
  if (r !== "ok") return Response.json({ error: "中断中のスキャンではありません" }, { status: 409 });
  return Response.json({ ok: true });
}

import type { NextRequest } from "next/server";
import { pauseScan } from "@/lib/scanner";

/** 実行中のスキャンを中断する。処理中のファイルは打ち切って未処理に戻す */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/pause">) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  if (pauseScan(n) !== "ok") return Response.json({ error: "実行中のスキャンではありません" }, { status: 409 });
  return Response.json({ ok: true });
}

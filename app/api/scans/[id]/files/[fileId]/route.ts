import type { NextRequest } from "next/server";
import { ACTION_STATUSES, getDuplicates, getFile, setActionStatus, type ActionStatus } from "@/lib/scanner";

function ids(params: { id: string; fileId: string }) {
  const scanId = Number(params.id);
  const fileId = Number(params.fileId);
  return Number.isInteger(scanId) && Number.isInteger(fileId) ? { scanId, fileId } : null;
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]">) {
  const p = ids(await ctx.params);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  const file = getFile(p.scanId, p.fileId);
  if (!file) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ file, duplicates: getDuplicates(p.scanId, file) });
}

/** 社員の対応状況（未対応 / 対応した / 対応しない）を更新する。ファイル自体は操作しない */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/scans/[id]/files/[fileId]">) {
  const p = ids(await ctx.params);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  if (typeof status !== "string" || !ACTION_STATUSES.includes(status as ActionStatus)) {
    return Response.json({ error: "status は todo / done / skipped のいずれかです" }, { status: 400 });
  }
  if (!setActionStatus(p.scanId, p.fileId, status as ActionStatus)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true, status });
}

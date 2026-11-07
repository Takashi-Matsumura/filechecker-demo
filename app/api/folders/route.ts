import type { NextRequest } from "next/server";
import { folderRoots, listFolder } from "@/lib/folders";
import { PathError } from "@/lib/scanner";

/**
 * フォルダの選択画面のための一覧。?path= を省くと起点（許可された範囲と、マウントされた共有フォルダ）を返す。
 * 一覧を返すのは、棚卸しを許可した範囲（SCAN_ALLOWED_ROOTS）の中のフォルダだけ。
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  const headers = { "Cache-Control": "no-store" };
  if (p === null) return Response.json({ roots: await folderRoots() }, { headers });
  if (p.length > 4096) return Response.json({ error: "パスが長すぎます" }, { status: 400, headers });
  try {
    return Response.json(await listFolder(p), { headers });
  } catch (e) {
    if (e instanceof PathError) return Response.json({ error: e.message }, { status: 400, headers });
    throw e;
  }
}

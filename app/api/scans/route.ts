import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { listScans, PathError, resolveScanRoot, startScan } from "@/lib/scanner";

export async function GET() {
  await connection();
  const sample = path.join(process.cwd(), "testdata", "sample-files");
  return Response.json({
    scans: listScans(),
    allowedRoots: config.allowedRoots,
    sampleDir: fs.existsSync(sample) ? sample : null,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON で送信してください" }, { status: 400 });
  }
  const input = (body as { root?: unknown })?.root;
  try {
    const root = await resolveScanRoot(typeof input === "string" ? input : "");
    const id = startScan(root);
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof PathError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

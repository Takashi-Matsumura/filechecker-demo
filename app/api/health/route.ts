import { connection } from "next/server";
import { llmStatus } from "@/lib/llm";

export async function GET() {
  await connection();
  return Response.json({ llm: await llmStatus() });
}

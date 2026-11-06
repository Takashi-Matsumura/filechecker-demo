import { NextResponse, type NextRequest } from "next/server";
import { checkLocalRequest } from "@/lib/local-request";

/** このPCからのアクセスだけを受け付ける。判定の内容は lib/local-request.ts を参照 */
export function proxy(request: NextRequest) {
  const check = checkLocalRequest(request.method, request.headers.get("host"), request.headers.get("origin"));
  if (!check.ok && check.reason === "host") {
    return new NextResponse("This app only accepts requests from localhost.", { status: 403 });
  }
  if (!check.ok) {
    return new NextResponse("Cross-origin request rejected.", { status: 403 });
  }
  return NextResponse.next();
}

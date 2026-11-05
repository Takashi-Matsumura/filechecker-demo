import { NextResponse, type NextRequest } from "next/server";

/**
 * このアプリはローカルのファイルを読むため、このPCからのアクセスだけを受け付ける。
 * - Host が localhost 系以外（トンネル経由・LAN経由・DNS リバインディング）は拒否
 * - 状態を変えるリクエストは Origin も localhost 系であることを要求（CSRF 対策）
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const host = hostnameOf(request.headers.get("host"));
  if (!host || !LOCAL_HOSTS.has(host)) {
    return new NextResponse("This app only accepts requests from localhost.", { status: 403 });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const originHost = origin ? hostnameOf(origin.replace(/^https?:\/\//, "")) : null;
    if (!originHost || !LOCAL_HOSTS.has(originHost)) {
      return new NextResponse("Cross-origin request rejected.", { status: 403 });
    }
  }
  return NextResponse.next();
}

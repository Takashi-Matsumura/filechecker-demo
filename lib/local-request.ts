/**
 * このアプリはローカルのファイルを読むため、このPCからのアクセスだけを受け付ける（proxy.ts から使う）。
 * - Host が localhost 系以外（トンネル経由・LAN経由・DNS リバインディング）は拒否
 * - 状態を変えるリクエストは、Origin がこのアプリ自身（同じホスト名・同じポート）であることを要求（CSRF 対策）。
 *   ホスト名だけを見ると、同じPCの別のポートで動く Web ページ（他の開発サーバなど）から操作できてしまう
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Host ヘッダ（"localhost:3000" など）を、ホスト名とポートに分ける。読めなければ null */
function parseHost(hostHeader: string | null): { hostname: string; port: string } | null {
  if (!hostHeader) return null;
  try {
    const u = new URL(`http://${hostHeader}`);
    // "localhost@evil.com" のような、ホスト以外の部分を含むものは受け付けない
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
    return { hostname: u.hostname, port: u.port };
  } catch {
    return null;
  }
}

export type RequestCheck = { ok: true } | { ok: false; reason: "host" | "origin" };

export function checkLocalRequest(method: string, hostHeader: string | null, originHeader: string | null): RequestCheck {
  const host = parseHost(hostHeader);
  if (!host || !LOCAL_HOSTS.has(host.hostname)) return { ok: false, reason: "host" };
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };
  if (!originHeader) return { ok: false, reason: "origin" };
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return { ok: false, reason: "origin" };
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return { ok: false, reason: "origin" };
  // Origin のホスト名・ポートが、リクエスト先（Host）と同じであること
  if (origin.hostname !== host.hostname || origin.port !== host.port) return { ok: false, reason: "origin" };
  return { ok: true };
}

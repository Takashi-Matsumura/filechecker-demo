/**
 * localhost 以外からのアクセスと、別のオリジンからの操作を拒否する判定（lib/local-request.ts）の単体テスト。
 * 実行: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkLocalRequest } from "../lib/local-request.ts";

const ok = { ok: true };
const host = { ok: false, reason: "host" };
const origin = { ok: false, reason: "origin" };

describe("Host の確認", () => {
  it("localhost 系だけを受け付ける", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) assert.deepEqual(checkLocalRequest("GET", h, null), ok, h);
  });
  it("それ以外のホスト（LAN・トンネル・DNS リバインディング）は拒否する", () => {
    for (const h of ["example.com", "192.168.0.10:3000", "localhost.evil.com", "localhost@evil.com", "evil.com#localhost", null, ""]) {
      assert.deepEqual(checkLocalRequest("GET", h, null), host, String(h));
    }
  });
});

describe("状態を変えるリクエストの Origin", () => {
  it("同じホスト名・同じポートなら受け付ける", () => {
    assert.deepEqual(checkLocalRequest("POST", "localhost:3000", "http://localhost:3000"), ok);
    assert.deepEqual(checkLocalRequest("PATCH", "127.0.0.1:3000", "http://127.0.0.1:3000"), ok);
    assert.deepEqual(checkLocalRequest("POST", "[::1]:3000", "http://[::1]:3000"), ok);
  });
  it("同じPCの別のポートで動くページからは拒否する", () => {
    assert.deepEqual(checkLocalRequest("POST", "localhost:3000", "http://localhost:8000"), origin);
    assert.deepEqual(checkLocalRequest("POST", "localhost:3000", "http://127.0.0.1:3000"), origin);
  });
  it("Origin が無い・null・別のサイト・不正な形なら拒否する", () => {
    for (const o of [null, "null", "https://evil.com", "http://localhost.evil.com:3000", "file://", "localhost:3000"]) {
      assert.deepEqual(checkLocalRequest("POST", "localhost:3000", o), origin, String(o));
    }
  });
  it("GET / HEAD / OPTIONS は Origin を見ない", () => {
    assert.deepEqual(checkLocalRequest("GET", "localhost:3000", "https://evil.com"), ok);
    assert.deepEqual(checkLocalRequest("head", "localhost:3000", null), ok);
  });
});

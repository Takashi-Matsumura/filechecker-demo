/**
 * 紹介動画の配信で使う Range ヘッダの読み取り（lib/video.ts）の単体テスト。実行: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRange } from "../lib/video.ts";

describe("parseRange", () => {
  it("ヘッダが無い・読めない形なら全体を返す（null）", () => {
    assert.equal(parseRange(null, 100), null);
    assert.equal(parseRange("items=0-1", 100), null);
    assert.equal(parseRange("bytes=0-1, 5-6", 100), null);
    assert.equal(parseRange("bytes=abc-", 100), null);
  });

  it("開始と終了を指定した範囲を返す（終了はファイルの末尾までに収める）", () => {
    assert.deepEqual(parseRange("bytes=0-", 100), { start: 0, end: 99 });
    assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  });

  it("末尾からのバイト数を指定した範囲を返す", () => {
    assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange("bytes=-500", 100), { start: 0, end: 99 });
  });

  it("ファイルの外の範囲は unsatisfiable", () => {
    assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
    assert.equal(parseRange("bytes=50-10", 100), "unsatisfiable");
    assert.equal(parseRange("bytes=-0", 100), "unsatisfiable");
  });
});

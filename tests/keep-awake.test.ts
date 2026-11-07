/**
 * 棚卸し・評価の間のスリープ防止（lib/keep-awake.ts）の単体テスト。実行: npm test
 * mac では caffeinate が起動し、すべて解除すると終わることを確かめる。ほかの OS では何もしないことを確かめる。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { keepAwake, keepAwakePid } = await jiti.import<typeof import("../lib/keep-awake.ts")>(path.join(root, "lib/keep-awake.ts"));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("keepAwake", () => {
  it("すべての処理が終わるまでスリープを止め、終わったら解除する", { skip: process.platform !== "darwin" }, async () => {
    const a = keepAwake();
    const pid = keepAwakePid();
    assert.ok(pid, "caffeinate が起動していない");
    const b = keepAwake();
    assert.equal(keepAwakePid(), pid, "2つ目の処理で別の caffeinate を起動しない");
    a();
    a(); // 2回呼んでも数を減らしすぎない
    assert.equal(keepAwakePid(), pid, "処理が残っている間は解除しない");
    assert.ok(alive(pid));
    b();
    assert.equal(keepAwakePid(), null);
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(50);
    assert.ok(!alive(pid), "解除しても caffeinate が残っている");
  });

  it("mac 以外では何も起動しない", { skip: process.platform === "darwin" }, () => {
    const release = keepAwake();
    assert.equal(keepAwakePid(), null);
    release();
  });
});

/**
 * 棚卸しの画面に出す「いま何をしているか」（lib/scanner.ts の getScanActivity）の単体テスト。一時ファイルの DB を使う。
 * 実行: npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createJiti } from "jiti";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "filechecker-activity-"));
process.env.DB_PATH = path.join(tmp, "test.db");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { db } = await jiti.import<typeof import("../lib/db.ts")>(path.join(root, "lib/db.ts"));
const { getScanActivity } = await jiti.import<typeof import("../lib/scanner.ts")>(path.join(root, "lib/scanner.ts"));

const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
function scan(): number {
  const r = db().prepare(`INSERT INTO scans (root, status, created_at) VALUES ('/tmp/x', 'processing', ?)`).run(ago(600));
  return Number(r.lastInsertRowid);
}
function file(scanId: number, rel: string, status: string, progress: object | null): void {
  db()
    .prepare(`INSERT INTO files (scan_id, rel_path, ext, kind, size, mtime, status, is_stale, progress) VALUES (?, ?, 'csv', 'text', 1, '2026-01-01', ?, 0, ?)`)
    .run(scanId, rel, status, progress ? JSON.stringify(progress) : null);
}

describe("getScanActivity", () => {
  it("処理中のファイルの段階と経過時間、最後の動きからの秒数を返す", () => {
    const id = scan();
    file(id, "全社.csv", "pending", { stage: "names", step: 4, total: 10, startedAt: ago(190), updatedAt: ago(20) });
    file(id, "未着手.csv", "pending", null);
    file(id, "終わった.csv", "done", null);
    const a = getScanActivity(id);
    assert.equal(a.files.length, 1);
    assert.deepEqual({ ...a.files[0], id: 0, elapsedSec: Math.round(a.files[0].elapsedSec / 10) * 10 }, {
      id: 0,
      relPath: "全社.csv",
      stage: "names",
      step: 4,
      total: 10,
      elapsedSec: 190,
    });
    assert.ok(a.idleSec !== null && a.idleSec >= 19 && a.idleSec <= 22, String(a.idleSec));
  });
  it("AI の呼び出しが終わった時刻も、最後の動きに数える", () => {
    const id = scan();
    file(id, "a.csv", "pending", { stage: "judge", startedAt: ago(300), updatedAt: ago(300) });
    // 10秒前に始まり、7秒かかった呼び出し = 3秒前に終わった
    db()
      .prepare(`INSERT INTO ai_calls (scan_id, file_id, kind, prompt_version, started_at, duration_ms, ok) VALUES (?, 1, 'names', 'x', ?, 7000, 1)`)
      .run(id, ago(10));
    const a = getScanActivity(id);
    assert.ok(a.idleSec !== null && a.idleSec >= 2 && a.idleSec <= 5, String(a.idleSec));
  });
  it("処理中のファイルも AI の呼び出しもなければ、最後の動きは null", () => {
    const a = getScanActivity(scan());
    assert.deepEqual(a, { files: [], idleSec: null });
  });
});

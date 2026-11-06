/**
 * 棚卸しの記録の削除（lib/scanner.ts の deleteScan）の単体テスト。一時ファイルの DB を使う。実行: npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createJiti } from "jiti";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "filechecker-test-"));
process.env.DB_PATH = path.join(tmp, "test.db");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { db } = await jiti.import<typeof import("../lib/db.ts")>(path.join(root, "lib/db.ts"));
const { deleteScan } = await jiti.import<typeof import("../lib/scanner.ts")>(path.join(root, "lib/scanner.ts"));

/** 棚卸しの記録と、そのファイルを1件作る */
function scan(status: string, pid: number | null = null): number {
  const { lastInsertRowid } = db()
    .prepare(`INSERT INTO scans (root, status, runner_pid, created_at) VALUES ('/tmp/x', ?, ?, '2026-01-01T00:00:00Z')`)
    .run(status, pid);
  const id = Number(lastInsertRowid);
  db()
    .prepare(`INSERT INTO files (scan_id, rel_path, ext, kind, size, mtime, status, is_stale) VALUES (?, 'a.txt', 'txt', 'text', 1, '2026-01-01', 'done', 0)`)
    .run(id);
  return id;
}
const count = (sql: string, id: number) => (db().prepare(sql).get(id) as { n: number }).n;

describe("deleteScan", () => {
  it("終わった棚卸しは、ファイルごとの結果ごと削除する", () => {
    const id = scan("done");
    assert.equal(deleteScan(id), "ok");
    assert.equal(count("SELECT count(*) AS n FROM scans WHERE id=?", id), 0);
    assert.equal(count("SELECT count(*) AS n FROM files WHERE scan_id=?", id), 0);
  });
  it("中断中・エラーの棚卸しも削除できる", () => {
    assert.equal(deleteScan(scan("paused")), "ok");
    assert.equal(deleteScan(scan("error")), "ok");
  });
  it("実行中の棚卸しは削除しない", () => {
    for (const st of ["queued", "walking", "processing", "pausing"]) {
      const id = scan(st, process.pid); // このプロセスが動かしている = 実行中
      assert.equal(deleteScan(id), "running", st);
      assert.equal(count("SELECT count(*) AS n FROM files WHERE scan_id=?", id), 1, st);
    }
  });
  it("サーバが止まって取り残された「実行中」は、中断扱いにして削除できる", () => {
    const id = scan("processing", 2_147_483_646); // 存在しないプロセス
    assert.equal(deleteScan(id), "ok");
  });
  it("無い棚卸しは not_found", () => {
    assert.equal(deleteScan(999_999), "not_found");
  });
});

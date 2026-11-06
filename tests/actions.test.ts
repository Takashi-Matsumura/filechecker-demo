/**
 * やること画面の区分と優先度（components/actions.ts）の単体テスト。実行: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bucketOf, folderOf, fileName, priority, reasonTags, type FileItem } from "../components/actions.ts";

function file(over: Partial<FileItem> = {}): FileItem {
  return {
    id: 1,
    rel_path: "人事/名簿.xlsx",
    ext: ".xlsx",
    kind: "office",
    size: 100,
    mtime: "2025-01-01T00:00:00.000Z",
    status: "done",
    error: null,
    extract_method: "text",
    findings: [],
    ai: null,
    risk: "none",
    is_stale: false,
    dup_of: null,
    action_status: "todo",
    action_at: null,
    ...over,
  };
}

describe("bucketOf", () => {
  it("AI の推奨から区分を決める", () => {
    assert.equal(bucketOf(file({ ai: { recommendation: "restrict" } })), "move");
    assert.equal(bucketOf(file({ ai: { recommendation: "delete" } })), "remove");
    assert.equal(bucketOf(file({ ai: { recommendation: "archive" } })), "tidy");
    assert.equal(bucketOf(file({ ai: { recommendation: "review" } })), "check");
    assert.equal(bucketOf(file({ ai: { recommendation: "keep" } })), "ok");
  });
  it("中身を読めなかったファイルは、AI の推奨や重複より優先して「確認する」", () => {
    assert.equal(bucketOf(file({ status: "error", ai: { recommendation: "keep" } })), "check");
    assert.equal(bucketOf(file({ extract_method: "none", dup_of: 3 })), "check");
    assert.deepEqual(reasonTags(file({ status: "error" })).at(-1), "読み込みエラー");
  });
  it("AI の判定がなければルールの結果から決める", () => {
    assert.equal(bucketOf(file({ dup_of: 2 })), "remove");
    assert.equal(bucketOf(file({ risk: "high" })), "move");
    assert.equal(bucketOf(file({ risk: "medium" })), "check");
    assert.equal(bucketOf(file({ is_stale: true })), "tidy");
    assert.equal(bucketOf(file()), "ok");
  });
  it("解析中のファイルはやることに含めない", () => {
    assert.equal(bucketOf(file({ status: "processing", extract_method: null })), "ok");
  });
});

describe("priority / reasonTags", () => {
  const mynumber = { type: "mynumber", label: "マイナンバー", level: "high" as const, count: 1 };
  const phone = { type: "phone", label: "電話番号", level: "medium" as const, count: 50 };
  it("リスクが同じなら、重大な情報があるほうを先にする（件数より種類）", () => {
    const a = file({ risk: "high", findings: [mynumber] });
    const b = file({ risk: "high", findings: [phone] });
    assert.ok(priority(a) > priority(b));
  });
  it("リスクが高いほうを先にする", () => {
    assert.ok(priority(file({ risk: "high" })) > priority(file({ risk: "medium", findings: [mynumber] })));
  });
  it("理由は区分の理由を先頭に、隠れた理由を補足として並べる", () => {
    assert.deepEqual(reasonTags(file({ dup_of: 1, findings: [phone, mynumber], is_stale: true })), [
      "重複",
      "マイナンバー 1件",
      "2025年から更新なし",
    ]);
  });
});

describe("パスの表示", () => {
  it("/ と \\ のどちらの区切りでも分ける", () => {
    assert.equal(fileName("a/b/c.txt"), "c.txt");
    assert.equal(fileName("a\\b\\c.txt"), "c.txt");
    assert.equal(folderOf("a\\b\\c.txt"), "a / b");
    assert.equal(folderOf("c.txt"), "（直下）");
  });
});

/**
 * フォルダの選択画面のための一覧（lib/folders.ts）の単体テスト。一時フォルダを許可された範囲にして確かめる。
 * 実行: npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createJiti } from "jiti";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "filechecker-folders-")));
const allowedRoot = path.join(tmp, "allowed");
const outside = path.join(tmp, "outside");
for (const d of ["総務/2024", "総務/2025", "人事", ".hidden", "node_modules"]) fs.mkdirSync(path.join(allowedRoot, d), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(allowedRoot, "総務", "memo.txt"), "x");
fs.symlinkSync(outside, path.join(allowedRoot, "外へのリンク"));
process.env.SCAN_ALLOWED_ROOTS = allowedRoot;
process.env.DB_PATH = path.join(tmp, "test.db");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${root}/` } });
const { listFolder, folderRoots, parseMacMounts, parseLinuxMounts } = await jiti.import<typeof import("../lib/folders.ts")>(
  path.join(root, "lib/folders.ts"),
);

describe("listFolder", () => {
  it("直下のフォルダを名前順に返し、隠しフォルダ・node_modules・リンクは出さない", async () => {
    const r = await listFolder(allowedRoot);
    assert.deepEqual(r.folders.map((f) => f.name), ["人事", "総務"].sort((a, b) => a.localeCompare(b, "ja")));
    assert.equal(r.parent, null, "許可された範囲の外（1つ上）へは戻れない");
  });
  it("中のフォルダでは、1つ上と直下のファイル数を返す", async () => {
    const r = await listFolder(path.join(allowedRoot, "総務"));
    assert.deepEqual(r.folders.map((f) => f.name), ["2024", "2025"]);
    assert.equal(r.parent, allowedRoot);
    assert.equal(r.files, 1);
  });
  it("許可された範囲の外・リンクで外へ出る先・存在しないフォルダは返さない", async () => {
    await assert.rejects(listFolder(outside), /許可されていません/);
    await assert.rejects(listFolder(path.join(allowedRoot, "外へのリンク")), /許可されていません/);
    await assert.rejects(listFolder(path.join(allowedRoot, "..")), /許可されていません/);
    await assert.rejects(listFolder(path.join(allowedRoot, "無い")), /見つかりません/);
    await assert.rejects(listFolder("相対/パス"), /絶対パス/);
  });
  it("起点に許可された範囲を返す", async () => {
    const roots = await folderRoots();
    assert.ok(roots.some((r) => r.path === allowedRoot && r.kind === "allowed" && r.selectable));
  });
});

describe("共有フォルダの検出", () => {
  it("mac の mount の出力から、ネットワークの共有フォルダだけを拾う（空白を含むマウント先・ユーザ名は出さない）", () => {
    const out = [
      "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
      "//taro@fileserver/share on /Volumes/share (smbfs, nodev, nosuid, mounted by taro)",
      "//GUEST:@nas.local/総務 部 on /Volumes/総務 部 (smbfs, nodev, nosuid, mounted by taro)",
      "nfsserver:/export on /Volumes/export (nfs, nodev)",
      "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)",
    ].join("\n");
    assert.deepEqual(parseMacMounts(out), [
      { source: "fileserver/share", mountPoint: "/Volumes/share" },
      { source: "nas.local/総務 部", mountPoint: "/Volumes/総務 部" },
      { source: "nfsserver:/export", mountPoint: "/Volumes/export" },
    ]);
  });
  it("Linux の /proc/mounts から、cifs などを拾う（\\040 は空白に戻す）", () => {
    const text = [
      "/dev/sda1 / ext4 rw 0 0",
      "//fileserver/share /mnt/share cifs rw,user=taro 0 0",
      "//fileserver/my\\040share /mnt/my\\040share smb3 rw 0 0",
    ].join("\n");
    assert.deepEqual(parseLinuxMounts(text), [
      { source: "fileserver/share", mountPoint: "/mnt/share" },
      { source: "fileserver/my share", mountPoint: "/mnt/my share" },
    ]);
  });
});

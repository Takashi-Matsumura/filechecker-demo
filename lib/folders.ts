import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config";
import { PathError, resolveScanRoot } from "./scanner";

/**
 * 棚卸しするフォルダを画面で選ぶための、フォルダの一覧。
 * ブラウザの標準のフォルダ選択ではフォルダの絶対パスを受け取れないので、サーバ（社員の PC）が一覧を返す。
 * 一覧を返すのは、棚卸しを許可した範囲（SCAN_ALLOWED_ROOTS）の中だけ。ファイルの名前や中身は返さない。
 */

export interface FolderRoot {
  path: string;
  label: string;
  /** allowed = 許可された範囲 / network = マウントされたネットワークの共有フォルダ（Samba など） */
  kind: "allowed" | "network";
  /** 棚卸しを許可した範囲の中か（範囲の外の共有フォルダは、設定に加えるまで選べない） */
  selectable: boolean;
  /** 共有フォルダの接続先（"server/share"）。ユーザ名は含めない */
  source?: string;
}

export interface FolderEntry {
  name: string;
  path: string;
}

export interface FolderListing {
  path: string;
  /** 1つ上のフォルダ。許可された範囲の外なら null */
  parent: string | null;
  folders: FolderEntry[];
  /** このフォルダの直下のファイルの数（中のフォルダは数えない） */
  files: number;
  /** フォルダが多すぎて、一部だけを返した */
  truncated: boolean;
}

/** 1回に返すフォルダの数の上限（極端に多いフォルダで画面と通信が重くならないように） */
const MAX_FOLDERS = 2000;

const isAllowed = (p: string) =>
  resolveScanRoot(p).then(
    () => true,
    () => false,
  );

/** 選択画面の左に並べる起点。許可された範囲と、マウントされた共有フォルダ */
export async function folderRoots(): Promise<FolderRoot[]> {
  const roots: FolderRoot[] = [];
  const home = path.resolve(os.homedir());
  for (const p of config.allowedRoots) {
    const exists = await fs.stat(p).then((s) => s.isDirectory(), () => false);
    if (!exists) continue;
    roots.push({ path: p, label: p === home ? "ホーム" : path.basename(p) || p, kind: "allowed", selectable: true });
  }
  for (const m of await networkMounts()) {
    if (roots.some((r) => r.path === m.mountPoint)) continue;
    roots.push({
      path: m.mountPoint,
      label: path.basename(m.mountPoint) || m.mountPoint,
      kind: "network",
      selectable: await isAllowed(m.mountPoint),
      source: m.source,
    });
  }
  return roots;
}

/** 指定したフォルダの直下のフォルダを返す。許可された範囲の外・フォルダでないものは PathError */
export async function listFolder(input: string): Promise<FolderListing> {
  const real = await resolveScanRoot(input);
  let entries;
  try {
    entries = await fs.readdir(real, { withFileTypes: true });
  } catch {
    throw new PathError("このフォルダは開けません（読み取る権限がない可能性があります）");
  }
  const folders: FolderEntry[] = [];
  let files = 0;
  for (const e of entries) {
    if (e.isFile()) files++;
    // 棚卸し（walk）と同じく、隠しフォルダ・node_modules・シンボリックリンクは出さない
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    folders.push({ name: e.name, path: path.join(real, e.name) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const parentPath = path.dirname(real);
  const parent = parentPath !== real && (await isAllowed(parentPath)) ? parentPath : null;
  return { path: real, parent, folders: folders.slice(0, MAX_FOLDERS), files, truncated: folders.length > MAX_FOLDERS };
}

// ---------------------------------------------------------------- ネットワークの共有フォルダの検出

interface NetworkMount {
  /** "server/share" */
  source: string;
  mountPoint: string;
}

/** ネットワークのファイルシステムの種類（mount の出力・/proc/mounts の表記） */
const NETWORK_FS = new Set(["smbfs", "cifs", "smb3", "nfs", "nfs4", "afpfs", "webdav"]);

/** マウントされたネットワークの共有フォルダを返す（mac・Linux）。Windows は \\server\share を直接指定する */
export async function networkMounts(): Promise<NetworkMount[]> {
  try {
    if (process.platform === "darwin") return parseMacMounts(await run("/sbin/mount", []));
    if (process.platform === "linux") return parseLinuxMounts(await fs.readFile("/proc/mounts", "utf8"));
  } catch {
    // 検出できなくても、パスの手入力で指定できる
  }
  return [];
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );
}

/** "//user@server/share" → "server/share"（ユーザ名は画面に出さない） */
function sourceLabel(device: string): string {
  const s = device.replace(/^\/\//, "");
  const at = s.indexOf("@");
  return at >= 0 ? s.slice(at + 1) : s;
}

/**
 * mac の mount の出力を読む。例: "//user@server/share on /Volumes/share (smbfs, nodev, nosuid, mounted by user)"
 * マウント先に空白が入ることがあるので、" on " と最後の " (" の位置で区切る（正規表現は使わない）
 */
export function parseMacMounts(out: string): NetworkMount[] {
  const mounts: NetworkMount[] = [];
  for (const line of out.split("\n")) {
    const on = line.indexOf(" on ");
    const paren = line.lastIndexOf(" (");
    if (on < 0 || paren < on) continue;
    const type = line.slice(paren + 2).split(/[,)]/)[0].trim();
    if (!NETWORK_FS.has(type)) continue;
    mounts.push({ source: sourceLabel(line.slice(0, on)), mountPoint: line.slice(on + 4, paren) });
  }
  return mounts;
}

/** Linux の /proc/mounts を読む。空白などは \040 のような8進数で書かれている */
export function parseLinuxMounts(text: string): NetworkMount[] {
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  const mounts: NetworkMount[] = [];
  for (const line of text.split("\n")) {
    const [device, mountPoint, type] = line.split(" ");
    if (!device || !mountPoint || !NETWORK_FS.has(type)) continue;
    mounts.push({ source: sourceLabel(unescape(device)), mountPoint: unescape(mountPoint) });
  }
  return mounts;
}

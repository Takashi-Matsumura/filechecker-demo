import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

/**
 * 走査結果の保存先。
 * 方針: 抽出した生テキストは保存しない。保存するのはメタ情報・マスク済みの抜粋・AI の判定だけ。
 * （棚卸しツール自体が機密のコピーを抱え込まないため）
 */

const globalForDb = globalThis as unknown as { __fcDb?: DatabaseSync };

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS scans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      root        TEXT NOT NULL,
      status      TEXT NOT NULL,          -- queued | walking | processing | pausing | paused | done | error
      total       INTEGER NOT NULL DEFAULT 0,
      processed   INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      runner_pid  INTEGER,                -- 実行中プロセスの PID（中断検知用）
      created_at  TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id        INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      rel_path       TEXT NOT NULL,
      ext            TEXT NOT NULL,
      kind           TEXT NOT NULL,       -- office | pdf | image | text | other
      size           INTEGER NOT NULL,
      mtime          TEXT NOT NULL,
      sha256         TEXT,
      status         TEXT NOT NULL,       -- pending | done | error
      error          TEXT,
      extract_method TEXT,                -- text | office | pdf-text | ocr | none
      text_chars     INTEGER NOT NULL DEFAULT 0,
      excerpt        TEXT,                -- マスク済みの抜粋
      findings_json  TEXT NOT NULL DEFAULT '[]',
      rule_level     TEXT NOT NULL DEFAULT 'none',
      ai_json        TEXT,
      risk           TEXT NOT NULL DEFAULT 'none',  -- high | medium | low | none
      is_stale       INTEGER NOT NULL DEFAULT 0,
      dup_of         INTEGER                -- 同一内容の代表ファイル id
    );
    CREATE INDEX IF NOT EXISTS idx_files_scan ON files(scan_id);
  `);
  // 後から追加した列のマイグレーション
  const cols = db.prepare(`PRAGMA table_info(scans)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "runner_pid")) db.exec(`ALTER TABLE scans ADD COLUMN runner_pid INTEGER`);
  if (!cols.some((c) => c.name === "truncated")) {
    // ファイル数の上限に達して、一覧づくりを途中で打ち切ったか（1 なら、棚卸ししていないファイルが残っている）
    db.exec(`ALTER TABLE scans ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "walked")) {
    // ファイル一覧の作成が終わったか（再開時に一覧を作り直すかの判定に使う）
    db.exec(`ALTER TABLE scans ADD COLUMN walked INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE scans SET walked=1 WHERE total > 0`);
  }
  const fileCols = db.prepare(`PRAGMA table_info(files)`).all() as { name: string }[];
  if (!fileCols.some((c) => c.name === "action_status")) {
    // 社員の対応状況: todo=未対応 / done=対応した / skipped=対応しない
    db.exec(`ALTER TABLE files ADD COLUMN action_status TEXT NOT NULL DEFAULT 'todo'`);
    db.exec(`ALTER TABLE files ADD COLUMN action_at TEXT`);
  }
  if (!fileCols.some((c) => c.name === "name_ranges")) {
    // AI が推定した氏名の位置（マスク後テキスト上の [start, end) の JSON）。氏名の文字列そのものは保存しない
    db.exec(`ALTER TABLE files ADD COLUMN name_ranges TEXT`);
  }
  if (!fileCols.some((c) => c.name === "ocr_preview")) {
    // OCR で読み取ったファイルのプレビュー（番号・氏名を伏せた全文と検出位置の JSON）。OCR のやり直しを避けるため
    db.exec(`ALTER TABLE files ADD COLUMN ocr_preview TEXT`);
  }
  return db;
}

export function db(): DatabaseSync {
  if (!globalForDb.__fcDb) globalForDb.__fcDb = open();
  return globalForDb.__fcDb;
}

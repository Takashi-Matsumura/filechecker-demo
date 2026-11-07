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

/**
 * DB ファイル（と WAL の付随ファイル）を本人だけが読み書きできる権限にする。SQLite は WAL の付随ファイルを
 * DB ファイルと同じ権限で作るので、DB ファイルを先に絞っておけばよい。Windows では権限の仕組みが違うので何もしない
 */
function restrictPermissions(dbPath: string) {
  if (process.platform === "win32") return;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.chmodSync(f, 0o600);
    } catch {
      // 付随ファイルがまだ無い場合など。権限を絞れなくても動作は続ける
    }
  }
}

function open(): DatabaseSync {
  // 保存先は、同じPCの他のユーザから読めないようにする（中身は伏せてあるが、パスや検出の結果は残る）
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.dbPath);
  restrictPermissions(config.dbPath);
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
  // AI の性能分析用の記録（本文は保存しない）。棚卸しの記録とは切り離してためる
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_calls (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id           INTEGER,
      file_id           INTEGER,
      ext               TEXT,
      kind              TEXT NOT NULL,          -- ocr | judge
      model             TEXT,
      prompt_version    TEXT NOT NULL,
      started_at        TEXT NOT NULL,
      duration_ms       INTEGER NOT NULL,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      ok                INTEGER NOT NULL,
      error_kind        TEXT,                   -- timeout | http | network | parse | aborted
      input_chars       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_calls_started ON ai_calls(started_at);
    -- 棚卸しの画面が2秒ごとに「最後の動き」を調べるため
    CREATE INDEX IF NOT EXISTS idx_ai_calls_scan ON ai_calls(scan_id);
    CREATE TABLE IF NOT EXISTS ai_file_stats (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id              INTEGER NOT NULL,
      file_id              INTEGER NOT NULL,
      ext                  TEXT,
      extract_method       TEXT,
      rule_level           TEXT,
      ai_ok                INTEGER NOT NULL,
      ai_risk              TEXT,
      final_risk           TEXT,
      ai_recommendation    TEXT,
      final_recommendation TEXT,
      names_ai             INTEGER NOT NULL DEFAULT 0,
      names_layout         INTEGER NOT NULL DEFAULT 0,
      names_both           INTEGER NOT NULL DEFAULT 0,
      readings_ai          INTEGER NOT NULL DEFAULT 0,
      readings_layout      INTEGER NOT NULL DEFAULT 0,
      readings_both        INTEGER NOT NULL DEFAULT 0,
      finding_types        TEXT,
      prompt_version       TEXT,
      created_at           TEXT NOT NULL
    );
  `);
  // 担当者の判断（「済」「対応しない」「戻す」）の記録。AI の推奨との比較に使う（本文・ファイル名は残さない）
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id              INTEGER NOT NULL,
      file_id              INTEGER NOT NULL,
      bucket               TEXT NOT NULL,     -- move | remove | tidy | check（押したときの区分）
      final_recommendation TEXT,
      risk                 TEXT,
      unread               INTEGER NOT NULL DEFAULT 0,  -- 中身を確認できなかったファイル
      status               TEXT NOT NULL,     -- todo | done | skipped
      prompt_version       TEXT,
      created_at           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_feedback_file ON ai_feedback(scan_id, file_id);
  `);
    // テストデータの正解を使った評価（npm run eval）の結果。数字だけを記録する
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_evals (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT NOT NULL,
      model          TEXT,
      judge_version  TEXT NOT NULL,
      ocr_version    TEXT NOT NULL,
      files          INTEGER NOT NULL,
      duration_ms    INTEGER NOT NULL,
      metrics_json   TEXT NOT NULL      -- 集計（EvalMetrics）
    );
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
  const evalCols = db.prepare(`PRAGMA table_info(ai_evals)`).all() as { name: string }[];
  if (!evalCols.some((c) => c.name === "dataset")) {
    // 評価に使ったテストデータ（sample = 標準 / hard = 難しい）
    db.exec(`ALTER TABLE ai_evals ADD COLUMN dataset TEXT NOT NULL DEFAULT 'sample'`);
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
  if (!fileCols.some((c) => c.name === "progress")) {
    // 処理中のファイルの段階（{ stage, step, total, startedAt, updatedAt } の JSON）。終わったら NULL に戻す。
    // 棚卸しの画面に「いま何をしているか」を出すため（ファイルが大きいと、1件終わるまで件数が動かない）
    db.exec(`ALTER TABLE files ADD COLUMN progress TEXT`);
  }
  return db;
}

export function db(): DatabaseSync {
  if (!globalForDb.__fcDb) globalForDb.__fcDb = open();
  return globalForDb.__fcDb;
}

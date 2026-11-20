// db.js — SQLite database (Node's built-in node:sqlite, no native install needed)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'finance-guru.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  worker_type   TEXT NOT NULL DEFAULT 'delivery',
  month_income  INTEGER NOT NULL DEFAULT 0,
  lean_bal      INTEGER NOT NULL DEFAULT 0,
  lean_target   INTEGER NOT NULL DEFAULT 30000,
  emer_bal      INTEGER NOT NULL DEFAULT 0,
  emer_target   INTEGER NOT NULL DEFAULT 15000,
  month_key     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  amount   INTEGER NOT NULL CHECK (amount > 0),
  note     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS expenses (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  amount   INTEGER NOT NULL CHECK (amount >= 0),
  icon     TEXT NOT NULL DEFAULT 'send',
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS activity (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('income','expense','buffer_save','buffer_draw')),
  amount   INTEGER NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  icon     TEXT NOT NULL DEFAULT 'box'
);

CREATE TABLE IF NOT EXISTS buffer_tx (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fund     TEXT NOT NULL CHECK (fund IN ('lean','emer')),
  kind     TEXT NOT NULL CHECK (kind IN ('dep','wd')),
  amount   INTEGER NOT NULL CHECK (amount > 0),
  note     TEXT NOT NULL DEFAULT '',
  date     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key TEXT NOT NULL,             -- 'YYYY-MM', used for ordering
  month    TEXT NOT NULL,              -- 'Nov'
  year     TEXT NOT NULL,              -- '26'
  income   INTEGER NOT NULL DEFAULT 0,
  saved    INTEGER NOT NULL DEFAULT 0,
  lean_dep INTEGER NOT NULL DEFAULT 0,
  emer_dep INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, month_key)
);

CREATE TABLE IF NOT EXISTS sms_seen (       -- de-duplicates imported SMS (stores only a hash, never the text)
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash     TEXT NOT NULL,
  date     TEXT NOT NULL,
  PRIMARY KEY (user_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_income_user   ON income(user_id, date);
CREATE INDEX IF NOT EXISTS idx_exp_user      ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_act_user      ON activity(user_id, date);
CREATE INDEX IF NOT EXISTS idx_btx_user      ON buffer_tx(user_id, fund, date);
CREATE INDEX IF NOT EXISTS idx_hist_user     ON history(user_id, month_key);
`);

/** Run fn inside a transaction; roll back on any error. */
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx, DATA_DIR };

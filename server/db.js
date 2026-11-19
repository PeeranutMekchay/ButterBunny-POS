// SQLite access through Node's built-in node:sqlite (no native build step on Windows/macOS/Linux).
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  migrate(db);
  return db;
}

// Columns added after the first release: added in place so existing shop databases keep their data.
const COLUMNS = [
  ["members", "birthday", "TEXT"],   // "MM-DD"
  ["orders", "shift_id", "TEXT"],
  ["orders", "manual_by", "TEXT"],   // who approved the special discount
];
function migrate(db) {
  for (const [table, col, type] of COLUMNS) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

// Runs fn inside one write transaction; rolls back on any error.
function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

const b = v => (v ? 1 : 0);
const json = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

module.exports = { openDb, tx, b, json };

// Database backups: a consistent copy made with VACUUM INTO, kept for the last 30 days.
const fs = require("node:fs");
const path = require("node:path");

const KEEP = 30;
const NAME_RE = /^butterbunny-\d{8}-\d{4}\.db$/;
const pad = n => String(n).padStart(2, "0");

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => NAME_RE.test(f)).sort().reverse()
    .map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, createdAt: st.mtimeMs }; });
}
const { json } = require("./db");
const getCopy = db => ({ copyDir: "", ...json(db.prepare("SELECT value FROM config WHERE key = 'backup'").get()?.value, {}) });
const meta = (db, k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value || null;
const setMeta = (db, k, v) => db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
const publicCopy = db => ({ copyDir: getCopy(db).copyDir, lastCopy: meta(db, "backup_copy_ok"), lastCopyError: meta(db, "backup_copy_error") });

// checks that the folder exists (or can be made) and accepts files
function checkFolder(dir) {
  if (!path.isAbsolute(dir)) throw Object.assign(new Error("ใส่ตำแหน่งโฟลเดอร์แบบเต็ม เช่น G:\\My Drive\\ButterBunny"), { status: 400 });
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, ".butterbunny-write-test");
  fs.writeFileSync(probe, "ok"); fs.unlinkSync(probe);
}
function saveCopy(db, { copyDir }) {
  const dir = String(copyDir || "").trim();
  if (dir) { try { checkFolder(dir); } catch (e) { throw Object.assign(new Error(e.status ? e.message : "เขียนไฟล์ลงโฟลเดอร์นี้ไม่ได้: " + e.message), { status: 400 }); } }
  db.prepare("INSERT INTO config (key, value) VALUES ('backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ copyDir: dir }));
  return publicCopy(db);
}
// copy the newest backup to the second folder and keep 30 there too; returns an error message or null
function copyOut(db, file) {
  const { copyDir } = getCopy(db);
  if (!copyDir) return null;
  try {
    checkFolder(copyDir);
    fs.copyFileSync(file, path.join(copyDir, path.basename(file)));
    for (const old of listBackups(copyDir).slice(KEEP)) fs.unlinkSync(path.join(copyDir, old.name));
    setMeta(db, "backup_copy_ok", String(Date.now())); db.prepare("DELETE FROM meta WHERE key = 'backup_copy_error'").run();
    return null;
  } catch (e) {
    const msg = `คัดลอกไปที่ ${copyDir} ไม่สำเร็จ: ${e.message}`;
    setMeta(db, "backup_copy_error", `${new Date().toLocaleString("th-TH")} · ${msg}`);
    return msg;
  }
}

function backupNow(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  let name = `butterbunny-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file); // same minute: replace
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups(dir).slice(KEEP)) fs.unlinkSync(path.join(dir, old.name));
  const copyError = copyOut(db, file);
  return { ...listBackups(dir)[0], copyError };
}
const backupPath = (dir, name) => (NAME_RE.test(String(name)) ? path.join(dir, name) : null);

module.exports = { listBackups, backupNow, backupPath, KEEP, publicCopy, saveCopy };

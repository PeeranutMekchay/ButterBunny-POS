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
function backupNow(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  let name = `butterbunny-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file); // same minute: replace
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups(dir).slice(KEEP)) fs.unlinkSync(path.join(dir, old.name));
  return listBackups(dir)[0];
}
const backupPath = (dir, name) => (NAME_RE.test(String(name)) ? path.join(dir, name) : null);

module.exports = { listBackups, backupNow, backupPath, KEEP };

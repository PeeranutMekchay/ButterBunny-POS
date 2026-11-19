// Entry point: opens the database, loads starter data on first run, and serves the POS.
const path = require("node:path");
const os = require("node:os");
const { openDb } = require("./db");
const { seedIfEmpty, addExtras } = require("./seed");
const { createApp } = require("./app");

const DATA = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const db = openDb(process.env.DB_FILE || path.join(DATA, "butterbunny.db"));
if (seedIfEmpty(db)) console.log("โหลดเมนู โปรโมชั่น และของรางวัลเริ่มต้นแล้ว");
{ const n = addExtras(db); if (n) console.log(`เพิ่มเมนูใหม่ ${n} รายการ (เค้กปอนด์)`); }
const backupDir = path.join(DATA, "backups");
const app = createApp({ db, uploadsDir: path.join(DATA, "uploads"), backupDir });
require("./jobs").startJobs(db, { backupDir, backupHour: Number(process.env.BACKUP_HOUR ?? 3) });

app.listen(PORT, HOST, () => {
  console.log(`\nButter Bunny POS พร้อมใช้งาน`);
  console.log(`  เครื่องนี้:        http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`  เครื่องอื่นใน Wi-Fi: http://${a.address}:${PORT}`);
  console.log(`  ฐานข้อมูล:         ${path.resolve(process.env.DB_FILE || path.join(DATA, "butterbunny.db"))}\n`);
});

const stop = () => { try { db.close(); } catch {} process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

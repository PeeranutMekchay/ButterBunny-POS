// Background jobs, checked every 5 minutes:
//  • nightly backup (at 03:00, or on start if the last one is older than a day)
//  • LINE reminder of tomorrow's pre-order pickups (once a day at the configured hour)
const R = require("./repo");
const O = require("./ops");
const N = require("./notify");
const B = require("./backup");

function startJobs(db, { backupDir, backupHour = 3 }) {
  const meta = k => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value || null;
  const tick = () => {
    const now = new Date();
    try {
      const last = B.listBackups(backupDir)[0];
      const due = !last || now - last.createdAt > 24 * 3600e3 || (now.getHours() === backupHour && now - last.createdAt > 2 * 3600e3);
      if (due) { const b = B.backupNow(db, backupDir); console.log(`สำรองข้อมูลแล้ว: ${b.name}`); }
    } catch (e) {
      console.error("สำรองข้อมูลไม่สำเร็จ:", e.message);
      const l = N.getLine(db); if (l.enabled && l.events.backupFail) N.send(db, `❗ สำรองข้อมูลไม่สำเร็จ: ${e.message}`);
    }
    try {
      const l = N.getLine(db), today = R.bday(db, now);
      if (l.enabled && l.events.preorderDue && now.getHours() >= l.reminderHour && meta("line_preorder_reminded") !== today) {
        N.setMeta(db, "line_preorder_reminded", today);
        const tomorrow = R.shiftDays(today, 1);
        const list = O.listPreorders(db, { from: tomorrow, to: tomorrow }).filter(p => ["pending", "ready"].includes(p.status));
        if (list.length) N.send(db, N.preorderDueText(tomorrow, list));
      }
    } catch (e) { console.error("แจ้งเตือนออเดอร์ล่วงหน้าไม่สำเร็จ:", e.message); }
  };
  tick();
  return setInterval(tick, 5 * 60 * 1000);
}

module.exports = { startJobs };

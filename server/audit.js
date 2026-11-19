// Audit trail: who changed prices, stock, points, staff, settings, voids and discounts, and when.
const { json } = require("./db");

function log(db, staff, action, target = "", detail = null) {
  try {
    db.prepare("INSERT INTO audit_log (created_at, staff_name, action, target, detail) VALUES (?, ?, ?, ?, ?)")
      .run(Date.now(), staff ? staff.name : null, action, String(target || "").slice(0, 120), detail == null ? null : JSON.stringify(detail).slice(0, 4000));
  } catch (e) { console.error("บันทึกประวัติไม่สำเร็จ:", e.message); }
}

// before/after for the fields that matter; empty when nothing changed
function changes(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a ?? null, b ?? null];
  }
  return out;
}

function list(db, { from, to, q, limit = 300 } = {}) {
  const where = [], args = [];
  if (from) { where.push("created_at >= ?"); args.push(from); }
  if (to) { where.push("created_at < ?"); args.push(to); }
  if (q) { where.push("(staff_name LIKE ? OR action LIKE ? OR target LIKE ? OR detail LIKE ?)"); const like = "%" + q + "%"; args.push(like, like, like, like); }
  const rows = db.prepare(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(1000, Math.max(1, limit)));
  return rows.map(r => ({ id: r.id, createdAt: r.created_at, staffName: r.staff_name, action: r.action, target: r.target, detail: json(r.detail, null) }));
}

module.exports = { log, changes, list };

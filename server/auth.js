// Staff sign-in with a 4-digit PIN. PINs are stored as scrypt hashes; sessions are random bearer tokens.
const crypto = require("node:crypto");
const { tx } = require("./db");
const { HttpError, str, staffOut, listStaff } = require("./repo");

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5, LOCK_MS = 30 * 1000;
const fails = new Map(); // staffId -> {count, until}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
function checkPin(row, pin) {
  const a = Buffer.from(hashPin(pin, row.pin_salt), "hex"), b = Buffer.from(row.pin_hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function pinFields(pin) {
  if (!/^\d{4}$/.test(String(pin || ""))) throw new HttpError(400, "PIN ต้องเป็นตัวเลข 4 หลัก");
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPin(pin, salt) };
}

function createSession(db, staffId) {
  const token = crypto.randomBytes(32).toString("hex"), t = Date.now();
  db.prepare("INSERT INTO sessions (token, staff_id, created_at, last_seen) VALUES (?, ?, ?, ?)").run(token, staffId, t, t);
  db.prepare("DELETE FROM sessions WHERE last_seen < ?").run(t - SESSION_IDLE_MS);
  return token;
}
function staffForToken(db, token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const r = db.prepare("SELECT s.*, x.last_seen FROM sessions x JOIN staff s ON s.id = x.staff_id WHERE x.token = ?").get(token);
  if (!r || !r.active || r.last_seen < Date.now() - SESSION_IDLE_MS) return null;
  if (Date.now() - r.last_seen > 60 * 1000) db.prepare("UPDATE sessions SET last_seen = ? WHERE token = ?").run(Date.now(), token);
  return staffOut(r);
}

function setup(db, {name, pin}) {
  const { salt, hash } = pinFields(pin);
  const nm = str(name, 40, "ชื่อผู้จัดการ", {required: true});
  return tx(db, () => {
    if (db.prepare("SELECT COUNT(*) n FROM staff").get().n > 0) throw new HttpError(409, "ร้านนี้ตั้งค่าผู้จัดการไว้แล้ว ให้ล็อกอินแทน");
    const sid = "u" + crypto.randomBytes(6).toString("hex");
    db.prepare("INSERT INTO staff (id, name, role, active, pin_salt, pin_hash, created_at) VALUES (?, ?, 'manager', 1, ?, ?, ?)").run(sid, nm, salt, hash, Date.now());
    return { token: createSession(db, sid), staff: { id: sid, name: nm, role: "manager", active: true } };
  });
}

function login(db, {staffId, pin}) {
  const row = db.prepare("SELECT * FROM staff WHERE id = ? AND active = 1").get(String(staffId || ""));
  if (!row) throw new HttpError(404, "ไม่พบพนักงานคนนี้");
  const f = fails.get(row.id);
  if (f && f.until > Date.now()) throw new HttpError(429, `ใส่รหัสผิดหลายครั้ง รอ ${Math.ceil((f.until - Date.now()) / 1000)} วินาที`);
  if (!checkPin(row, pin)) {
    const n = (f?.until ? 0 : f?.count || 0) + 1; // an expired lock starts the count again
    fails.set(row.id, n >= MAX_FAILS ? { count: 0, until: Date.now() + LOCK_MS } : { count: n, until: 0 });
    throw new HttpError(401, "รหัส PIN ไม่ถูกต้อง");
  }
  fails.delete(row.id);
  return { token: createSession(db, row.id), staff: staffOut(row) };
}
const logout = (db, token) => db.prepare("DELETE FROM sessions WHERE token = ?").run(token);

function saveStaff(db, sid, d, me) {
  const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(sid);
  const name = str(d.name, 40, "ชื่อพนักงาน", {required: true});
  const role = d.role === "manager" ? "manager" : "cashier", active = d.active !== false;
  if (!existing && !d.pin) throw new HttpError(400, "ตั้ง PIN 4 หลักให้พนักงานใหม่");
  const pinF = d.pin ? pinFields(d.pin) : null;
  return tx(db, () => {
    const others = db.prepare("SELECT COUNT(*) n FROM staff WHERE role = 'manager' AND active = 1 AND id != ?").get(sid).n;
    if (!others && (role !== "manager" || !active)) throw new HttpError(400, "ร้านต้องมีผู้จัดการที่เปิดใช้งานอย่างน้อย 1 คน");
    if (existing) {
      db.prepare("UPDATE staff SET name = ?, role = ?, active = ? WHERE id = ?").run(name, role, active ? 1 : 0, sid);
      if (pinF) db.prepare("UPDATE staff SET pin_salt = ?, pin_hash = ? WHERE id = ?").run(pinF.salt, pinF.hash, sid);
      // Deactivating signs the person out everywhere; a new PIN signs out their other devices.
      if (!active || (pinF && sid !== me.id)) db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(sid);
    } else {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) throw new HttpError(400, "รหัสพนักงานไม่ถูกต้อง");
      db.prepare("INSERT INTO staff (id, name, role, active, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(sid, name, role, active ? 1 : 0, pinF.salt, pinF.hash, Date.now());
    }
    return listStaff(db).find(s => s.id === sid);
  });
}
function deleteStaff(db, sid, me) {
  if (sid === me.id) throw new HttpError(400, "ลบบัญชีของตัวเองไม่ได้");
  tx(db, () => {
    const row = db.prepare("SELECT * FROM staff WHERE id = ?").get(sid);
    if (!row) throw new HttpError(404, "ไม่พบพนักงานคนนี้");
    if (row.role === "manager" && !db.prepare("SELECT COUNT(*) n FROM staff WHERE role = 'manager' AND active = 1 AND id != ?").get(sid).n) throw new HttpError(400, "ลบผู้จัดการคนสุดท้ายไม่ได้");
    db.prepare("DELETE FROM staff WHERE id = ?").run(sid);
  });
}

module.exports = { setup, login, logout, staffForToken, saveStaff, deleteStaff };

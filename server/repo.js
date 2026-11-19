// Data access: row ↔ API object mapping, validation and catalog CRUD.
const { tx, b, json } = require("./db");
const { DEFAULT_SHOP, businessDay } = require("../shared/pricing");

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = msg => new HttpError(400, msg);

const CATS = ["bread", "cake", "coffee", "drink", "other"];
const SWEET = ["0%", "25%", "50%", "100%", "120%"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^0\d{8,9}$/;

const str = (v, max, label, {required = false} = {}) => {
  const s = v == null ? "" : String(v).trim();
  if (required && !s) throw bad(`กรุณาใส่${label}`);
  if (s.length > max) throw bad(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return s;
};
const num = (v, label, {min = 0, max = 1e7, int = false} = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`${label}ไม่ถูกต้อง`);
  return int ? n : Math.round(n * 100) / 100;
};
const birthday = v => {
  if (v == null || v === "") return null;
  const m = String(v).match(/^(\d{2})-(\d{2})$/);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) throw bad("วันเกิดไม่ถูกต้อง");
  return m[0];
};
const id = (v, label = "รหัส") => { if (!ID_RE.test(String(v || ""))) throw bad(`${label}ไม่ถูกต้อง`); return String(v); };
const imgUrl = v => {
  if (v == null || v === "") return null;
  const s = String(v);
  if (!/^\/(uploads|assets)\/[A-Za-z0-9_./-]+$/.test(s) || s.includes("..")) throw bad("ที่อยู่รูปภาพไม่ถูกต้อง");
  return s;
};
const now = () => Date.now();

/* ---------- mappers ---------- */
const menuOut = r => ({ id: r.id, name: r.name, cat: r.cat, price: r.price, active: !!r.active, trackStock: !!r.track_stock, sweet: !!r.sweet, opts: json(r.opts, []), img: r.img, order: r.sort });
const rewardOut = r => ({ id: r.id, name: r.name, kind: r.kind, itemId: r.item_id, value: r.value, points: r.points, blurb: r.blurb, active: !!r.active, limited: !!r.limited, img: r.img });
const memberOut = r => ({ id: r.phone, name: r.name, birthday: r.birthday || null, points: r.points, visits: r.visits, spent: r.spent, createdAt: r.created_at, lastVisit: r.last_visit });
const staffOut = r => ({ id: r.id, name: r.name, role: r.role, active: !!r.active });
const redeemOut = r => ({ id: r.id, day: r.day, createdAt: r.created_at, memberId: r.member_phone, memberName: r.member_name, rewardId: r.reward_id, rewardName: r.reward_name,
  kind: r.kind, qty: r.qty, points: r.points, staffName: r.staff_name, via: r.via, orderId: r.order_id, voided: !!r.voided, voidAt: r.void_at, voidBy: r.void_by, restocked: !!r.restocked });
function orderOut(r, items) {
  return { id: r.id, day: r.day, queue: r.queue, createdAt: r.created_at, type: r.type, status: r.status, pay: r.pay, ref: r.ref,
    items: items.map(i => ({ id: i.menu_id, name: i.name, cat: i.cat, unit: i.unit, qty: i.qty, opt: i.opt, sweet: i.sweet, reward: i.reward_id, pts: i.pts })),
    subtotal: r.subtotal, promos: json(r.promos, []), promoTotal: r.promo_total, manual: r.manual, pointsUsed: r.points_used, pointsDisc: r.points_disc,
    voucherName: r.voucher_name, total: r.total, vat: r.vat, tendered: r.tendered, change: r.change, note: r.note,
    memberId: r.member_phone, memberName: r.member_name, pointsEarned: r.points_earned, staffId: r.staff_id, staffName: r.staff_name,
    readyAt: r.ready_at, doneAt: r.done_at, voidReason: r.void_reason, voidBy: r.void_by, voidAt: r.void_at, shiftId: r.shift_id, manualBy: r.manual_by };
}

/* ---------- reads ---------- */
const getShop = db => ({ ...DEFAULT_SHOP, ...json(db.prepare("SELECT value FROM config WHERE key = 'shop'").get()?.value, {}) });
// today's business day (respects the shop's day start hour)
const bday = (db, now = new Date()) => businessDay(now, getShop(db).dayStartHour);
const shiftDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const listMenu = db => db.prepare("SELECT * FROM menu ORDER BY cat, sort, name").all().map(menuOut);
const getMenu = (db, mid) => { const r = db.prepare("SELECT * FROM menu WHERE id = ?").get(mid); return r ? menuOut(r) : null; };
const listStock = db => Object.fromEntries(db.prepare("SELECT id, qty FROM stock").all().map(r => [r.id, { qty: r.qty }]));
const stockQty = (db, sid) => db.prepare("SELECT qty FROM stock WHERE id = ?").get(sid)?.qty ?? null;
const listPromos = db => db.prepare("SELECT id, data FROM promos ORDER BY updated_at").all().map(r => ({ id: r.id, ...json(r.data, {}) }));
const listRewards = db => db.prepare("SELECT * FROM rewards ORDER BY points").all().map(rewardOut);
const getReward = (db, rid) => { const r = db.prepare("SELECT * FROM rewards WHERE id = ?").get(rid); return r ? rewardOut(r) : null; };
const listMembers = db => db.prepare("SELECT * FROM members ORDER BY COALESCE(last_visit, created_at) DESC").all().map(memberOut);
const getMember = (db, phone) => { const r = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone); return r ? memberOut(r) : null; };
const listStaff = (db, {activeOnly = false} = {}) => db.prepare(`SELECT * FROM staff ${activeOnly ? "WHERE active = 1" : ""} ORDER BY created_at`).all().map(staffOut);

function listOrders(db, from, to) {
  const rows = db.prepare("SELECT * FROM orders WHERE day BETWEEN ? AND ? ORDER BY created_at").all(from, to);
  if (!rows.length) return [];
  const items = db.prepare("SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.day BETWEEN ? AND ? ORDER BY oi.order_id, oi.line").all(from, to);
  const by = {}; for (const i of items) (by[i.order_id] ||= []).push(i);
  return rows.map(r => orderOut(r, by[r.id] || []));
}
function getOrder(db, oid) {
  const r = db.prepare("SELECT * FROM orders WHERE id = ?").get(oid);
  return r ? orderOut(r, db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY line").all(oid)) : null;
}
const listRedeems = (db, from, to) => db.prepare("SELECT * FROM redeems WHERE day BETWEEN ? AND ? ORDER BY created_at").all(from, to).map(redeemOut);

/* ---------- catalog writes ---------- */
function saveMenu(db, mid, d) {
  mid = id(mid, "รหัสเมนู");
  const name = str(d.name, 60, "ชื่อเมนู", {required: true});
  if (!CATS.includes(d.cat)) throw bad("หมวดเมนูไม่ถูกต้อง");
  const opts = Array.isArray(d.opts) ? d.opts : [];
  if (opts.length > 8) throw bad("ตัวเลือกมีได้ไม่เกิน 8 แบบ");
  const cleanOpts = opts.map(o => ({ name: str(o?.name, 30, "ชื่อตัวเลือก", {required: true}), add: num(o?.add ?? 0, "ราคาบวกเพิ่ม") }));
  if (new Set(cleanOpts.map(o => o.name)).size !== cleanOpts.length) throw bad("ชื่อตัวเลือกซ้ำกัน");
  const row = [name, d.cat, num(d.price, "ราคา"), b(d.active !== false), b(d.trackStock), b(d.sweet), JSON.stringify(cleanOpts), imgUrl(d.img), num(d.order ?? 0, "ลำดับ", {int: true, min: -1e6, max: 1e6}), now()];
  return tx(db, () => {
    db.prepare(`INSERT INTO menu (name, cat, price, active, track_stock, sweet, opts, img, sort, updated_at, id) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, cat=excluded.cat, price=excluded.price, active=excluded.active, track_stock=excluded.track_stock,
      sweet=excluded.sweet, opts=excluded.opts, img=excluded.img, sort=excluded.sort, updated_at=excluded.updated_at`).run(...row, mid);
    if (d.trackStock) {
      if (d.stock != null && d.stock !== "") setStock(db, mid, num(d.stock, "จำนวนสต็อก", {int: true}));
      else db.prepare("INSERT OR IGNORE INTO stock (id, qty) VALUES (?, 0)").run(mid);
    }
    return getMenu(db, mid);
  });
}
function deleteMenu(db, mid) {
  tx(db, () => { db.prepare("DELETE FROM menu WHERE id = ?").run(id(mid)); db.prepare("DELETE FROM stock WHERE id = ?").run(mid); });
}
function setStock(db, sid, qty) {
  db.prepare("INSERT INTO stock (id, qty) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET qty = excluded.qty").run(sid, Math.max(0, Math.floor(qty)));
}
function addStock(db, sid, delta) {
  db.prepare("INSERT INTO stock (id, qty) VALUES (?, MAX(0, ?)) ON CONFLICT(id) DO UPDATE SET qty = MAX(0, qty + ?)").run(sid, delta, delta);
}

const PROMO_TYPES = ["percent", "amount", "bxgy", "minspend"];
function savePromo(db, pid, d) {
  pid = id(pid, "รหัสโปร");
  if (!PROMO_TYPES.includes(d.type)) throw bad("ประเภทโปรไม่ถูกต้อง");
  const scope = d.type === "minspend" ? "all" : d.scope;
  if (!["all", "cat", "items"].includes(scope)) throw bad("ขอบเขตโปรไม่ถูกต้อง");
  if (scope === "cat" && !CATS.includes(d.cat)) throw bad("เลือกหมวดของโปรก่อน");
  const items = scope === "items" ? (Array.isArray(d.items) ? d.items.map(x => id(x, "รหัสเมนู")) : []) : [];
  if (scope === "items" && !items.length) throw bad("เลือกเมนูที่ร่วมโปรอย่างน้อย 1 รายการ");
  const days = Array.isArray(d.days) ? [...new Set(d.days.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
  const start = d.start || null, end = d.end || null;
  if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end)) || (!!start !== !!end)) throw bad("ใส่เวลาเริ่มและเวลาสิ้นสุดให้ครบและถูกรูปแบบ");
  const from = d.from || null, to = d.to || null;
  if ((from && !DAY_RE.test(from)) || (to && !DAY_RE.test(to))) throw bad("วันที่ของโปรไม่ถูกต้อง");
  const code = d.code ? String(d.code).trim().toUpperCase() : null;
  if (code && !/^[A-Z0-9_-]{2,20}$/.test(code)) throw bad("โค้ดคูปองใช้ได้เฉพาะ A-Z, 0-9 ยาว 2–20 ตัว");
  const data = { name: str(d.name, 40, "ชื่อโปร", {required: true}), type: d.type, scope, cat: scope === "cat" ? d.cat : null, items,
    value: num(d.value ?? 0, "มูลค่าโปร", {max: d.type === "percent" || d.unit === "percent" ? 100 : 1e6}),
    buy: num(d.buy ?? 1, "จำนวนซื้อ", {min: 1, max: 99, int: true}), get: num(d.get ?? 1, "จำนวนแถม", {min: 1, max: 99, int: true}),
    min: num(d.min ?? 0, "ยอดขั้นต่ำ"), unit: d.unit === "percent" ? "percent" : "baht", days, start, end, from, to, code, active: d.active !== false };
  db.prepare("INSERT INTO promos (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(pid, JSON.stringify(data), now());
  return { id: pid, ...data };
}
function setPromoActive(db, pid, active) {
  const r = db.prepare("SELECT data FROM promos WHERE id = ?").get(pid);
  if (!r) throw new HttpError(404, "ไม่พบโปรโมชั่นนี้");
  db.prepare("UPDATE promos SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ...json(r.data, {}), active: !!active }), now(), pid);
}

function saveReward(db, rid, d) {
  rid = id(rid, "รหัสของรางวัล");
  if (!["item", "gift", "discount"].includes(d.kind)) throw bad("ประเภทของรางวัลไม่ถูกต้อง");
  const itemId = d.kind === "item" ? id(d.itemId, "เมนูที่ให้ฟรี") : null;
  if (itemId && !getMenu(db, itemId)) throw bad("ไม่พบเมนูที่ให้ฟรี");
  const value = d.kind === "discount" ? num(d.value, "มูลค่าส่วนลด", {min: 1}) : 0;
  const limited = d.stock != null && d.stock !== "";
  const row = [str(d.name, 50, "ชื่อของรางวัล", {required: true}), d.kind, itemId, value, num(d.points, "จำนวนแต้ม", {min: 1, max: 1e6, int: true}),
    str(d.blurb, 60, "คำบรรยาย"), b(d.active !== false), b(limited), imgUrl(d.img), now()];
  return tx(db, () => {
    db.prepare(`INSERT INTO rewards (name, kind, item_id, value, points, blurb, active, limited, img, updated_at, id) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, item_id=excluded.item_id, value=excluded.value, points=excluded.points,
      blurb=excluded.blurb, active=excluded.active, limited=excluded.limited, img=excluded.img, updated_at=excluded.updated_at`).run(...row, rid);
    if (limited) setStock(db, "rw-" + rid, num(d.stock, "จำนวนของรางวัล", {int: true}));
    else db.prepare("DELETE FROM stock WHERE id = ?").run("rw-" + rid);
    return getReward(db, rid);
  });
}
function deleteReward(db, rid) {
  tx(db, () => { db.prepare("DELETE FROM rewards WHERE id = ?").run(id(rid)); db.prepare("DELETE FROM stock WHERE id = ?").run("rw-" + rid); });
}

function createMember(db, d) {
  const phone = String(d.phone || "").replace(/\D/g, "");
  if (!PHONE_RE.test(phone)) throw bad("เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก");
  if (getMember(db, phone)) throw new HttpError(409, "เบอร์นี้เป็นสมาชิกอยู่แล้ว");
  db.prepare("INSERT INTO members (phone, name, birthday, created_at) VALUES (?, ?, ?, ?)").run(phone, str(d.name, 40, "ชื่อเล่น"), birthday(d.birthday), now());
  return getMember(db, phone);
}
function updateMember(db, phone, d, staff) {
  const m = getMember(db, phone); if (!m) throw new HttpError(404, "ไม่พบสมาชิกนี้");
  return tx(db, () => {
    if (d.name !== undefined) db.prepare("UPDATE members SET name = ? WHERE phone = ?").run(str(d.name, 40, "ชื่อเล่น"), phone);
    if (d.birthday !== undefined) db.prepare("UPDATE members SET birthday = ? WHERE phone = ?").run(birthday(d.birthday), phone);
    if (d.points !== undefined) {
      if (staff.role !== "manager") throw new HttpError(403, "เฉพาะผู้จัดการที่แก้แต้มได้");
      const p = num(d.points, "แต้มสะสม", {int: true, max: 1e7});
      if (p !== m.points) {
        db.prepare("UPDATE members SET points = ? WHERE phone = ?").run(p, phone);
        db.prepare("INSERT INTO point_ledger (member_phone, delta, reason, staff_name, created_at) VALUES (?, ?, 'adjust', ?, ?)").run(phone, p - m.points, staff.name, now());
      }
    }
    return getMember(db, phone);
  });
}
function deleteMember(db, phone) {
  const r = db.prepare("DELETE FROM members WHERE phone = ?").run(phone);
  if (!r.changes) throw new HttpError(404, "ไม่พบสมาชิกนี้");
}

const SHOP_LIMITS = { name: 50, tagline: 60, branch: 40, address: 120, phone: 20, taxId: 13, footer: 80 };
function saveShop(db, d) {
  const out = { ...getShop(db) };
  for (const [k, max] of Object.entries(SHOP_LIMITS)) if (d[k] !== undefined) out[k] = str(d[k], max, "ข้อมูลร้าน");
  if (!out.name) out.name = DEFAULT_SHOP.name;
  if (d.promptpay !== undefined) {
    const pp = String(d.promptpay || "").replace(/\D/g, "");
    if (pp && !(pp.length === 10 && pp[0] === "0") && pp.length !== 13 && pp.length !== 15) throw bad("หมายเลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13/15 หลัก");
    out.promptpay = pp;
  }
  if (d.vat !== undefined) out.vat = d.vat === "incl" ? "incl" : "none";
  if (d.pointsPer !== undefined) out.pointsPer = num(d.pointsPer, "อัตราแต้ม", {min: 1, max: 10000, int: true});
  if (d.dayStartHour !== undefined) out.dayStartHour = num(d.dayStartHour, "เวลาเริ่มวันใหม่", {min: 0, max: 6, int: true});
  if (d.birthdayMultiplier !== undefined) out.birthdayMultiplier = num(d.birthdayMultiplier, "ตัวคูณแต้มเดือนเกิด", {min: 1, max: 5, int: true});
  if (d.discountLimitBaht !== undefined) out.discountLimitBaht = num(d.discountLimitBaht, "เพดานส่วนลดของแคชเชียร์ (บาท)", {min: 0, max: 1e5});
  if (d.discountLimitPct !== undefined) out.discountLimitPct = num(d.discountLimitPct, "เพดานส่วนลดของแคชเชียร์ (%)", {min: 0, max: 100});
  if (d.poundPrice !== undefined) out.poundPrice = num(d.poundPrice, "ราคาเค้กต่อปอนด์", {min: 1, max: 1e5});
  if (d.lowStockAt !== undefined) out.lowStockAt = num(d.lowStockAt, "จำนวนแจ้งเตือนสต็อก", {min: 0, max: 999, int: true});
  db.prepare("INSERT INTO config (key, value) VALUES ('shop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return out;
}

module.exports = {
  HttpError, bad, CATS, SWEET, PHONE_RE, DAY_RE, str, num, id, bday, shiftDays,
  menuOut, rewardOut, memberOut, staffOut, orderOut, redeemOut,
  getShop, listMenu, getMenu, listStock, stockQty, listPromos, listRewards, getReward, listMembers, getMember, listStaff,
  listOrders, getOrder, listRedeems,
  saveMenu, deleteMenu, setStock, addStock, savePromo, setPromoActive, saveReward, deleteReward,
  createMember, updateMember, deleteMember, saveShop
};

// Shop operations beyond the sale itself: shifts & cash drawer, cake pre-orders,
// end-of-day waste, bake planning, the owner dashboard and the customer queue screen.
const { tx, json } = require("./db");
const pricing = require("../shared/pricing");
const R = require("./repo");
const { newId } = require("./services");
const { HttpError, bad } = R;
const r2 = pricing.r2;

const ledger = (db, phone, delta, reason, ref, staff) => {
  if (delta) db.prepare("INSERT INTO point_ledger (member_phone, delta, reason, ref, staff_name, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(phone, delta, reason, ref, staff, Date.now());
};
const PAYS = ["cash", "qr", "card"];
const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

/* =================== shifts =================== */
const openShiftRow = db => db.prepare("SELECT * FROM shifts WHERE closed_at IS NULL").get();
function requireShift(db) {
  const s = openShiftRow(db);
  if (!s) throw new HttpError(409, "ยังไม่ได้เปิดกะ กดเปิดกะก่อน");
  return s;
}

// Everything the drawer should hold for one shift, computed from the records.
function shiftSummary(db, s) {
  const orders = db.prepare("SELECT pay, status, total FROM orders WHERE shift_id = ?").all(s.id);
  const ok = orders.filter(o => o.status !== "void"), voids = orders.filter(o => o.status === "void");
  const byPay = { cash: 0, qr: 0, card: 0 };
  for (const o of ok) byPay[o.pay] = r2(byPay[o.pay] + o.total);
  const pre = { cash: 0, qr: 0, card: 0 };
  for (const p of db.prepare("SELECT pay, amount FROM preorder_payments WHERE shift_id = ?").all(s.id)) pre[p.pay] = r2(pre[p.pay] + p.amount);
  const moves = db.prepare("SELECT * FROM cash_moves WHERE shift_id = ? ORDER BY created_at").all(s.id)
    .map(m => ({ id: m.id, createdAt: m.created_at, kind: m.kind, amount: m.amount, reason: m.reason, staffName: m.staff_name }));
  const cashIn = r2(moves.filter(m => m.kind === "in").reduce((a, m) => a + m.amount, 0));
  const cashOut = r2(moves.filter(m => m.kind === "out").reduce((a, m) => a + m.amount, 0));
  const expectedCash = r2(s.opening_cash + byPay.cash + pre.cash + cashIn - cashOut);
  return { bills: ok.length, sales: r2(ok.reduce((a, o) => a + o.total, 0)), byPay, voids: voids.length, voidTotal: r2(voids.reduce((a, o) => a + o.total, 0)),
    preorder: pre, cashIn, cashOut, moves, expectedCash };
}
function shiftOut(db, s) {
  if (!s) return null;
  const live = s.closed_at ? json(s.summary, {}) : shiftSummary(db, s);
  return { id: s.id, openedAt: s.opened_at, openedBy: s.opened_by, openingCash: s.opening_cash, closedAt: s.closed_at, closedBy: s.closed_by,
    countedCash: s.counted_cash, expectedCash: s.closed_at ? s.expected_cash : live.expectedCash, diff: s.closed_at ? r2(s.counted_cash - s.expected_cash) : null,
    counts: json(s.counts, null), note: s.note, summary: live };
}
const currentShift = db => shiftOut(db, openShiftRow(db));
const listShifts = (db, limit = 30) => db.prepare("SELECT * FROM shifts ORDER BY opened_at DESC LIMIT ?").all(limit).map(s => shiftOut(db, s));

function openShift(db, { openingCash }, staff) {
  const cash = R.num(openingCash ?? 0, "เงินทอนตั้งต้น", { max: 1e6 });
  return tx(db, () => {
    if (openShiftRow(db)) throw new HttpError(409, "มีกะที่เปิดอยู่แล้ว");
    const id = newId("s");
    db.prepare("INSERT INTO shifts (id, opened_at, opened_by, opening_cash) VALUES (?, ?, ?, ?)").run(id, Date.now(), staff.name, cash);
    return currentShift(db);
  });
}
function addCashMove(db, { kind, amount, reason }, staff) {
  if (!["in", "out"].includes(kind)) throw bad("เลือกเงินเข้าหรือเงินออก");
  const amt = R.num(amount, "จำนวนเงิน", { min: 0.01, max: 1e6 });
  const why = R.str(reason, 80, "เหตุผล", { required: true });
  return tx(db, () => {
    const s = requireShift(db);
    db.prepare("INSERT INTO cash_moves (id, shift_id, created_at, kind, amount, reason, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)").run(newId("c"), s.id, Date.now(), kind, amt, why, staff.name);
    return currentShift(db);
  });
}
function closeShift(db, { counts, counted, note }, staff) {
  let total = 0, clean = null;
  if (counts && typeof counts === "object") {
    clean = {};
    for (const d of DENOMS) { const n = R.num(counts[d] ?? 0, `จำนวนแบงก์/เหรียญ ${d}`, { int: true, max: 1e5 }); if (n) clean[d] = n; total += d * n; }
  } else total = R.num(counted, "เงินที่นับได้", { max: 1e7 });
  return tx(db, () => {
    const s = requireShift(db);
    const sum = shiftSummary(db, s);
    db.prepare("UPDATE shifts SET closed_at = ?, closed_by = ?, counted_cash = ?, expected_cash = ?, counts = ?, note = ?, summary = ? WHERE id = ?")
      .run(Date.now(), staff.name, r2(total), sum.expectedCash, clean ? JSON.stringify(clean) : null, R.str(note, 200, "หมายเหตุ"), JSON.stringify(sum), s.id);
    return shiftOut(db, db.prepare("SELECT * FROM shifts WHERE id = ?").get(s.id));
  });
}

/* =================== pre-orders =================== */
function preOut(db, r) {
  const pays = db.prepare("SELECT * FROM preorder_payments WHERE preorder_id = ? ORDER BY created_at").all(r.id)
    .map(p => ({ id: p.id, createdAt: p.created_at, kind: p.kind, amount: p.amount, pay: p.pay, ref: p.ref, staffName: p.staff_name }));
  const paid = r2(pays.reduce((a, p) => a + p.amount, 0));
  return { id: r.id, code: r.code, createdAt: r.created_at, customer: r.customer_name, phone: r.phone, memberPhone: r.member_phone, pickupDay: r.pickup_day, pickupTime: r.pickup_time,
    title: r.title, details: r.details, message: r.cake_message, qty: r.qty, total: r.total, paid, balance: r2(Math.max(0, r.total - paid)), status: r.status, note: r.note,
    staffName: r.staff_name, readyAt: r.ready_at, pickedAt: r.picked_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, payments: pays };
}
const getPre = (db, id) => { const r = db.prepare("SELECT * FROM preorders WHERE id = ?").get(String(id)); if (!r) throw new HttpError(404, "ไม่พบออเดอร์ล่วงหน้านี้"); return r; };
// open ones, plus anything picked up or cancelled in the last 7 days
function listPreorders(db, { from, to } = {}) {
  const rows = from && to
    ? db.prepare("SELECT * FROM preorders WHERE pickup_day BETWEEN ? AND ? ORDER BY pickup_day, pickup_time").all(from, to)
    : db.prepare("SELECT * FROM preorders WHERE status IN ('pending','ready') OR pickup_day >= ? ORDER BY pickup_day, pickup_time").all(R.shiftDays(R.bday(db), -7));
  return rows.map(r => preOut(db, r));
}
function prePayment(db, pid, kind, amount, pay, ref, staff, shiftId) {
  if (!PAYS.includes(pay)) throw bad("เลือกวิธีรับเงิน");
  db.prepare("INSERT INTO preorder_payments (id, preorder_id, created_at, day, kind, amount, pay, ref, staff_name, shift_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(newId("pp"), pid, Date.now(), R.bday(db), kind, amount, pay, R.str(ref, 40, "เลขอ้างอิง"), staff.name, shiftId);
}
function preFields(d) {
  if (!R.DAY_RE.test(String(d.pickupDay || ""))) throw bad("เลือกวันรับของ");
  if (d.pickupTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.pickupTime)) throw bad("เวลารับของไม่ถูกต้อง");
  const phone = String(d.phone || "").replace(/\D/g, "");
  if (phone && !R.PHONE_RE.test(phone)) throw bad("เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก");
  return { customer: R.str(d.customer, 50, "ชื่อลูกค้า", { required: true }), phone, pickupDay: d.pickupDay, pickupTime: d.pickupTime || "",
    title: R.str(d.title, 80, "รายการที่สั่ง", { required: true }), details: R.str(d.details, 300, "รายละเอียด"), message: R.str(d.message, 80, "ข้อความบนเค้ก"),
    qty: R.num(d.qty ?? 1, "จำนวน", { min: 1, max: 999, int: true }), total: R.num(d.total, "ราคารวม", { max: 1e6 }), note: R.str(d.note, 200, "หมายเหตุ") };
}
function createPreorder(db, d, staff) {
  const f = preFields(d);
  const deposit = R.num(d.deposit ?? 0, "มัดจำ", { max: f.total });
  const member = d.memberPhone ? R.getMember(db, String(d.memberPhone)) : null;
  if (d.memberPhone && !member) throw bad("ไม่พบสมาชิกนี้");
  return tx(db, () => {
    const shift = deposit > 0 ? requireShift(db) : null;
    const n = db.prepare("SELECT COUNT(*) n FROM preorders").get().n + 1;
    const id = newId("p"), code = "P" + String(n).padStart(4, "0");
    db.prepare(`INSERT INTO preorders (id, code, created_at, customer_name, phone, member_phone, pickup_day, pickup_time, title, details, cake_message, qty, total, status, note, staff_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(id, code, Date.now(), f.customer, f.phone, member?.id ?? null, f.pickupDay, f.pickupTime, f.title, f.details, f.message, f.qty, f.total, f.note, staff.name);
    if (deposit > 0) prePayment(db, id, "deposit", deposit, d.pay, d.ref, staff, shift.id);
    return preOut(db, getPre(db, id));
  });
}
function updatePreorder(db, id, d) {
  return tx(db, () => {
    const r = getPre(db, id);
    if (!["pending", "ready"].includes(r.status)) throw bad("ออเดอร์นี้ปิดไปแล้ว แก้ไขไม่ได้");
    const f = preFields({ ...preOut(db, r), ...d });
    const paid = preOut(db, r).paid;
    if (f.total < paid) throw bad(`ราคารวมต้องไม่น้อยกว่าเงินที่รับแล้ว ฿${paid}`);
    db.prepare("UPDATE preorders SET customer_name=?, phone=?, pickup_day=?, pickup_time=?, title=?, details=?, cake_message=?, qty=?, total=?, note=? WHERE id=?")
      .run(f.customer, f.phone, f.pickupDay, f.pickupTime, f.title, f.details, f.message, f.qty, f.total, f.note, r.id);
    return preOut(db, getPre(db, r.id));
  });
}
function markPreorderReady(db, id) {
  const r = getPre(db, id);
  if (r.status !== "pending") throw bad("ออเดอร์นี้ไม่ได้อยู่ในสถานะรอทำ");
  db.prepare("UPDATE preorders SET status = 'ready', ready_at = ? WHERE id = ?").run(Date.now(), r.id);
  return preOut(db, getPre(db, r.id));
}
function pickupPreorder(db, id, { pay, tendered, ref }, staff) {
  return tx(db, () => {
    const r = getPre(db, id);
    if (!["pending", "ready"].includes(r.status)) throw new HttpError(409, "ออเดอร์นี้รับไปแล้วหรือถูกยกเลิก");
    const cur = preOut(db, r);
    let change = 0;
    if (cur.balance > 0) {
      const shift = requireShift(db);
      if (pay === "cash") { const t = R.num(tendered, "จำนวนเงินที่รับ"); if (t < cur.balance) throw bad("รับเงินมาไม่พอ"); change = r2(t - cur.balance); }
      prePayment(db, r.id, "balance", cur.balance, pay, ref, staff, shift.id);
    }
    db.prepare("UPDATE preorders SET status = 'picked', picked_at = ? WHERE id = ?").run(Date.now(), r.id);
    if (r.member_phone && R.getMember(db, r.member_phone)) {
      const shop = R.getShop(db), m = R.getMember(db, r.member_phone);
      const pts = Math.floor(r.total / Math.max(1, shop.pointsPer)) * (pricing.isBirthMonth(m) ? Math.max(1, shop.birthdayMultiplier) : 1);
      db.prepare("UPDATE members SET points = points + ?, visits = visits + 1, spent = ROUND(spent + ?, 2), last_visit = ? WHERE phone = ?").run(pts, r.total, Date.now(), m.id);
      ledger(db, m.id, pts, "earn", r.id, staff.name);
    }
    return { preorder: preOut(db, getPre(db, r.id)), change };
  });
}
function cancelPreorder(db, id, { refund, pay = "cash", reason }, staff) {
  return tx(db, () => {
    const r = getPre(db, id);
    if (!["pending", "ready"].includes(r.status)) throw new HttpError(409, "ออเดอร์นี้รับไปแล้วหรือถูกยกเลิก");
    const paid = preOut(db, r).paid;
    if (refund && paid > 0) prePayment(db, r.id, "refund", -paid, pay, "", staff, requireShift(db).id);
    db.prepare("UPDATE preorders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?").run(Date.now(), R.str(reason, 80, "เหตุผล"), r.id);
    return preOut(db, getPre(db, r.id));
  });
}
const prePaymentsInRange = (db, from, to) => db.prepare(`SELECT pp.*, p.code, p.customer_name FROM preorder_payments pp JOIN preorders p ON p.id = pp.preorder_id
  WHERE pp.day BETWEEN ? AND ? ORDER BY pp.created_at`).all(from, to).map(p => ({ code: p.code, customer: p.customer_name, day: p.day, createdAt: p.created_at, kind: p.kind, amount: p.amount, pay: p.pay, staffName: p.staff_name }));

/* =================== waste & bake plan =================== */
function recordWaste(db, { items, reason }, staff) {
  if (!Array.isArray(items) || !items.length) throw bad("ยังไม่ได้ใส่จำนวนที่ทิ้ง");
  return tx(db, () => {
    const day = R.bday(db), t = Date.now(), why = R.str(reason, 80, "เหตุผล");
    for (const it of items) {
      const m = R.getMenu(db, String(it.menuId || "")); if (!m) throw bad("ไม่พบเมนู");
      const qty = R.num(it.qty, `จำนวนที่ทิ้งของ ${m.name}`, { min: 1, max: 9999, int: true });
      const have = R.stockQty(db, m.id);
      if (have != null && qty > have) throw bad(`${m.name} เหลือแค่ ${have} ชิ้น`);
      if (have != null) R.addStock(db, m.id, -qty);
      db.prepare("INSERT INTO waste (id, day, created_at, menu_id, name, qty, unit_price, reason, staff_name) VALUES (?,?,?,?,?,?,?,?,?)").run(newId("w"), day, t, m.id, m.name, qty, m.price, why, staff.name);
    }
    return listWaste(db, day, day);
  });
}
const listWaste = (db, from, to) => db.prepare("SELECT * FROM waste WHERE day BETWEEN ? AND ? ORDER BY created_at").all(from, to)
  .map(w => ({ id: w.id, day: w.day, createdAt: w.created_at, menuId: w.menu_id, name: w.name, qty: w.qty, unitPrice: w.unit_price, value: r2(w.qty * w.unit_price), reason: w.reason, staffName: w.staff_name }));

// Suggested bake quantity for the next business day, from the last 4 same weekdays (or the last 7 days).
function bakePlan(db) {
  const today = R.bday(db), tomorrow = R.shiftDays(today, 1);
  const soldOn = (mid, day) => db.prepare("SELECT COALESCE(SUM(oi.qty),0) q FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.menu_id = ? AND o.day = ? AND o.status != 'void'").get(mid, day).q;
  const wasteOn = (mid, from, to) => db.prepare("SELECT COALESCE(SUM(qty),0) q FROM waste WHERE menu_id = ? AND day BETWEEN ? AND ?").get(mid, from, to).q;
  const last7 = Array.from({ length: 7 }, (_, i) => R.shiftDays(today, -i));
  const sameWd = [1, 2, 3, 4].map(w => R.shiftDays(tomorrow, -7 * w));
  return { today, tomorrow, items: R.listMenu(db).filter(m => m.trackStock && m.active).map(m => {
    const s7 = last7.map(d => soldOn(m.id, d)), sw = sameWd.map(d => soldOn(m.id, d));
    const avg7 = s7.reduce((a, b) => a + b, 0) / 7, swDays = sw.filter(x => x > 0).length, avgWd = swDays ? sw.reduce((a, b) => a + b, 0) / sw.length : null;
    const waste7 = wasteOn(m.id, last7[6], today) / 7;
    const demand = avgWd != null && swDays >= 2 ? avgWd : avg7;
    const stock = R.stockQty(db, m.id) ?? 0;
    // bake for expected demand, trimmed by half the usual waste, minus what is already on the shelf
    const suggest = Math.max(0, Math.ceil(demand - waste7 / 2 - stock));
    return { id: m.id, name: m.name, img: m.img, price: m.price, stock, soldToday: s7[0], avg7: r2(avg7), avgWeekday: avgWd == null ? null : r2(avgWd), waste7: r2(waste7), suggest,
      basis: avgWd != null && swDays >= 2 ? "weekday" : "7days" };
  }) };
}

/* =================== owner dashboard =================== */
function daySales(db, day) {
  const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE day = ? AND status != 'void'").get(day);
  const items = db.prepare("SELECT COALESCE(SUM(oi.qty),0) q FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.day = ? AND o.status != 'void'").get(day).q;
  const pre = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM preorder_payments WHERE day = ?").get(day).s;
  return { day, bills: r.n, sales: r2(r.s), avg: r.n ? r2(r.s / r.n) : 0, items, preorderIncome: r2(pre) };
}
function hourly(db, day) {
  const out = Array(24).fill(0);
  for (const o of db.prepare("SELECT created_at, total FROM orders WHERE day = ? AND status != 'void'").all(day)) out[new Date(o.created_at).getHours()] += o.total;
  return out.map(r2);
}
function dashboard(db) {
  const today = R.bday(db), yesterday = R.shiftDays(today, -1), lastWeek = R.shiftDays(today, -7), shop = R.getShop(db);
  const top = db.prepare(`SELECT oi.name, SUM(oi.qty) q, SUM(oi.qty * oi.unit) v FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.day = ? AND o.status != 'void' GROUP BY oi.name ORDER BY q DESC LIMIT 5`).all(today).map(r => ({ name: r.name, qty: r.q, value: r2(r.v) }));
  const stock = R.listStock(db);
  const low = R.listMenu(db).filter(m => m.active && m.trackStock && (stock[m.id]?.qty ?? 0) <= shop.lowStockAt).map(m => ({ id: m.id, name: m.name, qty: stock[m.id]?.qty ?? 0 }));
  const due = listPreorders(db, { from: today, to: R.shiftDays(today, 1) }).filter(p => ["pending", "ready"].includes(p.status));
  const wasteY = listWaste(db, yesterday, yesterday);
  const newMembers = db.prepare("SELECT COUNT(*) n FROM members WHERE created_at >= ?").get(new Date(today + "T00:00:00").getTime() + (shop.dayStartHour || 0) * 3600e3).n;
  return { today: daySales(db, today), yesterday: daySales(db, yesterday), lastWeek: daySales(db, lastWeek),
    hourly: { today: hourly(db, today), yesterday: hourly(db, yesterday) }, top, lowStock: low, preordersDue: due,
    shift: currentShift(db), wasteYesterday: { qty: wasteY.reduce((a, w) => a + w.qty, 0), value: r2(wasteY.reduce((a, w) => a + w.value, 0)) }, newMembers };
}

/* =================== customer queue screen =================== */
function queueBoard(db) {
  const today = R.bday(db), since = R.shiftDays(today, -2);
  const rows = db.prepare("SELECT queue, day, type, status, created_at, ready_at FROM orders WHERE day >= ? AND status IN ('preparing','ready') ORDER BY created_at").all(since);
  const shop = R.getShop(db);
  return { shop: { name: shop.name, tagline: shop.tagline }, today,
    preparing: rows.filter(r => r.status === "preparing").map(r => ({ queue: r.queue, day: r.day, type: r.type })),
    ready: rows.filter(r => r.status === "ready").sort((a, b) => (b.ready_at || 0) - (a.ready_at || 0)).map(r => ({ queue: r.queue, day: r.day, type: r.type, readyAt: r.ready_at })) };
}

module.exports = { DENOMS, currentShift, listShifts, openShift, addCashMove, closeShift, shiftSummary,
  listPreorders, createPreorder, updatePreorder, markPreorderReady, pickupPreorder, cancelPreorder, prePaymentsInRange,
  recordWaste, listWaste, bakePlan, dashboard, queueBoard };

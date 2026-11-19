// Business operations. Each runs in one transaction so stock, points and records never drift apart.
const crypto = require("node:crypto");
const { tx } = require("./db");
const pricing = require("../shared/pricing");
const R = require("./repo");
const { HttpError, bad } = R;

const newId = p => p + crypto.randomBytes(8).toString("hex");
const ledger = (db, phone, delta, reason, ref, staff) => {
  if (delta) db.prepare("INSERT INTO point_ledger (member_phone, delta, reason, ref, staff_name, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(phone, delta, reason, ref, staff, Date.now());
};

/* Turn the client's cart into priced lines using catalog data from the database. */
function buildLines(db, cart, member) {
  if (!Array.isArray(cart) || !cart.length) throw bad("บิลยังไม่มีรายการ");
  if (cart.length > 100) throw bad("รายการในบิลมากเกินไป");
  return cart.map((c, i) => {
    const qty = R.num(c.qty, "จำนวน", {min: 1, max: 99, int: true});
    if (c.reward) {
      if (!member) throw bad("ต้องเลือกสมาชิกก่อนแลกของรางวัล");
      const r = R.getReward(db, String(c.reward));
      if (!r || !r.active || r.kind === "discount") throw bad("ของรางวัลนี้ใช้ในบิลไม่ได้");
      const m = r.kind === "item" ? R.getMenu(db, r.itemId) : null;
      if (r.kind === "item" && !m) throw bad(`ไม่พบเมนูของรางวัล ${r.name}`);
      return { key: "rw|" + r.id, id: m ? m.id : "gift:" + r.id, name: r.name, cat: m ? m.cat : "other", unit: 0, qty, opt: null, sweet: null, reward: r.id, pts: r.points, _menu: m, _reward: r };
    }
    const m = R.getMenu(db, String(c.id || ""));
    if (!m || !m.active) throw bad(`เมนูรายการที่ ${i + 1} ปิดขายหรือถูกลบแล้ว`);
    let add = 0, opt = null;
    if (m.opts.length) {
      const o = c.opt ? m.opts.find(x => x.name === c.opt) : m.opts[0];
      if (!o) throw bad(`ตัวเลือก "${c.opt}" ของ ${m.name} ไม่มีแล้ว`);
      add = o.add; opt = o.name;
    }
    const sweet = m.sweet && c.sweet != null ? String(c.sweet) : null;
    if (sweet && !R.SWEET.includes(sweet)) throw bad("ระดับความหวานไม่ถูกต้อง");
    return { key: [m.id, opt || "", sweet ?? ""].join("|"), id: m.id, name: m.name, cat: m.cat, unit: pricing.r2(m.price + add), qty, opt, sweet, reward: null, pts: 0, _menu: m };
  });
}

function checkout(db, body, staff, now = new Date()) {
  const type = body.type === "take" ? "take" : "dine";
  const pay = ["cash", "qr", "card"].includes(body.pay) ? body.pay : null;
  if (!pay) throw bad("เลือกวิธีชำระเงิน");
  const shop = R.getShop(db);
  if (pay === "qr" && !shop.promptpay) throw bad("ร้านยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์");
  return tx(db, () => {
    const shift = db.prepare("SELECT id FROM shifts WHERE closed_at IS NULL").get();
    if (!shift) throw new HttpError(409, "ยังไม่ได้เปิดกะ กดเปิดกะก่อนเริ่มขาย");
    const member = body.memberPhone ? R.getMember(db, String(body.memberPhone)) : null;
    if (body.memberPhone && !member) throw bad("ไม่พบสมาชิกนี้");
    const lines = buildLines(db, body.lines, member);
    let voucher = null;
    if (body.voucher) {
      if (!member) throw bad("ต้องเลือกสมาชิกก่อนใช้คูปองแลกแต้ม");
      voucher = R.getReward(db, String(body.voucher));
      if (!voucher || !voucher.active || voucher.kind !== "discount") throw bad("คูปองแลกแต้มนี้ใช้ไม่ได้แล้ว");
    }
    const P = pricing.price({ lines, promos: R.listPromos(db), coupon: body.coupon, manualDisc: body.manualDisc, member, voucher, shop, now });
    if (body.expectTotal != null && Math.abs(Number(body.expectTotal) - P.total) > 0.009)
      throw new HttpError(409, `ยอดบิลเปลี่ยนเป็น ฿${P.total.toFixed(2)} (ราคาหรือโปรโมชั่นอาจเพิ่งถูกแก้) ตรวจบิลแล้วกดชำระอีกครั้ง`);
    // special discount above the cashier's limit needs a manager's one-time approval
    let approval = null;
    if (P.manual > 0 && staff.role !== "manager" && pricing.discountNeedsApproval(P.manual, P.subtotal, shop)) {
      approval = body.approval ? db.prepare("SELECT * FROM approvals WHERE token = ?").get(String(body.approval)) : null;
      if (!approval || approval.used_at || approval.expires_at < Date.now() || approval.amount + 0.009 < P.manual)
        throw new HttpError(403, "ส่วนลดพิเศษเกินสิทธิ์แคชเชียร์ ต้องให้ผู้จัดการใส่ PIN อนุมัติก่อน");
    }
    const tendered = pay === "cash" ? R.num(body.tendered, "จำนวนเงินที่รับ") : P.total;
    if (body.paymentId && pay !== "qr") throw bad("รายการชำระเงิน QR ใช้ได้กับการจ่ายแบบพร้อมเพย์เท่านั้น");
    if (tendered < P.total) throw bad("รับเงินมาไม่พอ");

    // stock checks: menu items (including free reward items) and limited rewards
    const needMenu = {}, needReward = {};
    for (const l of lines) {
      if (l._menu?.trackStock) needMenu[l._menu.id] = (needMenu[l._menu.id] || 0) + l.qty;
      if (l._reward?.limited) needReward[l._reward.id] = (needReward[l._reward.id] || 0) + l.qty;
    }
    if (voucher?.limited) needReward[voucher.id] = (needReward[voucher.id] || 0) + 1;
    for (const [mid, q] of Object.entries(needMenu)) {
      const have = R.stockQty(db, mid);
      if (have != null && have < q) throw new HttpError(409, `สต็อก ${lines.find(l => l.id === mid).name} เหลือ ${have} ชิ้น`);
    }
    for (const [rid, q] of Object.entries(needReward)) {
      if ((R.stockQty(db, "rw-" + rid) ?? 0) < q) throw new HttpError(409, `ของรางวัล ${R.getReward(db, rid).name} หมดแล้ว`);
    }
    if (member && member.points < P.pointsUsed) throw new HttpError(409, `แต้มของ ${member.name || member.id} ไม่พอ (มี ${member.points} ต้องใช้ ${P.pointsUsed})`);

    const t = now.getTime(), day = R.bday(db, now), oid = newId("o");
    const queue = db.prepare("SELECT COALESCE(MAX(queue), 0) + 1 q FROM orders WHERE day = ?").get(day).q;
    db.prepare(`INSERT INTO orders (id, day, queue, created_at, type, status, pay, ref, subtotal, promos, promo_total, manual, points_used, points_disc, voucher_name,
      total, vat, tendered, change, note, member_phone, member_name, points_earned, staff_id, staff_name) VALUES (?,?,?,?,?,'preparing',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      oid, day, queue, t, type, pay, R.str(body.ref, 40, "เลขอ้างอิง"), P.subtotal, JSON.stringify(P.applied.map(a => ({ id: a.id, name: a.name, amt: a.amt }))),
      P.promoTotal, P.manual, P.pointsUsed, P.pointsDisc, P.voucherName, P.total, P.vat, tendered, pricing.r2(tendered - P.total), R.str(body.note, 200, "หมายเหตุ"),
      member?.id ?? null, member?.name ?? null, P.pointsEarned, staff.id, staff.name);
    const ins = db.prepare("INSERT INTO order_items (order_id, line, menu_id, name, cat, unit, qty, opt, sweet, reward_id, pts) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    lines.forEach((l, i) => ins.run(oid, i + 1, l.id, l.name, l.cat, l.unit, l.qty, l.opt, l.sweet, l.reward, l.pts));
    db.prepare("UPDATE orders SET shift_id = ? WHERE id = ?").run(shift.id, oid);
    if (P.manual > 0) {
      const by = approval ? approval.manager_name : staff.role === "manager" ? staff.name : null;
      db.prepare("UPDATE orders SET manual_by = ? WHERE id = ?").run(by, oid);
      if (approval) db.prepare("UPDATE approvals SET used_at = ?, order_id = ? WHERE id = ?").run(t, oid, approval.id);
      require("./audit").log(db, staff, "order_discount", `คิว ${queue}`, { amount: P.manual, subtotal: P.subtotal, approvedBy: by });
    }
    // auto-confirmed QR: the provider must report this exact amount as paid, and it can be used once
    if (body.paymentId) db.prepare("UPDATE orders SET ref = ? WHERE id = ?").run(require("./payments").claimForOrder(db, String(body.paymentId), P.total, oid), oid);
    const lowStock = [], th = Number(shop.lowStockAt) || 0;
    for (const [mid, q] of Object.entries(needMenu)) {
      const before = R.stockQty(db, mid); if (before == null) continue;
      R.addStock(db, mid, -q);
      const after = Math.max(0, before - q);
      if (before > th && after <= th) lowStock.push({ name: lines.find(l => l.id === mid).name, qty: after });
    }
    for (const [rid, q] of Object.entries(needReward)) R.addStock(db, "rw-" + rid, -q);
    if (member) {
      db.prepare("UPDATE members SET points = points - ? + ?, visits = visits + 1, spent = ROUND(spent + ?, 2), last_visit = ? WHERE phone = ?").run(P.pointsUsed, P.pointsEarned, P.total, t, member.id);
      ledger(db, member.id, -P.pointsUsed, "spend", oid, staff.name);
      ledger(db, member.id, P.pointsEarned, "earn", oid, staff.name);
      const logR = (r, qty) => db.prepare(`INSERT INTO redeems (id, day, created_at, member_phone, member_name, reward_id, reward_name, kind, qty, points, staff_name, via, order_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'bill',?)`).run(newId("r"), day, t, member.id, member.name, r.id, r.name, r.kind, qty, r.points * qty, staff.name, oid);
      for (const l of lines) if (l._reward) logR(l._reward, l.qty);
      if (voucher) logR(voucher, 1);
    }
    return { order: R.getOrder(db, oid), lowStock };
  });
}

const NEXT = { preparing: "ready", ready: "done" };
function setStatus(db, oid, status) {
  const o = R.getOrder(db, oid);
  if (!o) throw new HttpError(404, "ไม่พบออเดอร์นี้");
  if (NEXT[o.status] !== status) throw bad("เปลี่ยนสถานะออเดอร์แบบนี้ไม่ได้");
  db.prepare(`UPDATE orders SET status = ?, ${status}_at = ? WHERE id = ?`).run(status, Date.now(), oid);
  return R.getOrder(db, oid);
}

function voidOrder(db, oid, {reason, restock = true, restockRewards = true}, staff) {
  return tx(db, () => {
    const o = R.getOrder(db, oid);
    if (!o) throw new HttpError(404, "ไม่พบออเดอร์นี้");
    if (o.status === "void") throw new HttpError(409, "ออเดอร์นี้ถูกยกเลิกไปแล้ว");
    const t = Date.now();
    db.prepare("UPDATE orders SET status = 'void', void_reason = ?, void_by = ?, void_at = ? WHERE id = ?").run(R.str(reason, 80, "เหตุผล"), staff.name, t, oid);
    if (restock) {
      const per = {}; o.items.forEach(l => { if (l.id && !String(l.id).startsWith("gift:")) per[l.id] = (per[l.id] || 0) + l.qty; });
      for (const [mid, q] of Object.entries(per)) { const m = R.getMenu(db, mid); if (m?.trackStock && R.stockQty(db, mid) != null) R.addStock(db, mid, q); }
    }
    for (const x of db.prepare("SELECT * FROM redeems WHERE order_id = ? AND voided = 0").all(oid)) {
      const r = R.getReward(db, x.reward_id), back = !!(restockRewards && r?.limited);
      if (back) R.addStock(db, "rw-" + r.id, x.qty);
      db.prepare("UPDATE redeems SET voided = 1, void_at = ?, void_by = ?, restocked = ? WHERE id = ?").run(t, staff.name, back ? 1 : 0, x.id);
    }
    if (o.memberId && R.getMember(db, o.memberId)) {
      db.prepare("UPDATE members SET points = MAX(0, points - ? + ?), spent = MAX(0, ROUND(spent - ?, 2)), visits = MAX(0, visits - 1) WHERE phone = ?").run(o.pointsEarned, o.pointsUsed, o.total, o.memberId);
      ledger(db, o.memberId, o.pointsUsed - o.pointsEarned, "void", oid, staff.name);
    }
    return R.getOrder(db, oid);
  });
}

function redeemDirect(db, {memberPhone, rewardId}, staff, now = new Date()) {
  return tx(db, () => {
    const m = R.getMember(db, String(memberPhone || "")), r = R.getReward(db, String(rewardId || ""));
    if (!m) throw new HttpError(404, "ไม่พบสมาชิกนี้");
    if (!r || !r.active) throw new HttpError(404, "ของรางวัลนี้ไม่ได้วางในตู้แล้ว");
    if (r.kind === "discount") throw bad("คูปองส่วนลดใช้ได้ตอนชำระเงินเท่านั้น");
    if (m.points < r.points) throw new HttpError(409, `แต้มไม่พอ ขาดอีก ${r.points - m.points} แต้ม`);
    if (r.limited && (R.stockQty(db, "rw-" + r.id) ?? 0) < 1) throw new HttpError(409, "ของรางวัลหมดแล้ว");
    const item = r.kind === "item" ? R.getMenu(db, r.itemId) : null;
    if (r.kind === "item" && !item) throw bad("ไม่พบเมนูของรางวัลนี้");
    const itemQty = item?.trackStock ? R.stockQty(db, item.id) : null;
    if (itemQty != null && itemQty < 1) throw new HttpError(409, `${item.name} หมดแล้ว`);
    const t = now.getTime(), rid = newId("r");
    db.prepare("UPDATE members SET points = points - ? WHERE phone = ?").run(r.points, m.id);
    ledger(db, m.id, -r.points, "redeem", rid, staff.name);
    if (r.limited) R.addStock(db, "rw-" + r.id, -1);
    if (itemQty != null) R.addStock(db, item.id, -1);
    db.prepare(`INSERT INTO redeems (id, day, created_at, member_phone, member_name, reward_id, reward_name, kind, qty, points, staff_name, via)
      VALUES (?,?,?,?,?,?,?,?,1,?,?,'direct')`).run(rid, R.bday(db, now), t, m.id, m.name, r.id, r.name, r.kind, r.points, staff.name);
    return { redeem: R.redeemOut(db.prepare("SELECT * FROM redeems WHERE id = ?").get(rid)), member: R.getMember(db, m.id) };
  });
}

function cancelRedeem(db, rid, {restockReward = true, restockItem = true}, staff) {
  return tx(db, () => {
    const x = db.prepare("SELECT * FROM redeems WHERE id = ?").get(String(rid));
    if (!x) throw new HttpError(404, "ไม่พบรายการแลกนี้");
    if (x.voided) throw new HttpError(409, "รายการนี้ถูกยกเลิกไปแล้ว");
    if (x.via !== "direct") throw bad("รายการนี้แลกในบิลขาย ให้ยกเลิกที่บิลแทน");
    const r = R.getReward(db, x.reward_id), back = !!(restockReward && r?.limited);
    if (back) R.addStock(db, "rw-" + r.id, x.qty);
    if (restockItem && r?.kind === "item") { const it = R.getMenu(db, r.itemId); if (it?.trackStock && R.stockQty(db, it.id) != null) R.addStock(db, it.id, x.qty); }
    if (R.getMember(db, x.member_phone)) {
      db.prepare("UPDATE members SET points = points + ? WHERE phone = ?").run(x.points, x.member_phone);
      ledger(db, x.member_phone, x.points, "redeem-cancel", x.id, staff.name);
    }
    db.prepare("UPDATE redeems SET voided = 1, void_at = ?, void_by = ?, restocked = ? WHERE id = ?").run(Date.now(), staff.name, back ? 1 : 0, x.id);
    return { redeem: R.redeemOut(db.prepare("SELECT * FROM redeems WHERE id = ?").get(x.id)), member: R.getMember(db, x.member_phone) };
  });
}

module.exports = { checkout, setStatus, voidOrder, redeemDirect, cancelRedeem, newId };

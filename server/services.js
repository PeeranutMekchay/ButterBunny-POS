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
  const PAYS = ["cash", "qr", "card"];
  // one method, or a split bill: payments [{pay, amount, ref, paymentId}] that add up to the total
  const split = Array.isArray(body.payments) && body.payments.length > 1;
  if (split && body.payments.length > 4) throw bad("แบ่งจ่ายได้ไม่เกิน 4 ส่วน");
  const parts = split ? body.payments.map((p, i) => {
    if (!PAYS.includes(p?.pay)) throw bad(`เลือกวิธีชำระของส่วนที่ ${i + 1}`);
    return { pay: p.pay, amount: R.num(p.amount, `ยอดส่วนที่ ${i + 1}`, { min: 0.01, max: 1e6 }), ref: R.str(p.ref, 40, "เลขอ้างอิง"), paymentId: p.paymentId ? String(p.paymentId) : null };
  }) : null;
  if (split && parts.filter(p => p.pay === "cash").length > 1) throw bad("ส่วนที่จ่ายเงินสดรวมเป็นส่วนเดียว");
  const pay = split ? [...parts].sort((a, b) => b.amount - a.amount)[0].pay : PAYS.includes(body.pay) ? body.pay : null;
  if (!pay) throw bad("เลือกวิธีชำระเงิน");
  const shop = R.getShop(db);
  const qrNoProvider = split ? parts.some(p => p.pay === "qr" && !p.paymentId) : pay === "qr" && !body.paymentId;
  if (qrNoProvider && !shop.promptpay) throw bad("ร้านยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์");
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
    let tendered, change, payments;
    if (split) {
      const sum = pricing.r2(parts.reduce((a, p) => a + p.amount, 0));
      if (Math.abs(sum - P.total) > 0.009) throw bad(`ยอดที่แบ่งจ่ายรวม ฿${sum.toFixed(2)} ไม่เท่ากับยอดบิล ฿${P.total.toFixed(2)}`);
      if (parts.some(p => p.paymentId && p.pay !== "qr")) throw bad("รายการชำระเงิน QR ใช้ได้กับส่วนที่จ่ายพร้อมเพย์เท่านั้น");
      const cash = parts.find(p => p.pay === "cash");
      const given = cash ? R.num(body.tendered ?? cash.amount, "เงินสดที่รับ") : 0;
      if (cash && given < cash.amount) throw bad("รับเงินสดมาไม่พอ");
      change = cash ? pricing.r2(given - cash.amount) : 0;
      tendered = pricing.r2(P.total + change);
      payments = parts.map(p => ({ pay: p.pay, amount: p.amount, ref: p.ref }));
    } else {
      tendered = pay === "cash" ? R.num(body.tendered, "จำนวนเงินที่รับ") : P.total;
      if (body.paymentId && pay !== "qr") throw bad("รายการชำระเงิน QR ใช้ได้กับการจ่ายแบบพร้อมเพย์เท่านั้น");
      if (tendered < P.total) throw bad("รับเงินมาไม่พอ");
      change = pricing.r2(tendered - P.total);
      payments = [{ pay, amount: P.total, ref: R.str(body.ref, 40, "เลขอ้างอิง") }];
    }

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
      oid, day, queue, t, type, pay, split ? payments.filter(p => p.ref).map(p => p.ref).join(" / ").slice(0, 80) : payments[0].ref, P.subtotal, JSON.stringify(P.applied.map(a => ({ id: a.id, name: a.name, amt: a.amt }))),
      P.promoTotal, P.manual, P.pointsUsed, P.pointsDisc, P.voucherName, P.total, P.vat, tendered, change, R.str(body.note, 200, "หมายเหตุ"),
      member?.id ?? null, member?.name ?? null, P.pointsEarned, staff.id, staff.name);
    const ins = db.prepare("INSERT INTO order_items (order_id, line, menu_id, name, cat, unit, qty, opt, sweet, reward_id, pts) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    lines.forEach((l, i) => ins.run(oid, i + 1, l.id, l.name, l.cat, l.unit, l.qty, l.opt, l.sweet, l.reward, l.pts));
    db.prepare("UPDATE orders SET shift_id = ?, receipt_token = ? WHERE id = ?").run(shift.id, crypto.randomBytes(12).toString("hex"), oid);
    if (P.manual > 0) {
      const by = approval ? approval.manager_name : staff.role === "manager" ? staff.name : null;
      db.prepare("UPDATE orders SET manual_by = ? WHERE id = ?").run(by, oid);
      if (approval) db.prepare("UPDATE approvals SET used_at = ?, order_id = ? WHERE id = ?").run(t, oid, approval.id);
      require("./audit").log(db, staff, "order_discount", `คิว ${queue}`, { amount: P.manual, subtotal: P.subtotal, approvedBy: by });
    }
    // auto-confirmed QR: the provider must report this exact amount as paid, and it can be used once
    if (split) {
      parts.forEach((p, i) => { if (p.paymentId) payments[i].ref = require("./payments").claimForOrder(db, p.paymentId, p.amount, oid); });
    } else if (body.paymentId) payments[0].ref = require("./payments").claimForOrder(db, String(body.paymentId), P.total, oid);
    db.prepare("UPDATE orders SET payments = ?, ref = ? WHERE id = ?").run(JSON.stringify(payments), payments.map(p => p.ref).filter(Boolean).join(" / ").slice(0, 80), oid);
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
    if (o.refunded > 0) throw new HttpError(409, "บิลนี้คืนเงินไปบางส่วนแล้ว ให้ใช้ คืนเงิน กับรายการที่เหลือแทน");
    if (o.invoice) throw new HttpError(409, `บิลนี้ออกใบกำกับภาษี ${o.invoice.no} แล้ว ยกเลิกใบกำกับภาษีก่อน`);
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

/* Partial refund: give money back for some items (or an amount), optionally put them back on the shelf.
   The suggested amount follows the bill's discounts; points earned shrink in proportion. */
function refundOrder(db, oid, { items, amount, pay, reason, restock = true }, staff, now = new Date()) {
  return tx(db, () => {
    const o = R.getOrder(db, String(oid));
    if (!o) throw new HttpError(404, "ไม่พบออเดอร์นี้");
    if (o.status === "void") throw new HttpError(409, "บิลนี้ถูกยกเลิกแล้ว");
    if (o.invoice) throw new HttpError(409, `บิลนี้ออกใบกำกับภาษี ${o.invoice.no} แล้ว ยกเลิกใบกำกับภาษีก่อนคืนเงิน`);
    const shift = db.prepare("SELECT id FROM shifts WHERE closed_at IS NULL").get();
    if (!shift) throw new HttpError(409, "ยังไม่ได้เปิดกะ เปิดกะก่อนคืนเงิน");
    const left = pricing.r2(o.total - o.refunded);
    if (left <= 0) throw new HttpError(409, "บิลนี้คืนเงินครบแล้ว");
    const done = {}; for (const f of o.refunds) for (const it of f.items) done[it.line] = (done[it.line] || 0) + it.qty;
    const sel = [];
    for (const it of Array.isArray(items) ? items : []) {
      const line = R.num(it?.line, "รายการ", { min: 1, int: true }), qty = R.num(it?.qty, "จำนวนที่คืน", { min: 0, max: 999, int: true });
      if (!qty) continue;
      const l = o.items[line - 1];
      if (!l) throw bad("ไม่พบรายการนี้ในบิล");
      if (l.reward) throw bad("ของที่แลกด้วยแต้มคืนเงินไม่ได้ ให้ยกเลิกทั้งบิลแทน");
      if (qty > l.qty - (done[line] || 0)) throw bad(`${l.name} คืนได้อีกไม่เกิน ${l.qty - (done[line] || 0)} ชิ้น`);
      sel.push({ line, qty, name: l.name, id: l.id, unit: l.unit });
    }
    const suggested = o.subtotal > 0 ? pricing.r2(sel.reduce((a, s) => a + s.unit * s.qty, 0) * o.total / o.subtotal) : 0;
    const amt = amount != null && amount !== "" ? R.num(amount, "จำนวนเงินที่คืน", { min: 0.01, max: 1e6 }) : Math.min(suggested, left);
    if (!sel.length && !(amount > 0)) throw bad("เลือกรายการที่จะคืน หรือใส่จำนวนเงิน");
    if (amt <= 0) throw bad("จำนวนเงินที่คืนต้องมากกว่า 0");
    if (amt - left > 0.009) throw bad(`คืนได้ไม่เกิน ฿${left.toFixed(2)} (ยอดที่เหลือของบิล)`);
    const method = ["cash", "qr", "card"].includes(pay) ? pay : [...o.payments].sort((a, b) => b.amount - a.amount)[0].pay;
    const earnedLeft = o.pointsEarned - o.refunds.reduce((a, f) => a + f.pointsBack, 0);
    const pointsBack = o.memberId && earnedLeft > 0 ? Math.min(earnedLeft, Math.round(o.pointsEarned * amt / o.total)) : 0;
    const t = now.getTime(), id = newId("f");
    db.prepare(`INSERT INTO refunds (id, order_id, created_at, day, shift_id, amount, pay, items, reason, restocked, points_back, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, o.id, t, R.bday(db, now), shift.id, amt, method, JSON.stringify(sel.map(s => ({ line: s.line, qty: s.qty, name: s.name }))),
        R.str(reason, 80, "เหตุผล"), restock && sel.length ? 1 : 0, pointsBack, staff.name);
    db.prepare("UPDATE orders SET refunded = ROUND(refunded + ?, 2) WHERE id = ?").run(amt, o.id);
    if (restock) for (const s of sel) { const m = R.getMenu(db, s.id); if (m?.trackStock && R.stockQty(db, s.id) != null) R.addStock(db, s.id, s.qty); }
    if (o.memberId && R.getMember(db, o.memberId)) {
      db.prepare("UPDATE members SET points = MAX(0, points - ?), spent = MAX(0, ROUND(spent - ?, 2)) WHERE phone = ?").run(pointsBack, amt, o.memberId);
      ledger(db, o.memberId, -pointsBack, "refund", o.id, staff.name);
    }
    return R.getOrder(db, o.id);
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

module.exports = { checkout, setStatus, voidOrder, refundOrder, redeemDirect, cancelRedeem, newId };

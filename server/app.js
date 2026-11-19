// HTTP API + static frontend.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const R = require("./repo");
const A = require("./auth");
const S = require("./services");
const O = require("./ops");
const N = require("./notify");
const B = require("./backup");
const PAY = require("./payments");
const AU = require("./audit");
const IV = require("./invoices");
const DSP = require("./display");
const os = require("node:os");
const { HttpError, DAY_RE } = R;

const ROOT = path.join(__dirname, "..");
const MAGIC = [[[0xff, 0xd8, 0xff], "jpg"], [[0x89, 0x50, 0x4e, 0x47], "png"], [[0x52, 0x49, 0x46, 0x46], "webp"]];

function createApp({ db, uploadsDir, backupDir = path.join(uploadsDir, "..", "backups") }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  app.disable("x-powered-by");

  /* ---------- live updates (Server-Sent Events) ---------- */
  const clients = new Set();
  const broadcast = (...topics) => { const msg = `data: ${JSON.stringify({ topics })}\n\n`; for (const c of clients) c.write(msg); };
  app.get("/api/events", (req, res) => {
    const staff = A.staffForToken(db, String(req.query.token || ""));
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`retry: 3000\ndata: ${JSON.stringify({ topics: ["hello"], signedIn: !!staff })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
  });

  /* ---------- helpers ---------- */
  const wrap = fn => (req, res, next) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { next(e); } };
  const wrapAsync = fn => (req, res, next) => Promise.resolve(fn(req, res)).then(out => { if (out !== undefined) res.json(out); }, next);
  const notify = N.makeNotifier(db);
  const auth = (req, _res, next) => {
    const h = req.get("authorization") || "";
    req.token = h.startsWith("Bearer ") ? h.slice(7) : "";
    req.staff = A.staffForToken(db, req.token);
    if (!req.staff) return next(new HttpError(401, "กรุณาเข้าสู่ระบบใหม่"));
    next();
  };
  const manager = (req, _res, next) => next(req.staff.role === "manager" ? undefined : new HttpError(403, "ส่วนนี้สำหรับผู้จัดการเท่านั้น"));
  const changed = (...topics) => { broadcast(...topics); return { ok: true }; };
  const range = q => {
    const from = String(q.from || ""), to = String(q.to || "");
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw R.bad("ช่วงวันที่ไม่ถูกต้อง");
    if ((new Date(to) - new Date(from)) / 864e5 > 366) throw R.bad("ดูรายงานได้ครั้งละไม่เกิน 1 ปี");
    return [from, to];
  };

  /* ---------- public ---------- */
  const api = express.Router();
  api.use(express.json({ limit: "200kb" }));
  api.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
  api.get("/public", wrap(() => {
    const staff = R.listStaff(db, { activeOnly: true });
    const menu = R.listMenu(db).filter(m => m.active && m.img).slice(0, 7).map(m => ({ id: m.id, name: m.name, cat: m.cat, img: m.img, active: true }));
    return { needsSetup: db.prepare("SELECT COUNT(*) n FROM staff").get().n === 0, shop: R.getShop(db), staff, menu };
  }));
  // customer-facing queue screen (/queue): queue numbers only, no names or amounts
  api.get("/queue", wrap(() => O.queueBoard(db)));
  // digital receipt opened from the QR on the slip: the long random token is the only key
  api.get("/receipt/:token", wrap(req => {
    const tok = String(req.params.token || "");
    const r = /^[0-9a-f]{24}$/.test(tok) ? db.prepare("SELECT id FROM orders WHERE receipt_token = ?").get(tok) : null;
    if (!r) throw new HttpError(404, "ไม่พบใบเสร็จนี้");
    const o = R.getOrder(db, r.id), sh = R.getShop(db);
    const mask = p => p ? p.slice(0, 3) + "-xxx-" + p.slice(-4) : null;
    return { shop: { name: sh.name, branch: sh.branch, address: sh.address, phone: sh.phone, taxId: sh.taxId, vat: sh.vat, footer: sh.footer, tagline: sh.tagline },
      order: { day: o.day, queue: o.queue, createdAt: o.createdAt, type: o.type, status: o.status, items: o.items.map(l => ({ name: l.name, opt: l.opt, sweet: l.sweet, qty: l.qty, unit: l.unit, reward: !!l.reward, pts: l.pts })),
        subtotal: o.subtotal, promos: o.promos, manual: o.manual, pointsDisc: o.pointsDisc, voucherName: o.voucherName, total: o.total, vat: o.vat, tendered: o.tendered, change: o.change,
        payments: o.payments.map(p => ({ pay: p.pay, amount: p.amount })), refunded: o.refunded, refunds: o.refunds.map(f => ({ createdAt: f.createdAt, amount: f.amount, items: f.items })),
        member: o.memberId ? { name: o.memberName, phone: mask(o.memberId), earned: o.pointsEarned, used: o.pointsUsed } : null, staffName: o.staffName, invoiceNo: o.invoice?.no || null } };
  }));
  // customer display: public live feed of what the cashier shows (no member phone numbers)
  api.get("/display/:station/events", (req, res, next) => { try { DSP.watch(req, res); } catch (e) { next(e); } });
  api.post("/auth/setup", wrap(req => { const r = A.setup(db, req.body || {}); broadcast("staff"); return r; }));
  api.post("/auth/login", wrap(req => A.login(db, req.body || {})));

  /* ---------- signed in ---------- */
  api.use(auth);
  api.post("/auth/logout", wrap(req => { A.logout(db, req.token); return { ok: true }; }));
  api.get("/auth/me", wrap(req => ({ staff: req.staff })));
  api.post("/auth/approve", wrap(req => ({ approval: A.approve(db, req.body || {}, req.staff) })));
  api.get("/audit", manager, wrap(req => ({ entries: AU.list(db, { from: Number(req.query.from) || null, to: Number(req.query.to) || null, q: String(req.query.q || "").trim().slice(0, 60), limit: Number(req.query.limit) || 300 }) })));
  api.get("/bootstrap", wrap(req => {
    const today = R.bday(db);
    // orders still open from the previous two days stay on the board until someone finishes them
    const carry = db.prepare("SELECT id FROM orders WHERE day < ? AND day >= ? AND status IN ('preparing','ready')").all(today, R.shiftDays(today, -2)).map(r => R.getOrder(db, r.id));
    return { me: req.staff, shop: R.getShop(db), menu: R.listMenu(db), stock: R.listStock(db), promos: R.listPromos(db), rewards: R.listRewards(db),
      members: R.listMembers(db), staff: R.listStaff(db, { activeOnly: req.staff.role !== "manager" }), shift: O.currentShift(db), preorders: O.listPreorders(db),
      payment: { provider: PAY.getPay(db).provider },
      lanUrls: Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => `http://${a.address}:${req.socket.localPort}`),
      today: { day: today, orders: [...carry, ...R.listOrders(db, today, today)], redeems: R.listRedeems(db, today, today) } };
  }));

  // orders
  api.post("/orders", wrap(req => {
    const { order, lowStock } = S.checkout(db, req.body || {}, req.staff);
    broadcast("orders", "stock", "members", "redeems", "shift");
    if (lowStock.length) notify("lowStock", N.lowStockText(lowStock));
    return { order };
  }));
  api.patch("/orders/:id/status", wrap(req => { const order = S.setStatus(db, req.params.id, req.body?.status); broadcast("orders"); return { order }; }));
  api.post("/orders/:id/void", manager, wrap(req => {
    const order = S.voidOrder(db, req.params.id, req.body || {}, req.staff); broadcast("orders", "stock", "members", "redeems", "shift");
    AU.log(db, req.staff, "order_void", `คิว ${order.queue} (${order.day})`, { total: order.total, pay: order.pay, reason: order.voidReason, soldBy: order.staffName });
    return { order };
  }));

  // shifts & cash drawer (any staff can open/close; history is for managers)
  api.get("/shifts/current", wrap(() => ({ shift: O.currentShift(db) })));
  api.post("/shifts/open", wrap(req => { const shift = O.openShift(db, req.body || {}, req.staff); broadcast("shift"); AU.log(db, req.staff, "shift_open", "เปิดกะ", { openingCash: shift.openingCash }); return { shift }; }));
  api.post("/shifts/current/moves", wrap(req => { const shift = O.addCashMove(db, req.body || {}, req.staff); broadcast("shift"); AU.log(db, req.staff, req.body?.kind === "in" ? "cash_in" : "cash_out", req.body?.reason || "", { amount: Number(req.body?.amount) }); return { shift }; }));
  api.post("/shifts/current/close", wrap(req => {
    const shift = O.closeShift(db, req.body || {}, req.staff); broadcast("shift");
    AU.log(db, req.staff, "shift_close", "ปิดกะ", { expected: shift.expectedCash, counted: shift.countedCash, diff: shift.diff });
    notify("shiftClose", N.shiftCloseText(R.getShop(db), shift, O.shiftPreorders(db, shift)));
    return { shift };
  }));
  api.get("/shifts", manager, wrap(() => ({ shifts: O.listShifts(db, 60) })));

  // cake / party pre-orders
  api.get("/preorders", wrap(req => ({ preorders: req.query.from ? O.listPreorders(db, { from: range(req.query)[0], to: range(req.query)[1] }) : O.listPreorders(db) })));
  api.post("/preorders", wrap(req => { const preorder = O.createPreorder(db, req.body || {}, req.staff); broadcast("preorders", "shift"); return { preorder }; }));
  api.patch("/preorders/:id", wrap(req => { const preorder = O.updatePreorder(db, req.params.id, req.body || {}); broadcast("preorders"); return { preorder }; }));
  api.post("/preorders/:id/ready", wrap(req => { const preorder = O.markPreorderReady(db, req.params.id); broadcast("preorders"); return { preorder }; }));
  api.post("/preorders/:id/pickup", wrap(req => { const r = O.pickupPreorder(db, req.params.id, req.body || {}, req.staff); broadcast("preorders", "shift", "members"); return r; }));
  api.post("/preorders/:id/cancel", wrap(req => { const preorder = O.cancelPreorder(db, req.params.id, req.body || {}, req.staff); broadcast("preorders", "shift"); AU.log(db, req.staff, "preorder_cancel", `${preorder.code} ${preorder.title}`, { refund: !!req.body?.refund, reason: preorder.cancelReason }); return { preorder }; }));

  // end-of-day waste and bake plan
  api.post("/waste", wrap(req => { const waste = O.recordWaste(db, req.body || {}, req.staff); broadcast("stock", "waste"); AU.log(db, req.staff, "waste", "ของทิ้ง", { items: (req.body?.items || []).map(i => ({ id: i.menuId, qty: i.qty })), reason: req.body?.reason }); return { waste }; }));
  api.get("/waste", wrap(req => { const [from, to] = req.query.from ? range(req.query) : [R.bday(db), R.bday(db)]; return { waste: O.listWaste(db, from, to) }; }));
  api.get("/bake-plan", wrap(() => O.bakePlan(db)));

  // owner dashboard
  api.get("/dashboard", manager, wrap(() => O.dashboard(db)));
  api.get("/orders", manager, wrap(req => { const [from, to] = range(req.query); return { orders: R.listOrders(db, from, to), redeems: R.listRedeems(db, from, to),
    preorderPayments: O.prePaymentsInRange(db, from, to), waste: O.listWaste(db, from, to) }; }));

  // members (staff can register members; editing points and deleting is manager-only)
  api.post("/members", wrap(req => { const member = R.createMember(db, req.body || {}); broadcast("members"); return { member }; }));
  api.patch("/members/:phone", wrap(req => {
    const before = R.getMember(db, req.params.phone), member = R.updateMember(db, req.params.phone, req.body || {}, req.staff); broadcast("members");
    const diff = AU.changes(before, member, ["name", "birthday", "points"]);
    if (Object.keys(diff).length) AU.log(db, req.staff, diff.points ? "member_points" : "member_update", `${member.name || ""} ${member.id}`.trim(), diff);
    return { member };
  }));
  api.delete("/members/:phone", manager, wrap(req => { const m = R.getMember(db, req.params.phone); R.deleteMember(db, req.params.phone); AU.log(db, req.staff, "member_delete", `${m?.name || ""} ${req.params.phone}`.trim(), m ? { points: m.points } : null); return changed("members"); }));
  api.get("/members/:phone/ledger", wrap(req => ({ ledger: db.prepare("SELECT delta, reason, ref, staff_name AS staffName, created_at AS createdAt FROM point_ledger WHERE member_phone = ? ORDER BY id DESC LIMIT 100").all(req.params.phone) })));

  // rewards redemption at the counter
  api.post("/redeems", wrap(req => { const r = S.redeemDirect(db, req.body || {}, req.staff); broadcast("redeems", "members", "stock"); return r; }));
  api.post("/redeems/:id/cancel", wrap(req => { const r = S.cancelRedeem(db, req.params.id, req.body || {}, req.staff); broadcast("redeems", "members", "stock"); AU.log(db, req.staff, "redeem_cancel", r.redeem.rewardName, { member: r.redeem.memberId, points: r.redeem.points }); return r; }));

  // catalog (manager)
  api.put("/menu/:id", manager, wrap(req => {
    const before = R.getMenu(db, req.params.id), stockBefore = R.stockQty(db, req.params.id);
    const item = R.saveMenu(db, req.params.id, req.body || {}); broadcast("menu", "stock");
    const diff = AU.changes(before, item, ["name", "price", "cat", "active", "trackStock", "opts", "img"]);
    const stockAfter = R.stockQty(db, item.id); if (stockAfter !== stockBefore) diff.stock = [stockBefore, stockAfter];
    if (!before || Object.keys(diff).length) AU.log(db, req.staff, before ? "menu_update" : "menu_create", item.name, diff);
    return { item };
  }));
  api.delete("/menu/:id", manager, wrap(req => { const m = R.getMenu(db, req.params.id); R.deleteMenu(db, req.params.id); AU.log(db, req.staff, "menu_delete", m?.name || req.params.id, m ? { price: m.price } : null); return changed("menu", "stock"); }));
  api.post("/stock/:id/add", manager, wrap(req => {
    const sid = R.id(req.params.id), q = R.num(req.body?.qty, "จำนวนที่เติม", { min: -1e5, max: 1e5, int: true }), before = R.stockQty(db, sid);
    R.addStock(db, sid, q); AU.log(db, req.staff, "stock_add", R.getMenu(db, sid)?.name || sid, { qty: q, stock: [before, R.stockQty(db, sid)] });
    return changed("stock");
  }));
  const promoOf = id => R.listPromos(db).find(p => p.id === id);
  api.put("/promos/:id", manager, wrap(req => {
    const before = promoOf(req.params.id), promo = R.savePromo(db, req.params.id, req.body || {}); broadcast("promos");
    AU.log(db, req.staff, before ? "promo_update" : "promo_create", promo.name, AU.changes(before, promo, ["type", "scope", "cat", "items", "value", "buy", "get", "min", "unit", "days", "start", "end", "from", "to", "code", "active"]));
    return { promo };
  }));
  api.patch("/promos/:id/active", manager, wrap(req => { R.setPromoActive(db, req.params.id, req.body?.active); AU.log(db, req.staff, req.body?.active ? "promo_on" : "promo_off", promoOf(req.params.id)?.name || req.params.id); return changed("promos"); }));
  api.delete("/promos/:id", manager, wrap(req => { const p = promoOf(req.params.id); db.prepare("DELETE FROM promos WHERE id = ?").run(req.params.id); AU.log(db, req.staff, "promo_delete", p?.name || req.params.id); return changed("promos"); }));
  api.put("/rewards/:id", manager, wrap(req => {
    const before = R.getReward(db, req.params.id), reward = R.saveReward(db, req.params.id, req.body || {}); broadcast("rewards", "stock");
    AU.log(db, req.staff, before ? "reward_update" : "reward_create", reward.name, AU.changes(before, reward, ["name", "kind", "itemId", "value", "points", "active", "limited"]));
    return { reward };
  }));
  api.delete("/rewards/:id", manager, wrap(req => { const r = R.getReward(db, req.params.id); R.deleteReward(db, req.params.id); AU.log(db, req.staff, "reward_delete", r?.name || req.params.id); return changed("rewards", "stock"); }));
  api.put("/config/shop", manager, wrap(req => {
    const before = R.getShop(db), shop = R.saveShop(db, req.body || {}); broadcast("shop");
    const diff = AU.changes(before, shop, Object.keys(shop)); if (Object.keys(diff).length) AU.log(db, req.staff, "shop_settings", "ข้อมูลร้าน", diff);
    return { shop };
  }));
  // backups
  api.get("/backups", manager, wrap(() => ({ backups: B.listBackups(backupDir), keep: B.KEEP })));
  api.post("/backups", manager, wrap(req => { const backup = B.backupNow(db, backupDir); AU.log(db, req.staff, "backup_now", backup.name, backup.copyError ? { copyError: backup.copyError } : null); return { backup }; }));
  api.get("/backup-settings", manager, wrap(() => ({ settings: B.publicCopy(db) })));
  api.put("/backup-settings", manager, wrap(req => { const settings = B.saveCopy(db, req.body || {}); AU.log(db, req.staff, "backup_settings", settings.copyDir || "(ไม่คัดลอก)"); return { settings }; }));
  api.get("/backups/:name", manager, (req, res, next) => {
    const file = B.backupPath(backupDir, req.params.name);
    if (!file || !fs.existsSync(file)) return next(new HttpError(404, "ไม่พบไฟล์สำรองนี้"));
    res.download(file);
  });

  // QR payments confirmed by a provider (Opn Payments) or practice mode
  api.get("/payment", manager, wrap(() => ({ payment: PAY.publicPay(db) })));
  api.put("/payment", manager, wrap(req => { const payment = PAY.savePay(db, req.body || {}); broadcast("shop"); AU.log(db, req.staff, "payment_settings", payment.provider, { keyChanged: !!req.body?.secretKey }); return { payment }; }));
  api.post("/payments/qr", wrapAsync(async req => ({ payment: await PAY.createQr(db, req.body || {}, req.staff) })));
  api.get("/payments/qr/:id", wrapAsync(async req => ({ payment: await PAY.checkQr(db, req.params.id) })));
  // look up an older bill by day + queue number (for refunds, tax invoices, reprints)
  api.get("/orders/find", wrap(req => {
    const day = String(req.query.day || ""), q = Number(req.query.queue);
    if (!DAY_RE.test(day) || !Number.isInteger(q) || q < 1) throw R.bad("ใส่วันที่และเลขคิว");
    const r = db.prepare("SELECT id FROM orders WHERE day = ? AND queue = ?").get(day, q);
    if (!r) throw new HttpError(404, "ไม่พบบิลนี้");
    return { order: R.getOrder(db, r.id) };
  }));
  // partial refunds and full tax invoices
  api.post("/orders/:id/refund", manager, wrap(req => {
    const order = S.refundOrder(db, req.params.id, req.body || {}, req.staff); broadcast("orders", "stock", "members", "shift");
    const f = order.refunds[order.refunds.length - 1];
    AU.log(db, req.staff, "order_refund", `คิว ${order.queue} (${order.day})`, { amount: f.amount, pay: f.pay, items: f.items.map(i => `${i.name} ×${i.qty}`).join(", "), reason: f.reason });
    return { order };
  }));
  api.post("/orders/:id/invoice", wrap(req => {
    const invoice = IV.issueInvoice(db, req.params.id, req.body || {}, req.staff); broadcast("orders");
    AU.log(db, req.staff, "invoice_issue", invoice.no, { buyer: invoice.buyer.name, total: invoice.total });
    return { invoice };
  }));
  api.get("/invoices/:id", wrap(req => { const r = db.prepare("SELECT * FROM tax_invoices WHERE id = ? OR no = ?").get(req.params.id, req.params.id); if (!r) throw new HttpError(404, "ไม่พบใบกำกับภาษี"); return { invoice: IV.invoiceOut(r) }; }));
  api.get("/invoice-buyer/:taxId", wrap(req => ({ buyer: IV.findBuyer(db, req.params.taxId) })));
  api.post("/invoices/:id/cancel", manager, wrap(req => { const invoice = IV.cancelInvoice(db, req.params.id, req.body || {}, req.staff); broadcast("orders"); AU.log(db, req.staff, "invoice_cancel", invoice.no, { reason: invoice.cancelReason }); return { invoice }; }));
  api.get("/invoices", manager, wrap(req => { const [from, to] = range(req.query); return { invoices: IV.listInvoices(db, new Date(from + "T00:00:00").getTime(), new Date(to + "T00:00:00").getTime() + 864e5) }; }));
  // the cashier's screen tells the customer display what to show
  api.put("/display/:station", wrap(req => { DSP.setState(req.params.station, req.body || {}); return { ok: true, watching: DSP.watching(req.params.station) }; }));
  api.post("/payments/qr/:id/simulate", manager, wrap(req => ({ payment: PAY.simulatePaid(db, req.params.id) })));

  // LINE notifications (token is write-only)
  api.get("/line", manager, wrap(() => ({ line: N.publicLine(db) })));
  api.put("/line", manager, wrap(req => { const line = N.saveLine(db, req.body || {}); AU.log(db, req.staff, "line_settings", line.enabled ? "เปิด" : "ปิด", { tokenChanged: !!req.body?.token, recipients: line.recipients.map(r => r.name || r.id.slice(0, 8)).join(", ") }); return { line }; }));
  api.post("/line/test", manager, wrapAsync(async req => {
    const only = req.body?.to ? String(req.body.to) : null;
    const r = await N.send(db, `🐰 ทดสอบการแจ้งเตือนจาก ${R.getShop(db).name}`, { force: true, only });
    if (r.skipped) throw R.bad(only ? "บันทึกผู้รับคนนี้ก่อนแล้วค่อยทดสอบ" : "ใส่ Channel access token และผู้รับก่อน");
    if (!r.sent) throw new HttpError(502, "ส่งไม่สำเร็จ: " + r.error);
    return { ok: true, sent: r.sent, failed: r.failed, error: r.error, line: N.publicLine(db) };
  }));

  api.put("/staff/:id", manager, wrap(req => {
    const before = R.listStaff(db).find(s => s.id === req.params.id), staff = A.saveStaff(db, req.params.id, req.body || {}, req.staff); broadcast("staff");
    const diff = AU.changes(before, staff, ["name", "role", "active"]); if (req.body?.pin) diff.pin = ["", "เปลี่ยนแล้ว"];
    AU.log(db, req.staff, before ? "staff_update" : "staff_create", staff.name, diff);
    return { staff };
  }));
  api.delete("/staff/:id", manager, wrap(req => { const s = R.listStaff(db).find(x => x.id === req.params.id); A.deleteStaff(db, req.params.id, req.staff); AU.log(db, req.staff, "staff_delete", s?.name || req.params.id); return changed("staff"); }));

  // image upload: raw JPEG/PNG/WebP body, up to 5 MB
  api.post("/uploads", manager, express.raw({ type: "image/*", limit: "5mb" }), wrap(req => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw R.bad("ไม่พบไฟล์รูป");
    const kind = MAGIC.find(([sig]) => sig.every((v, i) => buf[i] === v));
    if (!kind) throw R.bad("รองรับเฉพาะรูป JPG, PNG หรือ WebP");
    const name = crypto.randomBytes(12).toString("hex") + "." + kind[1];
    fs.writeFileSync(path.join(uploadsDir, name), buf);
    return { url: "/uploads/" + name };
  }));

  app.use("/api", api);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "ไม่พบ API นี้")));
  app.use("/uploads", express.static(uploadsDir, { maxAge: "30d", immutable: true }));
  app.use("/shared", express.static(path.join(ROOT, "shared")));
  // libraries and fonts served locally so the POS keeps working without internet
  const pkg = name => path.dirname(require.resolve(name + "/package.json"));
  const vendor = (url, dir) => app.use(url, express.static(dir, { maxAge: "7d" }));
  vendor("/vendor/jspdf", path.join(pkg("jspdf"), "dist"));
  vendor("/vendor/html2canvas", path.join(pkg("html2canvas"), "dist"));
  vendor("/vendor/qrcode", pkg("qrcode-generator"));
  vendor("/vendor/fonts", path.dirname(pkg("@fontsource/itim")));
  app.get("/queue", (_req, res) => res.sendFile(path.join(ROOT, "public", "queue.html")));
  app.get("/display", (_req, res) => res.sendFile(path.join(ROOT, "public", "display.html")));
  app.get("/r/:token", (_req, res) => res.sendFile(path.join(ROOT, "public", "receipt.html")));
  app.use(express.static(path.join(ROOT, "public")));

  // errors → JSON {error}
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === "entity.too.large" ? 413 : err.type === "entity.parse.failed" ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "เซิร์ฟเวอร์ขัดข้อง ลองอีกครั้ง" : status === 413 ? "ไฟล์ใหญ่เกินไป" : err.message });
  });

  app.broadcast = broadcast;
  return app;
}

module.exports = { createApp };

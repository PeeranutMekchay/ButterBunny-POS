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
  api.post("/auth/setup", wrap(req => { const r = A.setup(db, req.body || {}); broadcast("staff"); return r; }));
  api.post("/auth/login", wrap(req => A.login(db, req.body || {})));

  /* ---------- signed in ---------- */
  api.use(auth);
  api.post("/auth/logout", wrap(req => { A.logout(db, req.token); return { ok: true }; }));
  api.get("/auth/me", wrap(req => ({ staff: req.staff })));
  api.get("/bootstrap", wrap(req => {
    const today = R.bday(db);
    // orders still open from the previous two days stay on the board until someone finishes them
    const carry = db.prepare("SELECT id FROM orders WHERE day < ? AND day >= ? AND status IN ('preparing','ready')").all(today, R.shiftDays(today, -2)).map(r => R.getOrder(db, r.id));
    return { me: req.staff, shop: R.getShop(db), menu: R.listMenu(db), stock: R.listStock(db), promos: R.listPromos(db), rewards: R.listRewards(db),
      members: R.listMembers(db), staff: R.listStaff(db, { activeOnly: req.staff.role !== "manager" }), shift: O.currentShift(db), preorders: O.listPreorders(db),
      payment: { provider: PAY.getPay(db).provider },
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
  api.post("/orders/:id/void", manager, wrap(req => { const order = S.voidOrder(db, req.params.id, req.body || {}, req.staff); broadcast("orders", "stock", "members", "redeems", "shift"); return { order }; }));

  // shifts & cash drawer (any staff can open/close; history is for managers)
  api.get("/shifts/current", wrap(() => ({ shift: O.currentShift(db) })));
  api.post("/shifts/open", wrap(req => { const shift = O.openShift(db, req.body || {}, req.staff); broadcast("shift"); return { shift }; }));
  api.post("/shifts/current/moves", wrap(req => { const shift = O.addCashMove(db, req.body || {}, req.staff); broadcast("shift"); return { shift }; }));
  api.post("/shifts/current/close", wrap(req => {
    const shift = O.closeShift(db, req.body || {}, req.staff); broadcast("shift");
    notify("shiftClose", N.shiftCloseText(R.getShop(db), shift));
    return { shift };
  }));
  api.get("/shifts", manager, wrap(() => ({ shifts: O.listShifts(db, 60) })));

  // cake / party pre-orders
  api.get("/preorders", wrap(req => ({ preorders: req.query.from ? O.listPreorders(db, { from: range(req.query)[0], to: range(req.query)[1] }) : O.listPreorders(db) })));
  api.post("/preorders", wrap(req => { const preorder = O.createPreorder(db, req.body || {}, req.staff); broadcast("preorders", "shift"); return { preorder }; }));
  api.patch("/preorders/:id", wrap(req => { const preorder = O.updatePreorder(db, req.params.id, req.body || {}); broadcast("preorders"); return { preorder }; }));
  api.post("/preorders/:id/ready", wrap(req => { const preorder = O.markPreorderReady(db, req.params.id); broadcast("preorders"); return { preorder }; }));
  api.post("/preorders/:id/pickup", wrap(req => { const r = O.pickupPreorder(db, req.params.id, req.body || {}, req.staff); broadcast("preorders", "shift", "members"); return r; }));
  api.post("/preorders/:id/cancel", wrap(req => { const preorder = O.cancelPreorder(db, req.params.id, req.body || {}, req.staff); broadcast("preorders", "shift"); return { preorder }; }));

  // end-of-day waste and bake plan
  api.post("/waste", wrap(req => { const waste = O.recordWaste(db, req.body || {}, req.staff); broadcast("stock", "waste"); return { waste }; }));
  api.get("/waste", wrap(req => { const [from, to] = req.query.from ? range(req.query) : [R.bday(db), R.bday(db)]; return { waste: O.listWaste(db, from, to) }; }));
  api.get("/bake-plan", wrap(() => O.bakePlan(db)));

  // owner dashboard
  api.get("/dashboard", manager, wrap(() => O.dashboard(db)));
  api.get("/orders", manager, wrap(req => { const [from, to] = range(req.query); return { orders: R.listOrders(db, from, to), redeems: R.listRedeems(db, from, to),
    preorderPayments: O.prePaymentsInRange(db, from, to), waste: O.listWaste(db, from, to) }; }));

  // members (staff can register members; editing points and deleting is manager-only)
  api.post("/members", wrap(req => { const member = R.createMember(db, req.body || {}); broadcast("members"); return { member }; }));
  api.patch("/members/:phone", wrap(req => { const member = R.updateMember(db, req.params.phone, req.body || {}, req.staff); broadcast("members"); return { member }; }));
  api.delete("/members/:phone", manager, wrap(req => { R.deleteMember(db, req.params.phone); return changed("members"); }));
  api.get("/members/:phone/ledger", wrap(req => ({ ledger: db.prepare("SELECT delta, reason, ref, staff_name AS staffName, created_at AS createdAt FROM point_ledger WHERE member_phone = ? ORDER BY id DESC LIMIT 100").all(req.params.phone) })));

  // rewards redemption at the counter
  api.post("/redeems", wrap(req => { const r = S.redeemDirect(db, req.body || {}, req.staff); broadcast("redeems", "members", "stock"); return r; }));
  api.post("/redeems/:id/cancel", wrap(req => { const r = S.cancelRedeem(db, req.params.id, req.body || {}, req.staff); broadcast("redeems", "members", "stock"); return r; }));

  // catalog (manager)
  api.put("/menu/:id", manager, wrap(req => { const item = R.saveMenu(db, req.params.id, req.body || {}); broadcast("menu", "stock"); return { item }; }));
  api.delete("/menu/:id", manager, wrap(req => { R.deleteMenu(db, req.params.id); return changed("menu", "stock"); }));
  api.post("/stock/:id/add", manager, wrap(req => { R.addStock(db, R.id(req.params.id), R.num(req.body?.qty, "จำนวนที่เติม", { min: -1e5, max: 1e5, int: true })); return changed("stock"); }));
  api.put("/promos/:id", manager, wrap(req => { const promo = R.savePromo(db, req.params.id, req.body || {}); broadcast("promos"); return { promo }; }));
  api.patch("/promos/:id/active", manager, wrap(req => { R.setPromoActive(db, req.params.id, req.body?.active); return changed("promos"); }));
  api.delete("/promos/:id", manager, wrap(req => { db.prepare("DELETE FROM promos WHERE id = ?").run(req.params.id); return changed("promos"); }));
  api.put("/rewards/:id", manager, wrap(req => { const reward = R.saveReward(db, req.params.id, req.body || {}); broadcast("rewards", "stock"); return { reward }; }));
  api.delete("/rewards/:id", manager, wrap(req => { R.deleteReward(db, req.params.id); return changed("rewards", "stock"); }));
  api.put("/config/shop", manager, wrap(req => { const shop = R.saveShop(db, req.body || {}); broadcast("shop"); return { shop }; }));
  // backups
  api.get("/backups", manager, wrap(() => ({ backups: B.listBackups(backupDir), keep: B.KEEP })));
  api.post("/backups", manager, wrap(() => ({ backup: B.backupNow(db, backupDir) })));
  api.get("/backups/:name", manager, (req, res, next) => {
    const file = B.backupPath(backupDir, req.params.name);
    if (!file || !fs.existsSync(file)) return next(new HttpError(404, "ไม่พบไฟล์สำรองนี้"));
    res.download(file);
  });

  // QR payments confirmed by a provider (Opn Payments) or practice mode
  api.get("/payment", manager, wrap(() => ({ payment: PAY.publicPay(db) })));
  api.put("/payment", manager, wrap(req => { const payment = PAY.savePay(db, req.body || {}); broadcast("shop"); return { payment }; }));
  api.post("/payments/qr", wrapAsync(async req => ({ payment: await PAY.createQr(db, req.body || {}, req.staff) })));
  api.get("/payments/qr/:id", wrapAsync(async req => ({ payment: await PAY.checkQr(db, req.params.id) })));
  api.post("/payments/qr/:id/simulate", manager, wrap(req => ({ payment: PAY.simulatePaid(db, req.params.id) })));

  // LINE notifications (token is write-only)
  api.get("/line", manager, wrap(() => ({ line: N.publicLine(db) })));
  api.put("/line", manager, wrap(req => ({ line: N.saveLine(db, req.body || {}) })));
  api.post("/line/test", manager, wrapAsync(async () => {
    const r = await N.send(db, `🐰 ทดสอบการแจ้งเตือนจาก ${R.getShop(db).name}`, { force: true });
    if (r.skipped) throw R.bad("ใส่ Channel access token และผู้รับก่อน");
    if (!r.ok) throw new HttpError(502, "ส่งไม่สำเร็จ: " + r.error);
    return { ok: true, line: N.publicLine(db) };
  }));

  api.put("/staff/:id", manager, wrap(req => { const staff = A.saveStaff(db, req.params.id, req.body || {}, req.staff); broadcast("staff"); return { staff }; }));
  api.delete("/staff/:id", manager, wrap(req => { A.deleteStaff(db, req.params.id, req.staff); return changed("staff"); }));

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

// End-to-end API tests against a fresh in-memory database. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { openDb } = require("../server/db");
const { seedIfEmpty, addExtras } = require("../server/seed");
const { createApp } = require("../server/app");

let server, base, db;
const call = async (method, url, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.before(async () => {
  db = openDb(":memory:");
  seedIfEmpty(db); addExtras(db);
  const app = createApp({ db, uploadsDir: fs.mkdtempSync(path.join(os.tmpdir(), "bb-up-")) });
  await new Promise(r => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

let mgr, cashier, cashierId;

test("first run: setup creates the first manager once", async () => {
  const pub = await call("GET", "/public");
  assert.equal(pub.body.needsSetup, true);
  assert.equal(pub.body.menu.length, 7);
  const r = await call("POST", "/auth/setup", { name: "นุ่น", pin: "1234" });
  assert.equal(r.status, 200); mgr = r.body.token;
  assert.equal((await call("POST", "/auth/setup", { name: "อีกคน", pin: "1111" })).status, 409);
  assert.equal((await call("GET", "/public")).body.needsSetup, false);
});

test("staff: manager adds a cashier; wrong PINs lock the account", async () => {
  assert.equal((await call("PUT", "/staff/u-mew", { name: "มิว", role: "cashier", pin: "5678" }, mgr)).status, 200);
  cashierId = "u-mew";
  for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/auth/login", { staffId: cashierId, pin: "0000" })).status, 401);
  assert.equal((await call("POST", "/auth/login", { staffId: cashierId, pin: "0000" })).status, 401);
  const locked = await call("POST", "/auth/login", { staffId: cashierId, pin: "5678" });
  assert.equal(locked.status, 429);
});

test("staff: cannot remove the last manager", async () => {
  const me = (await call("GET", "/auth/me", undefined, mgr)).body.staff;
  const r = await call("PUT", "/staff/" + me.id, { name: me.name, role: "cashier" }, mgr);
  assert.equal(r.status, 400);
});

test("auth: protected routes need a session, manager routes need a manager", async () => {
  assert.equal((await call("GET", "/bootstrap")).status, 401);
  // log the cashier in directly (lock from the previous test is per-process, so reset by giving a new PIN)
  assert.equal((await call("PUT", "/staff/u-mew2", { name: "ฝน", role: "cashier", pin: "2468" }, mgr)).status, 200);
  cashier = (await call("POST", "/auth/login", { staffId: "u-mew2", pin: "2468" })).body.token;
  assert.ok(cashier);
  assert.equal((await call("PUT", "/menu/m-latte", { name: "x", cat: "coffee", price: 1 }, cashier)).status, 403);
  assert.equal((await call("GET", "/orders?from=2026-01-01&to=2026-01-02", undefined, cashier)).status, 403);
});

const stockOf = id => db.prepare("SELECT qty FROM stock WHERE id = ?").get(id)?.qty;
const pointsOf = phone => db.prepare("SELECT points FROM members WHERE phone = ?").get(phone).points;

test("shift: selling needs an open shift; only one can be open", async () => {
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-latte", qty: 1 }], pay: "card" }, cashier)).status, 409);
  assert.equal((await call("POST", "/shifts/open", { openingCash: 1000 }, cashier)).status, 200);
  assert.equal((await call("POST", "/shifts/open", { openingCash: 0 }, mgr)).status, 409);
});

test("checkout: server prices the bill, applies buy-3-get-1, cuts stock", async () => {
  const before = stockOf("m-eggtart");
  const r = await call("POST", "/orders", { lines: [{ id: "m-eggtart", qty: 4 }], type: "dine", pay: "cash", tendered: 200, expectTotal: 135 }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = r.body.order;
  assert.equal(o.subtotal, 180); assert.equal(o.total, 135); assert.equal(o.change, 65); assert.equal(o.queue, 1);
  assert.deepEqual(o.promos.map(p => p.id), ["p-tart31"]);
  assert.equal(stockOf("m-eggtart"), before - 4);
});

test("checkout: rejects a stale total, short cash and oversold stock", async () => {
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-latte", qty: 1, opt: "เย็น" }], pay: "cash", tendered: 100, expectTotal: 70 }, cashier)).status, 409);
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-latte", qty: 1, opt: "เย็น" }], pay: "cash", tendered: 10 }, cashier)).status, 400);
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-yuzu", qty: 99 }], pay: "card" }, cashier)).status, 409);
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-latte", qty: 1, opt: "ปั่นพิเศษ" }], pay: "card" }, cashier)).status, 400);
  assert.equal((await call("POST", "/orders", { lines: [{ id: "m-latte", qty: 1 }], pay: "qr" }, cashier)).status, 400, "no PromptPay set yet");
});

test("members: earn points, redeem a reward inside a bill, void restores everything", async () => {
  assert.equal((await call("POST", "/members", { phone: "0812345678", name: "ฝ้าย" }, cashier)).status, 200);
  assert.equal((await call("POST", "/members", { phone: "0812345678", name: "ซ้ำ" }, cashier)).status, 409);
  assert.equal((await call("PATCH", "/members/0812345678", { points: 300 }, cashier)).status, 403);
  assert.equal((await call("PATCH", "/members/0812345678", { points: 300 }, mgr)).status, 200);
  const tote = stockOf("rw-w-tote"), croissant = stockOf("m-croissant");
  const r = await call("POST", "/orders", { lines: [{ id: "m-croissant", qty: 1 }, { reward: "w-tote", qty: 1 }], pay: "card", memberPhone: "0812345678" }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.pointsUsed, 250); assert.equal(r.body.order.pointsEarned, 2); assert.equal(r.body.order.total, 65);
  assert.equal(pointsOf("0812345678"), 52);
  assert.equal(stockOf("rw-w-tote"), tote - 1); assert.equal(stockOf("m-croissant"), croissant - 1);
  // not enough points for another tote
  assert.equal((await call("POST", "/orders", { lines: [{ reward: "w-tote", qty: 1 }], pay: "card", memberPhone: "0812345678" }, cashier)).status, 409);
  // cashier cannot void, manager can
  assert.equal((await call("POST", `/orders/${r.body.order.id}/void`, { reason: "ทดสอบ" }, cashier)).status, 403);
  const v = await call("POST", `/orders/${r.body.order.id}/void`, { reason: "ทดสอบ", restock: true, restockRewards: true }, mgr);
  assert.equal(v.status, 200); assert.equal(v.body.order.status, "void");
  assert.equal(pointsOf("0812345678"), 300);
  assert.equal(stockOf("rw-w-tote"), tote); assert.equal(stockOf("m-croissant"), croissant);
  assert.equal((await call("POST", `/orders/${r.body.order.id}/void`, {}, mgr)).status, 409);
  const ledger = (await call("GET", "/members/0812345678/ledger", undefined, mgr)).body.ledger;
  assert.deepEqual(ledger.map(x => x.reason).sort(), ["adjust", "earn", "spend", "void"]);
});

test("redeems: counter redemption and cancellation", async () => {
  const cookie = stockOf("m-cookie");
  const r = await call("POST", "/redeems", { memberPhone: "0812345678", rewardId: "w-cookie" }, cashier);
  assert.equal(r.status, 200); assert.equal(r.body.member.points, 260); assert.equal(stockOf("m-cookie"), cookie - 1);
  assert.equal((await call("POST", "/redeems", { memberPhone: "0812345678", rewardId: "w-off50" }, cashier)).status, 400, "discount only at checkout");
  const c = await call("POST", `/redeems/${r.body.redeem.id}/cancel`, { restockItem: true }, cashier);
  assert.equal(c.status, 200); assert.equal(c.body.member.points, 300); assert.equal(stockOf("m-cookie"), cookie);
  assert.equal((await call("POST", `/redeems/${r.body.redeem.id}/cancel`, {}, cashier)).status, 409);
});

test("discount voucher from points applies at checkout", async () => {
  const r = await call("POST", "/orders", { lines: [{ id: "m-strawshort", qty: 1 }], pay: "card", memberPhone: "0812345678", voucher: "w-off50" }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.pointsDisc, 50); assert.equal(r.body.order.total, 85); assert.equal(r.body.order.pointsUsed, 100);
});

test("orders: status moves forward only; reports list the day", async () => {
  const day = (await call("GET", "/bootstrap", undefined, cashier)).body.today;
  const o = day.orders.find(x => x.status === "preparing");
  assert.equal((await call("PATCH", `/orders/${o.id}/status`, { status: "done" }, cashier)).status, 400);
  assert.equal((await call("PATCH", `/orders/${o.id}/status`, { status: "ready" }, cashier)).body.order.status, "ready");
  const rep = await call("GET", `/orders?from=${day.day}&to=${day.day}`, undefined, mgr);
  assert.equal(rep.body.orders.length, day.orders.length);
  assert.ok(rep.body.redeems.length >= 2);
});

test("catalog: validation and CRUD", async () => {
  assert.equal((await call("PUT", "/menu/m-new", { name: "", cat: "cake", price: 10 }, mgr)).status, 400);
  assert.equal((await call("PUT", "/menu/m-new", { name: "ทดสอบ", cat: "nope", price: 10 }, mgr)).status, 400);
  assert.equal((await call("PUT", "/menu/m-new", { name: "ทดสอบ", cat: "cake", price: 10, img: "javascript:alert(1)" }, mgr)).status, 400);
  const ok = await call("PUT", "/menu/m-new", { name: "คัพเค้ก", cat: "cake", price: 49, trackStock: true, stock: 6 }, mgr);
  assert.equal(ok.status, 200); assert.equal(stockOf("m-new"), 6);
  assert.equal((await call("POST", "/stock/m-new/add", { qty: 4 }, mgr)).status, 200); assert.equal(stockOf("m-new"), 10);
  assert.equal((await call("PUT", "/promos/p-x", { name: "ผิด", type: "percent", scope: "all", value: 150 }, mgr)).status, 400);
  assert.equal((await call("PUT", "/promos/p-x", { name: "ลด 10%", type: "percent", scope: "cat", cat: "cake", value: 10, start: "14:00" }, mgr)).status, 400);
  assert.equal((await call("PUT", "/promos/p-x", { name: "ลด 10%", type: "percent", scope: "cat", cat: "cake", value: 10 }, mgr)).status, 200);
  assert.equal((await call("DELETE", "/promos/p-x", undefined, mgr)).status, 200);
  assert.equal((await call("PUT", "/config/shop", { promptpay: "12345" }, mgr)).status, 400);
  assert.equal((await call("PUT", "/config/shop", { promptpay: "0812345678" }, mgr)).body.shop.promptpay, "0812345678");
  assert.equal((await call("DELETE", "/menu/m-new", undefined, mgr)).status, 200);
});

test("shared: business day honours the day start hour; birthday month doubles points", async () => {
  const P = require("../shared/pricing");
  assert.equal(P.businessDay(new Date("2026-11-19T01:30:00"), 4), "2026-11-18");
  assert.equal(P.businessDay(new Date("2026-11-19T04:00:00"), 4), "2026-11-19");
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  assert.equal((await call("POST", "/members", { phone: "0822222222", name: "เกิดเดือนนี้", birthday: month + "-15" }, cashier)).status, 200);
  assert.equal((await call("POST", "/members", { phone: "0833333333", name: "ผิด", birthday: "13-40" }, cashier)).status, 400);
  const r = await call("POST", "/orders", { lines: [{ id: "m-basque", qty: 2 }], pay: "card", memberPhone: "0822222222" }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.pointsEarned, Math.floor(250 / 25) * 2);
});

test("preorders: deposit, pickup with change, cancel with refund", async () => {
  const p = await call("POST", "/preorders", { customer: "คุณแพร", phone: "0899999999", pickupDay: "2026-12-24", pickupTime: "15:00",
    title: "เค้กช็อกโกแลต 2 ปอนด์", message: "Happy Birthday แพร", total: 900, deposit: 300, pay: "cash" }, cashier);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.preorder.code, "P0001"); assert.equal(p.body.preorder.balance, 600);
  assert.equal((await call("POST", "/preorders", { customer: "x", pickupDay: "2026-12-24", title: "x", total: 100, deposit: 200, pay: "cash" }, cashier)).status, 400);
  const id = p.body.preorder.id;
  assert.equal((await call("PATCH", `/preorders/${id}`, { total: 200 }, cashier)).status, 400, "total below paid");
  assert.equal((await call("POST", `/preorders/${id}/ready`, {}, cashier)).body.preorder.status, "ready");
  const pick = await call("POST", `/preorders/${id}/pickup`, { pay: "cash", tendered: 1000 }, cashier);
  assert.equal(pick.status, 200); assert.equal(pick.body.change, 400); assert.equal(pick.body.preorder.status, "picked"); assert.equal(pick.body.preorder.balance, 0);
  assert.equal((await call("POST", `/preorders/${id}/pickup`, { pay: "cash", tendered: 1000 }, cashier)).status, 409);
  const q = await call("POST", "/preorders", { customer: "คุณบี", pickupDay: "2026-12-25", title: "คัพเค้ก 12 ชิ้น", total: 480, deposit: 200, pay: "qr" }, cashier);
  const c = await call("POST", `/preorders/${q.body.preorder.id}/cancel`, { refund: true, pay: "qr", reason: "ลูกค้ายกเลิก" }, cashier);
  assert.equal(c.body.preorder.status, "cancelled"); assert.equal(c.body.preorder.paid, 0);
  const sh = (await call("GET", "/shifts/current", undefined, cashier)).body.shift.summary;
  assert.equal(sh.preorder.cash, 900); assert.equal(sh.preorder.qr, 0);
});

test("waste: throwing away reduces stock; bake plan suggests quantities", async () => {
  const before = stockOf("m-cookie");
  assert.equal((await call("POST", "/waste", { items: [{ menuId: "m-cookie", qty: 3 }], reason: "หมดอายุ" }, cashier)).status, 200);
  assert.equal(stockOf("m-cookie"), before - 3);
  assert.equal((await call("POST", "/waste", { items: [{ menuId: "m-cookie", qty: 9999 }] }, cashier)).status, 400);
  const plan = (await call("GET", "/bake-plan", undefined, cashier)).body;
  const tart = plan.items.find(i => i.id === "m-eggtart");
  assert.ok(tart && tart.soldToday >= 4 && Number.isInteger(tart.suggest));
});

test("queue screen and dashboard", async () => {
  const q = (await call("GET", "/queue")).body;
  assert.ok(q.preparing.length + q.ready.length >= 1);
  assert.equal(JSON.stringify(q).includes("total"), false, "queue screen shows no money");
  assert.equal((await call("GET", "/dashboard", undefined, cashier)).status, 403);
  const d = (await call("GET", "/dashboard", undefined, mgr)).body;
  assert.ok(d.today.sales > 0 && d.hourly.today.length === 24 && d.shift);
});

test("line: settings hide the token; test message and shift-close summary are pushed", async () => {
  const http = require("node:http");
  const got = [];
  const stub = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { got.push({ auth: req.headers.authorization, url: req.url, body: JSON.parse(b) }); res.end("{}"); }); });
  await new Promise(r => stub.listen(0, "127.0.0.1", r));
  process.env.LINE_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const to = "U" + "a".repeat(32);
  assert.equal((await call("PUT", "/line", { enabled: true, token: "", to }, mgr)).status, 400, "needs a token");
  const saved = await call("PUT", "/line", { enabled: true, token: "secret-token-1234", to }, mgr);
  assert.equal(saved.body.line.hasToken, true); assert.equal(JSON.stringify(saved.body).includes("secret-token"), false);
  assert.equal((await call("POST", "/line/test", {}, mgr)).status, 200);
  assert.equal(got[0].auth, "Bearer secret-token-1234"); assert.equal(got[0].url, "/v2/bot/message/push"); assert.equal(got[0].body.to, to);
  // close the shift: counted cash vs expected, and a LINE summary
  const cur = (await call("GET", "/shifts/current", undefined, cashier)).body.shift;
  const closed = await call("POST", "/shifts/current/close", { counted: cur.expectedCash - 20, note: "ทอนผิด" }, cashier);
  assert.equal(closed.status, 200); assert.equal(closed.body.shift.diff, -20);
  await new Promise(r => setTimeout(r, 300));
  assert.ok(got.some(g => g.body.messages[0].text.includes("ปิดกะ") && g.body.messages[0].text.includes("ขาด")));
  assert.equal((await call("GET", "/shifts/current", undefined, cashier)).body.shift, null);
  assert.equal((await call("GET", "/shifts", undefined, mgr)).body.shifts.length, 1);
  stub.close(); delete process.env.LINE_API_BASE;
});

test("backups: create, list, download", async () => {
  const made = await call("POST", "/backups", {}, mgr);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const list = (await call("GET", "/backups", undefined, mgr)).body.backups;
  assert.equal(list[0].name, made.body.backup.name);
  const res = await fetch(`${base}/backups/${made.body.backup.name}`, { headers: { Authorization: "Bearer " + mgr } });
  assert.equal(res.status, 200); assert.ok((await res.arrayBuffer()).byteLength > 10000);
  assert.equal((await call("GET", "/backups/..%2Fbutterbunny.db", undefined, mgr)).status, 404);
});

test("pound cakes are on the menu and priced per pound", async () => {
  const menu = (await call("GET", "/bootstrap", undefined, mgr)).body.menu;
  const cake = menu.find(m => m.id === "m-poundchoc");
  assert.ok(cake); assert.equal(cake.price, 250);
  assert.deepEqual(cake.opts.map(o => o.add), [0, 125, 250, 500, 750]);
  assert.equal(addExtras(db), 0, "extras are added only once");
  assert.equal((await call("POST", "/shifts/open", { openingCash: 0 }, mgr)).status, 200);
  const r = await call("POST", "/orders", { lines: [{ id: "m-poundchoc", opt: "2 ปอนด์", qty: 1 }], pay: "card" }, cashier);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.order.subtotal, 500);
  assert.equal(r.body.order.total, 450, "spend-500-get-50-off promotion applies");
});

test("qr payments: demo mode confirms itself; an unpaid or reused QR is refused", async () => {
  assert.equal((await call("POST", "/payments/qr", { amount: 70 }, cashier)).status, 400, "not configured yet");
  assert.equal((await call("PUT", "/payment", { provider: "opn" }, mgr)).status, 400, "opn needs a key");
  assert.equal((await call("PUT", "/payment", { provider: "demo" }, mgr)).body.payment.provider, "demo");
  const qr = (await call("POST", "/payments/qr", { amount: 70 }, cashier)).body.payment;
  assert.equal(qr.status, "pending");
  const sale = { lines: [{ id: "m-latte", qty: 1, opt: "ร้อน" }], pay: "qr", paymentId: qr.id, expectTotal: 70 };
  assert.equal((await call("POST", "/orders", sale, cashier)).status, 409, "not paid yet");
  assert.equal((await call("POST", `/payments/qr/${qr.id}/simulate`, {}, cashier)).status, 403);
  assert.equal((await call("POST", `/payments/qr/${qr.id}/simulate`, {}, mgr)).body.payment.status, "paid");
  assert.equal((await call("GET", `/payments/qr/${qr.id}`, undefined, cashier)).body.payment.status, "paid");
  const ok = await call("POST", "/orders", sale, cashier);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.ok(ok.body.order.ref.startsWith("ทดลอง"));
  assert.equal((await call("POST", "/orders", sale, cashier)).status, 409, "QR used once");
  const qr2 = (await call("POST", "/payments/qr", { amount: 50 }, cashier)).body.payment;
  await call("POST", `/payments/qr/${qr2.id}/simulate`, {}, mgr);
  assert.equal((await call("POST", "/orders", { ...sale, paymentId: qr2.id }, cashier)).status, 409, "amount must match");
});

test("qr payments: Opn Payments charge is created, polled and claimed", async () => {
  const http = require("node:http");
  let status = "pending"; const seen = [];
  const stub = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
      res.setHeader("Content-Type", req.url.startsWith("/qr") ? "image/svg+xml" : "application/json");
      if (req.url.startsWith("/qr")) return res.end("<svg xmlns='http://www.w3.org/2000/svg'/>");
      if (req.method === "POST") return res.end(JSON.stringify({ object: "charge", id: "chrg_test_1", amount: 8500, status: "pending", source: { scannable_code: { image: { download_uri: `http://127.0.0.1:${stub.address().port}/qr/1` } } } }));
      res.end(JSON.stringify({ object: "charge", id: "chrg_test_1", amount: 8500, status }));
    });
  });
  await new Promise(r => stub.listen(0, "127.0.0.1", r));
  process.env.OPN_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  const saved = await call("PUT", "/payment", { provider: "opn", secretKey: "skey_test_abc123" }, mgr);
  assert.equal(saved.body.payment.hasKey, true); assert.equal(JSON.stringify(saved.body).includes("skey_test_abc123"), false);
  const qr = (await call("POST", "/payments/qr", { amount: 85 }, cashier)).body.payment;
  assert.ok(qr.qr.startsWith("data:image/svg+xml;base64,"));
  assert.ok(seen[0].body.includes("amount=8500") && seen[0].body.includes("source%5Btype%5D=promptpay"));
  assert.equal(seen[0].auth, "Basic " + Buffer.from("skey_test_abc123:").toString("base64"));
  assert.equal((await call("GET", `/payments/qr/${qr.id}`, undefined, cashier)).body.payment.status, "pending");
  status = "successful";
  assert.equal((await call("GET", `/payments/qr/${qr.id}`, undefined, cashier)).body.payment.status, "paid");
  const ok = await call("POST", "/orders", { lines: [{ id: "m-caramel", qty: 1, opt: "ร้อน" }], pay: "qr", paymentId: qr.id, expectTotal: 85 }, cashier);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.order.ref, "chrg_test_1");
  await call("PUT", "/payment", { provider: "none" }, mgr);
  stub.close(); delete process.env.OPN_API_BASE;
});

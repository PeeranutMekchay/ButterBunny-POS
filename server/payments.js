// QR payments that confirm themselves.
// A plain PromptPay QR cannot tell the shop that money arrived, so automatic confirmation goes
// through a payment provider. Supported:
//   • "opn"  – Opn Payments (Omise): a PromptPay charge per bill; we poll its status.
//   • "demo" – practice mode: a manager presses "simulate paid" to see the whole flow.
//   • "none" – the static PromptPay QR with manual confirmation (default).
const crypto = require("node:crypto");
const { json } = require("./db");
const R = require("./repo");
const { HttpError, bad } = R;

const OPN = () => process.env.OPN_API_BASE || "https://api.omise.co";
const DEFAULTS = { provider: "none", secretKey: "" };
const getPay = db => ({ ...DEFAULTS, ...json(db.prepare("SELECT value FROM config WHERE key = 'payment'").get()?.value, {}) });
const publicPay = db => { const p = getPay(db); return { provider: p.provider, hasKey: !!p.secretKey, keyHint: p.secretKey ? "…" + p.secretKey.slice(-4) : "" }; };
function savePay(db, d) {
  const cur = getPay(db);
  if (!["none", "opn", "demo"].includes(d.provider)) throw bad("เลือกผู้ให้บริการรับชำระเงิน");
  const out = { ...cur, provider: d.provider };
  if (typeof d.secretKey === "string" && d.secretKey.trim()) {
    if (!/^skey_(test_)?[A-Za-z0-9]+$/.test(d.secretKey.trim())) throw bad("Secret key ของ Opn ต้องขึ้นต้นด้วย skey_");
    out.secretKey = d.secretKey.trim();
  }
  if (out.provider === "opn" && !out.secretKey) throw bad("ใส่ Secret key ของ Opn Payments ก่อน");
  db.prepare("INSERT INTO config (key, value) VALUES ('payment', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return publicPay(db);
}

const auth = key => "Basic " + Buffer.from(key + ":").toString("base64");
async function opn(key, method, path, form) {
  const res = await fetch(OPN() + path, { method, headers: { Authorization: auth(key), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.object === "error") throw new HttpError(502, "Opn Payments: " + (body.message || res.status));
  return body;
}
const rowOut = r => r && ({ id: r.id, provider: r.provider, amount: r.amount, status: r.status, createdAt: r.created_at, paidAt: r.paid_at, orderId: r.order_id, qr: r.qr, ref: r.provider_ref });
const getRow = (db, id) => db.prepare("SELECT * FROM qr_payments WHERE id = ?").get(String(id));

async function createQr(db, { amount }, staff) {
  const p = getPay(db);
  if (p.provider === "none") throw bad("ยังไม่ได้ตั้งค่าการรับชำระเงินอัตโนมัติ");
  const amt = R.num(amount, "ยอดเงิน", { min: 1, max: 1e6 });
  const id = "qp" + crypto.randomBytes(8).toString("hex"), t = Date.now();
  let ref = id, qr = null;
  if (p.provider === "opn") {
    const ch = await opn(p.secretKey, "POST", "/charges", { amount: String(Math.round(amt * 100)), currency: "thb", "source[type]": "promptpay", "metadata[pos_payment]": id });
    ref = ch.id;
    const uri = ch.source?.scannable_code?.image?.download_uri;
    if (uri) {
      // the QR image needs the secret key, so the server fetches it and hands the browser a data URL
      const img = await fetch(uri, { headers: { Authorization: auth(p.secretKey) }, signal: AbortSignal.timeout(15000) });
      if (img.ok) qr = `data:${img.headers.get("content-type") || "image/svg+xml"};base64,` + Buffer.from(await img.arrayBuffer()).toString("base64");
    }
  }
  db.prepare("INSERT INTO qr_payments (id, provider, provider_ref, amount, status, created_at, staff_name, qr) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)").run(id, p.provider, ref, amt, t, staff.name, qr);
  return rowOut(getRow(db, id));
}
async function checkQr(db, id) {
  const r = getRow(db, id);
  if (!r) throw new HttpError(404, "ไม่พบรายการชำระเงินนี้");
  if (r.status !== "pending" || r.provider !== "opn") return rowOut(r);
  const p = getPay(db);
  const ch = await opn(p.secretKey, "GET", "/charges/" + encodeURIComponent(r.provider_ref));
  const map = { successful: "paid", failed: "failed", expired: "expired", reversed: "failed" };
  const st = map[ch.status];
  if (st === "paid" && Math.round(ch.amount) !== Math.round(r.amount * 100)) throw new HttpError(409, "ยอดเงินที่ได้รับไม่ตรงกับบิล");
  if (st) db.prepare("UPDATE qr_payments SET status = ?, paid_at = ? WHERE id = ? AND status = 'pending'").run(st, st === "paid" ? Date.now() : null, r.id);
  return rowOut(getRow(db, id));
}
function simulatePaid(db, id) {
  const r = getRow(db, id);
  if (!r) throw new HttpError(404, "ไม่พบรายการชำระเงินนี้");
  if (r.provider !== "demo") throw bad("จำลองการโอนได้เฉพาะโหมดทดลอง");
  db.prepare("UPDATE qr_payments SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(Date.now(), r.id);
  return rowOut(getRow(db, id));
}
// called inside the checkout transaction: the payment must be paid, unused and for the same amount
function claimForOrder(db, id, total, orderId) {
  const r = getRow(db, id);
  if (!r) throw bad("ไม่พบรายการชำระเงิน QR นี้");
  if (r.status !== "paid") throw new HttpError(409, "ยังไม่ได้รับเงินจาก QR นี้");
  if (r.order_id) throw new HttpError(409, "QR นี้ถูกใช้กับบิลอื่นไปแล้ว");
  if (Math.abs(r.amount - total) > 0.009) throw new HttpError(409, "ยอดที่ลูกค้าโอนไม่ตรงกับยอดบิล");
  db.prepare("UPDATE qr_payments SET order_id = ? WHERE id = ?").run(orderId, r.id);
  return r.provider === "demo" ? "ทดลอง " + r.id.slice(-6) : r.provider_ref;
}

module.exports = { getPay, publicPay, savePay, createQr, checkQr, simulatePaid, claimForOrder };

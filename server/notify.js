// LINE notifications through the LINE Messaging API (push message).
// LINE Notify shut down on 31 Mar 2025, so the shop uses a LINE Official Account instead:
// a channel access token plus the user ID or group ID that should receive the messages.
const { json } = require("./db");
const R = require("./repo");

const API = () => (process.env.LINE_API_BASE || "https://api.line.me") + "/v2/bot/message/push";
const EVENTS = ["shiftClose", "lowStock", "preorderDue", "backupFail"];
const DEFAULTS = { enabled: false, token: "", to: "", events: { shiftClose: true, lowStock: true, preorderDue: true, backupFail: true }, reminderHour: 17 };

const getLine = db => { const v = json(db.prepare("SELECT value FROM config WHERE key = 'line'").get()?.value, {}); return { ...DEFAULTS, ...v, events: { ...DEFAULTS.events, ...(v.events || {}) } }; };
// what the settings page may see: never the token itself
function publicLine(db) {
  const l = getLine(db), meta = k => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value || null;
  return { enabled: l.enabled, to: l.to, hasToken: !!l.token, tokenHint: l.token ? "…" + l.token.slice(-4) : "", events: l.events, reminderHour: l.reminderHour,
    lastSent: meta("line_last_ok"), lastError: meta("line_last_error") };
}
function saveLine(db, d) {
  const cur = getLine(db);
  const out = { ...cur, enabled: !!d.enabled, to: R.str(d.to, 64, "ผู้รับ (User ID / Group ID)"), events: { ...cur.events },
    reminderHour: R.num(d.reminderHour ?? cur.reminderHour, "เวลาเตือนออเดอร์ล่วงหน้า", { min: 0, max: 23, int: true }) };
  if (out.to && !/^[CUR][0-9a-f]{32}$/.test(out.to)) throw R.bad("ผู้รับต้องเป็น User ID / Group ID ของ LINE (ขึ้นต้นด้วย U, C หรือ R ตามด้วย 32 ตัวอักษร)");
  for (const e of EVENTS) if (d.events && e in d.events) out.events[e] = !!d.events[e];
  if (typeof d.token === "string" && d.token.trim()) out.token = d.token.trim();
  if (d.clearToken) out.token = "";
  if (out.enabled && (!out.token || !out.to)) throw R.bad("ใส่ Channel access token และผู้รับให้ครบก่อนเปิดใช้");
  db.prepare("INSERT INTO config (key, value) VALUES ('line', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return publicLine(db);
}
const setMeta = (db, k, v) => db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

async function send(db, text, { force = false } = {}) {
  const l = getLine(db);
  if (!l.token || !l.to || (!l.enabled && !force)) return { ok: false, skipped: true };
  try {
    const res = await fetch(API(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + l.token },
      body: JSON.stringify({ to: l.to, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`LINE ตอบกลับ ${res.status}: ${(await res.text()).slice(0, 200)}`);
    setMeta(db, "line_last_ok", String(Date.now()));
    return { ok: true };
  } catch (e) {
    setMeta(db, "line_last_error", `${new Date().toLocaleString("th-TH")} · ${e.message}`);
    return { ok: false, error: e.message };
  }
}
// fire-and-forget for one event type; never blocks or fails the request that caused it
function makeNotifier(db) {
  return (event, text) => { const l = getLine(db); if (l.enabled && l.events[event]) send(db, text).catch(() => {}); };
}

const baht = n => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const lowStockText = items => `⚠️ สต็อกใกล้หมด\n${items.map(i => `• ${i.name} เหลือ ${i.qty}`).join("\n")}`;
function shiftCloseText(shop, s) {
  const x = s.summary, d = s.diff;
  return [`🐰 ${shop.name} ปิดกะแล้ว`, `ปิดโดย ${s.closedBy} · ${new Date(s.closedAt).toLocaleString("th-TH")}`, "",
    `ยอดขาย ${baht(x.sales)} (${x.bills} บิล)`, `เงินสด ${baht(x.byPay.cash)} · พร้อมเพย์ ${baht(x.byPay.qr)} · บัตร ${baht(x.byPay.card)}`,
    x.voids ? `ยกเลิก ${x.voids} บิล (${baht(x.voidTotal)})` : null,
    (x.preorder.cash || x.preorder.qr || x.preorder.card) ? `รับเงินออเดอร์ล่วงหน้า ${baht(x.preorder.cash + x.preorder.qr + x.preorder.card)}` : null, "",
    `เงินในลิ้นชักที่ควรมี ${baht(s.expectedCash)}`, `นับได้จริง ${baht(s.countedCash)}`,
    d === 0 ? "✅ ตรงพอดี" : d > 0 ? `⬆️ เกิน ${baht(d)}` : `⬇️ ขาด ${baht(-d)}`].filter(v => v !== null).join("\n");
}
function preorderDueText(day, list) {
  return `🎂 ออเดอร์ล่วงหน้าที่ต้องรับพรุ่งนี้ (${day}) ${list.length} รายการ\n` +
    list.map(p => `• ${p.pickupTime || "--:--"} ${p.code} ${p.title} ×${p.qty} · ${p.customer}${p.balance ? ` · ค้างจ่าย ${baht(p.balance)}` : ""}`).join("\n");
}

module.exports = { getLine, publicLine, saveLine, send, makeNotifier, lowStockText, shiftCloseText, preorderDueText, setMeta };

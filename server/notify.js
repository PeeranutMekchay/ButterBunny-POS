// LINE notifications through the LINE Messaging API (push message).
// LINE Notify shut down on 31 Mar 2025, so the shop uses a LINE Official Account instead:
// a channel access token plus the user ID or group ID that should receive the messages.
const { json } = require("./db");
const R = require("./repo");

const API = () => (process.env.LINE_API_BASE || "https://api.line.me") + "/v2/bot/message/push";
const EVENTS = ["shiftClose", "lowStock", "preorderDue", "backupFail"];
const ALL_ON = { shiftClose: true, lowStock: true, preorderDue: true, backupFail: true };
const DEFAULTS = { enabled: false, token: "", recipients: [], reminderHour: 17 };
const MAX_RECIPIENTS = 10;
const ID_RE = /^[CUR][0-9a-f]{32}$/;

// Older settings had one "to" plus one set of events: they become the first recipient.
function getLine(db) {
  const v = json(db.prepare("SELECT value FROM config WHERE key = 'line'").get()?.value, {});
  let recipients = Array.isArray(v.recipients) ? v.recipients : v.to ? [{ id: v.to, name: "เจ้าของร้าน", events: { ...ALL_ON, ...(v.events || {}) } }] : [];
  recipients = recipients.map(r => ({ id: r.id, name: r.name || "", events: { ...ALL_ON, ...(r.events || {}) } }));
  return { ...DEFAULTS, enabled: !!v.enabled, token: v.token || "", reminderHour: v.reminderHour ?? DEFAULTS.reminderHour, recipients };
}
const wants = (l, event) => l.enabled && l.recipients.some(r => r.events[event]);
// what the settings page may see: never the token itself
function publicLine(db) {
  const l = getLine(db), meta = k => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value || null;
  return { enabled: l.enabled, recipients: l.recipients, hasToken: !!l.token, tokenHint: l.token ? "…" + l.token.slice(-4) : "", reminderHour: l.reminderHour,
    lastSent: meta("line_last_ok"), lastError: meta("line_last_error") };
}
function saveLine(db, d) {
  const cur = getLine(db);
  const out = { enabled: !!d.enabled, token: cur.token, reminderHour: R.num(d.reminderHour ?? cur.reminderHour, "เวลาเตือนออเดอร์ล่วงหน้า", { min: 0, max: 23, int: true }), recipients: cur.recipients };
  if (Array.isArray(d.recipients)) {
    if (d.recipients.length > MAX_RECIPIENTS) throw R.bad(`ใส่ผู้รับได้ไม่เกิน ${MAX_RECIPIENTS} คน`);
    const seen = new Set();
    out.recipients = d.recipients.map((r, i) => {
      const id = String(r?.id || "").trim();
      if (!ID_RE.test(id)) throw R.bad(`ผู้รับคนที่ ${i + 1}: ต้องเป็น User ID / Group ID ของ LINE (ขึ้นต้นด้วย U, C หรือ R ตามด้วย 32 ตัวอักษร)`);
      if (seen.has(id)) throw R.bad(`ผู้รับคนที่ ${i + 1} ซ้ำกับคนก่อนหน้า`); seen.add(id);
      const events = {}; for (const e of EVENTS) events[e] = !!r?.events?.[e];
      return { id, name: R.str(r?.name, 30, "ชื่อผู้รับ"), events };
    });
  }
  if (typeof d.token === "string" && d.token.trim()) out.token = d.token.trim();
  if (d.clearToken) out.token = "";
  if (out.enabled && (!out.token || !out.recipients.length)) throw R.bad("ใส่ Channel access token และผู้รับอย่างน้อย 1 คนก่อนเปิดใช้");
  db.prepare("INSERT INTO config (key, value) VALUES ('line', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return publicLine(db);
}
const setMeta = (db, k, v) => db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

async function pushTo(token, to, text) {
  const res = await fetch(API(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ to, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`LINE ตอบกลับ ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
// event: send only to recipients who chose it; force (test button): everyone, even while switched off
async function send(db, text, { event = null, force = false, only = null } = {}) {
  const l = getLine(db);
  const targets = l.recipients.filter(r => only ? r.id === only : force || !event || r.events[event]);
  if (!l.token || !targets.length || (!l.enabled && !force)) return { ok: false, skipped: true, sent: 0 };
  const errors = [];
  let sent = 0;
  for (const r of targets) {
    try { await pushTo(l.token, r.id, text); sent++; }
    catch (e) { errors.push(`${r.name || r.id.slice(0, 8) + "…"}: ${e.message}`); }
  }
  if (sent) setMeta(db, "line_last_ok", String(Date.now()));
  if (errors.length) setMeta(db, "line_last_error", `${new Date().toLocaleString("th-TH")} · ${errors.join(" | ")}`);
  else if (sent) db.prepare("DELETE FROM meta WHERE key = 'line_last_error'").run();
  return { ok: sent > 0 && !errors.length, sent, failed: errors.length, error: errors.join(" | ") || null };
}
// fire-and-forget for one event type; never blocks or fails the request that caused it
function makeNotifier(db) {
  return (event, text) => { if (wants(getLine(db), event)) send(db, text, { event }).catch(() => {}); };
}

const baht = n => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const lowStockText = items => `⚠️ สต็อกใกล้หมด\n${items.map(i => `• ${i.name} เหลือ ${i.qty}`).join("\n")}`;
const thDay = day => new Date(day + "T12:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const preState = p => p.status === "cancelled" ? " · ยกเลิกแล้ว" : p.status === "picked" ? " · รับของแล้ว" : p.balance ? ` · ค้างจ่าย ${baht(p.balance)}` : " · จ่ายครบ";
const preLine = (p, withDay) => `• ${withDay ? thDay(p.pickupDay) + " " : ""}${p.pickupTime || "--:--"} ${p.code} ${p.title}${p.qty > 1 ? " ×" + p.qty : ""} · ${p.customer}${preState(p)}`;
const preList = (title, list, withDay) => !list.length ? [] : [`${title} ${list.length} รายการ`, ...list.slice(0, 10).map(p => preLine(p, withDay)), ...(list.length > 10 ? [`…และอีก ${list.length - 10} รายการ`] : [])];
// pre = { taken, todayLeft, tomorrow, overdue, tomorrowDay } from ops.shiftPreorders
function shiftCloseText(shop, s, pre) {
  const x = s.summary, d = s.diff;
  const preLines = pre ? [
    ...preList("📝 รับออเดอร์ใหม่ในกะนี้", pre.taken, true),
    ...preList("⏰ วันนี้ยังไม่มารับ", pre.todayLeft, false),
    ...preList(`🎂 ต้องส่งพรุ่งนี้ (${thDay(pre.tomorrowDay)})`, pre.tomorrow, false),
    ...preList("⚠️ เลยวันรับแล้ว", pre.overdue, true),
  ] : [];
  return [`🐰 ${shop.name} ปิดกะแล้ว`, `ปิดโดย ${s.closedBy} · ${new Date(s.closedAt).toLocaleString("th-TH")}`, "",
    `ยอดขาย ${baht(x.sales)} (${x.bills} บิล)`, `เงินสด ${baht(x.byPay.cash)} · พร้อมเพย์ ${baht(x.byPay.qr)} · บัตร ${baht(x.byPay.card)}`,
    x.voids ? `ยกเลิก ${x.voids} บิล (${baht(x.voidTotal)})` : null,
    x.refunds?.count ? `คืนเงิน ${x.refunds.count} ครั้ง (${baht(x.refunds.total)}) หักจากยอดแล้ว` : null,
    (x.preorder.cash || x.preorder.qr || x.preorder.card) ? `รับเงินออเดอร์ล่วงหน้า ${baht(x.preorder.cash + x.preorder.qr + x.preorder.card)}` : null, "",
    `เงินในลิ้นชักที่ควรมี ${baht(s.expectedCash)}`, `นับได้จริง ${baht(s.countedCash)}`,
    d === 0 ? "✅ ตรงพอดี" : d > 0 ? `⬆️ เกิน ${baht(d)}` : `⬇️ ขาด ${baht(-d)}`,
    ...(preLines.length ? ["", "— ออเดอร์ล่วงหน้า —", ...preLines] : [])].filter(v => v !== null).join("\n");
}
function preorderDueText(day, list) {
  return `🎂 ออเดอร์ล่วงหน้าที่ต้องรับพรุ่งนี้ (${day}) ${list.length} รายการ\n` +
    list.map(p => `• ${p.pickupTime || "--:--"} ${p.code} ${p.title} ×${p.qty} · ${p.customer}${p.balance ? ` · ค้างจ่าย ${baht(p.balance)}` : ""}`).join("\n");
}

module.exports = { getLine, wants, publicLine, saveLine, send, makeNotifier, lowStockText, shiftCloseText, preorderDueText, setMeta };

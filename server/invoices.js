// Full tax invoices (ใบกำกับภาษีเต็มรูป) issued from a paid bill when the customer asks for one.
// Numbers run per Buddhist year and are never reused: a cancelled invoice keeps its number.
const { tx, json } = require("./db");
const pricing = require("../shared/pricing");
const R = require("./repo");
const { HttpError, bad } = R;
const r2 = pricing.r2;

const TAXID_RE = /^\d{13}$/;
function invoiceOut(r) {
  if (!r) return null;
  return { id: r.id, no: r.no, orderId: r.order_id, createdAt: r.created_at, staffName: r.staff_name,
    buyer: { name: r.buyer_name, taxId: r.buyer_tax_id, branch: r.buyer_branch, address: r.buyer_address },
    seller: json(r.seller, {}), items: json(r.items, []), total: r.total, vat: r.vat, base: r2(r.total - r.vat),
    cancelledAt: r.cancelled_at, cancelledBy: r.cancelled_by, cancelReason: r.cancel_reason };
}
const activeFor = (db, oid) => invoiceOut(db.prepare("SELECT * FROM tax_invoices WHERE order_id = ? AND cancelled_at IS NULL").get(oid));

function buyerFields(d) {
  const taxId = String(d.taxId || "").replace(/\D/g, "");
  if (!TAXID_RE.test(taxId)) throw bad("เลขประจำตัวผู้เสียภาษีของผู้ซื้อต้องมี 13 หลัก (บุคคลธรรมดาใช้เลขบัตรประชาชน)");
  let branch = String(d.branch || "").trim();
  if (!branch || /^(สำนักงานใหญ่|สนญ\.?|00000|0)$/.test(branch)) branch = "สำนักงานใหญ่";
  else if (/^\d{1,5}$/.test(branch)) branch = branch.padStart(5, "0");
  else branch = R.str(branch, 40, "สาขาของผู้ซื้อ");
  return { name: R.str(d.name, 120, "ชื่อผู้ซื้อ", { required: true }), taxId, branch, address: R.str(d.address, 300, "ที่อยู่ผู้ซื้อ", { required: true }) };
}

function issueInvoice(db, oid, d, staff, now = new Date()) {
  const shop = R.getShop(db);
  if (shop.vat !== "incl") throw bad("ร้านตั้งค่าเป็นไม่จด VAT ออกใบกำกับภาษีไม่ได้ (แก้ที่หน้าร้านค้า)");
  if (!TAXID_RE.test(String(shop.taxId || ""))) throw bad("ใส่เลขประจำตัวผู้เสียภาษี 13 หลักของร้านที่หน้าร้านค้าก่อน");
  if (!shop.address) throw bad("ใส่ที่อยู่ร้านที่หน้าร้านค้าก่อน (ต้องพิมพ์บนใบกำกับภาษี)");
  const buyer = buyerFields(d || {});
  return tx(db, () => {
    const o = R.getOrder(db, String(oid));
    if (!o) throw new HttpError(404, "ไม่พบบิลนี้");
    if (o.status === "void") throw bad("บิลนี้ถูกยกเลิกแล้ว");
    if (activeFor(db, o.id)) throw new HttpError(409, "บิลนี้ออกใบกำกับภาษีไปแล้ว");
    const total = r2(o.total - (o.refunded || 0));
    if (total <= 0) throw bad("บิลนี้คืนเงินครบแล้ว");
    // items net of refunded quantities; discounts shown as one line so the sum equals the bill
    const back = {}; for (const f of o.refunds || []) for (const it of f.items) back[it.line] = (back[it.line] || 0) + it.qty;
    const items = o.items.map((l, i) => ({ name: l.name + (l.opt ? ` (${l.opt})` : ""), qty: l.qty - (back[i + 1] || 0), unit: l.unit }))
      .filter(l => l.qty > 0 && l.unit > 0).map(l => ({ ...l, amount: r2(l.qty * l.unit) }));
    const gross = r2(items.reduce((a, l) => a + l.amount, 0));
    if (gross - total > 0.009) items.push({ name: "ส่วนลด", qty: 1, unit: r2(total - gross), amount: r2(total - gross) });
    const year = now.getFullYear() + 543;
    const seq = db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 n FROM tax_invoices WHERE year = ?").get(year).n;
    const no = `INV${year}-${String(seq).padStart(5, "0")}`, id = "iv" + require("node:crypto").randomBytes(8).toString("hex");
    const seller = { name: shop.name, taxId: shop.taxId, branch: shop.taxBranch || "สำนักงานใหญ่", address: shop.address, phone: shop.phone };
    db.prepare(`INSERT INTO tax_invoices (id, no, year, seq, order_id, created_at, staff_name, buyer_name, buyer_tax_id, buyer_branch, buyer_address, seller, items, total, vat)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, no, year, seq, o.id, now.getTime(), staff.name, buyer.name, buyer.taxId, buyer.branch, buyer.address,
      JSON.stringify(seller), JSON.stringify(items), total, r2(total * 7 / 107));
    return invoiceOut(db.prepare("SELECT * FROM tax_invoices WHERE id = ?").get(id));
  });
}

function cancelInvoice(db, id, { reason }, staff) {
  const r = db.prepare("SELECT * FROM tax_invoices WHERE id = ?").get(String(id));
  if (!r) throw new HttpError(404, "ไม่พบใบกำกับภาษีนี้");
  if (r.cancelled_at) throw new HttpError(409, "ใบกำกับภาษีนี้ถูกยกเลิกไปแล้ว");
  db.prepare("UPDATE tax_invoices SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?").run(Date.now(), staff.name, R.str(reason, 120, "เหตุผล", { required: true }), r.id);
  return invoiceOut(db.prepare("SELECT * FROM tax_invoices WHERE id = ?").get(r.id));
}

// the last buyer details used with this tax ID, so a regular company customer is filled in for you
const findBuyer = (db, taxId) => {
  const r = db.prepare("SELECT buyer_name, buyer_tax_id, buyer_branch, buyer_address FROM tax_invoices WHERE buyer_tax_id = ? ORDER BY created_at DESC LIMIT 1").get(String(taxId || "").replace(/\D/g, ""));
  return r ? { name: r.buyer_name, taxId: r.buyer_tax_id, branch: r.buyer_branch, address: r.buyer_address } : null;
};
const listInvoices = (db, fromMs, toMs) => db.prepare("SELECT * FROM tax_invoices WHERE created_at >= ? AND created_at < ? ORDER BY seq").all(fromMs, toMs).map(invoiceOut);

module.exports = { invoiceOut, activeFor, issueInvoice, cancelInvoice, findBuyer, listInvoices };

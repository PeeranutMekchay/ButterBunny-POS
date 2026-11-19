// Pricing engine shared by the browser (window.BBPricing) and the server (require).
// The server is the authority: it re-prices every bill with this same code before saving.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BBPricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const r2 = n => Math.round(n * 100) / 100;
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => { const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); };
  // The shop's business day: with dayStartHour = 4, sales at 01:30 still belong to the previous day.
  const businessDay = (d, startHour = 0) => dayKey(new Date(new Date(d).getTime() - (Number(startHour) || 0) * 3600e3));
  // member.birthday is "MM-DD"
  const isBirthMonth = (member, now = new Date()) => !!(member && member.birthday && Number(String(member.birthday).slice(0, 2)) === now.getMonth() + 1);

  const DEFAULT_SHOP = {
    name: "Butter Bunny บัตเตอร์บันนี่", tagline: "เบเกอรี่อบสดทุกเช้า & กาแฟหอมกรุ่น", branch: "", address: "", phone: "", taxId: "",
    promptpay: "", vat: "incl", footer: "ขอบคุณที่แวะมาหาเจ้ากระต่ายเนยนะคะ แล้วมาอีกน้า", pointsPer: 25,
    dayStartHour: 0, birthdayMultiplier: 2, lowStockAt: 5, poundPrice: 250,
    discountLimitBaht: 20, discountLimitPct: 10, taxBranch: "สำนักงานใหญ่", receiptUrl: ""
  };

  function promoLive(p, now = new Date()) {
    if (p.active === false) return false;
    const k = dayKey(now);
    if (p.from && k < p.from) return false;
    if (p.to && k > p.to) return false;
    if (p.days && p.days.length && !p.days.includes(now.getDay())) return false;
    if (p.start && p.end) { const t = pad(now.getHours()) + ":" + pad(now.getMinutes()); if (t < p.start || t >= p.end) return false; }
    return true;
  }
  const inScope = (p, l) => p.scope === "all" || (p.scope === "cat" && l.cat === p.cat) || (p.scope === "items" && (p.items || []).includes(l.id));

  function promoAmount(p, lines) {
    const L = lines.filter(l => inScope(p, l));
    if (!L.length) return {amt: 0, keys: []};
    let amt = 0;
    if (p.type === "percent") amt = L.reduce((s, l) => s + l.unit * l.qty * p.value / 100, 0);
    else if (p.type === "amount") amt = L.reduce((s, l) => s + Math.min(p.value, l.unit) * l.qty, 0);
    else if (p.type === "bxgy") {
      const units = L.flatMap(l => Array(l.qty).fill(l.unit)).sort((a, b) => b - a);
      const g = (p.buy || 1) + (p.get || 1), free = Math.floor(units.length / g) * (p.get || 1);
      amt = units.slice(units.length - free).reduce((s, v) => s + v, 0);
    }
    return {amt: r2(amt), keys: L.map(l => l.key)};
  }

  // lines: [{key, id, cat, unit, qty, reward?, pts?}]; member: {points} | null; voucher: discount reward | null
  function price({lines, promos = [], coupon = "", manualDisc = 0, member = null, voucher = null, shop = {}, now = new Date()}) {
    const sh = {...DEFAULT_SHOP, ...shop};
    lines = lines.map(l => ({...l}));
    const subtotal = r2(lines.reduce((s, l) => s + l.unit * l.qty, 0));
    const code = String(coupon || "").trim().toUpperCase();
    const avail = promos.filter(p => promoLive(p, now) && (!p.code || p.code.toUpperCase() === code));
    const applied = [], used = new Set();
    let pool = avail.filter(p => p.type !== "minspend");
    while (pool.length) {
      const free = lines.filter(l => !used.has(l.key) && !l.reward);
      const best = pool.map(p => ({p, ...promoAmount(p, free)})).sort((a, b) => b.amt - a.amt)[0];
      if (!best || best.amt <= 0) break;
      applied.push({id: best.p.id, name: best.p.name, amt: best.amt, keys: best.keys});
      best.keys.forEach(k => used.add(k)); pool = pool.filter(p => p !== best.p);
    }
    const base = subtotal - applied.reduce((s, a) => s + a.amt, 0);
    const bill = avail.filter(p => p.type === "minspend" && base >= (p.min || 0))
      .map(p => ({p, amt: r2(Math.min(base, p.unit === "percent" ? base * p.value / 100 : p.value))})).sort((a, b) => b.amt - a.amt)[0];
    if (bill && bill.amt > 0) applied.push({id: bill.p.id, name: bill.p.name, amt: bill.amt, keys: []});
    const promoTotal = r2(applied.reduce((s, a) => s + a.amt, 0));
    let after = subtotal - promoTotal;
    const manual = r2(Math.min(after, Math.max(0, Number(manualDisc) || 0))); after -= manual;
    let pointsUsed = member ? lines.filter(l => l.reward).reduce((s, l) => s + l.pts * l.qty, 0) : 0, pointsDisc = 0;
    const vr = member && voucher ? voucher : null;
    if (vr) { pointsDisc = r2(Math.min(after, vr.value || 0)); pointsUsed += vr.points; after -= pointsDisc; }
    const total = r2(Math.max(0, after));
    const vat = sh.vat === "incl" ? r2(total * 7 / 107) : 0;
    const codeValid = !code || avail.some(p => p.code && p.code.toUpperCase() === code);
    const birthday = isBirthMonth(member, now), mult = birthday ? Math.max(1, Number(sh.birthdayMultiplier) || 1) : 1;
    return {lines, subtotal, applied, promoTotal, manual, pointsUsed, pointsDisc, voucherName: vr ? vr.name : null, total, vat, codeValid, birthday,
      pointsEarned: member ? Math.floor(total / Math.max(1, sh.pointsPer)) * mult : 0};
  }

  // A cashier's special discount above either limit needs a manager's PIN.
  const discountNeedsApproval = (manual, subtotal, shop = {}) => {
    const sh = {...DEFAULT_SHOP, ...shop}, m = Number(manual) || 0;
    if (m <= 0) return false;
    return m > Number(sh.discountLimitBaht) + 0.0001 || (subtotal > 0 && m / subtotal * 100 > Number(sh.discountLimitPct) + 0.0001);
  };
  return {r2, dayKey, businessDay, discountNeedsApproval, isBirthMonth, DEFAULT_SHOP, promoLive, inScope, promoAmount, price};
});

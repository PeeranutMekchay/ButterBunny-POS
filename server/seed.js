// Loads seed/starter-data.json (menu, stock, promotions, rewards, shop settings) into an empty database.
const fs = require("node:fs");
const path = require("node:path");
const { tx } = require("./db");
const R = require("./repo");

const FILE = path.join(__dirname, "..", "seed", "starter-data.json");

function seedIfEmpty(db, { force = false } = {}) {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (done && !force) return false;
  if (!force && db.prepare("SELECT COUNT(*) n FROM menu").get().n > 0) return false;
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  tx(db, () => {
    for (const [id, m] of Object.entries(data.menu || {})) {
      const stock = data.stock?.[id]?.qty;
      db.prepare(`INSERT OR REPLACE INTO menu (id, name, cat, price, active, track_stock, sweet, opts, img, sort, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, m.name, m.cat, m.price, m.active === false ? 0 : 1, m.trackStock ? 1 : 0, m.sweet ? 1 : 0, JSON.stringify(m.opts || []), m.imgFile || null, m.order || 0, Date.now());
      if (m.trackStock) R.setStock(db, id, stock ?? 0);
    }
    for (const [id, p] of Object.entries(data.promos || {})) db.prepare("INSERT OR REPLACE INTO promos (id, data, updated_at) VALUES (?, ?, ?)").run(id, JSON.stringify(p), Date.now());
    for (const [id, r] of Object.entries(data.rewards || {})) {
      db.prepare(`INSERT OR REPLACE INTO rewards (id, name, kind, item_id, value, points, blurb, active, limited, img, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, r.name, r.kind, r.itemId || null, r.value || 0, r.points, r.blurb || "", r.active === false ? 0 : 1, r.limited ? 1 : 0, r.imgFile || null, Date.now());
      if (r.limited) R.setStock(db, "rw-" + id, data.stock?.["rw-" + id]?.qty ?? 0);
    }
    if (data.config?.shop) db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('shop', ?)").run(JSON.stringify(data.config.shop));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', ?)").run(String(Date.now()));
  });
  return true;
}

// Menu items added after the first release. Each is inserted once (by id), so a shop that
// deleted or edited one keeps its choice; existing databases get them on the next start.
const poundOpts = price => [1, 1.5, 2, 3, 4].map(lb => ({ name: `${lb} ปอนด์`, add: (lb - 1) * price }));
const EXTRAS = [
  { key: "extras_pound_cakes", items: [
    { id: "m-poundchoc", name: "เค้กช็อกโกแลตเชอร์รี (ปอนด์)", img: "/assets/illustrations/m-poundchoc.jpg", sort: 20 },
    { id: "m-poundstraw", name: "เค้กสตรอว์เบอร์รีครีมสด (ปอนด์)", img: "/assets/illustrations/m-poundstraw.jpg", sort: 21 },
    { id: "m-poundthaitea", name: "เค้กชาไทย (ปอนด์)", img: "/assets/illustrations/m-poundthaitea.jpg", sort: 22 },
  ] },
];
function addExtras(db) {
  let added = 0;
  for (const x of EXTRAS) {
    if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(x.key)) continue;
    const price = R.getShop(db).poundPrice || 250;
    tx(db, () => {
      for (const m of x.items) {
        if (db.prepare("SELECT 1 FROM menu WHERE id = ?").get(m.id)) continue;
        db.prepare("INSERT INTO menu (id, name, cat, price, active, track_stock, sweet, opts, img, sort, updated_at) VALUES (?, ?, 'cake', ?, 1, 0, 0, ?, ?, ?, ?)")
          .run(m.id, m.name, price, JSON.stringify(poundOpts(price)), m.img, m.sort, Date.now());
        added++;
      }
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(x.key, String(Date.now()));
    });
  }
  return added;
}

module.exports = { seedIfEmpty, addExtras, poundOpts };

if (require.main === module) {
  const { openDb } = require("./db");
  const db = openDb(process.env.DB_FILE || path.join(__dirname, "..", "data", "butterbunny.db"));
  const force = process.argv.includes("--force");
  console.log(seedIfEmpty(db, { force }) ? "โหลดข้อมูลเริ่มต้นแล้ว" : "ฐานข้อมูลมีข้อมูลอยู่แล้ว (ใช้ --force เพื่อโหลดทับเมนู โปร ของรางวัล และข้อมูลร้าน)");
  addExtras(db);
}

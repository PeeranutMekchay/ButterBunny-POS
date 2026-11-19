-- Butter Bunny POS schema (SQLite). Money is stored in baht as REAL rounded to 2 decimals.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('manager', 'cashier')),
  active     INTEGER NOT NULL DEFAULT 1,
  pin_salt   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);

CREATE TABLE IF NOT EXISTS menu (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cat         TEXT NOT NULL,
  price       REAL NOT NULL CHECK (price >= 0),
  active      INTEGER NOT NULL DEFAULT 1,
  track_stock INTEGER NOT NULL DEFAULT 0,
  sweet       INTEGER NOT NULL DEFAULT 0,
  opts        TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, add}]
  img         TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- Keys: a menu id, or 'rw-' || reward id for limited rewards.
CREATE TABLE IF NOT EXISTS stock (
  id  TEXT PRIMARY KEY,
  qty INTEGER NOT NULL CHECK (qty >= 0)
);

CREATE TABLE IF NOT EXISTS promos (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,      -- JSON (type, scope, value, buy/get, min, days, start/end, from/to, code, active)
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('item', 'gift', 'discount')),
  item_id    TEXT,
  value      REAL NOT NULL DEFAULT 0,
  points     INTEGER NOT NULL CHECK (points > 0),
  blurb      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  limited    INTEGER NOT NULL DEFAULT 0,
  img        TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  phone      TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  points     INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  visits     INTEGER NOT NULL DEFAULT 0,
  spent      REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_visit INTEGER
);

-- Every change to a member's points, for auditing.
CREATE TABLE IF NOT EXISTS point_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_phone TEXT NOT NULL,
  delta        INTEGER NOT NULL,
  reason       TEXT NOT NULL,     -- earn | spend | void | redeem | redeem-cancel | adjust
  ref          TEXT,
  staff_name   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS point_ledger_member ON point_ledger(member_phone, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  day           TEXT NOT NULL,              -- YYYY-MM-DD, shop local time
  queue         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('dine', 'take')),
  status        TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'done', 'void')),
  pay           TEXT NOT NULL CHECK (pay IN ('cash', 'qr', 'card')),
  ref           TEXT NOT NULL DEFAULT '',
  subtotal      REAL NOT NULL,
  promos        TEXT NOT NULL DEFAULT '[]', -- JSON [{id, name, amt}]
  promo_total   REAL NOT NULL DEFAULT 0,
  manual        REAL NOT NULL DEFAULT 0,
  points_used   INTEGER NOT NULL DEFAULT 0,
  points_disc   REAL NOT NULL DEFAULT 0,
  voucher_name  TEXT,
  total         REAL NOT NULL,
  vat           REAL NOT NULL DEFAULT 0,
  tendered      REAL NOT NULL,
  change        REAL NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  member_phone  TEXT,
  member_name   TEXT,
  points_earned INTEGER NOT NULL DEFAULT 0,
  staff_id      TEXT,
  staff_name    TEXT,
  ready_at      INTEGER,
  done_at       INTEGER,
  void_reason   TEXT,
  void_by       TEXT,
  void_at       INTEGER,
  UNIQUE (day, queue)
);
CREATE INDEX IF NOT EXISTS orders_day ON orders(day, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  order_id  TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line      INTEGER NOT NULL,
  menu_id   TEXT,                -- menu id, or 'gift:<rewardId>' for a souvenir
  name      TEXT NOT NULL,
  cat       TEXT,
  unit      REAL NOT NULL,
  qty       INTEGER NOT NULL CHECK (qty > 0),
  opt       TEXT,
  sweet     TEXT,
  reward_id TEXT,
  pts       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, line)
);

CREATE TABLE IF NOT EXISTS redeems (
  id           TEXT PRIMARY KEY,
  day          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  member_phone TEXT NOT NULL,
  member_name  TEXT NOT NULL DEFAULT '',
  reward_id    TEXT NOT NULL,
  reward_name  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  qty          INTEGER NOT NULL DEFAULT 1,
  points       INTEGER NOT NULL,
  staff_name   TEXT,
  via          TEXT NOT NULL CHECK (via IN ('bill', 'direct')),
  order_id     TEXT,
  voided       INTEGER NOT NULL DEFAULT 0,
  void_at      INTEGER,
  void_by      TEXT,
  restocked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS redeems_day ON redeems(day, created_at);
CREATE INDEX IF NOT EXISTS redeems_order ON redeems(order_id);

-- Cash drawer shifts. Only one shift is open at a time (closed_at IS NULL).
CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY,
  opened_at     INTEGER NOT NULL,
  opened_by     TEXT NOT NULL,
  opening_cash  REAL NOT NULL DEFAULT 0,
  closed_at     INTEGER,
  closed_by     TEXT,
  counted_cash  REAL,
  expected_cash REAL,
  counts        TEXT,                 -- JSON {"1000": n, "500": n, ...}
  note          TEXT NOT NULL DEFAULT '',
  summary       TEXT                  -- JSON snapshot taken at close
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open ON shifts((closed_at IS NULL)) WHERE closed_at IS NULL;

-- Cash put into or taken out of the drawer during a shift (e.g. buying ice).
CREATE TABLE IF NOT EXISTS cash_moves (
  id         TEXT PRIMARY KEY,
  shift_id   TEXT NOT NULL REFERENCES shifts(id),
  created_at INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  amount     REAL NOT NULL CHECK (amount > 0),
  reason     TEXT NOT NULL DEFAULT '',
  staff_name TEXT
);

-- Cake and party orders taken in advance, with a deposit.
CREATE TABLE IF NOT EXISTS preorders (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,   -- P0001, P0002, ...
  created_at    INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  member_phone  TEXT,
  pickup_day    TEXT NOT NULL,          -- YYYY-MM-DD
  pickup_time   TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,          -- what to make
  details       TEXT NOT NULL DEFAULT '',
  cake_message  TEXT NOT NULL DEFAULT '',
  qty           INTEGER NOT NULL DEFAULT 1,
  total         REAL NOT NULL CHECK (total >= 0),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'picked', 'cancelled')),
  note          TEXT NOT NULL DEFAULT '',
  staff_name    TEXT,
  ready_at      INTEGER,
  picked_at     INTEGER,
  cancelled_at  INTEGER,
  cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS preorders_pickup ON preorders(pickup_day, status);

CREATE TABLE IF NOT EXISTS preorder_payments (
  id          TEXT PRIMARY KEY,
  preorder_id TEXT NOT NULL REFERENCES preorders(id),
  created_at  INTEGER NOT NULL,
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'balance', 'refund')),
  amount      REAL NOT NULL,            -- refunds are negative
  pay         TEXT NOT NULL CHECK (pay IN ('cash', 'qr', 'card')),
  ref         TEXT NOT NULL DEFAULT '',
  staff_name  TEXT,
  shift_id    TEXT
);
CREATE INDEX IF NOT EXISTS preorder_payments_day ON preorder_payments(day);

-- Pastries thrown away at closing time.
CREATE TABLE IF NOT EXISTS waste (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  menu_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL DEFAULT 0,
  reason     TEXT NOT NULL DEFAULT '',
  staff_name TEXT
);
CREATE INDEX IF NOT EXISTS waste_day ON waste(day);

-- QR payments through a payment provider (auto-confirmed when the money arrives).
CREATE TABLE IF NOT EXISTS qr_payments (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,           -- opn | demo
  provider_ref TEXT NOT NULL,           -- e.g. Opn charge id
  amount       REAL NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  order_id     TEXT,
  staff_name   TEXT,
  qr           TEXT                     -- data URL of the provider's QR image
);

-- Who changed what (prices, stock, points, staff, settings, voids, discounts, failed sign-ins).
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  staff_name TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT              -- JSON
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at);

-- A manager's PIN approval for one discount, valid for 10 minutes and usable once.
CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  manager_id   TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  requested_by TEXT,
  purpose      TEXT NOT NULL,
  amount       REAL NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  order_id     TEXT
);

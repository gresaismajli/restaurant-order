const { Pool } = require("pg");
const { makePassword, nowIso } = require("./security");

let pool;
let initialized = false;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Create a Postgres database and set DATABASE_URL before starting the app.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function query(text, params) {
  await initDb();
  return getPool().query(text, params);
}

async function rawQuery(text, params) {
  return getPool().query(text, params);
}

async function initDb() {
  if (initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'waiter', 'kitchen')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      password JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      available BOOLEAN NOT NULL DEFAULT TRUE,
      sort INTEGER NOT NULL DEFAULT 999,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      table_name TEXT NOT NULL,
      waiter_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      items JSONB NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      discount NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax NUMERIC(10,2) NOT NULL DEFAULT 0,
      service NUMERIC(10,2) NOT NULL DEFAULT 0,
      payment JSONB,
      history JSONB NOT NULL,
      paid_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      canceled_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      details JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cash_closures (
      id TEXT PRIMARY KEY,
      business_date DATE NOT NULL,
      expected_cash NUMERIC(10,2) NOT NULL,
      counted_cash NUMERIC(10,2) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      report JSONB NOT NULL,
      closed_by TEXT NOT NULL REFERENCES users(id),
      closed_by_name TEXT NOT NULL,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await seedDb();
  initialized = true;
}

async function seedDb() {
  const settings = {
    restaurantName: "Restaurant Orders",
    currency: "EUR",
    taxRate: 0,
    serviceRate: 0,
    requireKitchenConfirm: true
  };
  await rawQuery(
    "INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
    [settings]
  );

  const users = [
    ["u_admin", "Manager", "admin", "admin", makePassword("admin123")],
    ["u_waiter_arta", "Arta", "arta", "waiter", makePassword("waiter123")],
    ["u_waiter_jon", "Jon", "jon", "waiter", makePassword("waiter123")],
    ["u_kitchen", "Kitchen", "kitchen", "kitchen", makePassword("kitchen123")]
  ];
  for (const user of users) {
    await rawQuery(
      "INSERT INTO users (id, name, username, role, active, password, created_at, updated_at) VALUES ($1,$2,$3,$4,TRUE,$5,$6,$6) ON CONFLICT (id) DO NOTHING",
      [user[0], user[1], user[2], user[3], user[4], nowIso()]
    );
  }

  const products = [
    ["p1", "Margherita Pizza", "Pizza", 7.5, 10],
    ["p2", "Prosciutto Pizza", "Pizza", 9.2, 20],
    ["p3", "Chicken Caesar Salad", "Salads", 6.8, 30],
    ["p4", "Beef Burger", "Grill", 8.4, 40],
    ["p5", "Grilled Salmon", "Main", 13.5, 50],
    ["p6", "Penne Arrabbiata", "Pasta", 7.9, 60],
    ["p7", "Tiramisu", "Dessert", 4.2, 70],
    ["p8", "Sparkling Water", "Drinks", 1.8, 80],
    ["p9", "House Lemonade", "Drinks", 2.6, 90],
    ["p10", "Espresso", "Drinks", 1.4, 100]
  ];
  for (const product of products) {
    await rawQuery(
      "INSERT INTO products (id, name, category, price, available, sort) VALUES ($1,$2,$3,$4,TRUE,$5) ON CONFLICT (id) DO NOTHING",
      product
    );
  }
}

module.exports = { query, rawQuery, initDb };

const fs = require("fs");
const path = require("path");
const { initDb, rawQuery } = require("../lib/db");

const storePath = process.argv[2] || path.join(__dirname, "..", "data", "store.json");

function iso(value) {
  return value || new Date().toISOString();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before running the migration.");
  }
  if (!fs.existsSync(storePath)) {
    throw new Error(`JSON store not found: ${storePath}`);
  }

  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  await initDb();

  if (store.settings) {
    await rawQuery(
      "INSERT INTO settings (id, data, updated_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
      [store.settings]
    );
  }

  for (const user of store.users || []) {
    await rawQuery(
      `INSERT INTO users (id, name, username, role, active, password, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, role = EXCLUDED.role, active = EXCLUDED.active, password = EXCLUDED.password, updated_at = EXCLUDED.updated_at`,
      [user.id, user.name, user.username, user.role, user.active !== false, user.password, iso(user.createdAt), iso(user.updatedAt)]
    );
  }

  for (const product of store.products || []) {
    await rawQuery(
      `INSERT INTO products (id, name, category, price, available, sort, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price, available = EXCLUDED.available, sort = EXCLUDED.sort, updated_at = NOW()`,
      [product.id, product.name, product.category, product.price, product.available !== false, product.sort || 999]
    );
  }

  for (const order of store.orders || []) {
    await rawQuery(
      `INSERT INTO orders (id, number, table_name, waiter_id, status, payment_status, items, notes, discount, tax, service, payment, history, paid_at, canceled_at, canceled_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payment_status = EXCLUDED.payment_status, payment = EXCLUDED.payment, history = EXCLUDED.history, updated_at = EXCLUDED.updated_at`,
      [
        order.id,
        order.number,
        order.table,
        order.waiterId,
        order.status,
        order.paymentStatus,
        order.items || [],
        order.notes || "",
        order.discount || 0,
        order.tax || 0,
        order.service || 0,
        order.payment || null,
        order.history || [],
        order.paidAt || null,
        order.canceledAt || null,
        order.canceledReason || "",
        iso(order.createdAt),
        iso(order.updatedAt)
      ]
    );
  }

  for (const entry of store.audit || []) {
    await rawQuery(
      `INSERT INTO audit (id, action, user_id, user_name, details, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.action, entry.userId || "system", entry.userName || "System", entry.details || {}, iso(entry.at)]
    );
  }

  console.log("JSON data migrated to Postgres.");
  process.exit(0);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

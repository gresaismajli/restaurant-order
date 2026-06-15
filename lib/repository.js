const crypto = require("crypto");
const { query, rawQuery } = require("./db");
const { money, nowIso, uid, makePassword, verifyPassword } = require("./security");

const SESSION_TTL_MS = 1000 * 60 * 60 * 14;

function toNumber(value) {
  return Number(value || 0);
}

function cleanUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active
  };
}

function rowUser(row) {
  return row && {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    active: row.active,
    password: row.password,
    createdAt: row.created_at && row.created_at.toISOString ? row.created_at.toISOString() : row.created_at
  };
}

function rowProduct(row) {
  return row && {
    id: row.id,
    name: row.name,
    category: row.category,
    price: toNumber(row.price),
    available: row.available,
    sort: row.sort
  };
}

function rowOrder(row, waiterName) {
  if (!row) return null;
  const order = {
    id: row.id,
    number: row.number,
    table: row.table_name,
    waiterId: row.waiter_id,
    waiterName: waiterName || row.waiter_name || "Unknown waiter",
    status: row.status,
    paymentStatus: row.payment_status,
    items: row.items || [],
    notes: row.notes || "",
    discount: toNumber(row.discount),
    tax: toNumber(row.tax),
    service: toNumber(row.service),
    payment: row.payment,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
    paidAt: dateIso(row.paid_at),
    canceledAt: dateIso(row.canceled_at),
    canceledReason: row.canceled_reason || "",
    history: row.history || []
  };
  order.subtotal = orderSubtotal(order);
  order.total = orderTotal(order);
  return order;
}

function dateIso(value) {
  if (!value) return null;
  return value.toISOString ? value.toISOString() : value;
}

function orderSubtotal(order) {
  return money((order.items || []).reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity), 0));
}

function orderTotal(order) {
  return money(orderSubtotal(order) - toNumber(order.discount) + toNumber(order.tax) + toNumber(order.service));
}

async function audit(user, action, details) {
  await query(
    "INSERT INTO audit (id, action, user_id, user_name, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [uid("a"), action, user ? user.id : "system", user ? user.name : "System", details || {}, nowIso()]
  );
}

async function getSettings() {
  const result = await query("SELECT data FROM settings WHERE id = 1");
  return result.rows[0].data;
}

async function listUsers() {
  const result = await query("SELECT * FROM users ORDER BY role, name");
  return result.rows.map(rowUser);
}

async function listProducts() {
  const result = await query("SELECT * FROM products ORDER BY sort, name");
  return result.rows.map(rowProduct);
}

async function findUserByUsername(username) {
  const result = await query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND active = TRUE", [username]);
  return rowUser(result.rows[0]);
}

async function findUserById(id) {
  const result = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rowUser(result.rows[0]);
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [token, user.id, expiresAt]);
  await audit(user, "login", {});
  return { token, user: cleanUser(user) };
}

async function deleteSession(token) {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

async function currentUser(token) {
  if (!token) return null;
  const result = await query(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.active = TRUE`,
    [token]
  );
  const user = rowUser(result.rows[0]);
  if (user) {
    await query("UPDATE sessions SET expires_at = $2 WHERE token = $1", [token, new Date(Date.now() + SESSION_TTL_MS).toISOString()]);
  }
  return user;
}

async function login(username, password) {
  const user = await findUserByUsername(String(username || "").trim());
  if (!user || !verifyPassword(password || "", user)) {
    const error = new Error("Invalid username or password.");
    error.status = 401;
    throw error;
  }
  return createSession(user);
}

function requireRole(user, roles) {
  if (!roles || !roles.length || user.role === "admin" || roles.indexOf(user.role) !== -1) return;
  const error = new Error("You do not have permission for this action.");
  error.status = 403;
  throw error;
}

async function listOrders(user) {
  const params = [];
  let where = "";
  if (user.role === "waiter") {
    params.push(user.id);
    where = "WHERE o.waiter_id = $1";
  }
  const result = await query(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     ${where}
     ORDER BY o.created_at DESC, o.number DESC`,
    params
  );
  return result.rows.map(row => rowOrder(row));
}

async function getOrder(id) {
  const result = await query(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.id = $1`,
    [id]
  );
  return rowOrder(result.rows[0]);
}

async function nextOrderNumber() {
  const result = await query("SELECT COALESCE(MAX(number), 0) + 1 AS number FROM orders");
  return Number(result.rows[0].number);
}

async function createOrder(payload, user) {
  requireRole(user, ["waiter"]);
  const table = String(payload.table || "").trim();
  if (!table) throw new Error("Enter a table number or customer name.");
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  const productIds = requestedItems.map(item => item.productId);
  const productsResult = await query("SELECT * FROM products WHERE id = ANY($1) AND available = TRUE", [productIds]);
  const products = productsResult.rows.map(rowProduct);
  const items = requestedItems.map(item => {
    const product = products.find(candidate => candidate.id === item.productId);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      price: money(product.price),
      quantity,
      note: String(item.note || "").trim().slice(0, 240)
    };
  }).filter(Boolean);
  if (!items.length) throw new Error("Add at least one available product.");

  const settings = await getSettings();
  const subtotal = money(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const tax = money(subtotal * money(settings.taxRate || 0));
  const service = money(subtotal * money(settings.serviceRate || 0));
  const createdAt = nowIso();
  const order = {
    id: uid("o"),
    number: await nextOrderNumber(),
    table,
    waiterId: user.id,
    status: "sent",
    paymentStatus: "open",
    items,
    notes: String(payload.notes || "").trim().slice(0, 500),
    discount: 0,
    tax,
    service,
    payment: null,
    history: [{ status: "sent", label: "Sent to kitchen", userId: user.id, userName: user.name, at: createdAt }]
  };
  await query(
    `INSERT INTO orders (id, number, table_name, waiter_id, status, payment_status, items, notes, discount, tax, service, payment, history, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
    [order.id, order.number, order.table, order.waiterId, order.status, order.paymentStatus, order.items, order.notes, order.discount, order.tax, order.service, order.payment, order.history, createdAt]
  );
  await audit(user, "order.create", { orderId: order.id, number: order.number, total: orderTotal(order) });
  return getOrder(order.id);
}

async function updateOrderStatus(id, status, user) {
  requireRole(user, ["kitchen"]);
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  const transitions = { sent: ["received"], received: ["preparing", "done"], preparing: ["done"], done: [] };
  if (order.paymentStatus !== "open") throw new Error("Closed orders cannot be changed.");
  if (!transitions[order.status] || transitions[order.status].indexOf(status) === -1) {
    throw new Error(`Cannot move order from ${order.status} to ${status}.`);
  }
  order.status = status;
  order.updatedAt = nowIso();
  order.history.push({ status, label: status, userId: user.id, userName: user.name, at: order.updatedAt });
  await query("UPDATE orders SET status = $2, history = $3, updated_at = $4 WHERE id = $1", [id, status, order.history, order.updatedAt]);
  await audit(user, "order.status", { orderId: id, status });
  return getOrder(id);
}

async function markPaid(id, payload, user) {
  requireRole(user, ["waiter"]);
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  if (user.role === "waiter" && order.waiterId !== user.id) throw forbidden("Waiters can only close their own orders.");
  if (order.paymentStatus !== "open") throw new Error("Order is already closed.");
  if (order.status !== "done") throw new Error("Only kitchen-completed orders can be marked paid.");
  const method = String(payload.method || "cash");
  if (["cash", "card", "mixed", "other"].indexOf(method) === -1) throw new Error("Choose a valid payment method.");
  const discount = money(payload.discount || 0);
  if (discount < 0 || discount > orderSubtotal(order)) throw new Error("Discount cannot be negative or higher than the subtotal.");
  order.discount = discount;
  order.paymentStatus = "paid";
  order.paidAt = nowIso();
  order.updatedAt = order.paidAt;
  order.payment = {
    method,
    amountReceived: money(payload.amountReceived || orderTotal(order)),
    tip: money(payload.tip || 0),
    note: String(payload.note || "").trim().slice(0, 240),
    closedBy: user.id
  };
  order.history.push({ status: "paid", label: "Paid and closed", userId: user.id, userName: user.name, at: order.paidAt });
  await query(
    "UPDATE orders SET payment_status = 'paid', discount = $2, payment = $3, history = $4, paid_at = $5, updated_at = $5 WHERE id = $1",
    [id, order.discount, order.payment, order.history, order.paidAt]
  );
  await audit(user, "order.paid", { orderId: id, total: orderTotal(order), method });
  return getOrder(id);
}

async function cancelOrder(id, payload, user) {
  if (user.role === "kitchen") throw forbidden("Kitchen cannot cancel orders.");
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  if (user.role === "waiter" && order.waiterId !== user.id) throw forbidden("Waiters can only cancel their own orders.");
  if (order.paymentStatus === "paid") throw new Error("Paid orders cannot be canceled.");
  const canceledAt = nowIso();
  const reason = String(payload.reason || "Canceled").trim().slice(0, 240);
  order.history.push({ status: "canceled", label: reason, userId: user.id, userName: user.name, at: canceledAt });
  await query(
    "UPDATE orders SET status = 'canceled', payment_status = 'void', canceled_at = $2, canceled_reason = $3, history = $4, updated_at = $2 WHERE id = $1",
    [id, canceledAt, reason, order.history]
  );
  await audit(user, "order.cancel", { orderId: id, reason });
  return getOrder(id);
}

async function reportForDay(date) {
  const result = await query(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE (o.payment_status = 'paid' AND DATE(o.paid_at) = $1)
        OR (o.payment_status = 'void' AND DATE(o.canceled_at) = $1)
     ORDER BY o.updated_at DESC`,
    [date]
  );
  const all = result.rows.map(row => rowOrder(row));
  const paidOrders = all.filter(order => order.paymentStatus === "paid");
  const voidOrders = all.filter(order => order.paymentStatus === "void");
  const users = await listUsers();
  const byWaiter = users.filter(user => user.role === "waiter").map(waiter => {
    const waiterOrders = paidOrders.filter(order => order.waiterId === waiter.id);
    return {
      waiterId: waiter.id,
      waiterName: waiter.name,
      orders: waiterOrders.length,
      total: money(waiterOrders.reduce((sum, order) => sum + orderTotal(order), 0)),
      tips: money(waiterOrders.reduce((sum, order) => sum + money(order.payment && order.payment.tip), 0))
    };
  });
  const byMethod = ["cash", "card", "mixed", "other"].map(method => {
    const methodOrders = paidOrders.filter(order => order.payment && order.payment.method === method);
    return { method, orders: methodOrders.length, total: money(methodOrders.reduce((sum, order) => sum + orderTotal(order), 0)) };
  });
  return {
    date,
    orderCount: paidOrders.length,
    voidCount: voidOrders.length,
    total: money(paidOrders.reduce((sum, order) => sum + orderTotal(order), 0)),
    subtotal: money(paidOrders.reduce((sum, order) => sum + orderSubtotal(order), 0)),
    discounts: money(paidOrders.reduce((sum, order) => sum + money(order.discount), 0)),
    tips: money(paidOrders.reduce((sum, order) => sum + money(order.payment && order.payment.tip), 0)),
    byWaiter,
    byMethod,
    orders: paidOrders,
    voidOrders
  };
}

async function closeDay(payload, user) {
  requireRole(user, ["admin"]);
  const date = payload.date || nowIso().slice(0, 10);
  const report = await reportForDay(date);
  const cash = report.byMethod.find(row => row.method === "cash") || { total: 0 };
  const closure = {
    id: uid("close"),
    date,
    expectedCash: money(cash.total),
    countedCash: money(payload.countedCash || 0),
    note: String(payload.note || "").trim().slice(0, 240),
    report,
    closedBy: user.id,
    closedByName: user.name,
    closedAt: nowIso()
  };
  await query(
    `INSERT INTO cash_closures (id, business_date, expected_cash, counted_cash, note, report, closed_by, closed_by_name, closed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [closure.id, closure.date, closure.expectedCash, closure.countedCash, closure.note, closure.report, closure.closedBy, closure.closedByName, closure.closedAt]
  );
  await audit(user, "report.close-day", { date, total: report.total });
  return closure;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "");
}

async function createWaiter(payload, user) {
  requireRole(user, ["admin"]);
  const name = String(payload.name || "").trim();
  const username = normalizeUsername(payload.username || name);
  const password = String(payload.password || "");
  if (!name) throw new Error("Waiter name is required.");
  if (username.length < 3) throw new Error("Waiter username must be at least 3 characters.");
  if (password.length < 6) throw new Error("Waiter password must be at least 6 characters.");
  const waiter = { id: uid("u_waiter"), name: name.slice(0, 100), username: username.slice(0, 60), role: "waiter", active: true, password: makePassword(password) };
  await query(
    "INSERT INTO users (id, name, username, role, active, password, created_at, updated_at) VALUES ($1,$2,$3,'waiter',TRUE,$4,$5,$5)",
    [waiter.id, waiter.name, waiter.username, waiter.password, nowIso()]
  );
  await audit(user, "waiter.create", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

async function updateWaiter(id, payload, user) {
  requireRole(user, ["admin"]);
  const existing = await findUserById(id);
  if (!existing || existing.role !== "waiter") throw notFound("Waiter not found.");
  const name = String(payload.name || "").trim();
  const username = normalizeUsername(payload.username || "");
  const password = String(payload.password || "");
  if (!name) throw new Error("Waiter name is required.");
  if (username.length < 3) throw new Error("Waiter username must be at least 3 characters.");
  if (password && password.length < 6) throw new Error("Waiter password must be at least 6 characters.");
  const active = payload.active !== false;
  const passwordValue = password ? makePassword(password) : existing.password;
  const result = await query(
    "UPDATE users SET name = $2, username = $3, active = $4, password = $5, updated_at = $6 WHERE id = $1 AND role = 'waiter' RETURNING *",
    [id, name.slice(0, 100), username.slice(0, 60), active, passwordValue, nowIso()]
  );
  if (!active) await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  const waiter = rowUser(result.rows[0]);
  await audit(user, "waiter.update", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

async function removeWaiter(id, user) {
  requireRole(user, ["admin"]);
  const result = await query("UPDATE users SET active = FALSE, updated_at = $2 WHERE id = $1 AND role = 'waiter' RETURNING *", [id, nowIso()]);
  if (!result.rows[0]) throw notFound("Waiter not found.");
  await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  const waiter = rowUser(result.rows[0]);
  await audit(user, "waiter.remove", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

function parseProduct(payload, existing) {
  const name = String(payload.name || "").trim();
  const category = String(payload.category || "Menu").trim();
  const price = money(payload.price);
  if (!name) throw new Error("Product name is required.");
  if (!category) throw new Error("Product category is required.");
  if (!(price >= 0)) throw new Error("Product price must be zero or higher.");
  return {
    id: existing ? existing.id : uid("p"),
    name: name.slice(0, 120),
    category: category.slice(0, 80),
    price,
    available: payload.available !== false,
    sort: Number(payload.sort || (existing && existing.sort) || 999)
  };
}

async function createProduct(payload, user) {
  requireRole(user, ["admin"]);
  const product = parseProduct(payload);
  await query(
    "INSERT INTO products (id, name, category, price, available, sort, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
    [product.id, product.name, product.category, product.price, product.available, product.sort, nowIso()]
  );
  await audit(user, "product.create", { productId: product.id, name: product.name });
  return product;
}

async function updateProduct(id, payload, user) {
  requireRole(user, ["admin"]);
  const existingResult = await query("SELECT * FROM products WHERE id = $1", [id]);
  if (!existingResult.rows[0]) throw notFound("Product not found.");
  const product = parseProduct(payload, rowProduct(existingResult.rows[0]));
  const result = await query(
    "UPDATE products SET name = $2, category = $3, price = $4, available = $5, sort = $6, updated_at = $7 WHERE id = $1 RETURNING *",
    [id, product.name, product.category, product.price, product.available, product.sort, nowIso()]
  );
  await audit(user, "product.update", { productId: id, name: product.name });
  return rowProduct(result.rows[0]);
}

async function listAudit() {
  const result = await query("SELECT * FROM audit ORDER BY created_at DESC LIMIT 200");
  return result.rows.map(row => ({
    id: row.id,
    action: row.action,
    userId: row.user_id,
    userName: row.user_name,
    details: row.details,
    at: dateIso(row.created_at)
  }));
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

module.exports = {
  rawQuery,
  cleanUser,
  login,
  deleteSession,
  currentUser,
  requireRole,
  getSettings,
  listUsers,
  listProducts,
  listOrders,
  createOrder,
  updateOrderStatus,
  markPaid,
  cancelOrder,
  reportForDay,
  closeDay,
  createWaiter,
  updateWaiter,
  removeWaiter,
  createProduct,
  updateProduct,
  listAudit
};

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "store.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const seedData = {
  waiters: [
    { id: "w1", name: "Arta" },
    { id: "w2", name: "Jon" },
    { id: "w3", name: "Mira" }
  ],
  products: [
    { id: "p1", name: "Margherita Pizza", category: "Pizza", price: 7.5 },
    { id: "p2", name: "Prosciutto Pizza", category: "Pizza", price: 9.2 },
    { id: "p3", name: "Chicken Caesar Salad", category: "Salads", price: 6.8 },
    { id: "p4", name: "Beef Burger", category: "Grill", price: 8.4 },
    { id: "p5", name: "Grilled Salmon", category: "Main", price: 13.5 },
    { id: "p6", name: "Penne Arrabbiata", category: "Pasta", price: 7.9 },
    { id: "p7", name: "Tiramisu", category: "Dessert", price: 4.2 },
    { id: "p8", name: "Sparkling Water", category: "Drinks", price: 1.8 },
    { id: "p9", name: "House Lemonade", category: "Drinks", price: 2.6 },
    { id: "p10", name: "Espresso", category: "Drinks", price: 1.4 }
  ],
  orders: []
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedData, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function todayKey(date) {
  return date.toISOString().slice(0, 10);
}

function orderTotal(order) {
  return money(order.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
}

function publicOrder(order, store) {
  const waiter = store.waiters.find(user => user.id === order.waiterId);
  return {
    ...order,
    waiterName: waiter ? waiter.name : "Unknown waiter",
    total: orderTotal(order)
  };
}

function createOrder(payload, store) {
  const waiter = store.waiters.find(user => user.id === payload.waiterId);
  if (!waiter) {
    throw new Error("Please choose a waiter before sending the order.");
  }

  const table = String(payload.table || "").trim();
  if (!table) {
    throw new Error("Please enter a table number or customer name.");
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map(item => {
      const product = store.products.find(productItem => productItem.id === item.productId);
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        return null;
      }

      return {
        productId: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        quantity,
        note: String(item.note || "").trim()
      };
    })
    .filter(Boolean);

  if (!items.length) {
    throw new Error("Add at least one product before sending the order.");
  }

  const now = new Date().toISOString();
  return {
    id: `o_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    number: store.orders.length + 1,
    table,
    waiterId: waiter.id,
    status: "sent",
    paymentStatus: "open",
    items,
    notes: String(payload.notes || "").trim(),
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    history: [
      { status: "sent", label: "Sent to kitchen", at: now }
    ]
  };
}

async function handleApi(req, res, url) {
  const store = readStore();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      waiters: store.waiters,
      products: store.products,
      orders: store.orders.map(order => publicOrder(order, store))
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    sendJson(res, 200, store.orders.map(order => publicOrder(order, store)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    try {
      const payload = await readBody(req);
      const order = createOrder(payload, store);
      store.orders.unshift(order);
      writeStore(store);
      sendJson(res, 201, publicOrder(order, store));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    try {
      const payload = await readBody(req);
      const nextStatus = String(payload.status || "");
      const allowed = ["received", "preparing", "done"];
      if (allowed.indexOf(nextStatus) === -1) {
        throw new Error("This kitchen status is not allowed.");
      }

      const order = store.orders.find(item => item.id === statusMatch[1]);
      if (!order) {
        sendJson(res, 404, { error: "Order not found" });
        return;
      }

      if (order.paymentStatus === "paid") {
        throw new Error("Paid orders cannot be changed by the kitchen.");
      }

      const now = new Date().toISOString();
      order.status = nextStatus;
      order.updatedAt = now;
      order.history.push({ status: nextStatus, label: nextStatus, at: now });
      writeStore(store);
      sendJson(res, 200, publicOrder(order, store));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const paidMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/paid$/);
  if (req.method === "PATCH" && paidMatch) {
    const order = store.orders.find(item => item.id === paidMatch[1]);
    if (!order) {
      sendJson(res, 404, { error: "Order not found" });
      return;
    }

    if (order.status !== "done") {
      sendJson(res, 400, { error: "Only completed orders can be marked as paid." });
      return;
    }

    const now = new Date().toISOString();
    order.paymentStatus = "paid";
    order.paidAt = now;
    order.updatedAt = now;
    order.history.push({ status: "paid", label: "Paid and closed", at: now });
    writeStore(store);
    sendJson(res, 200, publicOrder(order, store));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/day") {
    const requestedDate = url.searchParams.get("date") || todayKey(new Date());
    const paidOrders = store.orders
      .filter(order => order.paymentStatus === "paid")
      .filter(order => order.paidAt && order.paidAt.slice(0, 10) === requestedDate);

    const byWaiter = store.waiters.map(waiter => {
      const waiterOrders = paidOrders.filter(order => order.waiterId === waiter.id);
      return {
        waiterId: waiter.id,
        waiterName: waiter.name,
        orders: waiterOrders.length,
        total: money(waiterOrders.reduce((sum, order) => sum + orderTotal(order), 0))
      };
    });

    sendJson(res, 200, {
      date: requestedDate,
      orders: paidOrders.map(order => publicOrder(order, store)),
      orderCount: paidOrders.length,
      total: money(paidOrders.reduce((sum, order) => sum + orderTotal(order), 0)),
      byWaiter
    });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(fallback);
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

ensureStore();
server.listen(PORT, () => {
  console.log(`Restaurant ordering app running at http://localhost:${PORT}`);
});

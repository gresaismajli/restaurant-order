const { URL } = require("url");
const repo = require("./repository");

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1000000) {
        reject(new Error("Request body is too large"));
        req.destroy();
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

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.indexOf("Bearer ") === 0 ? header.slice(7) : "";
}

async function requireUser(req, roles) {
  const user = await repo.currentUser(getToken(req));
  if (!user) {
    const error = new Error("Please log in.");
    error.status = 401;
    throw error;
  }
  repo.requireRole(user, roles);
  return user;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/^\/api\/?/, "/");

  try {
    if (req.method === "POST" && pathname === "/auth/login") {
      const payload = await readBody(req);
      sendJson(res, 200, await repo.login(payload.username, payload.password));
      return;
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      await repo.deleteSession(getToken(req));
      sendJson(res, 200, { ok: true });
      return;
    }

    const user = await requireUser(req);

    if (req.method === "GET" && pathname === "/bootstrap") {
      sendJson(res, 200, {
        me: repo.cleanUser(user),
        settings: await repo.getSettings(),
        users: user.role === "admin" ? (await repo.listUsers()).map(repo.cleanUser) : [],
        products: await repo.listProducts(),
        orders: await repo.listOrders(user)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/orders") {
      sendJson(res, 200, await repo.listOrders(user));
      return;
    }

    if (req.method === "POST" && pathname === "/orders") {
      sendJson(res, 201, await repo.createOrder(await readBody(req), user));
      return;
    }

    const statusMatch = pathname.match(/^\/orders\/([^/]+)\/status$/);
    if (req.method === "PATCH" && statusMatch) {
      const payload = await readBody(req);
      sendJson(res, 200, await repo.updateOrderStatus(statusMatch[1], String(payload.status || ""), user));
      return;
    }

    const paidMatch = pathname.match(/^\/orders\/([^/]+)\/paid$/);
    if (req.method === "PATCH" && paidMatch) {
      sendJson(res, 200, await repo.markPaid(paidMatch[1], await readBody(req), user));
      return;
    }

    const cancelMatch = pathname.match(/^\/orders\/([^/]+)\/cancel$/);
    if (req.method === "PATCH" && cancelMatch) {
      sendJson(res, 200, await repo.cancelOrder(cancelMatch[1], await readBody(req), user));
      return;
    }

    if (req.method === "GET" && pathname === "/reports/day") {
      repo.requireRole(user, ["admin"]);
      sendJson(res, 200, await repo.reportForDay(url.searchParams.get("date") || new Date().toISOString().slice(0, 10)));
      return;
    }

    if (req.method === "POST" && pathname === "/reports/close-day") {
      sendJson(res, 201, await repo.closeDay(await readBody(req), user));
      return;
    }

    if (req.method === "GET" && pathname === "/audit") {
      repo.requireRole(user, ["admin"]);
      sendJson(res, 200, await repo.listAudit());
      return;
    }

    if (req.method === "POST" && pathname === "/users/waiters") {
      sendJson(res, 201, await repo.createWaiter(await readBody(req), user));
      return;
    }

    const waiterMatch = pathname.match(/^\/users\/waiters\/([^/]+)$/);
    if (waiterMatch && req.method === "PATCH") {
      sendJson(res, 200, await repo.updateWaiter(waiterMatch[1], await readBody(req), user));
      return;
    }

    if (waiterMatch && req.method === "DELETE") {
      sendJson(res, 200, await repo.removeWaiter(waiterMatch[1], user));
      return;
    }

    if (req.method === "POST" && pathname === "/products") {
      sendJson(res, 201, await repo.createProduct(await readBody(req), user));
      return;
    }

    const productMatch = pathname.match(/^\/products\/([^/]+)$/);
    if (productMatch && req.method === "PATCH") {
      sendJson(res, 200, await repo.updateProduct(productMatch[1], await readBody(req), user));
      return;
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message });
  }
}

module.exports = { handleApi };

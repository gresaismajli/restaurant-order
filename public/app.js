const state = {
  view: "waiter",
  waiters: [],
  products: [],
  orders: [],
  report: null,
  selectedWaiterId: "",
  table: "",
  orderNotes: "",
  cart: [],
  search: "",
  category: "all",
  reportDate: new Date().toISOString().slice(0, 10),
  toast: ""
};

const statusLabels = {
  sent: "Sent",
  received: "Received",
  preparing: "Preparing",
  done: "Done",
  paid: "Paid"
};

const statusRank = {
  sent: 1,
  received: 2,
  preparing: 3,
  done: 4
};

const app = document.getElementById("app");

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2800);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }
  return data;
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  state.waiters = data.waiters;
  state.products = data.products;
  state.orders = data.orders;
  state.selectedWaiterId = state.selectedWaiterId || (state.waiters[0] && state.waiters[0].id) || "";
  await loadReport();
  render();
}

async function loadOrders(silent) {
  try {
    state.orders = await api("/api/orders");
    if (!silent) {
      render();
    }
  } catch (error) {
    if (!silent) {
      showToast(error.message);
    }
  }
}

async function loadReport() {
  state.report = await api(`/api/reports/day?date=${encodeURIComponent(state.reportDate)}`);
}

function categories() {
  return ["all"].concat(Array.from(new Set(state.products.map(product => product.category))));
}

function filteredProducts() {
  const query = state.search.trim().toLowerCase();
  return state.products.filter(product => {
    const matchesCategory = state.category === "all" || product.category === state.category;
    const matchesSearch = !query || product.name.toLowerCase().indexOf(query) > -1;
    return matchesCategory && matchesSearch;
  });
}

function cartTotal() {
  return state.cart.reduce((sum, item) => {
    const product = state.products.find(productItem => productItem.id === item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}

function addToCart(productId) {
  const existing = state.cart.find(item => item.productId === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ productId, quantity: 1, note: "" });
  }
  render();
}

function updateCart(productId, change) {
  const existing = state.cart.find(item => item.productId === productId);
  if (!existing) {
    return;
  }
  existing.quantity += change;
  if (existing.quantity < 1) {
    state.cart = state.cart.filter(item => item.productId !== productId);
  }
  render();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter(item => item.productId !== productId);
  render();
}

function updateCartNote(productId, note) {
  const existing = state.cart.find(item => item.productId === productId);
  if (existing) {
    existing.note = note;
  }
}

async function sendOrder() {
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        waiterId: state.selectedWaiterId,
        table: state.table,
        notes: state.orderNotes,
        items: state.cart
      })
    });
    state.orders.unshift(order);
    state.table = "";
    state.orderNotes = "";
    state.cart = [];
    showToast(`Order #${order.number} sent to kitchen`);
  } catch (error) {
    showToast(error.message);
  }
}

async function setKitchenStatus(orderId, status) {
  try {
    const updated = await api(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    replaceOrder(updated);
    showToast(`Order #${updated.number} is ${statusLabels[updated.status].toLowerCase()}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function markPaid(orderId) {
  try {
    const updated = await api(`/api/orders/${orderId}/paid`, { method: "PATCH" });
    replaceOrder(updated);
    await loadReport();
    showToast(`Order #${updated.number} closed as paid`);
  } catch (error) {
    showToast(error.message);
  }
}

function replaceOrder(order) {
  state.orders = state.orders.map(item => (item.id === order.id ? order : item));
  render();
}

function activeOrders() {
  return state.orders.filter(order => order.paymentStatus !== "paid");
}

function paidOrders() {
  return state.orders.filter(order => order.paymentStatus === "paid");
}

function orderCard(order, context) {
  const isPaid = order.paymentStatus === "paid";
  const status = isPaid ? "paid" : order.status;
  const items = order.items.map(item => `
    <li>
      <span>
        <strong>${item.quantity}x ${escapeHtml(item.name)}</strong>
        ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
      </span>
      <strong>${formatMoney(item.price * item.quantity)}</strong>
    </li>
  `).join("");

  return `
    <article class="order-card">
      <div class="order-card-header">
        <div>
          <h3>#${order.number} - ${escapeHtml(order.table)}</h3>
          <p>${escapeHtml(order.waiterName)} - ${new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <span class="status ${status}">${statusLabels[status]}</span>
      </div>
      <div class="order-card-body">
        <div class="status-flow">
          ${["sent", "received", "preparing", "done"].map(step => `
            <span class="flow-step ${statusRank[order.status] >= statusRank[step] ? "active" : ""}"></span>
          `).join("")}
        </div>
        <ul class="line-items">${items}</ul>
        ${order.notes ? `<p><strong>Note:</strong> ${escapeHtml(order.notes)}</p>` : ""}
        <div class="total-row"><span>Total</span><span>${formatMoney(order.total)}</span></div>
        ${orderActions(order, context)}
      </div>
    </article>
  `;
}

function orderActions(order, context) {
  if (order.paymentStatus === "paid") {
    return "";
  }

  if (context === "kitchen") {
    return `
      <div class="order-actions">
        <button class="small-action" data-action="kitchen-status" data-id="${order.id}" data-status="received" ${order.status !== "sent" ? "disabled" : ""}>Confirm</button>
        <button class="small-action" data-action="kitchen-status" data-id="${order.id}" data-status="preparing" ${statusRank[order.status] < 2 || order.status === "preparing" || order.status === "done" ? "disabled" : ""}>Prepare</button>
        <button class="small-action ready" data-action="kitchen-status" data-id="${order.id}" data-status="done" ${order.status !== "preparing" ? "disabled" : ""}>Done</button>
      </div>
    `;
  }

  return `
    <div class="order-actions">
      <button class="small-action ready" data-action="paid" data-id="${order.id}" ${order.status !== "done" ? "disabled" : ""}>Mark paid</button>
    </div>
  `;
}

function renderWaiter() {
  const productCards = filteredProducts().map(product => `
    <button class="product" data-action="add-product" data-id="${product.id}">
      <strong>${escapeHtml(product.name)}</strong>
      <span>${escapeHtml(product.category)}</span>
      <span class="price">${formatMoney(product.price)}</span>
    </button>
  `).join("");

  const cartItems = state.cart.map(item => {
    const product = state.products.find(productItem => productItem.id === item.productId);
    if (!product) {
      return "";
    }

    return `
      <div class="cart-item">
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${formatMoney(product.price)} each</p>
          <input class="input" data-action="cart-note" data-id="${product.id}" value="${escapeHtml(item.note)}" placeholder="Kitchen note">
        </div>
        <div class="quantity">
          <button class="icon-button" data-action="cart-minus" data-id="${product.id}" title="Decrease">-</button>
          <strong>${item.quantity}</strong>
          <button class="icon-button" data-action="cart-plus" data-id="${product.id}" title="Increase">+</button>
          <button class="icon-button danger" data-action="cart-remove" data-id="${product.id}" title="Remove">x</button>
        </div>
      </div>
    `;
  }).join("");

  const active = activeOrders();
  return `
    <div class="workspace">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>New order</h2>
            <p>Select waiter, table, products, then send it to the kitchen.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="field-grid">
            <div class="field">
              <label for="waiter">Waiter</label>
              <select class="select" id="waiter" data-action="waiter-select">
                ${state.waiters.map(waiter => `<option value="${waiter.id}" ${waiter.id === state.selectedWaiterId ? "selected" : ""}>${escapeHtml(waiter.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="table">Table</label>
              <input class="input" id="table" data-action="table-input" value="${escapeHtml(state.table)}" placeholder="Table 4">
            </div>
            <div class="field full">
              <label for="notes">Order note</label>
              <textarea class="textarea" id="notes" data-action="order-notes" placeholder="Allergy, timing, customer request">${escapeHtml(state.orderNotes)}</textarea>
            </div>
          </div>

          <div class="menu-tools">
            <input class="input" data-action="search" value="${escapeHtml(state.search)}" placeholder="Search menu">
            <select class="select" data-action="category">
              ${categories().map(category => `<option value="${category}" ${category === state.category ? "selected" : ""}>${category === "all" ? "All categories" : escapeHtml(category)}</option>`).join("")}
            </select>
          </div>
          <div class="product-grid">${productCards || `<p class="empty">No products found.</p>`}</div>
        </div>
      </section>

      <aside class="panel">
        <div class="panel-header">
          <div>
            <h2>Current ticket</h2>
            <p>${state.cart.length} selected item${state.cart.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="cart-list">${cartItems || `<p class="empty">Tap products to build the order.</p>`}</div>
          <div class="cart-footer">
            <div class="total-row"><span>Total</span><span>${formatMoney(cartTotal())}</span></div>
            <button class="primary" data-action="send-order" ${state.cart.length ? "" : "disabled"}>Send to kitchen</button>
          </div>
        </div>
      </aside>

      <section class="panel" style="grid-column: 1 / -1;">
        <div class="panel-header">
          <div>
            <h2>Waiter dashboard</h2>
            <p>Track kitchen progress and close completed orders after payment.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="order-list">${active.map(order => orderCard(order, "waiter")).join("") || `<p class="empty">No active orders yet.</p>`}</div>
        </div>
      </section>
    </div>
  `;
}

function renderKitchen() {
  const columns = [
    { title: "New", statuses: ["sent"] },
    { title: "In progress", statuses: ["received", "preparing"] },
    { title: "Ready", statuses: ["done"] }
  ];

  return `
    <section class="kitchen-grid">
      ${columns.map(column => {
        const orders = activeOrders().filter(order => column.statuses.indexOf(order.status) > -1);
        return `
          <div class="column">
            <h2>${column.title}</h2>
            <div class="order-list">${orders.map(order => orderCard(order, "kitchen")).join("") || `<p class="empty">Nothing here.</p>`}</div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderReports() {
  const report = state.report || { total: 0, orderCount: 0, byWaiter: [], orders: [] };
  return `
    <section class="report-grid">
      <aside class="panel">
        <div class="panel-header">
          <div>
            <h2>Daily totals</h2>
            <p>Paid orders only.</p>
          </div>
        </div>
        <div class="panel-body cart-list">
          <div class="field">
            <label for="report-date">Date</label>
            <input class="input" id="report-date" type="date" data-action="report-date" value="${escapeHtml(state.reportDate)}">
          </div>
          <div class="metric">
            <span>Total money</span>
            <strong>${formatMoney(report.total)}</strong>
          </div>
          <div class="metric">
            <span>Paid orders</span>
            <strong>${report.orderCount}</strong>
          </div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Breakdown</h2>
            <p>Waiter totals and closed tickets for the selected day.</p>
          </div>
        </div>
        <div class="panel-body">
          <h3 class="section-title">By waiter</h3>
          <div class="report-list" style="margin: 12px 0 20px;">
            ${report.byWaiter.map(row => `
              <div class="report-row">
                <span>${escapeHtml(row.waiterName)} (${row.orders})</span>
                <strong>${formatMoney(row.total)}</strong>
              </div>
            `).join("")}
          </div>
          <h3 class="section-title">Paid orders</h3>
          <div class="order-list" style="margin-top: 12px;">
            ${report.orders.map(order => orderCard(order, "report")).join("") || `<p class="empty">No paid orders for this day.</p>`}
          </div>
        </div>
      </section>
    </section>
  `;
}

function render() {
  const body = state.view === "kitchen"
    ? renderKitchen()
    : state.view === "reports"
      ? renderReports()
      : renderWaiter();

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">RO</div>
          <div>
            <h1>Restaurant Orders</h1>
            <span>Waiter, kitchen, and daily cash control</span>
          </div>
        </div>
        <nav class="tabs" aria-label="Main views">
          <button class="tab ${state.view === "waiter" ? "active" : ""}" data-view="waiter">Waiter</button>
          <button class="tab ${state.view === "kitchen" ? "active" : ""}" data-view="kitchen">Kitchen</button>
          <button class="tab ${state.view === "reports" ? "active" : ""}" data-view="reports">Reports</button>
        </nav>
      </header>
      <main class="main">${body}</main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
}

app.addEventListener("click", async event => {
  const target = event.target.closest("[data-view], [data-action]");
  if (!target) {
    return;
  }

  if (target.dataset.view) {
    state.view = target.dataset.view;
    if (state.view === "reports") {
      await loadReport();
    }
    render();
    return;
  }

  const action = target.dataset.action;
  if (action === "add-product") addToCart(target.dataset.id);
  if (action === "cart-minus") updateCart(target.dataset.id, -1);
  if (action === "cart-plus") updateCart(target.dataset.id, 1);
  if (action === "cart-remove") removeFromCart(target.dataset.id);
  if (action === "send-order") sendOrder();
  if (action === "kitchen-status") setKitchenStatus(target.dataset.id, target.dataset.status);
  if (action === "paid") markPaid(target.dataset.id);
});

app.addEventListener("input", event => {
  const target = event.target;
  const action = target.dataset.action;
  if (action === "table-input") state.table = target.value;
  if (action === "order-notes") state.orderNotes = target.value;
  if (action === "search") {
    state.search = target.value;
    render();
  }
  if (action === "cart-note") updateCartNote(target.dataset.id, target.value);
});

app.addEventListener("change", async event => {
  const target = event.target;
  const action = target.dataset.action;
  if (action === "waiter-select") state.selectedWaiterId = target.value;
  if (action === "category") {
    state.category = target.value;
    render();
  }
  if (action === "report-date") {
    state.reportDate = target.value;
    await loadReport();
    render();
  }
});

loadBootstrap().catch(error => {
  app.innerHTML = `<main class="main"><div class="panel"><div class="panel-body">${escapeHtml(error.message)}</div></div></main>`;
});

window.setInterval(async () => {
  await loadOrders(true);
  if (state.view === "reports") {
    await loadReport();
  }
  render();
}, 4000);

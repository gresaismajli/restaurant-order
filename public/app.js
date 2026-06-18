const state = {
	token: localStorage.getItem("restaurant_token") || "",
	me: null,
	settings: null,
	users: [],
	products: [],
	orders: [],
	audit: [],
	report: null,
	view: "waiter",
	login: { username: "admin", password: "admin123" },
	table: "",
	orderNotes: "",
	cart: [],
	search: "",
	category: "all",
	reportDate: new Date().toISOString().slice(0, 10),
	payment: {
		method: "cash",
		discount: 0,
		amountReceived: "",
		tip: 0,
		note: "",
	},
	productForm: {
		id: "",
		name: "",
		category: "Pizza",
		price: "",
		available: true,
		sort: 999,
	},
	waiterForm: { id: "", name: "", username: "", password: "", active: true },
	closeDay: { countedCash: "", note: "" },
	toast: "",
	orderSnapshot: {},
	audioReady: localStorage.getItem("restaurant_alerts_enabled") === "true",
	audioContext: null,
};

const app = document.getElementById("app");
const statusLabels = {
	sent: "Sent",
	received: "Received",
	preparing: "Preparing",
	done: "Done",
	paid: "Paid",
	canceled: "Canceled",
};
const statusRank = { sent: 1, received: 2, preparing: 3, done: 4 };
const stationLabels = { bar: "Bartender", pizza: "Pizzaman", kitchen: "Kitchen" };
const productCategories = [
	"Pizza",
	"Soups",
	"Rissoto",
	"Pasta",
	"Grill",
	"Mix grill",
	"Fish",
	"Mix fish",
	"Salads",
	"Side dish",
	"Drinks and coctails",
];

function money(value) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: (state.settings && state.settings.currency) || "EUR",
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

function toast(message) {
	state.toast = message;
	render();
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => {
		state.toast = "";
		render();
	}, 3000);
}

function ensureAudio() {
	const AudioContext = window.AudioContext || window.webkitAudioContext;
	if (!AudioContext) return null;
	if (!state.audioContext) state.audioContext = new AudioContext();
	if (state.audioContext.state === "suspended") state.audioContext.resume();
	state.audioReady = true;
	localStorage.setItem("restaurant_alerts_enabled", "true");
	return state.audioContext;
}

function playTone(kind) {
	const audio = ensureAudio();
	if (!audio || audio.state === "suspended") return;
	const tones = kind === "ready"
		? [392, 523, 659, 784, 1046, 784]
		: [330, 440, 554, 740, 554];
	tones.forEach((frequency, index) => {
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		const start = audio.currentTime + index * 0.18;
		oscillator.type = "square";
		oscillator.frequency.value = frequency;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.34, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(start);
		oscillator.stop(start + 0.18);
	});
}

function vibrate(kind) {
	if (!navigator.vibrate) return;
	if (kind === "ready") navigator.vibrate([400, 120, 400, 120, 700]);
	else navigator.vibrate([300, 100, 300, 100, 300]);
}

async function enableAlerts() {
	ensureAudio();
	if ("Notification" in window && Notification.permission === "default") {
		try {
			await Notification.requestPermission();
		} catch (error) {}
	}
	await enablePushNotifications();
	state.audioReady = true;
	localStorage.setItem("restaurant_alerts_enabled", "true");
	render();
}

function urlBase64ToUint8Array(base64String) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}

async function enablePushNotifications() {
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !state.token) return false;
	if ("Notification" in window && Notification.permission !== "granted") return false;
	try {
		const keyData = await api("/api/push/public-key");
		if (!keyData.publicKey) return false;
		const registration = await navigator.serviceWorker.register("/sw.js");
		const existing = await registration.pushManager.getSubscription();
		const subscription = existing || await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
		});
		await api("/api/push/subscribe", {
			method: "POST",
			body: JSON.stringify(subscription)
		});
		return true;
	} catch (error) {
		console.warn("Push notification setup failed", error);
		return false;
	}
}

function notify(title, body, kind) {
	playTone(kind);
	vibrate(kind);
	if ("Notification" in window && Notification.permission === "granted") {
		try {
			new Notification(title, {
				body,
				tag: `restaurant-${kind}`,
				renotify: true,
				requireInteraction: kind === "ready",
				vibrate: kind === "ready" ? [400, 120, 400, 120, 700] : [300, 100, 300]
			});
		} catch (error) {}
	}
}

function stationForCurrentView() {
	if (!state.me) return "";
	if (state.me.role === "bartender") return "bar";
	if (state.me.role === "pizzaman") return "pizza";
	if (state.me.role === "kitchen") return "kitchen";
	if (["bar", "pizza", "kitchen"].indexOf(state.view) > -1) return state.view;
	return "";
}

function snapshotOrder(order) {
	const stationStatuses = {};
	Object.keys(order.stationStatuses || {}).forEach((station) => {
		stationStatuses[station] = order.stationStatuses[station].status;
	});
	return {
		status: order.status,
		paymentStatus: order.paymentStatus,
		stationStatuses,
	};
}

function primeOrderSnapshot(orders) {
	state.orderSnapshot = {};
	orders.forEach((order) => {
		state.orderSnapshot[order.id] = snapshotOrder(order);
	});
}

function detectOrderNotifications(nextOrders) {
	if (!state.me) return;
	const previous = state.orderSnapshot || {};
	const station = stationForCurrentView();
	let newStationOrder = false;
	let waiterReadyOrder = false;

	nextOrders.forEach((order) => {
		const before = previous[order.id];
		if (station && order.stationStatuses && order.stationStatuses[station]) {
			const beforeStation = before && before.stationStatuses ? before.stationStatuses[station] : "";
			if (!beforeStation && order.paymentStatus === "open") newStationOrder = true;
		}
		if (state.me.role === "waiter" && before && before.status !== "done" && order.status === "done" && order.paymentStatus === "open") {
			waiterReadyOrder = true;
		}
	});

	if (newStationOrder) {
		notify("New order received", "A new order arrived for this station.", "new");
		toast("New order received");
	}
	if (waiterReadyOrder) {
		notify("Order ready for pickup", "An order is fully done.", "ready");
		toast("Order ready for pickup");
	}
	primeOrderSnapshot(nextOrders);
}

async function api(path, options) {
	const response = await fetch(path, {
		headers: {
			"Content-Type": "application/json",
			Authorization: state.token ? `Bearer ${state.token}` : "",
		},
		...options,
	});
	const data = await response.json();
	if (!response.ok) {
		if (response.status === 401) logout(false);
		throw new Error(data.error || "Request failed");
	}
	return data;
}

function allowedViews() {
	if (!state.me) return [];
	if (state.me.role === "admin")
		return ["waiter", "bar", "pizza", "kitchen", "reports", "staff", "admin"];
	if (state.me.role === "kitchen") return ["kitchen"];
	if (state.me.role === "bartender") return ["bar"];
	if (state.me.role === "pizzaman") return ["pizza"];
	return ["waiter"];
}

function defaultViewForRole(role) {
	if (role === "kitchen") return "kitchen";
	if (role === "bartender") return "bar";
	if (role === "pizzaman") return "pizza";
	return "waiter";
}

async function bootstrap() {
	if (!state.token) {
		render();
		return;
	}
	try {
		const data = await api("/api/bootstrap");
		state.me = data.me;
		state.settings = data.settings;
		state.users = data.users || [];
		state.products = data.products;
		state.orders = data.orders;
		if (["kitchen", "bartender", "pizzaman"].indexOf(state.me.role) > -1) {
			state.view = defaultViewForRole(state.me.role);
		}
		if (allowedViews().indexOf(state.view) === -1)
			state.view = allowedViews()[0];
		if (state.view === "reports") await loadReport();
		if (state.view === "admin" || state.view === "staff") await loadAudit();
		primeOrderSnapshot(state.orders);
		render();
	} catch (error) {
		toast(error.message);
		render();
	}
}

async function login() {
	try {
		const data = await api("/api/auth/login", {
			method: "POST",
			body: JSON.stringify(state.login),
		});
		state.token = data.token;
		localStorage.setItem("restaurant_token", state.token);
		if (state.audioReady) ensureAudio();
		state.me = data.user;
		state.view = defaultViewForRole(data.user.role);
		await bootstrap();
		if (state.audioReady) enablePushNotifications();
		toast(`Logged in as ${data.user.name}`);
	} catch (error) {
		toast(error.message);
	}
}

async function logout(callApi = true) {
	if (callApi && state.token) {
		try {
			await api("/api/auth/logout", { method: "POST" });
		} catch (error) {}
	}
	localStorage.removeItem("restaurant_token");
	state.token = "";
	state.me = null;
	state.orders = [];
	state.orderSnapshot = {};
	render();
}

async function refreshOrders(silent) {
	if (!state.token) return;
	try {
		const orders = await api("/api/orders");
		if (silent) detectOrderNotifications(orders);
		else primeOrderSnapshot(orders);
		state.orders = orders;
		if (!silent) render();
	} catch (error) {
		if (!silent) toast(error.message);
	}
}

async function loadReport() {
	state.report = await api(
		`/api/reports/day?date=${encodeURIComponent(state.reportDate)}`,
	);
}

async function loadAudit() {
	state.audit = await api("/api/audit");
}

function categories() {
	return ["all"].concat(
		Array.from(
			new Set(productCategories.concat(state.products.map((product) => product.category))),
		).filter(Boolean),
	);
}

function menuProducts(includeUnavailable) {
	const query = state.search.trim().toLowerCase();
	return state.products.filter((product) => {
		if (!includeUnavailable && product.available === false) return false;
		if (state.category !== "all" && product.category !== state.category)
			return false;
		return !query || product.name.toLowerCase().indexOf(query) > -1;
	});
}

function cartTotal() {
	return state.cart.reduce((sum, item) => {
		const product = state.products.find(
			(candidate) => candidate.id === item.productId,
		);
		return sum + (product ? product.price * item.quantity : 0);
	}, 0);
}

function addProduct(productId) {
	const product = state.products.find((item) => item.id === productId);
	if (!product || product.available === false) return;
	const existing = state.cart.find((item) => item.productId === productId);
	if (existing) existing.quantity += 1;
	else state.cart.push({ productId, quantity: 1, note: "" });
	render();
}

function updateCart(productId, amount) {
	const item = state.cart.find(
		(candidate) => candidate.productId === productId,
	);
	if (!item) return;
	item.quantity += amount;
	if (item.quantity < 1)
		state.cart = state.cart.filter(
			(candidate) => candidate.productId !== productId,
		);
	render();
}

async function sendOrder() {
	try {
		const order = await api("/api/orders", {
			method: "POST",
			body: JSON.stringify({
				table: state.table,
				notes: state.orderNotes,
				items: state.cart,
			}),
		});
		state.orders.unshift(order);
		state.table = "";
		state.orderNotes = "";
		state.cart = [];
		toast(`Order #${order.number} sent`);
	} catch (error) {
		toast(error.message);
	}
}

async function setStatus(orderId, status, station) {
	try {
		const path = station
			? `/api/orders/${orderId}/stations/${station}/status`
			: `/api/orders/${orderId}/status`;
		const order = await api(path, {
			method: "PATCH",
			body: JSON.stringify({ status }),
		});
		replaceOrder(order);
		toast(`Order #${order.number}: ${station ? `${stationLabels[station]} ` : ""}${statusLabels[status]}`);
	} catch (error) {
		toast(error.message);
	}
}

async function payOrder(orderId) {
	try {
		const order = await api(`/api/orders/${orderId}/paid`, {
			method: "PATCH",
			body: JSON.stringify(state.payment),
		});
		replaceOrder(order);
		state.payment = {
			method: "cash",
			discount: 0,
			amountReceived: "",
			tip: 0,
			note: "",
		};
		toast(`Order #${order.number} paid`);
	} catch (error) {
		toast(error.message);
	}
}

async function cancelOrder(orderId) {
	const reason = prompt("Cancel reason");
	if (!reason) return;
	try {
		const order = await api(`/api/orders/${orderId}/cancel`, {
			method: "PATCH",
			body: JSON.stringify({ reason }),
		});
		replaceOrder(order);
		toast(`Order #${order.number} canceled`);
	} catch (error) {
		toast(error.message);
	}
}

function replaceOrder(order) {
	state.orders = state.orders.map((item) =>
		item.id === order.id ? order : item,
	);
	state.orderSnapshot[order.id] = snapshotOrder(order);
	render();
}

async function saveProduct() {
	try {
		const payload = {
			name: state.productForm.name,
			category: state.productForm.category,
			price: Number(state.productForm.price),
			available: state.productForm.available,
			sort: Number(state.productForm.sort || 999),
		};
		const path = state.productForm.id
			? `/api/products/${state.productForm.id}`
			: "/api/products";
		const method = state.productForm.id ? "PATCH" : "POST";
		const product = await api(path, { method, body: JSON.stringify(payload) });
		const exists = state.products.some((item) => item.id === product.id);
		state.products = exists
			? state.products.map((item) => (item.id === product.id ? product : item))
			: state.products.concat(product);
		resetProductForm();
		await loadAudit();
		toast("Menu saved");
	} catch (error) {
		toast(error.message);
	}
}

function editProduct(id) {
	const product = state.products.find((item) => item.id === id);
	if (!product) return;
	state.productForm = { ...product };
	render();
}

async function deleteProduct(id) {
	const product = state.products.find((item) => item.id === id);
	if (!product || !confirm(`Delete ${product.name} from the menu?`)) return;
	try {
		const updated = await api(`/api/products/${id}`, { method: "DELETE" });
		state.products = state.products.filter((item) => item.id !== updated.id);
		if (state.productForm.id === id) resetProductForm();
		await loadAudit();
		toast(`${updated.name} removed from menu`);
	} catch (error) {
		toast(error.message);
	}
}

function resetProductForm() {
	state.productForm = {
		id: "",
		name: "",
		category: "Pizza",
		price: "",
		available: true,
		sort: 999,
	};
}

async function saveWaiter() {
	try {
		const payload = {
			name: state.waiterForm.name,
			username: state.waiterForm.username,
			password: state.waiterForm.password,
			active: state.waiterForm.active,
		};
		const path = state.waiterForm.id
			? `/api/users/waiters/${state.waiterForm.id}`
			: "/api/users/waiters";
		const method = state.waiterForm.id ? "PATCH" : "POST";
		const waiter = await api(path, {
			method,
			body: JSON.stringify(payload),
		});
		state.users = state.users.some((user) => user.id === waiter.id)
			? state.users.map((user) => (user.id === waiter.id ? waiter : user))
			: state.users.concat(waiter);
		resetWaiterForm();
		await loadAudit();
		toast(`Waiter ${waiter.name} saved`);
	} catch (error) {
		toast(error.message);
	}
}

function editWaiter(id) {
	const waiter = state.users.find(
		(user) => user.id === id && user.role === "waiter",
	);
	if (!waiter) return;
	state.waiterForm = {
		id: waiter.id,
		name: waiter.name,
		username: waiter.username,
		password: "",
		active: waiter.active,
	};
	render();
}

function resetWaiterForm() {
	state.waiterForm = {
		id: "",
		name: "",
		username: "",
		password: "",
		active: true,
	};
}

async function removeWaiter(id) {
	const waiter = state.users.find((user) => user.id === id);
	if (!waiter || !confirm(`Remove waiter ${waiter.name}?`)) return;
	try {
		const updated = await api(`/api/users/waiters/${id}`, { method: "DELETE" });
		state.users = state.users.map((user) =>
			user.id === updated.id ? updated : user,
		);
		await loadAudit();
		toast(`Waiter ${updated.name} removed`);
	} catch (error) {
		toast(error.message);
	}
}

async function closeDay() {
	try {
		const closure = await api("/api/reports/close-day", {
			method: "POST",
			body: JSON.stringify({
				date: state.reportDate,
				countedCash: state.closeDay.countedCash,
				note: state.closeDay.note,
			}),
		});
		state.closeDay = { countedCash: "", note: "" };
		await loadReport();
		toast(`Day closed. Expected cash: ${money(closure.expectedCash)}`);
	} catch (error) {
		toast(error.message);
	}
}

function activeOrders() {
	return state.orders.filter((order) => order.paymentStatus === "open");
}

function closedOrders() {
	return state.orders.filter((order) => order.paymentStatus !== "open");
}

function orderCard(order, context) {
	const status = order.paymentStatus === "paid" ? "paid" : order.status;
	const station = context && context.indexOf("station:") === 0 ? context.split(":")[1] : "";
	const displayItems = station
		? order.items.filter((item) => item.station === station)
		: order.items;
	const items = displayItems
		.map(
			(item) => `
    <li>
      <span><strong>${item.quantity}x ${escapeHtml(item.name)}</strong><small>${escapeHtml(stationLabels[item.station] || item.station || "")}${item.note ? ` - ${escapeHtml(item.note)}` : ""}</small></span>
      <strong>${money(item.price * item.quantity)}</strong>
    </li>
  `,
		)
		.join("");
	const stationSummary = order.stationStatuses
		? Object.keys(order.stationStatuses)
				.map((key) => `<span class="status ${order.stationStatuses[key].status}">${stationLabels[key]}: ${statusLabels[order.stationStatuses[key].status]}</span>`)
				.join("")
		: "";

	return `
    <article class="order-card ${order.paymentStatus !== "open" ? "closed" : ""}">
      <div class="order-card-header">
        <div>
          <h3>#${order.number} - ${escapeHtml(order.table)}</h3>
          <p>${escapeHtml(order.waiterName)} - ${new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <span class="status ${status}">${statusLabels[status] || status}</span>
      </div>
      <div class="order-card-body">
        ${order.paymentStatus === "open" ? `<div class="station-summary">${stationSummary}</div>` : ""}
        <ul class="line-items">${items}</ul>
        ${order.notes ? `<p><strong>Note:</strong> ${escapeHtml(order.notes)}</p>` : ""}
        ${order.discount ? `<div class="line"><span>Discount</span><strong>-${money(order.discount)}</strong></div>` : ""}
        <div class="total-row"><span>Total</span><span>${money(order.total)}</span></div>
        ${order.payment ? `<p>Payment: ${escapeHtml(order.payment.method)}${order.payment.tip ? `, tip ${money(order.payment.tip)}` : ""}</p>` : ""}
        ${order.paymentStatus === "void" ? `<p>Void: ${escapeHtml(order.canceledReason)}</p>` : ""}
        ${orderActions(order, context)}
      </div>
    </article>
  `;
}

function orderActions(order, context) {
	if (order.paymentStatus !== "open") return "";
	if (context && context.indexOf("station:") === 0) {
		const station = context.split(":")[1];
		const stationStatus = order.stationStatuses && order.stationStatuses[station] ? order.stationStatuses[station].status : "";
		return `
      <div class="order-actions">
        <button class="small-action" data-action="status" data-id="${order.id}" data-station="${station}" data-status="received" ${stationStatus !== "sent" ? "disabled" : ""}>Confirm</button>
        <button class="small-action" data-action="status" data-id="${order.id}" data-station="${station}" data-status="preparing" ${stationStatus !== "received" ? "disabled" : ""}>Prepare</button>
        <button class="small-action ready" data-action="status" data-id="${order.id}" data-station="${station}" data-status="done" ${["received", "preparing"].indexOf(stationStatus) === -1 ? "disabled" : ""}>Done</button>
      </div>
    `;
	}
	return `
    <div class="payment-box">
      <select class="select compact" data-action="pay-method">
        ${["cash", "card", "mixed", "other"].map((method) => `<option value="${method}" ${state.payment.method === method ? "selected" : ""}>${method}</option>`).join("")}
      </select>
      <input class="input compact" type="number" step="0.01" data-action="pay-discount" value="${escapeHtml(state.payment.discount)}" placeholder="Discount">
      <input class="input compact" type="number" step="0.01" data-action="pay-tip" value="${escapeHtml(state.payment.tip)}" placeholder="Tip">
      <button class="small-action ready" data-action="paid" data-id="${order.id}" ${order.status !== "done" ? "disabled" : ""}>Paid</button>
      <button class="small-action danger" data-action="cancel" data-id="${order.id}">Void</button>
    </div>
  `;
}

function renderLogin() {
	return `
    <main class="login-screen">
      <section class="login-card">
        <div class="brand big"><div class="brand-mark">RO</div><div><h1>Restaurant Orders</h1><span>Secure staff access</span></div></div>
        <div class="field"><label>Username</label><input class="input" data-action="login-username" value="${escapeHtml(state.login.username)}"></div>
        <div class="field"><label>Password</label><input class="input" type="password" data-action="login-password" value="${escapeHtml(state.login.password)}"></div>
        <button class="primary" data-action="login">Log in</button>
        <p class="empty">Defaults: admin/admin123, kitchen/kitchen123, bartender/bar123, pizzaman/pizza123.</p>
      </section>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </main>
  `;
}

function renderWaiter() {
	const products = menuProducts(false)
		.map(
			(product) => `
    <button class="product" data-action="add-product" data-id="${product.id}">
      <strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)}</span><span class="price">${money(product.price)}</span>
    </button>
  `,
		)
		.join("");
	const cart = state.cart
		.map((item) => {
			const product = state.products.find(
				(candidate) => candidate.id === item.productId,
			);
			if (!product) return "";
			return `
      <div class="cart-item">
        <div><h3>${escapeHtml(product.name)}</h3><p>${money(product.price)} each</p><input class="input" data-action="cart-note" data-id="${product.id}" value="${escapeHtml(item.note)}" placeholder="Kitchen note"></div>
        <div class="quantity"><button class="icon-button" data-action="cart-minus" data-id="${product.id}">-</button><strong>${item.quantity}</strong><button class="icon-button" data-action="cart-plus" data-id="${product.id}">+</button></div>
      </div>
    `;
		})
		.join("");
	return `
    <div class="workspace">
      <section class="panel"><div class="panel-header"><div><h2>New order</h2><p>${escapeHtml(state.me.name)} is taking this order.</p></div></div>
        <div class="panel-body">
          <div class="field-grid">
            <div class="field"><label>Table</label><input class="input" data-action="table" value="${escapeHtml(state.table)}" placeholder="Table 4"></div>
            <div class="field"><label>Search</label><input class="input" data-action="search" value="${escapeHtml(state.search)}" placeholder="Menu item"></div>
            <div class="field"><label>Category</label><select class="select" data-action="category">${categories()
							.map(
								(category) =>
									`<option value="${category}" ${state.category === category ? "selected" : ""}>${category === "all" ? "All categories" : escapeHtml(category)}</option>`,
							)
							.join("")}</select></div>
            <div class="field full"><label>Order note</label><textarea class="textarea" data-action="order-notes">${escapeHtml(state.orderNotes)}</textarea></div>
          </div>
          <div class="product-grid">${products || `<p class="empty">No available products.</p>`}</div>
        </div>
      </section>
      <aside class="panel"><div class="panel-header"><div><h2>Ticket</h2><p>${state.cart.length} item${state.cart.length === 1 ? "" : "s"}</p></div></div>
        <div class="panel-body"><div class="cart-list">${cart || `<p class="empty">Tap products to add them.</p>`}</div><div class="cart-footer"><div class="total-row"><span>Total</span><span>${money(cartTotal())}</span></div><button class="primary" data-action="send-order" ${state.cart.length ? "" : "disabled"}>Send order</button></div></div>
      </aside>
      <section class="panel span"><div class="panel-header"><div><h2>My active orders</h2><p>Close paid orders only after every required station marks its part done.</p></div></div><div class="panel-body"><div class="order-list">${
				activeOrders()
					.map((order) => orderCard(order, "waiter"))
					.join("") || `<p class="empty">No active orders.</p>`
			}</div></div></section>
    </div>
  `;
}

function renderStation(station) {
	const columns = [
		{ title: "New", statuses: ["sent"] },
		{ title: "Cooking", statuses: ["received", "preparing"] },
		{ title: "Ready", statuses: ["done"] },
	];
	return `<section class="station-board"><div class="panel station-hero"><div class="panel-header"><div><h2>${stationLabels[station]} orders</h2><p>Receive and complete only the items assigned to this station.</p></div></div></div><div class="kitchen-grid">${columns
		.map((column) => {
			const orders = activeOrders().filter(
				(order) => order.stationStatuses && order.stationStatuses[station] && column.statuses.indexOf(order.stationStatuses[station].status) > -1,
			);
			return `<div class="column"><h2>${stationLabels[station]} - ${column.title}</h2><div class="order-list">${orders.map((order) => orderCard(order, `station:${station}`)).join("") || `<p class="empty">Nothing here.</p>`}</div></div>`;
		})
		.join("")}</div></section>`;
}

function renderReports() {
	const report = state.report || {
		total: 0,
		orderCount: 0,
		voidCount: 0,
		discounts: 0,
		tips: 0,
		byWaiter: [],
		byMethod: [],
		orders: [],
		voidOrders: [],
	};
	return `
    <section class="report-grid">
      <aside class="panel"><div class="panel-header"><div><h2>End of day</h2><p>Paid sales, voids, and cash control.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Date</label><input class="input" type="date" data-action="report-date" value="${escapeHtml(state.reportDate)}"></div>
          <div class="metric"><span>Total sales</span><strong>${money(report.total)}</strong></div>
          <div class="metric"><span>Paid orders</span><strong>${report.orderCount}</strong></div>
          <div class="metric"><span>Voids</span><strong>${report.voidCount}</strong></div>
          <div class="field"><label>Counted cash</label><input class="input" type="number" step="0.01" data-action="close-cash" value="${escapeHtml(state.closeDay.countedCash)}"></div>
          <div class="field"><label>Closing note</label><textarea class="textarea" data-action="close-note">${escapeHtml(state.closeDay.note)}</textarea></div>
          <button class="primary" data-action="close-day">Close day</button>
        </div>
      </aside>
      <section class="panel"><div class="panel-header"><div><h2>Report</h2><p>Breakdown for ${escapeHtml(report.date || state.reportDate)}.</p></div></div>
        <div class="panel-body">
          <div class="metrics-row"><div class="metric"><span>Subtotal</span><strong>${money(report.subtotal)}</strong></div><div class="metric"><span>Discounts</span><strong>${money(report.discounts)}</strong></div><div class="metric"><span>Tips</span><strong>${money(report.tips)}</strong></div></div>
          <h3 class="section-title">Payment methods</h3><div class="report-list">${report.byMethod.map((row) => `<div class="report-row"><span>${escapeHtml(row.method)} (${row.orders})</span><strong>${money(row.total)}</strong></div>`).join("")}</div>
          <h3 class="section-title">Waiters</h3><div class="report-list">${report.byWaiter.map((row) => `<div class="report-row"><span>${escapeHtml(row.waiterName)} (${row.orders})</span><strong>${money(row.total)}</strong></div>`).join("")}</div>
          <h3 class="section-title">Paid orders</h3><div class="order-list">${report.orders.map((order) => orderCard(order, "report")).join("") || `<p class="empty">No paid orders.</p>`}</div>
        </div>
      </section>
    </section>
  `;
}

function renderStaff() {
	const waiterRows = state.users
		.filter((user) => user.role === "waiter")
		.map(
			(waiter) => `
    <div class="admin-row ${waiter.active ? "" : "muted-row"}">
      <span><strong>${escapeHtml(waiter.name)}</strong><small>${escapeHtml(waiter.username)} - ${waiter.active ? "active" : "removed"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-waiter" data-id="${waiter.id}">Edit</button>
        <button class="small-action danger" data-action="remove-waiter" data-id="${waiter.id}" ${waiter.active ? "" : "disabled"}>Remove</button>
      </div>
    </div>
  `,
		)
		.join("");

	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>${state.waiterForm.id ? "Edit waiter" : "Add waiter"}</h2><p>Create staff login accounts for waiters.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Name</label><input class="input" data-action="waiter-name" value="${escapeHtml(state.waiterForm.name)}" placeholder="Waiter name"></div>
          <div class="field"><label>Username</label><input class="input" data-action="waiter-username" value="${escapeHtml(state.waiterForm.username)}" placeholder="login username"></div>
          <div class="field"><label>Password</label><input class="input" type="password" data-action="waiter-password" value="${escapeHtml(state.waiterForm.password)}" placeholder="${state.waiterForm.id ? "leave empty to keep current" : "minimum 6 characters"}"></div>
          <label class="check"><input type="checkbox" data-action="waiter-active" ${state.waiterForm.active ? "checked" : ""}> Active</label>
          <button class="primary" data-action="save-waiter">${state.waiterForm.id ? "Update waiter" : "Add waiter"}</button>
          <button class="secondary" data-action="reset-waiter">Clear</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Waiter accounts</h2><p>${state.users.filter((user) => user.role === "waiter" && user.active).length} active.</p></div></div><div class="panel-body"><div class="admin-list">${waiterRows || `<p class="empty">No waiters yet.</p>`}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Audit log</h2><p>Latest staff changes.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">No audit entries.</p>`}</div></div></div>
    </section>
  `;
}

function renderAdmin() {
	const rows = state.products
		.map(
			(product) => `
    <div class="admin-row">
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} - ${money(product.price)} - ${product.available ? "available" : "hidden"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-product" data-id="${product.id}">Edit</button>
        <button class="small-action danger" data-action="delete-product" data-id="${product.id}" ${product.available ? "" : "disabled"}>Delete</button>
      </div>
    </div>
  `,
		)
		.join("");
	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>Menu management</h2><p>Add products, change prices, hide unavailable items.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Name</label><input class="input" data-action="product-name" value="${escapeHtml(state.productForm.name)}"></div>
          <div class="field"><label>Category</label><select class="select" data-action="product-category">${productCategories.map((category) => `<option value="${escapeHtml(category)}" ${state.productForm.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div>
          <div class="field-grid"><div class="field"><label>Price</label><input class="input" type="number" step="0.01" data-action="product-price" value="${escapeHtml(state.productForm.price)}"></div><div class="field"><label>Sort</label><input class="input" type="number" data-action="product-sort" value="${escapeHtml(state.productForm.sort)}"></div></div>
          <label class="check"><input type="checkbox" data-action="product-available" ${state.productForm.available ? "checked" : ""}> Available</label>
          <button class="primary" data-action="save-product">${state.productForm.id ? "Update product" : "Add product"}</button>
          <button class="secondary" data-action="reset-product">Clear</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Products</h2><p>${state.products.length} menu items.</p></div></div><div class="panel-body"><div class="admin-list">${rows}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Audit log</h2><p>Latest operational changes.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">No audit entries.</p>`}</div></div></div>
    </section>
  `;
}

function renderShell() {
	const body =
		state.view === "kitchen"
			? renderStation("kitchen")
			: state.view === "bar"
				? renderStation("bar")
				: state.view === "pizza"
					? renderStation("pizza")
			: state.view === "reports"
				? renderReports()
				: state.view === "staff"
					? renderStaff()
					: state.view === "admin"
						? renderAdmin()
						: renderWaiter();
	const labels = {
		waiter: "Waiter",
		bar: "Bartender",
		pizza: "Pizzaman",
		kitchen: "Kitchen",
		reports: "Reports",
		staff: "Staff",
		admin: "Menu",
	};
	return `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><div class="brand-mark">RO</div><div><h1>${escapeHtml((state.settings && state.settings.restaurantName) || "Restaurant Orders")}</h1><span>${escapeHtml(state.me.name)} - ${escapeHtml(state.me.role)}</span></div></div>
        <nav class="tabs">${allowedViews()
					.map(
						(view) =>
							`<button class="tab ${state.view === view ? "active" : ""}" data-view="${view}">${labels[view] || view}</button>`,
					)
					.join(
						"",
					)}<button class="tab" data-action="enable-sound">${state.audioReady ? "Alerts on" : "Enable alerts"}</button><button class="tab" data-action="logout">Logout</button></nav>
      </header>
      <main class="main">${body}</main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
}

function render() {
	app.innerHTML = state.me ? renderShell() : renderLogin();
}

app.addEventListener("click", async (event) => {
	const target = event.target.closest("[data-view], [data-action]");
	if (!target) return;
	if (target.dataset.view) {
		state.view = target.dataset.view;
		if (state.view === "reports") await loadReport();
		if (state.view === "admin" || state.view === "staff") await loadAudit();
		render();
		return;
	}
	const action = target.dataset.action;
	if (action === "enable-sound") {
		await enableAlerts();
		playTone("ready");
		vibrate("ready");
		toast("Alerts enabled");
		return;
	}
	if (action === "login") login();
	if (action === "logout") logout(true);
	if (action === "add-product") addProduct(target.dataset.id);
	if (action === "cart-minus") updateCart(target.dataset.id, -1);
	if (action === "cart-plus") updateCart(target.dataset.id, 1);
	if (action === "send-order") sendOrder();
	if (action === "status") setStatus(target.dataset.id, target.dataset.status, target.dataset.station);
	if (action === "paid") payOrder(target.dataset.id);
	if (action === "cancel") cancelOrder(target.dataset.id);
	if (action === "save-product") saveProduct();
	if (action === "edit-product") editProduct(target.dataset.id);
	if (action === "delete-product") deleteProduct(target.dataset.id);
	if (action === "reset-product") {
		resetProductForm();
		render();
	}
	if (action === "save-waiter") saveWaiter();
	if (action === "edit-waiter") editWaiter(target.dataset.id);
	if (action === "remove-waiter") removeWaiter(target.dataset.id);
	if (action === "reset-waiter") {
		resetWaiterForm();
		render();
	}
	if (action === "close-day") closeDay();
});

app.addEventListener("input", (event) => {
	const t = event.target;
	const action = t.dataset.action;
	if (action === "login-username") state.login.username = t.value;
	if (action === "login-password") state.login.password = t.value;
	if (action === "table") state.table = t.value;
	if (action === "order-notes") state.orderNotes = t.value;
	if (action === "search") {
		state.search = t.value;
		render();
	}
	if (action === "cart-note") {
		const item = state.cart.find(
			(candidate) => candidate.productId === t.dataset.id,
		);
		if (item) item.note = t.value;
	}
	if (action === "pay-discount") state.payment.discount = t.value;
	if (action === "pay-tip") state.payment.tip = t.value;
	if (action === "product-name") state.productForm.name = t.value;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "product-price") state.productForm.price = t.value;
	if (action === "product-sort") state.productForm.sort = t.value;
	if (action === "waiter-name") state.waiterForm.name = t.value;
	if (action === "waiter-username") state.waiterForm.username = t.value;
	if (action === "waiter-password") state.waiterForm.password = t.value;
	if (action === "close-cash") state.closeDay.countedCash = t.value;
	if (action === "close-note") state.closeDay.note = t.value;
});

app.addEventListener("change", async (event) => {
	const t = event.target;
	const action = t.dataset.action;
	if (action === "category") {
		state.category = t.value;
		render();
	}
	if (action === "pay-method") state.payment.method = t.value;
	if (action === "product-available") state.productForm.available = t.checked;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "waiter-active") state.waiterForm.active = t.checked;
	if (action === "report-date") {
		state.reportDate = t.value;
		await loadReport();
		render();
	}
});

bootstrap();
setInterval(async () => {
	if (!state.me) return;
	await refreshOrders(true);
	if (state.view === "reports") await loadReport();
	render();
}, 4000);

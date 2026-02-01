// app/static/labo/product_stats.js

console.log("[LABO_PRODUCT_STATS] JS chargé");

const API_BASE = "/api-zenhub/labo/products";

const $ = (sel, root = document) => root.querySelector(sel);

let chartMonthlyQty = null;
let chartMonthlyRevenue = null;
let chartTopClients = null;

// =========================
// Auth helper
// =========================

function getToken() {
  return localStorage.getItem("token");
}

async function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    console.error("Token JWT manquant");
    throw new Error("Missing token");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  headers.set("Accept", "application/json");

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

async function fetchJSON(url) {
  const res = await authFetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} - ${txt}`);
  }
  return res.json();
}

// =========================
// Formatters
// =========================

function formatCurrency(v) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number(v || 0));
}

function formatNumber(v) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

function formatDateISO(d) {
  if (!d) return "-";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR");
}

// =========================
// Cards globales
// =========================

function renderGlobalStats(data) {
  const wrap = $("#globalStats");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">CA total HT (facturé)</div>
      <div class="stat-value">${formatCurrency(data.total_revenue_ht)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Quantité totale vendue</div>
      <div class="stat-value">${formatNumber(data.total_qty)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Prix moyen HT</div>
      <div class="stat-value">${formatCurrency(data.avg_price_ht)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Nombre de clients</div>
      <div class="stat-value">${data.nb_clients}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Première vente</div>
      <div class="stat-value">${
        data.first_sale_date ? formatDateISO(data.first_sale_date) : "-"
      }</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Dernière vente</div>
      <div class="stat-value">${
        data.last_sale_date ? formatDateISO(data.last_sale_date) : "-"
      }</div>
    </div>
  `;
}

// =========================
// Graphiques
// =========================

function renderMonthlyCharts(monthlyData) {
  const labels = monthlyData.points.map((p) => {
    const d = new Date(p.month);
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  });
  const qtyValues = monthlyData.points.map((p) => Number(p.qty || 0));
  const revenueValues = monthlyData.points.map((p) => Number(p.revenue_ht || 0));

  const ctxQty = $("#chartMonthlyQty");
  const ctxRev = $("#chartMonthlyRevenue");

  if (chartMonthlyQty) chartMonthlyQty.destroy();
  if (chartMonthlyRevenue) chartMonthlyRevenue.destroy();

  chartMonthlyQty = new Chart(ctxQty, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Quantités vendues",
          data: qtyValues,
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
      },
    },
  });

  chartMonthlyRevenue = new Chart(ctxRev, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "CA HT",
          data: revenueValues,
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function renderTopClientsChart(data) {
  const labels = data.items.map((c) => c.client_name);
  const values = data.items.map((c) => Number(c.total_revenue_ht || 0));

  const ctx = $("#chartTopClients");
  if (chartTopClients) chartTopClients.destroy();

  chartTopClients = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "CA HT",
          data: values,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true },
      },
    },
  });
}

// =========================
// Tableaux
// =========================

function renderTopClientsTable(data) {
  const tbody = $("#topClientsBody");
  if (!tbody) return;

  if (!data.items.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;opacity:.6;">Aucune vente</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  data.items.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.client_name}</td>
      <td class="ta-right">${formatNumber(c.total_qty)}</td>
      <td class="ta-right">${formatCurrency(c.total_revenue_ht)}</td>
      <td>${c.last_purchase_date ? formatDateISO(c.last_purchase_date) : "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSalesListTable(data) {
  const tbody = $("#salesListBody");
  if (!tbody) return;

  if (!data.items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;opacity:.6;">Aucune vente</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  data.items.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateISO(s.date_document)}</td>
      <td>${s.doc_type}</td>
      <td>${s.doc_number}</td>
      <td>${s.client_name}</td>
      <td class="ta-right">${formatNumber(s.qty)}</td>
      <td class="ta-right">${formatCurrency(s.unit_price_ht)}</td>
      <td class="ta-right">${formatCurrency(s.total_ht)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// =========================
// Loader visuel global
// =========================

function setCardLoading(root, isLoading) {
  root.style.opacity = isLoading ? "0.5" : "1";
}

// =========================
// Init
// =========================

async function initProductStats() {
  const root = $("#productStatsRoot");
  if (!root) return;

  const productId = root.dataset.productId;
  if (!productId) return;

  const base = `${API_BASE}/${productId}/stats`;

  try {
    setCardLoading(root, true);

    const [globalStats, monthly, topClients, salesList] = await Promise.all([
      fetchJSON(`${base}/global`),
      fetchJSON(`${base}/monthly-sales`),
      fetchJSON(`${base}/top-clients`),
      fetchJSON(`${base}/sales-list`),
    ]);

    renderGlobalStats(globalStats);
    renderMonthlyCharts(monthly);
    renderTopClientsChart(topClients);
    renderTopClientsTable(topClients);
    renderSalesListTable(salesList);
  } catch (err) {
    console.error("[LABO_PRODUCT_STATS] Erreur:", err);
    alert("Erreur lors du chargement des statistiques produit.");
  } finally {
    setCardLoading(root, false);
  }
}

document.addEventListener("DOMContentLoaded", initProductStats);

// app/static/agent/pages/client_detail/index.js

const root = document.getElementById("agent-client-detail");
if (!root) {
  console.warn("[agent-client-detail] root not found");
}

const clientId = Number(root?.dataset.clientId || 0);
const apiPrefix = root?.dataset.apiPrefix || "";

const LABEL_VIEW_ORDER = root?.dataset.labelViewOrder || "Voir détail";
const LABEL_VIEW_APPT = root?.dataset.labelViewAppt || "Voir / Modifier";
const LABEL_CA_AXIS = root?.dataset.labelCaAxis || "CA (HT)";

// Éléments
const ordersBody = root?.querySelector(".js-orders-body");
const ordersEmptyRow = root?.querySelector(".js-empty-row-orders");
const ordersPager = root?.querySelector(".js-orders-pager");

const apptBody = root?.querySelector(".js-appt-body");
const apptEmptyRow = root?.querySelector(".js-empty-row-appt");
const apptPager = root?.querySelector(".js-appt-pager");

const topProductsBody = root?.querySelector(".js-top-products-body");
const topProductsEmptyRow = root?.querySelector(".js-empty-row-top");

const revenueTotalEl = root?.querySelector(".js-revenue-total");
const periodBtns = [...(root?.querySelectorAll(".js-period-btn") || [])];
const customPeriodForm = root?.querySelector(".js-custom-period");

let currentOrdersPage = 1;
let currentApptPage = 1;
const pageSize = 10;
let currentPeriodMode = "12m";
let currentStartDate = null;
let currentEndDate = null;

let revenueChart = null;

// ===============================
// Helpers
// ===============================
async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...options,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`[${resp.status}] ${txt}`);
  }
  return resp.json();
}

function formatDate(isoOrDate) {
  if (!isoOrDate) return "";
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleDateString();
}

function formatDateOnly(isoOrStr) {
  if (!isoOrStr) return "";
  // isoOrStr peut être "2025-01-01"
  const d = new Date(isoOrStr);
  if (Number.isNaN(d.getTime())) return isoOrStr;
  return d.toLocaleDateString();
}

function formatDateTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return (
    d.toLocaleDateString() +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function formatMoney(x) {
  if (x === null || x === undefined) return "–";
  const n = Number(x);
  if (Number.isNaN(n)) return x;
  return (
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

// ===============================
// Infos client
// ===============================
async function loadClientInfo() {
  try {
    const data = await jsonFetch(`${apiPrefix}/info`);
    const c = data.client;

    root.querySelector(".js-ci-name").textContent = c.name || "–";
    root.querySelector(".js-ci-contact").textContent =
      c.contact_name || "–";

    let addrParts = [];
    if (c.address1) addrParts.push(c.address1);
    let zipCity = [c.postcode, c.city].filter(Boolean).join(" ");
    if (zipCity) addrParts.push(zipCity);
    if (c.country) addrParts.push(c.country);
    root.querySelector(".js-ci-address").textContent =
      addrParts.join(", ") || "–";

    if (c.email) {
      const el = root.querySelector(".js-ci-email");
      el.innerHTML = `<a href="mailto:${c.email}">${c.email}</a>`;
    } else {
      root.querySelector(".js-ci-email").textContent = "–";
    }

    root.querySelector(".js-ci-phone").textContent = c.phone || "–";
    root.querySelector(".js-ci-groupement").textContent =
      c.groupement || "–";
    root.querySelector(".js-ci-sage").textContent =
      c.sage_code || "–";

    root.querySelector(".js-ci-iban").textContent = c.iban || "–";
    root.querySelector(".js-ci-bic").textContent = c.bic || "–";
    root.querySelector(".js-ci-payment-terms").textContent =
      c.payment_terms || "–";
    root.querySelector(".js-ci-credit-limit").textContent = c.credit_limit
      ? formatMoney(c.credit_limit)
      : "–";
    root.querySelector(".js-ci-sepa").textContent =
      c.sepa_mandate_ref || "–";
  } catch (err) {
    console.error("[agent-client-detail] loadClientInfo error", err);
  }
}

// ===============================
// Commandes
// ===============================
async function loadOrders(page = 1) {
  currentOrdersPage = page;
  try {
    const url = `${apiPrefix}/orders?page=${page}&page_size=${pageSize}`;
    const data = await jsonFetch(url);

    const items = data.items || [];
    ordersBody.innerHTML = "";

    if (!items.length) {
      if (ordersEmptyRow) {
        ordersBody.appendChild(ordersEmptyRow);
        ordersEmptyRow.style.display = "";
      }
    } else {
      if (ordersEmptyRow) ordersEmptyRow.style.display = "none";

      for (const o of items) {
        const tr = document.createElement("tr");

        const tdNum = document.createElement("td");
        tdNum.textContent = o.number;
        tr.appendChild(tdNum);

        const tdDate = document.createElement("td");
        const d = o.date || o.created_at;
        tdDate.textContent = formatDate(d);
        tr.appendChild(tdDate);

        const tdHt = document.createElement("td");
        tdHt.textContent = formatMoney(o.total_ht);
        tr.appendChild(tdHt);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = o.status;
        tr.appendChild(tdStatus);

        const tdActions = document.createElement("td");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "acd-btn";
        btn.textContent = LABEL_VIEW_ORDER;
        btn.addEventListener("click", () => openOrderDetailModal(o.id));
        tdActions.appendChild(btn);
        tr.appendChild(tdActions);

        ordersBody.appendChild(tr);
      }
    }

    renderPager(
      ordersPager,
      data.page,
      data.page_size,
      data.total,
      loadOrders
    );
  } catch (err) {
    console.error("[agent-client-detail] loadOrders error", err);
  }
}

async function openOrderDetailModal(orderId) {
  try {
    const data = await jsonFetch(`${apiPrefix}/orders/${orderId}`);

    let lines = [];
    const d = data.date || data.created_at;
    lines.push(
      `${data.number} – ${formatDateTime(d)} – ${data.status}`
    );
    lines.push(
      `Total HT: ${formatMoney(data.total_ht)} / TTC: ${formatMoney(
        data.total_ttc
      )}`
    );
    lines.push("");
    lines.push("Produits :");
    for (const it of data.items) {
      lines.push(
        `- ${it.product_name} (${it.sku || ""}) x${it.quantity} = ${formatMoney(
          it.total_ht
        )}`
      );
    }
    alert(lines.join("\n"));
  } catch (err) {
    console.error("[agent-client-detail] openOrderDetailModal error", err);
  }
}

// ===============================
// RDV
// ===============================
async function loadAppointments(page = 1) {
  currentApptPage = page;
  try {
    const url = `${apiPrefix}/appointments?page=${page}&page_size=${pageSize}`;
    const data = await jsonFetch(url);

    const items = data.items || [];
    apptBody.innerHTML = "";

    if (!items.length) {
      if (apptEmptyRow) {
        apptBody.appendChild(apptEmptyRow);
        apptEmptyRow.style.display = "";
      }
    } else {
      if (apptEmptyRow) apptEmptyRow.style.display = "none";

      for (const appt of items) {
        const tr = document.createElement("tr");

        const tdDate = document.createElement("td");
        tdDate.textContent = formatDateTime(appt.start_at);
        tr.appendChild(tdDate);

        const tdAgent = document.createElement("td");
        tdAgent.textContent = appt.agent_name || "";
        tr.appendChild(tdAgent);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = appt.status || "";
        tr.appendChild(tdStatus);

        const tdNotes = document.createElement("td");
        tdNotes.textContent = appt.notes || "";
        tr.appendChild(tdNotes);

        const tdActions = document.createElement("td");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "acd-btn";
        btn.textContent = LABEL_VIEW_APPT;
        btn.addEventListener("click", () => {
          // URL detail/édition RDV agent
          window.location.href = `/agent/agenda/appointment/${appt.id}`;
        });
        tdActions.appendChild(btn);
        tr.appendChild(tdActions);

        apptBody.appendChild(tr);
      }
    }

    renderPager(
      apptPager,
      data.page,
      data.page_size,
      data.total,
      loadAppointments
    );
  } catch (err) {
    console.error("[agent-client-detail] loadAppointments error", err);
  }
}

// ===============================
// Top produits
// ===============================
async function loadTopProducts() {
  try {
    const params = new URLSearchParams();
    params.set("mode", currentPeriodMode);
    if (currentPeriodMode === "custom" && currentStartDate && currentEndDate) {
      params.set("start_date", currentStartDate);
      params.set("end_date", currentEndDate);
    }

    const url = `${apiPrefix}/top-products?${params.toString()}`;
    const data = await jsonFetch(url);

    const items = data.items || [];
    topProductsBody.innerHTML = "";

    if (!items.length) {
      if (topProductsEmptyRow) {
        topProductsBody.appendChild(topProductsEmptyRow);
        topProductsEmptyRow.style.display = "";
      }
    } else {
      if (topProductsEmptyRow) topProductsEmptyRow.style.display = "none";

      for (const p of items) {
        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        const link = document.createElement("a");
        // Adapter si tu as une page produit côté agent
        link.href = `/agent/products/${p.product_id}`;
        link.textContent = p.product_name;
        tdName.appendChild(link);
        tr.appendChild(tdName);

        const tdQty = document.createElement("td");
        tdQty.textContent = String(p.total_qty);
        tr.appendChild(tdQty);

        const tdHt = document.createElement("td");
        tdHt.textContent = formatMoney(p.total_ht);
        tr.appendChild(tdHt);

        const tdActions = document.createElement("td");
        tr.appendChild(tdActions);

        topProductsBody.appendChild(tr);
      }
    }
  } catch (err) {
    console.error("[agent-client-detail] loadTopProducts error", err);
  }
}

// ===============================
// CA + graphique
// ===============================
async function loadRevenue() {
  try {
    const params = new URLSearchParams();
    params.set("mode", currentPeriodMode);
    if (currentPeriodMode === "custom" && currentStartDate && currentEndDate) {
      params.set("start_date", currentStartDate);
      params.set("end_date", currentEndDate);
    }

    const url = `${apiPrefix}/revenue?${params.toString()}`;
    const data = await jsonFetch(url);

    revenueTotalEl.textContent = formatMoney(data.total_ht);

    const labels = data.points.map((p) => p.date);
    const values = data.points.map((p) => Number(p.total_ht));

    const ctx = document.getElementById("acd-revenue-chart");
    if (!ctx) return;

    if (revenueChart) {
      revenueChart.destroy();
    }

    revenueChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: LABEL_CA_AXIS,
            data: values,
            tension: 0.2,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  } catch (err) {
    console.error("[agent-client-detail] loadRevenue error", err);
  }
}

// ===============================
// Pagination générique
// ===============================
function renderPager(container, page, pageSize, total, onPageChange) {
  if (!container) return;
  container.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const info = document.createElement("span");
  info.textContent = `Page ${page} / ${totalPages}`;
  container.appendChild(info);

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "<";
  prevBtn.disabled = page <= 1;
  prevBtn.addEventListener("click", () => {
    if (page > 1) onPageChange(page - 1);
  });
  container.appendChild(prevBtn);

  const nextBtn = document.createElement("button");
  nextBtn.textContent = ">";
  nextBtn.disabled = page >= totalPages;
  nextBtn.addEventListener("click", () => {
    if (page < totalPages) onPageChange(page + 1);
  });
  container.appendChild(nextBtn);
}

// ===============================
// Period selector
// ===============================
function bindPeriodSelector() {
  periodBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.period;
      currentPeriodMode = mode;

      periodBtns.forEach((b) => b.classList.remove("acd-pill-active"));
      btn.classList.add("acd-pill-active");

      if (mode === "custom") {
        if (customPeriodForm) customPeriodForm.style.display = "flex";
      } else {
        if (customPeriodForm) customPeriodForm.style.display = "none";
        currentStartDate = null;
        currentEndDate = null;
        refreshPeriodDependentData();
      }
    });
  });

  if (customPeriodForm) {
    customPeriodForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const start = customPeriodForm.querySelector("input[name='start']").value;
      const end = customPeriodForm.querySelector("input[name='end']").value;
      if (!start || !end) return;

      currentStartDate = start;
      currentEndDate = end;
      refreshPeriodDependentData();
    });
  }
}

function refreshPeriodDependentData() {
  loadRevenue();
  loadTopProducts();
}

// ===============================
// Init
// ===============================
async function init() {
  if (!root || !clientId || !apiPrefix) {
    console.warn("[agent-client-detail] missing root, clientId or apiPrefix");
    return;
  }

  bindPeriodSelector();

  loadClientInfo();
  loadOrders(1);
  loadAppointments(1);
  refreshPeriodDependentData();
}

document.addEventListener("DOMContentLoaded", init);

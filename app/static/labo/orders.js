// app/static/labo/orders.js

const ORDERS_API_BASE = "/api-zenhub/labo/orders";

const ordersState = {
  page: 1,
  pageSize: 20,
  total: 0,
  items: [],
  sortBy: "date",   // tri par défaut : date de commande
  sortDir: "desc",  // du plus récent au plus ancien
};

// DOM
const ordersTbody = document.getElementById("orders-tbody");
const ordersRowEmpty = document.getElementById("row-empty");
const ordersBtnPrev = document.getElementById("btn-prev");
const ordersBtnNext = document.getElementById("btn-next");
const ordersPagerInfo = document.getElementById("pager-info");

const ordersSearchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const agentFilter = document.getElementById("agent-filter");
const btnFilter = document.getElementById("btn-filter");

// Modal détail
const orderModal = document.getElementById("order-modal");
const orderClose = document.getElementById("order-close");
const modalOrderNumber = document.getElementById("modal-order-number");
const modalDetail = document.getElementById("order-detail");

// Modal code client
const clientCodeModal = document.getElementById("client-code-modal");
const clientCodeForm = document.getElementById("client-code-form");
const clientCodeInput = document.getElementById("client-code-input");
const clientIdInput = document.getElementById("client-id-input");
const clientCodeError = document.getElementById("client-code-error");
const clientCodeClose = document.getElementById("client-code-close");
const clientCodeCancel = document.getElementById("client-code-cancel");

// Bulk sélection
const selectAllCheckbox = document.getElementById("select-all-orders");
const btnBulkValidate = document.getElementById("btn-bulk-validate");
const btnBulkPdf = document.getElementById("btn-bulk-pdf");
const btnBulkExportCsv = document.getElementById("btn-bulk-export-csv");
const bulkSelectionCount = document.getElementById("bulk-selection-count");

console.log("Bulk buttons présents ?", { btnBulkValidate, btnBulkPdf, btnBulkExportCsv });

// i18n JS avec fallback FR (fourni par orders.html)
const ZI18N = window.Z_I18N || {};
const tClientCodeAdd         = ZI18N.clientCodeAdd || "Ajouter code client";
const tClientCodeError       = ZI18N.clientCodeError || "Erreur lors de l'enregistrement du code client.";
const tClientCodeSuccess     = ZI18N.clientCodeSuccess || "Code client enregistré avec succès.";
const tClientCodeModal       = ZI18N.clientCodeModalTitle || "Code client pour ce client";
const tClientCodeLabel       = ZI18N.clientCodeLabel || "Code client";
const tClientCodePlaceholder = ZI18N.clientCodePlaceholder || "Saisir le code client…";

// Sommes-nous sur la page commandes ?
const HAS_ORDERS_TABLE = !!ordersTbody;

// ============================
//   Auth helper
// ============================

function getToken() {
  return localStorage.getItem("token");
}

async function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    console.error("Token JWT manquant dans localStorage");
    throw new Error("Missing token");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

// ============================
//   Utils
// ============================

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function formatMoney(value) {
  const v = Number(value || 0);
  return v.toFixed(2).replace(".", ",");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Tri local sur le tableau actuel
function sortItems(items) {
  const { sortBy, sortDir } = ordersState;
  if (!sortBy) return items.slice();

  const factor = sortDir === "asc" ? 1 : -1;

  return items.slice().sort((a, b) => {
    let va = a[sortBy];
    let vb = b[sortBy];

    // dates
    if (sortBy === "date" || sortBy === "delivery_date") {
      const da = va ? new Date(va).getTime() : 0;
      const db = vb ? new Date(vb).getTime() : 0;
      if (da === db) return 0;
      return da < db ? -1 * factor : 1 * factor;
    }

    // strings (client_name, agent_name, order_number, client_code)
    if (typeof va === "string" || typeof vb === "string") {
      va = (va || "").toString().toLowerCase();
      vb = (vb || "").toString().toLowerCase();
      if (va === vb) return 0;
      return va < vb ? -1 * factor : 1 * factor;
    }

    // fallback
    if (va == null && vb == null) return 0;
    if (va == null) return -1 * factor;
    if (vb == null) return 1 * factor;
    if (va === vb) return 0;
    return va < vb ? -1 * factor : 1 * factor;
  });
}

// ============================
//   Gestion sélection multiple
// ============================

function getSelectedOrderIds() {
  const cbs = document.querySelectorAll(".order-select:checked");
  return Array.from(cbs).map((cb) => Number(cb.value));
}

function updateSelectionCount() {
  if (!bulkSelectionCount) return;
  const ids = getSelectedOrderIds();
  if (!ids.length) {
    bulkSelectionCount.textContent = "Aucune commande sélectionnée";
  } else if (ids.length === 1) {
    bulkSelectionCount.textContent = "1 commande sélectionnée";
  } else {
    bulkSelectionCount.textContent = `${ids.length} commandes sélectionnées`;
  }
}

function bindSelectionEvents() {
  if (!ordersTbody) return;
  const cbs = ordersTbody.querySelectorAll(".order-select");
  cbs.forEach((cb) => {
    cb.addEventListener("change", () => {
      updateSelectionCount();
      if (!selectAllCheckbox) return;
      const all = ordersTbody.querySelectorAll(".order-select");
      const allChecked =
        all.length > 0 &&
        Array.from(all).every((c) => c instanceof HTMLInputElement && c.checked);
      selectAllCheckbox.checked = allChecked;
    });
  });
}

// ============================
//   Chargement commandes
// ============================

async function fetchOrders() {
  if (!HAS_ORDERS_TABLE) return;

  const params = new URLSearchParams();
  params.set("page", ordersState.page);
  params.set("page_size", ordersState.pageSize);

  const q = ordersSearchInput ? ordersSearchInput.value.trim() : "";
  if (q) params.set("search", q);
  if (statusFilter && statusFilter.value) params.set("status", statusFilter.value);
  if (dateFromInput && dateFromInput.value) params.set("date_from", dateFromInput.value);
  if (dateToInput && dateToInput.value) params.set("date_to", dateToInput.value);
  if (agentFilter && agentFilter.value) params.set("agent_id", agentFilter.value);

  console.log("Params filtres commandes:", Object.fromEntries(params.entries()));

  try {
    const res = await authFetch(`${ORDERS_API_BASE}?${params.toString()}`);

    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur chargement commandes:", res.status, txt);
      return;
    }

    const data = await res.json();
    console.log("Réponse API commandes:", data);

    const items = Array.isArray(data.items) ? data.items : [];
    const total = typeof data.total === "number" ? data.total : items.length;

    ordersState.total = total;
    ordersState.items = items;

    const sorted = sortItems(items);
    renderOrders(sorted);
    renderOrdersPager();
    updateSortIndicators();
  } catch (err) {
    console.error("Erreur fetchOrders:", err);
  }
}

function renderOrders(items) {
  if (!ordersTbody) return;

  ordersTbody.innerHTML = "";

  // reset sélection globale
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  updateSelectionCount();

  if (!items || items.length === 0) {
    if (ordersRowEmpty) {
      ordersRowEmpty.classList.remove("hidden");
      ordersRowEmpty.colSpan = 12;
      ordersTbody.appendChild(ordersRowEmpty);
    }
    return;
  }

  if (ordersRowEmpty) ordersRowEmpty.classList.add("hidden");

  items.forEach((o) => {
    const tr = document.createElement("tr");
    tr.dataset.orderId = o.id;
    if (o.client_id != null) tr.dataset.clientId = o.client_id;

    const dateCmdText = o.date ? formatDate(o.date) : "—";
    const dateLivText = o.delivery_date ? formatDate(o.delivery_date) : "—";

    // colonne code client
    let clientCodeCell = "";
    if (o.client_code) {
      clientCodeCell = `<span class="z-client-code">${o.client_code}</span>`;
    } else if (o.client_id != null) {
      clientCodeCell = `
        <button
          type="button"
          class="btn btn-danger btn-sm btn-client-code"
          data-client-id="${o.client_id}"
          data-order-id="${o.id}"
        >
          ${tClientCodeAdd}
        </button>
      `;
    }

    // PDF unitaire
    const pdfUrl = `${ORDERS_API_BASE}/${o.id}/pdf`;

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="order-select" value="${o.id}" />
      </td>
      <td>${o.order_number}</td>
      <td>${dateCmdText}</td>
      <td>${dateLivText}</td>
      <td><div class="z-client-name">${o.client_name || ""}</div></td>
      <td>${clientCodeCell}</td>
      <td>${formatMoney(o.total_ht)} €</td>
      <td>${renderStatusBadge(o.status)}</td>
      <td>${o.items_count}</td>
      <td>${o.agent_name || ""}</td>
      <td>
        <button
          type="button"
          class="btn btn-light btn-sm btn-pdf"
          data-pdf-url="${pdfUrl}"
          data-order-number="${(o.order_number || "").toString()}"
        >
          PDF
        </button>
      </td>
      <td>
        <button type="button" class="btn btn-light btn-detail" data-id="${o.id}">
          Détail
        </button>
      </td>
    `;

    ordersTbody.appendChild(tr);
  });

  bindOrderRowEvents();
  bindClientCodeButtons();
  bindSelectionEvents();
  bindPdfButtons();
  updateSelectionCount();
}

function renderStatusBadge(statusRaw) {
  const status = (statusRaw || "").toString().toLowerCase();
  let label = statusRaw || "";
  let cls = "z-badge z-badge-default";

  if (status === "draft") {
    label = "Brouillon";
    cls = "z-badge z-badge-gray";
  } else if (status === "pending") {
    label = "En attente";
    cls = "z-badge z-badge-green";
  } else if (status === "validated") {
    // ✅ nouveau statut affiché
    label = "Validée";
    cls = "z-badge z-badge-green";
  } else if (status === "paid") {
    label = "Payée";
    cls = "z-badge z-badge-green";
  } else if (status === "shipped") {
    label = "Expédiée";
    cls = "z-badge z-badge-blue";
  } else if (status === "canceled") {
    label = "Annulée";
    cls = "z-badge z-badge-red";
  } else if (status === "completed") {
    label = "Terminée";
    cls = "z-badge z-badge-green";
  }

  return `<span class="${cls}">${label}</span>`;
}

function renderOrdersPager() {
  const nbPages = Math.ceil(ordersState.total / ordersState.pageSize) || 1;
  if (ordersPagerInfo) {
    ordersPagerInfo.textContent = `Page ${ordersState.page} / ${nbPages} – Total : ${ordersState.total}`;
  }
  if (ordersBtnPrev) ordersBtnPrev.disabled = ordersState.page <= 1;
  if (ordersBtnNext) ordersBtnNext.disabled = ordersState.page >= nbPages;
}

// ============================
//   Tri par clic sur en-têtes
// ============================

function bindSortHeaders() {
  const ths = document.querySelectorAll("#orders-table thead th[data-sort]");
  ths.forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (!col) return;

      if (ordersState.sortBy === col) {
        ordersState.sortDir = ordersState.sortDir === "asc" ? "desc" : "asc";
      } else {
        ordersState.sortBy = col;
        ordersState.sortDir = "asc";
      }

      const sorted = sortItems(ordersState.items || []);
      renderOrders(sorted);
      updateSortIndicators();
    });
  });
}

function updateSortIndicators() {
  const ths = document.querySelectorAll("#orders-table thead th[data-sort]");
  ths.forEach((th) => {
    const col = th.dataset.sort;
    th.classList.remove("z-sort-asc", "z-sort-desc");
    if (col === ordersState.sortBy) {
      th.classList.add(ordersState.sortDir === "asc" ? "z-sort-asc" : "z-sort-desc");
    }
  });
}

async function loadAgents() {
  if (!agentFilter) return;

  try {
    const res = await authFetch("/api-zenhub/labo/agents");
    if (!res.ok) {
      console.error("Erreur chargement agents:", await res.text());
      return;
    }

    const agents = await res.json();
    console.log("Agents labo:", agents);

    agentFilter.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Tous";
    agentFilter.appendChild(optAll);

    agents.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name || `Agent #${a.id}`;
      agentFilter.appendChild(opt);
    });
  } catch (err) {
    console.error("Erreur loadAgents:", err);
  }
}

// ============================
//   Events lignes tableau
// ============================

function bindOrderRowEvents() {
  if (!ordersTbody) return;

  ordersTbody.querySelectorAll(".btn-detail").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const orderId = e.target.dataset.id;
      if (!orderId) return;
      await openOrderDetail(orderId);
    });
  });
}

async function openPdfWithAuth(pdfUrl, orderNumber = "") {
  try {
    const res = await authFetch(pdfUrl, { method: "GET" });

    if (!res.ok) {
      console.error("Erreur PDF:", res.status, await res.text());
      alert("Erreur lors de la génération du PDF.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const win = window.open(url, "_blank");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bon-de-commande-${orderNumber || "commande"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error("Erreur openPdfWithAuth:", err);
    alert("Erreur lors de la génération du PDF.");
  }
}

function bindPdfButtons() {
  if (!ordersTbody) return;
  ordersTbody.querySelectorAll(".btn-pdf").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pdfUrl = btn.getAttribute("data-pdf-url");
      const orderNumber = btn.getAttribute("data-order-number") || "";
      if (!pdfUrl) return;
      openPdfWithAuth(pdfUrl, orderNumber);
    });
  });
}

// Boutons "Ajouter code client"
function bindClientCodeButtons() {
  if (!ordersTbody) return;

  ordersTbody.querySelectorAll(".btn-client-code").forEach((btn) => {
    btn.addEventListener("click", () => {
      const orderId = btn.getAttribute("data-order-id");
      const clientId = btn.getAttribute("data-client-id");
      openClientCodeModal(orderId, clientId);
    });
  });
}

// ============================
//   Détail commande (modale)
// ============================

async function openOrderDetail(orderId) {
  try {
    const res = await authFetch(`${ORDERS_API_BASE}/${orderId}`);
    if (!res.ok) {
      console.error("Erreur détail commande:", await res.text());
      return;
    }

    const o = await res.json();
    console.log("Détail commande:", o);

    if (modalOrderNumber) modalOrderNumber.textContent = o.order_number || "";

    const itemsRows = (o.items || [])
      .map(
        (it) => `
        <tr>
          <td>${it.sku || ""}</td>
          <td>${it.name}</td>
          <td>${it.qty}</td>
          <td>${formatMoney(it.price_ht)} €</td>
          <td>${formatMoney(it.line_total_ht)} €</td>
        </tr>
      `
      )
      .join("");

    if (modalDetail) {
      modalDetail.innerHTML = `
        <p>
          <strong>Date commande :</strong> ${o.date ? formatDate(o.date) : "—"}<br>
          ${
            o.delivery_date
              ? `<strong>Date livraison :</strong> ${formatDate(o.delivery_date)}<br>`
              : ""
          }
          <strong>Client :</strong> ${o.client && o.client.name ? o.client.name : ""}<br>
          ${
            o.client && o.client.code
              ? `<strong>Code client :</strong> ${o.client.code}<br>`
              : ""
          }
          <strong>Agent :</strong> ${o.agent && o.agent.name ? o.agent.name : ""}<br>
          <strong>Total HT :</strong> ${formatMoney(o.total_ht)} €
        </p>

        <h3>Articles</h3>
        <table class="table table-compact">
          <thead>
            <tr>
              <th>Réf.</th>
              <th>Produit</th>
              <th>Qté</th>
              <th>PU HT</th>
              <th>Total HT</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows || `<tr><td colspan="5">Aucun article.</td></tr>`}
          </tbody>
        </table>
      `;
    }

    if (orderModal) orderModal.classList.remove("hidden");
  } catch (err) {
    console.error("Erreur openOrderDetail:", err);
  }
}

function closeOrderModal() {
  if (orderModal) orderModal.classList.add("hidden");
}

if (orderClose) orderClose.addEventListener("click", closeOrderModal);

if (orderModal) {
  orderModal.addEventListener("click", (e) => {
    if (e.target === orderModal) closeOrderModal();
  });
}

// ============================
//   Modal code client
// ============================

let currentClientCodeOrderId = null;

function openClientCodeModal(orderId, clientId) {
  currentClientCodeOrderId = orderId;

  if (clientIdInput) clientIdInput.value = clientId || "";
  if (clientCodeInput) clientCodeInput.value = "";

  if (clientCodeError) {
    clientCodeError.textContent = "";
    clientCodeError.classList.add("hidden");
  }

  if (clientCodeModal) clientCodeModal.classList.remove("hidden");

  const titleEl = document.getElementById("client-code-modal-title");
  if (titleEl) titleEl.textContent = tClientCodeModal;

  const labelEl = document.querySelector("label[for='client-code-input']");
  if (labelEl) labelEl.textContent = tClientCodeLabel;

  if (clientCodeInput) clientCodeInput.placeholder = tClientCodePlaceholder;
}

function closeClientCodeModal() {
  currentClientCodeOrderId = null;
  if (clientCodeModal) clientCodeModal.classList.add("hidden");
}

async function handleClientCodeSubmit(event) {
  event.preventDefault();
  if (!clientIdInput || !clientCodeInput) return;

  const clientId = Number(clientIdInput.value || 0);
  const code = clientCodeInput.value.trim();

  if (!clientId || !code) {
    if (clientCodeError) {
      clientCodeError.textContent = tClientCodeError;
      clientCodeError.classList.remove("hidden");
    }
    return;
  }

  try {
    if (clientCodeError) {
      clientCodeError.textContent = "";
      clientCodeError.classList.add("hidden");
    }

    const res = await authFetch("/api-zenhub/labo/client-code", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, code_client: code }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur API client-code:", res.status, txt);
      if (clientCodeError) {
        clientCodeError.textContent = tClientCodeError;
        clientCodeError.classList.remove("hidden");
      }
      return;
    }

    const data = await res.json();
    console.log("Code client enregistré:", data);

    const oid = Number(currentClientCodeOrderId || 0);
    const items = ordersState.items || [];
    const item = items.find((i) => Number(i.id) === oid);
    if (item) item.client_code = data.code_client;

    const sorted = sortItems(items);
    renderOrders(sorted);
    updateSortIndicators();

    closeClientCodeModal();
  } catch (err) {
    console.error("Erreur handleClientCodeSubmit:", err);
    if (clientCodeError) {
      clientCodeError.textContent = tClientCodeError;
      clientCodeError.classList.remove("hidden");
    }
  }
}

if (clientCodeForm) clientCodeForm.addEventListener("submit", handleClientCodeSubmit);
if (clientCodeClose) clientCodeClose.addEventListener("click", closeClientCodeModal);
if (clientCodeCancel) clientCodeCancel.addEventListener("click", closeClientCodeModal);

if (clientCodeModal) {
  clientCodeModal.addEventListener("click", (e) => {
    if (e.target === clientCodeModal) closeClientCodeModal();
  });
}

// ============================
//   Bulk actions
// ============================

if (selectAllCheckbox) {
  selectAllCheckbox.addEventListener("change", () => {
    if (!ordersTbody) return;
    const checked = selectAllCheckbox.checked;
    ordersTbody.querySelectorAll(".order-select").forEach((cb) => {
      cb.checked = checked;
    });
    updateSelectionCount();
  });
}

async function bulkValidateSelected() {
  const ids = getSelectedOrderIds();
  console.log("bulkValidateSelected – ids:", ids);

  if (!ids.length) {
    alert("Veuillez sélectionner au moins une commande.");
    return;
  }

  try {
    const res = await authFetch("/api-zenhub/labo/orders/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        order_ids: ids,
        // ✅ ici on passe en VALIDATED (et non pending)
        new_status: "validated",
      }),
    });

    if (!res.ok) {
      console.error("Erreur bulk-status:", res.status, await res.text());
      alert("Erreur lors de la mise à jour des statuts.");
      return;
    }

    await fetchOrders();
  } catch (err) {
    console.error("Erreur bulkValidateSelected:", err);
    alert("Erreur lors de la mise à jour des statuts.");
  }
}

async function bulkPrintSelected() {
  const ids = getSelectedOrderIds();
  console.log("bulkPrintSelected – ids:", ids);
  if (!ids.length) {
    alert("Veuillez sélectionner au moins une commande.");
    return;
  }

  try {
    const res = await authFetch(`${ORDERS_API_BASE}/bulk-pdf`, {
      method: "POST",
      body: JSON.stringify({ order_ids: ids }),
    });

    if (!res.ok) {
      console.error("Erreur bulk-pdf (labo):", res.status, await res.text());
      alert("Erreur lors de la génération du PDF.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const win = window.open(url, "_blank");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = "bons_de_commande_selection.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error("Erreur bulkPrintSelected:", err);
    alert("Erreur lors de la génération du PDF.");
  }
}

async function bulkExportCsv() {
  const ids = getSelectedOrderIds();
  console.log("bulkExportCsv – ids:", ids);
  if (!ids.length) {
    alert("Veuillez sélectionner au moins une commande.");
    return;
  }

  try {
    const res = await authFetch("/api-zenhub/labo/orders/export-csv", {
      method: "POST",
      body: JSON.stringify({ order_ids: ids }),
    });

    if (!res.ok) {
      console.error("Erreur export CSV:", res.status, await res.text());
      alert("Erreur lors de la génération du CSV.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "commandes_selection.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error("Erreur bulkExportCsv:", err);
    alert("Erreur lors de la génération du CSV.");
  }
}

if (btnBulkValidate) btnBulkValidate.addEventListener("click", bulkValidateSelected);
if (btnBulkPdf) btnBulkPdf.addEventListener("click", bulkPrintSelected);
if (btnBulkExportCsv) btnBulkExportCsv.addEventListener("click", bulkExportCsv);

// ============================
//   Pager + filtres + search
// ============================

if (ordersBtnPrev) {
  ordersBtnPrev.addEventListener("click", () => {
    if (ordersState.page > 1) {
      ordersState.page -= 1;
      fetchOrders();
    }
  });
}

if (ordersBtnNext) {
  ordersBtnNext.addEventListener("click", () => {
    const nbPages = Math.ceil(ordersState.total / ordersState.pageSize) || 1;
    if (ordersState.page < nbPages) {
      ordersState.page += 1;
      fetchOrders();
    }
  });
}

if (ordersSearchInput) {
  ordersSearchInput.addEventListener(
    "input",
    debounce(() => {
      ordersState.page = 1;
      fetchOrders();
    }, 300)
  );
}

if (btnFilter) {
  btnFilter.addEventListener("click", () => {
    ordersState.page = 1;
    fetchOrders();
  });
}

if (statusFilter) {
  statusFilter.addEventListener("change", () => {
    ordersState.page = 1;
    fetchOrders();
  });
}

if (agentFilter) {
  agentFilter.addEventListener("change", () => {
    ordersState.page = 1;
    fetchOrders();
  });
}

if (dateFromInput) {
  dateFromInput.addEventListener("change", () => {
    ordersState.page = 1;
    fetchOrders();
  });
}
if (dateToInput) {
  dateToInput.addEventListener("change", () => {
    ordersState.page = 1;
    fetchOrders();
  });
}

// ============================
//   Initialisation
// ============================

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOMContentLoaded – HAS_ORDERS_TABLE =", HAS_ORDERS_TABLE);
  if (HAS_ORDERS_TABLE) {
    bindSortHeaders();
    loadAgents();
    fetchOrders();
  }
});

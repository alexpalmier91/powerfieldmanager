// app/static/labo/pages/client_detail.js

// ====== Auth & helpers partagés ======
const TOKEN =
  localStorage.zentro_token ||
  localStorage.token ||
  "";

const API_BASE = "/api-zenhub/labo";

const authFetch = (url, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (TOKEN) {
    headers["Authorization"] = `Bearer ${TOKEN}`;
  }
  return fetch(url, { ...options, headers });
};

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("labo-client-detail-page");
  if (!root) return;

  const clientId = root.dataset.clientId;
  if (!clientId) return;

  const ordersTbody = document.getElementById("client-orders-tbody");
  const ordersEmpty = document.getElementById("client-orders-empty");
  const ordersPagination = document.getElementById("client-orders-pagination");

  const docsTbody = document.getElementById("client-documents-tbody");
  const docsEmpty = document.getElementById("client-documents-empty");
  const docsPagination = document.getElementById("client-documents-pagination");

  let ordersPage = 1;
  let docsPage = 1;
  const pageSize = 20;

  // --- i18n helper avec fallback FR ---
  const tSafe = (key, fallbackText) => {
    if (typeof window.t === "function") {
      const v = window.t(key);
      if (v && v !== key) return v;
    }
    return fallbackText || key;
  };

  const formatDateSafe = (value) => {
    if (!value) return "";
    if (typeof window.formatDate === "function") {
      return window.formatDate(value);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
  };

  const formatCurrencySafe = (value) => {
    const num = Number(value || 0);
    if (typeof window.formatCurrency === "function") {
      return window.formatCurrency(num);
    }
    return num.toFixed(2);
  };

  // ========== DÉTAILS COMMANDES (lignes) ==========

  const buildOrderItemsTableHTML = (items) => {
    if (!items.length) {
      return `<div class="text-muted small">
        ${tSafe("labo.orders.details.empty", "Aucune ligne de commande.")}
      </div>`;
    }

    const headers = `
      <thead>
        <tr>
          <th>${tSafe("labo.orders.details.sku", "SKU")}</th>
          <th>${tSafe("labo.orders.details.product", "Produit")}</th>
          <th class="text-end">${tSafe("labo.orders.details.qty", "Qté")}</th>
          <th class="text-end">${tSafe("labo.orders.details.unit_ht", "PU HT")}</th>
          <th class="text-end">${tSafe("labo.orders.details.total_ht", "Total HT")}</th>
        </tr>
      </thead>
    `;

    const rows = items
      .map(
        (it) => `
        <tr>
          <td>${it.sku || ""}</td>
          <td>${it.product_name || ""}</td>
          <td class="text-end">${it.qty}</td>
          <td class="text-end">${formatCurrencySafe(it.unit_ht)}</td>
          <td class="text-end">${formatCurrencySafe(it.total_ht)}</td>
        </tr>
      `
      )
      .join("");

    return `
      <div class="client-details-table-wrapper mt-2">
        <table class="table table-sm mb-0">
          ${headers}
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  const toggleOrderDetails = async (tr, order) => {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains("order-details-row")) {
      existing.remove();
      return;
    }

    // fermer les autres détails éventuels
    const openDetails = tr.parentElement.querySelectorAll(".order-details-row");
    openDetails.forEach((row) => row.remove());

    const detailsRow = document.createElement("tr");
    detailsRow.classList.add("order-details-row");
    const detailsCell = document.createElement("td");
    detailsCell.colSpan = tr.children.length;
    detailsCell.textContent = tSafe(
      "labo.orders.details.loading",
      "Chargement des détails..."
    );
    detailsRow.appendChild(detailsCell);
    tr.after(detailsRow);

    try {
      const res = await authFetch(
        `${API_BASE}/clients/${clientId}/orders/${order.id}/items`
      );
      if (!res.ok) {
        detailsCell.textContent = tSafe(
          "labo.orders.details.error",
          "Erreur lors du chargement des lignes."
        );
        return;
      }
      const data = await res.json();
      const items = data.items || [];
      detailsCell.innerHTML = buildOrderItemsTableHTML(items);
    } catch (err) {
      console.error("Error loading order items", err);
      detailsCell.textContent = tSafe(
        "labo.orders.details.error",
        "Erreur lors du chargement des lignes."
      );
    }
  };

  // ========== DÉTAILS DOCUMENTS (lignes) ==========

  const buildDocumentItemsTableHTML = (items) => {
    if (!items.length) {
      return `<div class="text-muted small">
        ${tSafe("labo.docs.details.empty", "Aucune ligne pour ce document.")}
      </div>`;
    }

    const headers = `
      <thead>
        <tr>
          <th>${tSafe("labo.docs.details.sku", "SKU")}</th>
          <th>${tSafe("labo.docs.details.product", "Produit")}</th>
          <th class="text-end">${tSafe("labo.docs.details.qty", "Qté")}</th>
          <th class="text-end">${tSafe("labo.docs.details.unit_ht", "PU HT")}</th>
          <th class="text-end">${tSafe("labo.docs.details.total_ht", "Total HT")}</th>
        </tr>
      </thead>
    `;

    const rows = items
      .map(
        (it) => `
        <tr>
          <td>${it.sku || ""}</td>
          <td>${it.product_name || ""}</td>
          <td class="text-end">${it.qty}</td>
          <td class="text-end">${formatCurrencySafe(it.unit_ht)}</td>
          <td class="text-end">${formatCurrencySafe(it.total_ht)}</td>
        </tr>
      `
      )
      .join("");

    return `
      <div class="client-details-table-wrapper mt-2">
        <table class="table table-sm mb-0">
          ${headers}
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  const toggleDocumentDetails = async (tr, doc) => {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains("document-details-row")) {
      existing.remove();
      return;
    }

    const openDetails = tr.parentElement.querySelectorAll(
      ".document-details-row"
    );
    openDetails.forEach((row) => row.remove());

    const detailsRow = document.createElement("tr");
    detailsRow.classList.add("document-details-row");
    const detailsCell = document.createElement("td");
    detailsCell.colSpan = tr.children.length;
    detailsCell.textContent = tSafe(
      "labo.docs.details.loading",
      "Chargement des détails..."
    );
    detailsRow.appendChild(detailsCell);
    tr.after(detailsRow);

    try {
      const res = await authFetch(
        `${API_BASE}/clients/${clientId}/documents/${doc.id}/items`
      );
      if (!res.ok) {
        detailsCell.textContent = tSafe(
          "labo.docs.details.error",
          "Erreur lors du chargement des lignes."
        );
        return;
      }
      const data = await res.json();
      const items = data.items || [];
      detailsCell.innerHTML = buildDocumentItemsTableHTML(items);
    } catch (err) {
      console.error("Error loading document items", err);
      detailsCell.textContent = tSafe(
        "labo.docs.details.error",
        "Erreur lors du chargement des lignes."
      );
    }
  };

  // ---------- Commandes ----------

  const buildOrderRow = (order) => {
    const tr = document.createElement("tr");
    tr.dataset.orderId = order.id;

    const tdNumber = document.createElement("td");
    tdNumber.textContent = order.order_number || "";
    tr.appendChild(tdNumber);

    const tdOrderDate = document.createElement("td");
    tdOrderDate.textContent = formatDateSafe(order.order_date);
    tr.appendChild(tdOrderDate);

    const tdDeliveryDate = document.createElement("td");
    tdDeliveryDate.textContent = formatDateSafe(order.delivery_date);
    tr.appendChild(tdDeliveryDate);

    const tdAgent = document.createElement("td");
    tdAgent.textContent = order.agent_name || "";
    tr.appendChild(tdAgent);

    const tdStatus = document.createElement("td");
    const span = document.createElement("span");
    span.className = "badge bg-secondary";

    const statusCode = (order.status || "").toLowerCase();
    const statusKey = statusCode
      ? `labo.orders.status.${statusCode}`
      : "labo.orders.status.unknown";

    let statusFallback = "Inconnu";
    switch (statusCode) {
      case "draft":
        statusFallback = "Brouillon";
        break;
      case "pending":
        statusFallback = "En attente";
        break;
      case "paid":
        statusFallback = "Payée";
        break;
      case "shipped":
        statusFallback = "Expédiée";
        break;
      case "completed":
        statusFallback = "Terminée";
        break;
      case "canceled":
      case "cancelled":
        statusFallback = "Annulée";
        break;
      default:
        statusFallback = "Inconnu";
    }

    span.setAttribute("data-i18n", statusKey);
    span.textContent = tSafe(statusKey, statusFallback);
    tdStatus.appendChild(span);
    tr.appendChild(tdStatus);

    const tdTotal = document.createElement("td");
    tdTotal.classList.add("text-end");
    tdTotal.textContent = formatCurrencySafe(order.total_ht);
    tr.appendChild(tdTotal);

    // clic sur la ligne -> affichage / repli du détail
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => toggleOrderDetails(tr, order));

    return tr;
  };

  const renderOrders = (data) => {
    ordersTbody.innerHTML = "";
    const items = data.items || [];
    if (items.length === 0) {
      ordersEmpty.classList.remove("d-none");
    } else {
      ordersEmpty.classList.add("d-none");
      items.forEach((o) => {
        ordersTbody.appendChild(buildOrderRow(o));
      });
    }
    renderOrdersPagination(data.page, data.page_size, data.total);
  };

  const renderOrdersPagination = (page, pageSize, total) => {
    if (!ordersPagination) return;
    ordersPagination.innerHTML = "";
    if (!total || total <= pageSize) return;

    const totalPages = Math.ceil(total / pageSize);

    const createPageItem = (p, labelKey, isActive, isDisabled) => {
      const li = document.createElement("li");
      li.classList.add("page-item");
      if (isActive) li.classList.add("active");
      if (isDisabled) li.classList.add("disabled");

      const a = document.createElement("a");
      a.classList.add("page-link");

      if (typeof labelKey === "string") {
        a.textContent = tSafe(labelKey);
        a.setAttribute("data-i18n", labelKey);
      } else {
        a.textContent = String(labelKey);
      }

      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (!isDisabled && ordersPage !== p) {
          ordersPage = p;
          fetchOrders();
        }
      });

      li.appendChild(a);
      return li;
    };

    ordersPagination.appendChild(
      createPageItem(
        Math.max(1, page - 1),
        "pagination.prev",
        false,
        page <= 1
      )
    );

    for (let p = 1; p <= totalPages; p++) {
      ordersPagination.appendChild(
        createPageItem(p, p, p === page, false)
      );
    }

    ordersPagination.appendChild(
      createPageItem(
        Math.min(totalPages, page + 1),
        "pagination.next",
        false,
        page >= totalPages
      )
    );
  };

  const fetchOrders = async () => {
    const params = new URLSearchParams({
      page: String(ordersPage),
      page_size: String(pageSize),
    });
    try {
      const res = await authFetch(
        `${API_BASE}/clients/${clientId}/orders?${params.toString()}`
      );
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (data && data.items !== undefined) {
        renderOrders(data);
      }
    } catch (err) {
      console.error("Error loading client orders", err);
    }
  };

  // ---------- Documents ----------

  const buildDocumentRow = (doc) => {
    const tr = document.createElement("tr");
    tr.dataset.documentId = doc.id;

    const tdNumber = document.createElement("td");
    tdNumber.textContent = doc.order_number || "";
    tr.appendChild(tdNumber);

    const tdType = document.createElement("td");
    const spanType = document.createElement("span");
    const typeCode = (doc.type || "").toLowerCase();
    const typeKey = typeCode
      ? `labo.docs.type.${typeCode}`
      : "labo.docs.type.unknown";

    let typeFallback = "Inconnu";
    switch (typeCode) {
      case "fa":
        typeFallback = "Facture";
        break;
      case "bc":
        typeFallback = "Bon de commande";
        break;
      case "bl":
        typeFallback = "Bon de livraison";
        break;
      case "av":
      case "avoir":
        typeFallback = "Avoir";
        break;
      default:
        typeFallback = "Inconnu";
    }

    spanType.setAttribute("data-i18n", typeKey);
    spanType.textContent = tSafe(typeKey, typeFallback);
    tdType.appendChild(spanType);
    tr.appendChild(tdType);

    const tdOrderDate = document.createElement("td");
    tdOrderDate.textContent = formatDateSafe(doc.order_date);
    tr.appendChild(tdOrderDate);

    const tdDeliveryDate = document.createElement("td");
    tdDeliveryDate.textContent = formatDateSafe(doc.delivery_date);
    tr.appendChild(tdDeliveryDate);

    const tdTotal = document.createElement("td");
    tdTotal.classList.add("text-end");
    tdTotal.textContent = formatCurrencySafe(doc.total_ht);
    tr.appendChild(tdTotal);

    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => toggleDocumentDetails(tr, doc));

    return tr;
  };

  const renderDocuments = (data) => {
    docsTbody.innerHTML = "";
    const items = data.items || [];
    if (items.length === 0) {
      docsEmpty.classList.remove("d-none");
    } else {
      docsEmpty.classList.add("d-none");
      items.forEach((doc) => {
        docsTbody.appendChild(buildDocumentRow(doc));
      });
    }
    renderDocsPagination(data.page, data.page_size, data.total);
  };

  const renderDocsPagination = (page, pageSize, total) => {
    if (!docsPagination) return;
    docsPagination.innerHTML = "";
    if (!total || total <= pageSize) return;

    const totalPages = Math.ceil(total / pageSize);

    const createPageItem = (p, labelKey, isActive, isDisabled) => {
      const li = document.createElement("li");
      li.classList.add("page-item");
      if (isActive) li.classList.add("active");
      if (isDisabled) li.classList.add("disabled");

      const a = document.createElement("a");
      a.classList.add("page-link");

      if (typeof labelKey === "string") {
        a.textContent = tSafe(labelKey);
        a.setAttribute("data-i18n", labelKey);
      } else {
        a.textContent = String(labelKey);
      }

      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (!isDisabled && docsPage !== p) {
          docsPage = p;
          fetchDocuments();
        }
      });

      li.appendChild(a);
      return li;
    };

    docsPagination.appendChild(
      createPageItem(
        Math.max(1, page - 1),
        "pagination.prev",
        false,
        page <= 1
      )
    );

    for (let p = 1; p <= totalPages; p++) {
      docsPagination.appendChild(
        createPageItem(p, p, p === page, false)
      );
    }

    docsPagination.appendChild(
      createPageItem(
        Math.min(totalPages, page + 1),
        "pagination.next",
        false,
        page >= totalPages
      )
    );
  };

  const fetchDocuments = async () => {
    const params = new URLSearchParams({
      page: String(docsPage),
      page_size: String(pageSize),
    });
    try {
      const res = await authFetch(
        `${API_BASE}/clients/${clientId}/documents?${params.toString()}`
      );
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (data && data.items !== undefined) {
        renderDocuments(data);
      }
    } catch (err) {
      console.error("Error loading client documents", err);
    }
  };

  // ---------- Load client info ----------

  const refreshClientInfo = async () => {
    try {
      const res = await authFetch(`${API_BASE}/clients/${clientId}`);
      if (!res.ok) {
        return;
      }
      const client = await res.json();
      const companyEl = document.getElementById("client-company-name");
      const codeEl = document.getElementById("client-code");
      const addrEl = document.getElementById("client-address");
      const zipCityEl = document.getElementById("client-zip-city");

      if (companyEl) companyEl.textContent = client.company_name || "";
      if (codeEl) codeEl.textContent = client.code_client || "";
      if (addrEl) addrEl.textContent = client.address || "";

      if (zipCityEl) {
        const parts = [];
        if (client.zip_code) parts.push(client.zip_code);
        if (client.city) parts.push(client.city);
        zipCityEl.textContent = parts.join(" ");
      }
    } catch (err) {
      console.error("Error refreshing client info", err);
    }
  };

  // ---------- Initial load ----------

  refreshClientInfo();
  fetchOrders();
  fetchDocuments();
});

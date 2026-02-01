// app/static/agent/agent_client_detail.js
(() => {
  "use strict";
  const VERSION = "agent_client_detail.js v2025-11-28-2";
  console.log("[agent_client_detail] Loaded", VERSION);

  // ====== Small DOM helpers ======
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ====== Auth header (même logique que agent_clients.js) ======
  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API = "/api-zenhub";

  if (!TOKEN) {
    console.warn("[agent_client_detail] Missing token in localStorage");
  }

  // ====== Generic helpers ======
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(+d)) return "";
    return d.toLocaleDateString("fr-FR");
  };

  const fmtDateTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(+d)) return "";
    return d.toLocaleString("fr-FR");
  };

  const fmtMoney = (v) =>
    (Number(v) || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });

  const buildQS = (params = {}) => {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    );
    if (!entries.length) return "";
    return (
      "?" +
      entries
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
        )
        .join("&")
    );
  };

  const escapeHtml = (s) =>
    s == null
      ? ""
      : String(s).replace(/[&<>"']/g, (m) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m]);

  // ====== Toast ======
  const showToast = (msg, level = "error") => {
    const root = $("#agentClientDetailRoot");
    if (!root) return;
    let zone = $("#acd-toast-zone", root);
    if (!zone) {
      zone = document.createElement("div");
      zone.id = "acd-toast-zone";
      root.appendChild(zone);
    }
    zone.innerHTML = `
      <div class="toast ${level}" role="alert" aria-live="polite" style="margin:8px 0;">
        ${escapeHtml(msg)}
      </div>
    `;
    setTimeout(() => {
      if (zone) zone.innerHTML = "";
    }, 3500);
  };
  
  
  
  
  
  
  
  

  // ====== API helpers (Authorization: Bearer TOKEN, body lu UNE fois) ======
  async function apiGet(path, params = {}) {
    const url = `${API}${path}${buildQS(params)}`;
    console.log("[agent_client_detail] GET", url);

    const headers = {};
    if (TOKEN) {
      headers.Authorization = `Bearer ${TOKEN}`;
    }

    const res = await fetch(url, { headers });

    const raw = await res.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        // pas du JSON
      }
    }

    if (!res.ok) {
      let detail;
      if (data && data.detail) {
        detail =
          typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail);
      } else {
        detail = raw || `HTTP ${res.status}`;
      }

      console.warn("[agent_client_detail] API error", res.status, detail);
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }

    return data || {};
  }

  async function apiPut(path, payload = {}) {
    const url = `${API}${path}`;
    console.log("[agent_client_detail] PUT", url, payload);

    const headers = {
      "Content-Type": "application/json",
    };
    if (TOKEN) {
      headers.Authorization = `Bearer ${TOKEN}`;
    }

    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        // pas du JSON
      }
    }

    if (!res.ok) {
      let detail;
      if (data && data.detail) {
        detail =
          typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail);
      } else {
        detail = raw || `HTTP ${res.status}`;
      }

      console.warn("[agent_client_detail] API PUT error", res.status, detail);
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }

    return data || {};
  }
  
  
    // ====== Téléchargement PDF Labo ======
  async function downloadLabOrderPdf(docId, docNumber) {
    const url = `${API}/agent/clients/${clientId}/lab-orders/${docId}/pdf`;
    console.log("[agent_client_detail] Download PDF", url);

    const headers = {};
    if (TOKEN) {
      headers.Authorization = `Bearer ${TOKEN}`;
    }

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text();
        let detail = text || `HTTP ${res.status}`;
        try {
          const json = JSON.parse(text);
          if (json && json.detail) {
            detail =
              typeof json.detail === "string"
                ? json.detail
                : JSON.stringify(json.detail);
          }
        } catch (_) {
          // pas du JSON -> on garde text
        }
        throw new Error(detail);
      }

      const blob = await res.blob();
      const filename = `Facture-${(docNumber || docId)}.pdf`;

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.warn("[agent_client_detail] downloadLabOrderPdf error:", err);
      showToast(`Erreur lors du téléchargement du PDF : ${String(err)}`, "error");
    }
  }

  
  

  // =========================================================
  //          Boot : récupération des éléments de base
  // =========================================================
  const root = $("#agentClientDetailRoot");
  if (!root) {
    console.warn("[agent_client_detail] #agentClientDetailRoot not found");
    return;
  }

  const clientId = root.dataset.clientId;
  const lang = root.dataset.lang || "fr";

  if (!clientId) {
    console.error("[agent_client_detail] Missing data-client-id");
    return;
  }

  // Zones DOM
  const elClientInfo = $("#acd-client-info", root);
  const elBankInfo = $("#acd-bank-info", root);

  const elOrdersTbody = $("#acd-orders-tbody", root);
  const elOrdersPrev = $("#acd-orders-prev", root);
  const elOrdersNext = $("#acd-orders-next", root);
  const elOrdersPageInfo = $("#acd-orders-pageinfo", root);
  const elOrderDetail = $("#acd-order-detail", root);
  const elOrderDetailTitle = $("#acd-order-detail-title", root);
  const elOrderItemsTbody = $("#acd-order-items-tbody", root);

  const elRevenueTotal = $("#acd-revenue-total", root);
  const elRevenuePeriod = $("#acd-revenue-period", root);
  const elRevenueStart = $("#acd-revenue-start", root);
  const elRevenueEnd = $("#acd-revenue-end", root);
  const elRevenueApply = $("#acd-revenue-apply", root);

  const elProductsTbody = $("#acd-products-tbody", root);
  const elProductsPeriod = $("#acd-products-period", root);
  const elProductsStart = $("#acd-products-start", root);
  const elProductsEnd = $("#acd-products-end", root);
  const elProductsApply = $("#acd-products-apply", root);

  const elApptTbody = $("#acd-appt-tbody", root);
  const elApptPrev = $("#acd-appt-prev", root);
  const elApptNext = $("#acd-appt-next", root);
  const elApptPageInfo = $("#acd-appt-pageinfo", root);

 
  
    // NOUVEL onglet Commandes Labo
  const elLabOrdersTbody = $("#acd-laborders-tbody", root);
  const elLabOrdersPrev = $("#acd-laborders-prev", root);
  const elLabOrdersNext = $("#acd-laborders-next", root);
  const elLabOrdersPageInfo = $("#acd-laborders-pageinfo", root);

  // 👉 Détail d’un document labo
  const elLabOrderDetail = $("#acd-laborder-detail", root);
  const elLabOrderDetailTitle = $("#acd-laborder-detail-title", root);
  const elLabOrderItemsTbody = $("#acd-laborder-items-tbody", root);

  

  // Inputs édition coordonnées bancaires
  const elBankIban = $("#acd-bank-iban", root);
  const elBankBic = $("#acd-bank-bic", root);
  const elBankPaymentTerms = $("#acd-bank-payment-terms", root);
  const elBankCreditLimit = $("#acd-bank-credit-limit", root);
  const elBankSepaRef = $("#acd-bank-sepa-ref", root);
  const elBankSave = $("#acd-bank-save", root);

  // Tab system
  const tabButtons = $$(".acd-tab", root);
  const tabPanels = $$(".acd-tab-panel", root);

  // State
  let ordersPage = 1;
  const ordersPageSize = 10;

  let revenueChart = null;

  let apptPage = 1;
  const apptPageSize = 10;

  // State commandes labo
  let labOrdersPage = 1;
  const labOrdersPageSize = 10;

  // =========================================================
  //                     TABS
  // =========================================================
  function activateTab(tabName) {
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle("acd-tab-active", isActive);
    });
    tabPanels.forEach((panel) => {
      const isActive = panel.id === `acd-tab-${tabName}`;
      panel.classList.toggle("acd-tab-panel-active", isActive);
    });
  }

  tabButtons.forEach((btn) =>
    on(btn, "click", () => {
      const tab = btn.dataset.tab;
      if (!tab) return;
      activateTab(tab);
      if (tab === "orders") {
        loadOrders();
      } else if (tab === "revenue") {
        loadRevenue();
      } else if (tab === "products") {
        loadTopProducts();
      } else if (tab === "lab-orders") {
        loadLabOrders();
      } else if (tab === "appointments") {
        loadAppointments();
      }
    })
  );

  // =========================================================
  //                Client info + coordonnées bancaires
  // =========================================================
  async function loadClientInfo() {
    if (!elClientInfo) return;
    elClientInfo.innerHTML = `
      <div class="acd-skeleton-block"></div>
      <div class="acd-skeleton-block"></div>
      <div class="acd-skeleton-block small"></div>
    `;

    try {
      const data = await apiGet(`/agent/clients/${clientId}/info`);
      const c = data.client || {};

      const contact =
        c.contact_name ||
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        "";

      elClientInfo.innerHTML = `
        <div class="acd-info-line acd-client-name">
          <strong>${escapeHtml(c.name || "")}</strong>
        </div>
        ${
          contact
            ? `<div class="acd-info-line">${escapeHtml(contact)}</div>`
            : ""
        }
        <div class="acd-info-line">
          ${escapeHtml(c.address1 || "")}<br>
          ${escapeHtml(c.postcode || "")} ${escapeHtml(c.city || "")}<br>
          ${escapeHtml(c.country || "")}
        </div>
        <div class="acd-info-line">
          ${
            c.email
              ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(
                  c.email
                )}</a>`
              : ""
          }
          ${
            c.phone
              ? ` · <a href="tel:${escapeHtml(c.phone)}">${escapeHtml(
                  c.phone
                )}</a>`
              : ""
          }
        </div>
        ${
          c.groupement
            ? `<div class="acd-info-line">
                 <span class="acd-tag">Groupement</span>
                 ${escapeHtml(c.groupement)}
               </div>`
            : ""
        }
        ${
          c.sage_code
            ? `<div class="acd-info-line">
                 <span class="acd-tag">Code Sage</span>
                 ${escapeHtml(c.sage_code)}
               </div>`
            : ""
        }
        <div class="acd-info-line">
          <span class="acd-tag">CA 12 mois</span>
          ${fmtMoney(data.revenue_12m_ht || 0)}
        </div>
        <div class="acd-info-line">
          <span class="acd-tag">Nb commandes</span>
          ${data.total_orders || 0}
          ${
            data.last_order_date
              ? ` · Dernière : ${fmtDate(data.last_order_date)}`
              : ""
          }
        </div>
      `;

      // Affichage coord bancaires
      if (elBankInfo) {
        const hasBank =
          c.iban || c.bic || c.payment_terms || c.credit_limit || c.sepa_mandate_ref;
        if (!hasBank) {
          elBankInfo.innerHTML = `
            <p class="acd-muted">
              Aucune information bancaire enregistrée pour le moment.
            </p>
          `;
        } else {
          elBankInfo.innerHTML = `
            <dl class="acd-bank-dl">
              ${
                c.iban
                  ? `<div><dt>IBAN</dt><dd>${escapeHtml(c.iban)}</dd></div>`
                  : ""
              }
              ${
                c.bic
                  ? `<div><dt>BIC</dt><dd>${escapeHtml(c.bic)}</dd></div>`
                  : ""
              }
              ${
                c.payment_terms
                  ? `<div><dt>Conditions de paiement</dt><dd>${escapeHtml(
                      c.payment_terms
                    )}</dd></div>`
                  : ""
              }
              ${
                c.credit_limit
                  ? `<div><dt>Encours autorisé</dt><dd>${fmtMoney(
                      c.credit_limit
                    )}</dd></div>`
                  : ""
              }
              ${
                c.sepa_mandate_ref
                  ? `<div><dt>Mandat SEPA</dt><dd>${escapeHtml(
                      c.sepa_mandate_ref
                    )}</dd></div>`
                  : ""
              }
            </dl>
          `;
        }
      }

      // Pré-remplissage du formulaire d'édition bancaire
      if (elBankIban) elBankIban.value = c.iban || "";
      if (elBankBic) elBankBic.value = c.bic || "";
      if (elBankPaymentTerms) elBankPaymentTerms.value = c.payment_terms || "";
      if (elBankCreditLimit) {
        elBankCreditLimit.value =
          c.credit_limit != null && c.credit_limit !== ""
            ? String(c.credit_limit)
            : "";
      }
      if (elBankSepaRef) elBankSepaRef.value = c.sepa_mandate_ref || "";
    } catch (err) {
      console.warn("[agent_client_detail] loadClientInfo error:", err);
      elClientInfo.innerHTML = `
        <p class="acd-error">Erreur lors du chargement des informations client.</p>
      `;
      showToast(String(err));
    }
  }

  // Gestion clic "Enregistrer" coordonnées bancaires
  if (elBankSave) {
    on(elBankSave, "click", async () => {
      try {
        elBankSave.disabled = true;

        const payload = {
          iban: elBankIban ? elBankIban.value.trim() || null : null,
          bic: elBankBic ? elBankBic.value.trim() || null : null,
          payment_terms: elBankPaymentTerms
            ? elBankPaymentTerms.value.trim() || null
            : null,
          credit_limit:
            elBankCreditLimit && elBankCreditLimit.value !== ""
              ? Number(elBankCreditLimit.value)
              : null,
          sepa_mandate_ref: elBankSepaRef
            ? elBankSepaRef.value.trim() || null
            : null,
        };

        await apiPut(`/agent/clients/${clientId}/bank-info`, payload);

        showToast("Coordonnées bancaires enregistrées.", "success");
        await loadClientInfo();
      } catch (err) {
        console.warn("[agent_client_detail] save bank info error:", err);
        showToast(String(err), "error");
      } finally {
        elBankSave.disabled = false;
      }
    });
  }

  // =========================================================
  //                     Orders
  // =========================================================
  async function loadOrders() {
    if (!elOrdersTbody) return;
    elOrdersTbody.innerHTML = `
      <tr><td colspan="5" class="acd-empty">Chargement des commandes...</td></tr>
    `;

    try {
      const data = await apiGet(`/agent/clients/${clientId}/orders`, {
        page: ordersPage,
        page_size: ordersPageSize,
      });

      const items = data.items || [];
      if (!items.length) {
        elOrdersTbody.innerHTML = `
          <tr><td colspan="5" class="acd-empty">Aucune commande trouvée.</td></tr>
        `;
      } else {
        elOrdersTbody.innerHTML = items
          .map((o) => {
            return `
              <tr data-order-id="${o.id}">
                <td>${escapeHtml(o.number || "")}</td>
                <td>${fmtDate(o.order_date || o.date || o.created_at)}</td>
                <td>${escapeHtml(o.status || "")}</td>
                <td class="text-right">${fmtMoney(o.total_ht)}</td>
                <td class="text-right">
                  <button type="button"
                    class="acd-btn acd-btn-ghost acd-order-show"
                    data-order-id="${o.id}">
                    Détail
                  </button>
                </td>
              </tr>
            `;
          })
          .join("");
      }

      const start = (data.page - 1) * data.page_size + 1;
      const end = Math.min(data.total, data.page * data.page_size);
      const canPrev = data.page > 1;
      const canNext = data.page * data.page_size < data.total;

      if (elOrdersPageInfo) {
        elOrdersPageInfo.textContent = data.total
          ? `${start}-${end} / ${data.total}`
          : "0";
      }
      if (elOrdersPrev) elOrdersPrev.disabled = !canPrev;
      if (elOrdersNext) elOrdersNext.disabled = !canNext;

      // Bind détail
      $$(".acd-order-show", elOrdersTbody).forEach((btn) =>
        on(btn, "click", () => {
          const id = btn.dataset.orderId;
          if (id) loadOrderDetail(id);
        })
      );
    } catch (err) {
      console.warn("[agent_client_detail] loadOrders error:", err);
      elOrdersTbody.innerHTML = `
        <tr><td colspan="5" class="acd-empty acd-error">
          Erreur lors du chargement des commandes.
        </td></tr>
      `;
      showToast(String(err));
    }
  }

  async function loadOrderDetail(orderId) {
    if (!elOrderDetail || !elOrderDetailTitle || !elOrderItemsTbody) return;
    elOrderDetail.hidden = false;
    elOrderDetailTitle.textContent = "Chargement...";
    elOrderItemsTbody.innerHTML = "";

    try {
      const data = await apiGet(
        `/agent/clients/${clientId}/orders/${orderId}`
      );
      elOrderDetailTitle.textContent = `Commande ${data.number} du ${fmtDate(
        data.date || data.created_at
      )} — ${fmtMoney(data.total_ht)}`;

      const items = data.items || [];
      if (!items.length) {
        elOrderItemsTbody.innerHTML = `
          <tr><td colspan="5" class="acd-empty">Aucun produit.</td></tr>
        `;
      } else {
        elOrderItemsTbody.innerHTML = items
          .map(
            (it) => `
            <tr>
              <td>${escapeHtml(it.product_name || "")}</td>
              <td>${escapeHtml(it.sku || "")}</td>
              <td class="text-right">${Number(it.quantity || 0)}</td>
              <td class="text-right">${fmtMoney(it.unit_price_ht)}</td>
              <td class="text-right">${fmtMoney(it.total_ht)}</td>
            </tr>
          `
          )
          .join("");
      }
    } catch (err) {
      console.warn("[agent_client_detail] loadOrderDetail error:", err);
      elOrderDetailTitle.textContent =
        "Erreur lors du chargement de la commande.";
      elOrderItemsTbody.innerHTML = "";
      showToast(String(err));
    }
  }

  on(elOrdersPrev, "click", () => {
    if (ordersPage > 1) {
      ordersPage -= 1;
      loadOrders();
    }
  });
  on(elOrdersNext, "click", () => {
    ordersPage += 1;
    loadOrders();
  });

  // =========================================================
  //                     Revenue
  // =========================================================
  function getRevenuePeriodParams() {
    const mode = elRevenuePeriod ? elRevenuePeriod.value : "12m";
    let start = "";
    let end = "";
    if (mode === "custom") {
      start = elRevenueStart.value || "";
      end = elRevenueEnd.value || "";
    }
    return { mode, start_date: start, end_date: end };
  }

  async function loadRevenue() {
    if (!elRevenueTotal) return;

    try {
      const params = getRevenuePeriodParams(); // mode = "12m" par défaut
      const data = await apiGet(
        `/agent/clients/${clientId}/revenue`,
        params
      );

      // Total sur la période
      elRevenueTotal.textContent = fmtMoney(data.total_ht || 0);

      const points = data.points || [];

      // On mappe les mois envoyés par l'API -> CA
      const monthMap = new Map();
      points.forEach((p) => {
        const d = new Date(p.date);
        if (isNaN(+d)) return;
        const key = `${d.getFullYear()}-${d.getMonth()}`; // ex: "2025-10"
        monthMap.set(key, Number(p.total_ht || 0));
      });

      // On prend la fin de période renvoyée par l'API
      const end = data.end_date ? new Date(data.end_date) : new Date();
      if (isNaN(+end)) {
        console.warn("[agent_client_detail] end_date invalide, fallback now()");
      }

      const labels = [];
      const values = [];

      // On construit les 12 derniers mois (de end - 11 mois à end)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;

        labels.push(
          d.toLocaleDateString("fr-FR", {
            month: "short",
            year: "2-digit",
          })
        );
        values.push(monthMap.get(key) || 0);
      }

      const ctx = $("#acd-revenue-chart", root);
      if (!ctx) return;

      if (revenueChart) revenueChart.destroy();

      // eslint-disable-next-line no-undef
      revenueChart = new Chart(ctx, {
        type: "bar", // DIAGRAMME À BATONS
        data: {
          labels,
          datasets: [
            {
              label: "CA HT",
              data: values,
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: {
                autoSkip: false,
                maxRotation: 0,
                minRotation: 0,
              },
            },
            y: {
              beginAtZero: true,
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (ctx) => fmtMoney(ctx.parsed.y || 0),
              },
            },
          },
        },
      });
    } catch (err) {
      console.warn("[agent_client_detail] loadRevenue error:", err);
      showToast(String(err));
    }
  }

  on(elRevenuePeriod, "change", () => {
    if (!elRevenueStart || !elRevenueEnd || !elRevenuePeriod) return;
    const mode = elRevenuePeriod.value;
    const isCustom = mode === "custom";
    elRevenueStart.hidden = !isCustom;
    elRevenueEnd.hidden = !isCustom;
  });

  on(elRevenueApply, "click", () => {
    loadRevenue();
  });

  // =========================================================
  //                     Top Products
  // =========================================================
  function getProductsPeriodParams() {
    const mode = elProductsPeriod ? elProductsPeriod.value : "12m";
    let start = "";
    let end = "";
    if (mode === "custom") {
      start = elProductsStart.value || "";
      end = elProductsEnd.value || "";
    }
    return { mode, start_date: start, end_date: end };
  }

  async function loadTopProducts() {
    if (!elProductsTbody) return;
    elProductsTbody.innerHTML = `
      <tr><td colspan="4" class="acd-empty">Chargement...</td></tr>
    `;

    try {
      const params = getProductsPeriodParams();
      const data = await apiGet(
        `/agent/clients/${clientId}/top-products`,
        params
      );
      const items = data.items || [];

      if (!items.length) {
        elProductsTbody.innerHTML = `
          <tr><td colspan="4" class="acd-empty">Aucun produit sur la période.</td></tr>
        `;
      } else {
        elProductsTbody.innerHTML = items
          .map(
            (p) => `
            <tr>
              <td>${escapeHtml(p.product_name || "")}</td>
              <td>${escapeHtml(p.sku || "")}</td>
              <td class="text-right">${Number(p.total_qty || 0)}</td>
              <td class="text-right">${fmtMoney(p.total_ht)}</td>
            </tr>
          `
          )
          .join("");
      }
    } catch (err) {
      console.warn("[agent_client_detail] loadTopProducts error:", err);
      elProductsTbody.innerHTML = `
        <tr><td colspan="4" class="acd-empty acd-error">
          Erreur lors du chargement des produits.
        </td></tr>
      `;
      showToast(String(err));
    }
  }

  on(elProductsPeriod, "change", () => {
    if (!elProductsStart || !elProductsEnd || !elProductsPeriod) return;
    const mode = elProductsPeriod.value;
    const isCustom = mode === "custom";
    elProductsStart.hidden = !isCustom;
    elProductsEnd.hidden = !isCustom;
  });

  on(elProductsApply, "click", () => {
    loadTopProducts();
  });

  // =========================================================
  //                     Commandes Labo
  // =========================================================
   // =========================================================
  //                     Commandes Labo
  // =========================================================
     // =========================================================
  //                     Commandes Labo
  // =========================================================
  async function loadLabOrders() {
    if (!elLabOrdersTbody) return;
    elLabOrdersTbody.innerHTML = `
      <tr><td colspan="5" class="acd-empty">Chargement...</td></tr>
    `;

    try {
      const data = await apiGet(
        `/agent/clients/${clientId}/lab-orders`,
        {
          page: labOrdersPage,
          page_size: labOrdersPageSize,
        }
      );

      const items = data.items || [];

      if (!items.length) {
        elLabOrdersTbody.innerHTML = `
          <tr><td colspan="5" class="acd-empty">Aucune commande labo trouvée.</td></tr>
        `;
      } else {
        elLabOrdersTbody.innerHTML = items
          .map((o) => {
            const docNum = o.doc_number || o.number || "";
            const rawType = o.type || o.doc_type || "";
            const docDate = o.date || o.doc_date || o.created_at;
            const laboName = o.labo || o.labo_name || "";
            const hasPdf = !!o.has_pdf;

            // Type lisible : on privilégie doc_type_label si dispo, sinon on recalcule
            let docType = o.doc_type_label || "";
            if (!docType) {
              const numUpper = (docNum || "").toUpperCase();
              if (numUpper.startsWith("AVOIR") || numUpper.startsWith("AW")) {
                docType = "Avoir";
              } else {
                docType =
                  {
                    FA: "Facture",
                    BC: "Commande",
                    CO: "Commande",
                    AV: "Avoir",
                    AW: "Avoir",
                  }[rawType] || "Document";
              }
            }

            const actions = [
              `<button type="button"
                class="acd-btn acd-btn-ghost acd-laborder-show"
                data-labdoc-id="${o.id}">
                 Détail
               </button>`,
            ];

            if (hasPdf) {
              actions.push(
                `<button type="button"
                    class="acd-btn acd-btn-ghost acd-laborder-pdf"
                    data-labdoc-id="${o.id}"
                    data-labdoc-number="${escapeHtml(docNum)}">
                   PDF
                 </button>`
              );
            }

            return `
              <tr data-labdoc-id="${o.id}">
                <td>${escapeHtml(docNum)}</td>
                <td>${escapeHtml(docType)}</td>
                <td>${fmtDate(docDate)}</td>
                <td class="text-right">${fmtMoney(o.total_ht)}</td>
                <td class="text-right">
                  ${actions.join("&nbsp;")}
                </td>
              </tr>
            `;
          })
          .join("");
      }

      const start = (data.page - 1) * data.page_size + 1;
      const end = Math.min(data.total, data.page * data.page_size);
      const canPrev = data.page > 1;
      const canNext = data.page * data.page_size < data.total;

      if (elLabOrdersPageInfo) {
        elLabOrdersPageInfo.textContent = data.total
          ? `${start}-${end} / ${data.total}`
          : "0";
      }
      if (elLabOrdersPrev) elLabOrdersPrev.disabled = !canPrev;
      if (elLabOrdersNext) elLabOrdersNext.disabled = !canNext;

      // 👉 Bind boutons "Détail"
      $$(".acd-laborder-show", elLabOrdersTbody).forEach((btn) =>
        on(btn, "click", () => {
          const id = btn.dataset.labdocId;
          if (id) loadLabOrderDetail(id);
        })
      );

      // 👉 Bind boutons "PDF"
      $$(".acd-laborder-pdf", elLabOrdersTbody).forEach((btn) =>
        on(btn, "click", () => {
          const id = btn.dataset.labdocId;
          const num = btn.dataset.labdocNumber || "";
          if (id) downloadLabOrderPdf(id, num);
        })
      );
    } catch (err) {
      console.warn("[agent_client_detail] loadLabOrders error:", err);
      elLabOrdersTbody.innerHTML = `
        <tr><td colspan="5" class="acd-empty acd-error">
          Erreur lors du chargement des commandes labo.
        </td></tr>
      `;
      showToast(String(err));
    }
  }



  async function loadLabOrderDetail(docId) {
    if (!elLabOrderDetail || !elLabOrderDetailTitle || !elLabOrderItemsTbody) return;
    elLabOrderDetail.hidden = false;
    elLabOrderDetailTitle.textContent = "Chargement...";
    elLabOrderItemsTbody.innerHTML = "";

    try {
      const data = await apiGet(
        `/agent/clients/${clientId}/lab-orders/${docId}`
      );

      const docNum = data.doc_number || data.number || "";
      const rawType = data.type || data.doc_type || "";
      const docDate = data.doc_date || data.date || data.created_at;
      const laboName = data.labo || data.labo_name || "";

      const numUpper = (docNum || "").toUpperCase();
      let docType;
      if (numUpper.startsWith("AVOIR") || numUpper.startsWith("AW")) {
        docType = "Avoir";
      } else {
        docType =
          {
            FA: "Facture",
            BC: "Commande",
            CO: "Commande",
            AV: "Avoir",
            AW: "Avoir",
          }[rawType] || "Document";
      }

      const titleParts = [];
      if (docNum) titleParts.push(`Document ${docNum}`);
      if (docType) titleParts.push(`(${docType})`);
      if (docDate) titleParts.push(`du ${fmtDate(docDate)}`);
      if (laboName) titleParts.push(` — ${laboName}`);
      if (data.total_ht != null) titleParts.push(` — ${fmtMoney(data.total_ht)}`);

      elLabOrderDetailTitle.textContent = titleParts.join(" ");

      const items = data.items || [];
      if (!items.length) {
        elLabOrderItemsTbody.innerHTML = `
          <tr><td colspan="5" class="acd-empty">Aucun produit.</td></tr>
        `;
      } else {
        elLabOrderItemsTbody.innerHTML = items
          .map((it) => {
            const name = it.product_name || it.name || "";
            const sku = it.sku || "";
            const qty = it.quantity ?? it.qty ?? 0;
            const unit = it.unit_price_ht ?? it.unit_ht ?? 0;
            const total = it.total_ht ?? 0;

            return `
              <tr>
                <td>${escapeHtml(name)}</td>
                <td>${escapeHtml(sku)}</td>
                <td class="text-right">${Number(qty || 0)}</td>
                <td class="text-right">${fmtMoney(unit)}</td>
                <td class="text-right">${fmtMoney(total)}</td>
              </tr>
            `;
          })
          .join("");
      }
    } catch (err) {
      console.warn("[agent_client_detail] loadLabOrderDetail error:", err);
      elLabOrderDetailTitle.textContent =
        "Erreur lors du chargement du document labo.";
      elLabOrderItemsTbody.innerHTML = "";
      showToast(String(err));
    }
  }
  
   async function downloadLabOrderPdf(docId) {
    const url = `${API}/agent/clients/${clientId}/lab-orders/${docId}/pdf`;

    try {
      const headers = {};
      if (TOKEN) {
        headers.Authorization = `Bearer ${TOKEN}`;
      }

      const res = await fetch(url, { headers });

      if (!res.ok) {
        const txt = await res.text();
        console.warn("[agent_client_detail] downloadLabOrderPdf error:", res.status, txt);
        showToast("Erreur lors du téléchargement du PDF.", "error");
        return;
      }

      const blob = await res.blob();

      // Récupération filename depuis Content-Disposition
      const disposition = res.headers.get("Content-Disposition") || "";
      let filename = "facture.pdf";

      const match = disposition.match(
        /filename\*?=(?:UTF-8''([^;]+)|"([^"]+)"|([^;]+))/
      );
      if (match) {
        filename = decodeURIComponent(match[1] || match[2] || match[3]).replace(
          /[/\\]/g,
          "_"
        );
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("[agent_client_detail] downloadLabOrderPdf exception:", err);
      showToast("Erreur réseau lors du téléchargement du PDF.", "error");
    }
  }
 
  


  on(elLabOrdersPrev, "click", () => {
    if (labOrdersPage > 1) {
      labOrdersPage -= 1;
      loadLabOrders();
    }
  });

  on(elLabOrdersNext, "click", () => {
    labOrdersPage += 1;
    loadLabOrders();
  });

  // =========================================================
  //                     Appointments
  // =========================================================
  async function loadAppointments() {
    if (!elApptTbody) return;
    elApptTbody.innerHTML = `
      <tr><td colspan="5" class="acd-empty">Chargement...</td></tr>
    `;

    try {
      const data = await apiGet(
        `/agent/clients/${clientId}/appointments`,
        {
          page: apptPage,
          page_size: apptPageSize,
        }
      );
      const items = data.items || [];

      if (!items.length) {
        elApptTbody.innerHTML = `
          <tr><td colspan="5" class="acd-empty">Aucun rendez-vous.</td></tr>
        `;
      } else {
        elApptTbody.innerHTML = items
          .map(
            (a) => `
            <tr>
              <td>${fmtDateTime(a.start_at)}</td>
              <td>${escapeHtml(a.notes || "")}</td>
              <td>${escapeHtml(a.status || "")}</td>
              <td>${escapeHtml(a.agent_name || "")}</td>
              <td class="text-right"></td>
            </tr>
          `
          )
          .join("");
      }

      const start = (data.page - 1) * data.page_size + 1;
      const end = Math.min(data.total, data.page * data.page_size);
      const canPrev = data.page > 1;
      const canNext = data.page * data.page_size < data.total;

      if (elApptPageInfo) {
        elApptPageInfo.textContent = data.total
          ? `${start}-${end} / ${data.total}`
          : "0";
      }
      if (elApptPrev) elApptPrev.disabled = !canPrev;
      if (elApptNext) elApptNext.disabled = !canNext;
    } catch (err) {
      console.warn("[agent_client_detail] loadAppointments error:", err);
      elApptTbody.innerHTML = `
        <tr><td colspan="5" class="acd-empty acd-error">
          Erreur lors du chargement des rendez-vous.
        </td></tr>
      `;
      showToast(String(err));
    }
  }

  on(elApptPrev, "click", () => {
    if (apptPage > 1) {
      apptPage -= 1;
      loadAppointments();
    }
  });
  on(elApptNext, "click", () => {
    apptPage += 1;
    loadAppointments();
  });

  // =========================================================
  //                     Initial load
  // =========================================================
  (async () => {
    await loadClientInfo();
    await loadOrders();
    await loadRevenue();
    await loadTopProducts();
    await loadLabOrders();   // <- on charge aussi les commandes labo au chargement
    // rendez-vous se chargera au clic
  })();
})();

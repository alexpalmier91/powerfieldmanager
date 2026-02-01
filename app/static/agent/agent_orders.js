// app/static/agent/agent_orders.js
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API_BASE = "/api-zenhub/agent";

  const elContainer = $("#agentOrders");
  const elFilterLabo = $("#ordersFilterLabo");
  const elFilterStatus = $("#ordersFilterStatus");
  const elFilterPeriod = $("#ordersFilterPeriod");
  const elDateFrom = $("#ordersDateFrom");
  const elDateTo = $("#ordersDateTo");
  const elOrderDetail = $("#orderDetail");
  const elSearch = $("#agentOrdersSearch");

  if (!elContainer) {
    console.warn("[agent_orders] Missing #agentOrders container");
    return;
  }

  const getAuthHeaderValue = () => {
    const raw = (TOKEN || "").trim();
    if (!raw) return "";
    return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
  };

  const buildQS = (params = {}) =>
    "?" +
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(+d)) return "";
    return d.toLocaleDateString("fr-FR");
  };

  const fmtMoney = (v) =>
    (Number(v) || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });

  const debounce = (fn, ms = 300) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const firstOfMonthISO = () => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  };
  const daysAgoISO = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const stableSort = (arr, cmp) =>
    arr
      .map((v, i) => [v, i])
      .sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1])
      .map(([v]) => v);

  const state = {
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
    sort: { field: "date", dir: "desc" },
    filters: {
      labo_id: "",
      status: "",
      date_from: firstOfMonthISO(),
      date_to: todayISO(),
      search: "",
    },
    abortCtrl: null,
  };

  const showToast = (msg, level = "error", duration = 3000) => {
    const zone =
      elContainer.querySelector(".toast-zone") || document.createElement("div");
    zone.className = "toast-zone";
    zone.innerHTML = `<div class="toast ${level}" role="alert" aria-live="polite" style="margin-bottom:8px;">${msg}</div>`;
    if (!zone.parentNode) elContainer.prepend(zone);
    else elContainer.prepend(zone);

    setTimeout(() => zone.parentNode && zone.parentNode.removeChild(zone), duration);
  };

  const skeletonRows = (n = 8) =>
    Array.from({ length: n })
      .map(
        () => `<tr class="skeleton">
      <td style="width:18%"><div class="skl"></div></td>
      <td style="width:12%"><div class="skl"></div></td>
      <td style="width:24%"><div class="skl"></div></td>
      <td style="width:18%"><div class="skl"></div></td>
      <td style="width:12%"><div class="skl"></div></td>
      <td style="width:12%"><div class="skl"></div></td>
      <td style="width:8%"><div class="skl"></div></td>
    </tr>`
      )
      .join("");

  const sortableTh = (label, field, width) => {
    const isActive = state.sort.field === field;
    const dir = isActive ? state.sort.dir : "none";
    const arrow = dir === "asc" ? "↑" : dir === "desc" ? "↓" : "";
    return `
      <th scope="col" ${width ? `style="width:${width};"` : ""}>
        <button class="th-sort" data-field="${field}" aria-label="Trier par ${label}"
          aria-sort="${dir}" tabindex="0" style="background:none;border:none;padding:0;font:inherit;">
          <span>${label}</span><span class="dir">${arrow}</span>
        </button>
      </th>`;
  };

  const renderPager = () => {
    const start = (state.page - 1) * state.page_size + 1;
    const end = Math.min(state.total, state.page * state.page_size);
    const canPrev = state.page > 1;
    const canNext = state.page * state.page_size < state.total;
    return `
      <div class="pager" id="agentOrdersPagerInner" role="navigation" aria-label="Pagination">
        <label for="agentOrdersPageSize" style="display:flex;align-items:center;gap:6px;">
          <span>Par page</span>
          <select id="agentOrdersPageSize" class="page-size">
            <option value="50" ${state.page_size === 50 ? "selected" : ""}>50</option>
            <option value="100" ${state.page_size === 100 ? "selected" : ""}>100</option>
          </select>
        </label>
        <button class="btn" id="agentOrdersPrev" ${!canPrev ? "disabled" : ""}>Précédent</button>
        <button class="btn" id="agentOrdersNext" ${!canNext ? "disabled" : ""}>Suivant</button>
        <div class="count" aria-live="polite">${
          state.total ? `${start}–${end} sur ${state.total}` : "0 résultat"
        }</div>
      </div>
    `;
  };

  const tableTemplate = (rowsHtml) => `
    <div class="card" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <div class="table-wrap" style="overflow:auto;">
        <table class="table" role="table" style="width:100%;min-width:980px;">
          <thead style="background:#f3f4f6;">
            <tr role="row">
              <th scope="col" style="width:18%;">Bon de commande</th>
              ${sortableTh("Date", "date", "12%")}
              <th scope="col" style="width:24%;">Client</th>
              ${sortableTh("Labo", "labo_name", "18%")}
              <th scope="col" style="width:12%;">Statut</th>
              ${sortableTh("Total HT", "total_ht", "12%")}
              <th scope="col" style="width:8%;">PDF</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div class="footer" style="padding:8px 12px;background:#fafafa;border-top:1px solid #eee;">
        ${renderPager()}
      </div>
    </div>
    <style>
      .table th { text-align:left; padding:10px 12px; font-weight:600; }
      .table td { padding:8px 12px; border-top:1px solid #eee; white-space:nowrap; vertical-align:top; }
      .doccell { display:flex; flex-direction:column; gap:2px; }
      .docno { font-weight:700; }
      .agentname { font-size:12px; color:#6b7280; }
      .th-sort { cursor:pointer; user-select:none; }
      .th-sort .dir { opacity:0.7; margin-left:6px; }
      .skeleton .skl { height:12px; background:linear-gradient(90deg,#eee,#f5f5f5,#eee); animation: sh 1.2s infinite; border-radius:6px; }
      @keyframes sh { 0%{background-position:-150px 0} 100%{background-position:150px 0} }
      .pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .btn { padding:6px 10px; border:1px solid #ddd; background:#fff; border-radius:6px; }
      .btn[disabled]{ opacity:0.5; cursor:not-allowed; }
      .count { margin-left:auto; }
      .badge { padding:2px 8px; border-radius:999px; border:1px solid #e5e7eb; background:#f9fafb; font-size:12px; }
      .row-click { cursor:pointer; }
      .toast { padding:8px 10px; border-radius:6px; }
      .toast.error { background:#fee2e2; color:#7f1d1d; border:1px solid #fecaca; }
      .toast.success { background:#dcfce7; color:#14532d; border:1px solid #bbf7d0; }
      .btn-pdf { padding:4px 8px; font-size:12px; border-radius:6px; border:1px solid #ddd; background:#f9fafb; }
    </style>
  `;

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

  // ✅ Ouverture PDF avec token (pas de lien direct)
  const openPdf = async (orderId) => {
    try {
      const url = `${API_BASE}/orders/${orderId}/pdf`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/pdf",
          Authorization: getAuthHeaderValue(),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (e) {
      console.error("[agent_orders] openPdf error:", e);
      showToast("Impossible d'ouvrir le PDF.", "error");
    }
  };

  const renderRows = () => {
    if (!state.items.length) {
      return `<tr><td colspan="7" style="padding:16px;color:#6b7280;">Aucun bon de commande.</td></tr>`;
    }

    const { field, dir } = state.sort;
    const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

    const cmp = (a, b) => {
      let av = a[field], bv = b[field];

      if (field === "date") {
        const da = new Date(a.date || a.order_date);
        const db = new Date(b.date || b.order_date);
        const base = da - db;
        return dir === "asc" ? base : -base;
      }

      if (field === "total_ht") {
        const base = (Number(av) || 0) - (Number(bv) || 0);
        return dir === "asc" ? base : -base;
      }

      const base = collator.compare((av ?? "").toString(), (bv ?? "").toString());
      return dir === "asc" ? base : -base;
    };

    const sorted = stableSort(state.items, cmp);

    return sorted
      .map((o) => {
        const st = (o.status || "").toLowerCase();
        const docNo = o.doc_no || o.order_number || "";
        const dateVal = o.date || o.order_date || "";
        const agentName = o.agent_name || "";

        return `<tr class="row-click" data-id="${o.id}" tabindex="0" aria-label="Voir le détail du bon de commande ${escapeHtml(docNo)}">
          <td>
            <div class="doccell">
              <div class="docno">${escapeHtml(docNo)}</div>
              <div class="agentname">${escapeHtml(agentName)}</div>
            </div>
          </td>
          <td>${fmtDate(dateVal)}</td>
          <td>${escapeHtml(o.client_name || "")}</td>
          <td>${escapeHtml(o.labo_name || "")}</td>
          <td><span class="badge">${escapeHtml(st)}</span></td>
          <td style="text-align:right;">${fmtMoney(o.total_ht)}</td>
          <td style="text-align:center;">
            <button class="btn-pdf" data-pdf="${o.id}" type="button">BC PDF</button>
          </td>
        </tr>`;
      })
      .join("");
  };

  const paint = () => {
    elContainer.innerHTML = tableTemplate(renderRows());

    $$(".th-sort", elContainer).forEach((btn) =>
      on(btn, "click", () => toggleSort(btn.dataset.field))
    );
    $$(".th-sort", elContainer).forEach((btn) =>
      on(btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort(btn.dataset.field);
        }
      })
    );

    $$("tbody tr.row-click", elContainer).forEach((tr) => {
      const open = () => openDetail(tr.dataset.id);
      on(tr, "click", open);
      on(tr, "keydown", (e) => {
        if (e.key === "Enter") open();
      });
    });

    // ✅ PDF buttons
    $$("button[data-pdf]", elContainer).forEach((btn) => {
      on(btn, "click", (e) => {
        e.stopPropagation();
        openPdf(btn.dataset.pdf);
      });
    });

    on($("#agentOrdersPrev", elContainer), "click", () => changePage(state.page - 1));
    on($("#agentOrdersNext", elContainer), "click", () => changePage(state.page + 1));
    on($("#agentOrdersPageSize", elContainer), "change", (e) => {
      state.page_size = parseInt(e.target.value, 10) || 50;
      state.page = 1;
      fetchAndRender();
    });
  };

  const showLoading = () => {
    elContainer.innerHTML = tableTemplate(skeletonRows(8));
  };

  const toggleSort = (field) => {
    if (!field) return;
    if (state.sort.field === field) {
      state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
    } else {
      state.sort.field = field;
      state.sort.dir = "asc";
    }
    paint();
  };

  const changePage = (p) => {
    if (p < 1) return;
    const maxPage = Math.max(1, Math.ceil(state.total / state.page_size));
    if (p > maxPage) return;
    state.page = p;
    fetchAndRender();
  };

  const applyPeriod = () => {
    const v = (elFilterPeriod && elFilterPeriod.value) || "month";
    if (v === "month") {
      state.filters.date_from = firstOfMonthISO();
      state.filters.date_to = todayISO();
      if (elDateFrom) elDateFrom.value = state.filters.date_from;
      if (elDateTo) elDateTo.value = state.filters.date_to;
    } else if (v === "30d") {
      state.filters.date_from = daysAgoISO(30);
      state.filters.date_to = todayISO();
      if (elDateFrom) elDateFrom.value = state.filters.date_from;
      if (elDateTo) elDateTo.value = state.filters.date_to;
    }
  };

  const fetchAndRender = async () => {
    if (state.abortCtrl) state.abortCtrl.abort();
    state.abortCtrl = new AbortController();
    showLoading();

    try {
      const qs = buildQS({
        labo_id: state.filters.labo_id,
        status: state.filters.status,
        date_from: state.filters.date_from,
        date_to: state.filters.date_to,
        page: state.page,
        page_size: state.page_size,
        search: state.filters.search,
        sort: state.sort.field,
        dir: state.sort.dir,
      });

      const res = await fetch(`${API_BASE}/orders${qs}`, {
        headers: { Authorization: getAuthHeaderValue() },
        signal: state.abortCtrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.items = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total) || 0;
      state.page = Number(data.page) || 1;
      state.page_size = Number(data.page_size) || state.page_size;

      paint();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[agent_orders] fetch error:", err);
      showToast("Erreur lors du chargement des bons de commande.", "error");
      elContainer.innerHTML = tableTemplate(
        `<tr><td colspan="7" style="padding:16px;color:#6b7280;">Impossible de charger les données.</td></tr>`
      );
    }
  };

  const loadLabos = async () => {
    if (!elFilterLabo) return;
    try {
      const res = await fetch(`${API_BASE}/labos`, {
        headers: { Authorization: getAuthHeaderValue() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const labs = await res.json();
      elFilterLabo.innerHTML =
        `<option value="">Tous les labos</option>` +
        (Array.isArray(labs)
          ? labs
              .map(
                (l) =>
                  `<option value="${String(l.id)}">${escapeHtml(
                    l.name || l.label || "Labo " + l.id
                  )}</option>`
              )
              .join("")
          : "");
    } catch (e) {
      console.warn("[agent_orders] Unable to load labos:", e);
      elFilterLabo.innerHTML = `<option value="">Tous les labos</option>`;
    }
  };

  // --- Detail (inchangé sauf wording "bon de commande") ---
  const openDetail = async (orderId) => {
    if (!orderId || !elOrderDetail) return;

    try {
      elOrderDetail.innerHTML = `
        <div class="drawer card" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px;max-height:80vh;overflow:auto;">
          <div style="font-weight:700;margin-bottom:8px;">Détail bon de commande #${escapeHtml(orderId)}</div>
          <div>${skeletonDetail()}</div>
        </div>`;

      if (typeof elOrderDetail.showModal === "function") elOrderDetail.showModal?.();
      else elOrderDetail.style.display = "block";

      const res = await fetch(`${API_BASE}/orders/${orderId}`, {
        headers: { Authorization: getAuthHeaderValue() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const lines = Array.isArray(data.items || data.lines) ? (data.items || data.lines) : [];
      const docNo = data.doc_no || data.order_number || "";
      const dateVal = data.date || data.order_date || "";
      const paymentMethod = data.payment_method || "";
      const comment = data.comment || "";
      const deliveryDate = data.delivery_date || "";

      const header = `
        <div style="margin-bottom:8px;color:#374151;">
          <div><strong>N° BC:</strong> ${escapeHtml(docNo)}</div>
          <div><strong>Date:</strong> ${fmtDate(dateVal)}</div>
          <div><strong>Client:</strong> ${escapeHtml(data.client_name || "")}</div>
          <div><strong>Labo:</strong> ${escapeHtml(data.labo_name || "")}</div>
          <div><strong>Total HT:</strong> ${fmtMoney(data.total_ht)}</div>
          ${deliveryDate ? `<div><strong>Date livraison:</strong> ${fmtDate(deliveryDate)}</div>` : ""}
          ${paymentMethod ? `<div><strong>Mode de paiement:</strong> ${escapeHtml(paymentMethod)}</div>` : ""}
          ${comment ? `<div style="margin-top:4px;"><strong>Commentaire:</strong><br>${escapeHtml(comment)}</div>` : ""}
        </div>
      `;

      const rows = lines.length
        ? lines
            .map((li) => {
              const qty = li.qty ?? li.quantity ?? 0;
              const unit = li.unit_ht ?? li.unit_price_ht ?? li.unit_price ?? li.price_ht ?? 0;
              const discount = li.discount_percent != null ? Number(li.discount_percent) : null;
              const total = li.line_ht ?? li.total_ht ?? li.total_line ?? li.total ?? qty * unit;
              const discountLabel = discount !== null ? `${discount.toFixed(2)} %` : "—";

              return `
                <tr>
                  <td>${escapeHtml(li.sku || li.reference || "")}</td>
                  <td>${escapeHtml(li.product || li.name || "")}</td>
                  <td style="text-align:right;">${Number(qty)}</td>
                  <td style="text-align:right;">${fmtMoney(unit)}</td>
                  <td style="text-align:right;">${discountLabel}</td>
                  <td style="text-align:right;">${fmtMoney(total)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="6" style="padding:10px;color:#6b7280;">Aucune ligne.</td></tr>`;

      elOrderDetail.innerHTML = `
        <div class="drawer card" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px;max-height:80vh;overflow:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-weight:700;">Détail bon de commande</div>
            <button class="btn" id="orderDetailClose" aria-label="Fermer">Fermer</button>
          </div>
          ${header}
          <div class="table-wrap" style="overflow:auto;">
            <table role="table" style="width:100%;min-width:700px;">
              <thead style="background:#f3f4f6;">
                <tr>
                  <th>SKU</th>
                  <th>Produit</th>
                  <th style="text-align:right;">Qté</th>
                  <th style="text-align:right;">PU HT</th>
                  <th style="text-align:right;">Remise %</th>
                  <th style="text-align:right;">Total ligne HT</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <style>
          .btn { padding:6px 10px; border:1px solid #ddd; background:#fff; border-radius:6px; }
        </style>
      `;
      on($("#orderDetailClose", elOrderDetail), "click", closeDetail);
    } catch (err) {
      console.error("[agent_orders] detail error:", err);
      showToast("Erreur lors du chargement du détail.", "error");
    }
  };

  const skeletonDetail = () => `
    <div>
      <div style="height:12px;background:#eee;border-radius:6px;width:60%;margin-bottom:8px;"></div>
      <div style="height:12px;background:#eee;border-radius:6px;width:40%;margin-bottom:8px;"></div>
      <div style="height:12px;background:#eee;border-radius:6px;width:80%;margin-bottom:12px;"></div>
      <table style="width:100%;min-width:700px;">
        <thead><tr><th>SKU</th><th>Produit</th><th>Qté</th><th>PU HT</th><th>Remise %</th><th>Total ligne</th></tr></thead>
        <tbody>
          ${Array.from({ length: 5 })
            .map(
              () => `
            <tr class="skeleton">
              <td><div class="skl"></div></td>
              <td><div class="skl"></div></td>
              <td><div class="skl"></div></td>
              <td><div class="skl"></div></td>
              <td><div class="skl"></div></td>
              <td><div class="skl"></div></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  const closeDetail = () => {
    if (!elOrderDetail) return;
    if (typeof elOrderDetail.close === "function") elOrderDetail.close?.();
    else elOrderDetail.style.display = "none";
    elOrderDetail.innerHTML = "";
  };

  // Bind filters
  if (elFilterPeriod) on(elFilterPeriod, "change", () => (applyPeriod(), (state.page = 1), fetchAndRender()));
  if (elFilterLabo) on(elFilterLabo, "change", () => ((state.filters.labo_id = elFilterLabo.value || ""), (state.page = 1), fetchAndRender()));
  if (elFilterStatus) on(elFilterStatus, "change", () => ((state.filters.status = elFilterStatus.value || ""), (state.page = 1), fetchAndRender()));
  if (elDateFrom) on(elDateFrom, "change", () => ((state.filters.date_from = elDateFrom.value || ""), (state.page = 1), fetchAndRender()));
  if (elDateTo) on(elDateTo, "change", () => ((state.filters.date_to = elDateTo.value || ""), (state.page = 1), fetchAndRender()));
  if (elSearch) on(elSearch, "input", debounce((e) => ((state.filters.search = (e.target.value || "").trim()), (state.page = 1), fetchAndRender()), 300));

  (async function init() {
    applyPeriod();
    await loadLabos();
    await fetchAndRender();
  })();
})();

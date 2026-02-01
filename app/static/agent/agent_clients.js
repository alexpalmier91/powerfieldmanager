// app/static/agent/agent_clients.js
(() => {
  "use strict";
  const VERSION = "agent_clients.js v2025-11-26-1";
  console.log("[agent_clients] Loaded", VERSION);

  // ====== Small DOM helpers ======
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ====== Auth header ======
  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API = "/api-zenhub";

  // ====== Generic helpers ======
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

  const buildQS = (params = {}) =>
    "?" +
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  const debounce = (fn, ms = 300) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // Stable sort: decorate-sort-undecorate
  const stableSort = (arr, cmp) =>
    arr
      .map((v, i) => [v, i])
      .sort((a, b) => {
        const d = cmp(a[0], b[0]);
        return d !== 0 ? d : a[1] - b[1];
      })
      .map(([v]) => v);

  // ====== State (liste clients) ======
  const state = {
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
    search: "",
    sort: { field: "company", dir: "asc" }, // default sort Nom ASC
    abortCtrl: null,
  };

  // ====== Elements (expected in template) ======
  const elContainer = $("#agentClients");
  const elSearch = $("#agentClientsSearch");
  const elPageSize = $("#agentClientsPageSize");

  if (!elContainer) {
    console.warn("[agent_clients] Missing #agentClients container");
    return;
  }

  // ====== Banner succès création client ======
  const showClientCreatedBannerIfNeeded = () => {
    const box = $("#clientCreateSuccess");
    if (!box) return;

    const flag = sessionStorage.getItem("agentClientCreated");
    if (flag === "1") {
      box.style.display = "block";
      box.textContent = "Client créé avec succès.";
      sessionStorage.removeItem("agentClientCreated");

      setTimeout(() => {
        box.style.opacity = "0";
      }, 4000);

      setTimeout(() => {
        box.style.display = "none";
        box.style.opacity = "";
      }, 4500);
    }
  };

  // ====== UI helpers ======
  const showToast = (msg, level = "error") => {
    const zone =
      elContainer.querySelector(".toast-zone") || document.createElement("div");
    zone.className = "toast-zone";
    zone.innerHTML = `
      <div class="toast ${level}" role="alert" aria-live="polite" style="margin-bottom:8px;">
        ${msg}
      </div>`;
    elContainer.prepend(zone);
    setTimeout(() => zone.remove(), 3000);
  };

  const skeletonRows = (n = 6) =>
    Array.from({ length: n })
      .map(
        () => `<tr class="skeleton">
      <td style="width:32%"><div class="skl"></div></td>
      <td style="width:10%"><div class="skl"></div></td>
      <td style="width:18%"><div class="skl"></div></td>
      <td style="width:20%"><div class="skl"></div></td>
      <td style="width:12%"><div class="skl"></div></td>
      <td style="width:8%"><div class="skl"></div></td>
    </tr>`
      )
      .join("");

  const tableTemplate = (rowsHtml, ariaSort = {}) => `
    <div class="card" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <div class="table-wrap" style="overflow:auto;">
        <table class="table" role="table" style="width:100%;min-width:800px;">
          <thead style="background:#f3f4f6;">
            <tr role="row">
              ${sortableTh("Société", "company", ariaSort)}
              ${sortableTh("CP", "zipcode", ariaSort, "10%")}
              ${sortableTh("Ville", "city", ariaSort, "18%")}
              <th scope="col" style="width:20%;">Email</th>
              <th scope="col" style="width:12%;">Téléphone</th>
              <th scope="col" style="width:8%;">Groupement</th>
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
      .table th { text-align:left; padding:10px 12px; font-weight:600; cursor:default; }
      .table td { padding:8px 12px; border-top:1px solid #eee; white-space:nowrap; }
      .th-sort { cursor:pointer; user-select:none; }
      .th-sort .dir { opacity:0.7; margin-left:6px; }
      .skeleton .skl { height:12px; background:linear-gradient(90deg,#eee,#f5f5f5,#eee); animation: sh 1.2s infinite; border-radius:6px; }
      @keyframes sh { 0%{background-position:-150px 0} 100%{background-position:150px 0} }
      .pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .btn { padding:6px 10px; border:1px solid #ddd; background:#fff; border-radius:6px; }
      .btn[disabled]{ opacity:0.5; cursor:not-allowed; }
      .count { margin-left:auto; }
      .toast { padding:8px 10px; border-radius:6px; }
      .toast.error { background:#fee2e2; color:#7f1d1d; border:1px solid #fecaca; }
      .filters .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px; }
      .filters label { display:flex; align-items:center; gap:6px; }
      .titlebar { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
    </style>
  `;

  const sortableTh = (label, field, ariaSort, width) => {
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
      <div class="pager" id="agentClientsPagerInner" role="navigation" aria-label="Pagination">
        <label for="agentClientsPageSize" style="display:flex;align-items:center;gap:6px;">
          <span>Par page</span>
          <select id="agentClientsPageSize" class="page-size">
            <option value="50" ${state.page_size===50?"selected":""}>50</option>
            <option value="100" ${state.page_size===100?"selected":""}>100</option>
          </select>
        </label>
        <button class="btn" id="agentClientsPrev" ${!canPrev ? "disabled" : ""} aria-label="Page précédente">Précédent</button>
        <button class="btn" id="agentClientsNext" ${!canNext ? "disabled" : ""} aria-label="Page suivante">Suivant</button>
        <div class="count" aria-live="polite">${state.total ? `${start}–${end} sur ${state.total}` : "0 résultat"}</div>
      </div>
    `;
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

  const escapeAttr = escapeHtml;

  // ====== Render list ======
  const renderRows = () => {
    if (!state.items.length) {
      return `<tr><td colspan="6" style="padding:16px;color:#6b7280;">Aucun client trouvé.</td></tr>`;
    }
    const { field, dir } = state.sort;
    const collator = new Intl.Collator("fr", {
      sensitivity: "base",
      numeric: true,
    });
    const cmp = (a, b) => {
      const av = (a[field] ?? "").toString();
      const bv = (b[field] ?? "").toString();
      const base = collator.compare(av, bv);
      return dir === "asc" ? base : -base;
    };
    const sorted = stableSort(state.items, cmp);

    return sorted
      .map((c) => {
        const cid =
          c.id ?? c.client_id ?? c.clientID ?? c.pk ?? c.ID ?? null;

        const label =
          c.company ??
          c.company_name ??
          c.raison_sociale ??
          c.name ??
          "";

        const companyCell =
          cid != null
            ? `<a href="/agent/client/${encodeURIComponent(
                cid
              )}" class="client-link" title="Voir fiche client">${escapeHtml(
                label
              )}</a>`
            : `${escapeHtml(label)}`;

        const emailCell = c.email
          ? `<a href="mailto:${escapeAttr(c.email)}">${escapeHtml(
              c.email
            )}</a>`
          : "";
        const phoneCell = c.phone
          ? `<a href="tel:${escapeAttr(c.phone)}">${escapeHtml(
              c.phone
            )}</a>`
          : "";

        return `<tr role="row">
        <td>${companyCell}</td>
        <td>${escapeHtml(c.zipcode || c.postcode || c.zip || "")}</td>
        <td>${escapeHtml(c.city || "")}</td>
        <td>${emailCell}</td>
        <td>${phoneCell}</td>
        <td>${escapeHtml(c.groupement || c.group || "")}</td>
      </tr>`;
      })
      .join("");
  };

  const paint = () => {
    const rows = renderRows();
    elContainer.innerHTML = tableTemplate(rows, {
      [state.sort.field]: state.sort.dir,
    });

    // bind sort buttons
    $$(".th-sort", elContainer).forEach((btn) =>
      on(btn, "click", () => toggleSort(btn.dataset.field))
    );
    // keyboard sorting
    $$(".th-sort", elContainer).forEach((btn) =>
      on(btn, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort(btn.dataset.field);
        }
      })
    );
    // pager
    on($("#agentClientsPrev", elContainer), "click", () =>
      changePage(state.page - 1)
    );
    on($("#agentClientsNext", elContainer), "click", () =>
      changePage(state.page + 1)
    );
    on($("#agentClientsPageSize", elContainer), "change", (e) => {
      state.page_size = parseInt(e.target.value, 10) || 50;
      state.page = 1;
      fetchAndRender();
    });
  };

  const showLoading = () => {
    elContainer.innerHTML = tableTemplate(skeletonRows(8), {
      [state.sort.field]: state.sort.dir,
    });
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
    const maxPage = Math.max(
      1,
      Math.ceil(state.total / state.page_size)
    );
    if (p > maxPage) return;
    state.page = p;
    fetchAndRender();
  };

  // ====== Fetch data (liste clients) ======
  const fetchAndRender = async () => {
    if (state.abortCtrl) state.abortCtrl.abort();
    state.abortCtrl = new AbortController();

    showLoading();
    try {
      const qs = buildQS({
        search: state.search,
        page: state.page,
        page_size: state.page_size,
        sort: state.sort.field,
        dir: state.sort.dir,
      });

      const res = await fetch(`${API}/agent/clients${qs}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: state.abortCtrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.items = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total) || 0;
      state.page = Number(data.page) || 1;
      state.page_size = Number(data.page_size) || state.page_size;

      paint();

      // Après rafraîchissement, on affiche éventuellement le bandeau
      showClientCreatedBannerIfNeeded();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[agent_clients] fetch error:", err);
      showToast("Erreur lors du chargement des clients.", "error");
      elContainer.innerHTML = tableTemplate(
        `<tr><td colspan="6" style="padding:16px;color:#6b7280;">Impossible de charger les données.</td></tr>`
      );
    }
  };

  // ====== Fonction globale pour le popup "Nouveau client" ======
  window.reloadAgentClients = async function (overrides = {}) {
    if (overrides.search !== undefined) {
      state.search = (overrides.search || "").trim();
    }
    if (overrides.page_size) {
      state.page_size = parseInt(overrides.page_size, 10) || state.page_size;
    }
    if (overrides.page) {
      state.page = parseInt(overrides.page, 10) || 1;
    }
    return fetchAndRender();
  };

  // ====== Bind search ======
  if (elSearch) {
    on(
      elSearch,
      "input",
      debounce((e) => {
        state.search = (e.target.value || "").trim();
        state.page = 1;
        fetchAndRender();
      }, 300)
    );
  }
  if (elPageSize) {
    on(elPageSize, "change", (e) => {
      state.page_size = parseInt(e.target.value, 10) || 50;
      state.page = 1;
      fetchAndRender();
    });
  }

  // ====== Boot (simple liste, plus de hash-router) ======
  document.addEventListener("DOMContentLoaded", () => {
    // Affiche le bandeau si on revient après création
    showClientCreatedBannerIfNeeded();
    fetchAndRender();
  });
})();

// app/static/labo/pages/clients.js
(() => {
  "use strict";
  const VERSION = "labo_clients.js v2025-11-25-2";
  console.log("[labo_clients] Loaded", VERSION);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const t = (key, fallback) => {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
      if (typeof window.t === "function") {
        const v = window.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) {
      console.warn("[labo_clients] i18n error:", e);
    }
    return fallback || key;
  };

  const buildQS = (params = {}) =>
    "?" +
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  const debounce = (fn, ms = 300) => {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API_BASE = "/api-zenhub/labo";

  const authFetch = (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
    return fetch(url, { ...options, headers });
  };

  const state = {
    page: 1,
    pageSize: 50,
    search: "",
    sort: "name",
    direction: "asc",
    total: 0,
    loading: false,
    hasMore: true,
  };

  const renderRowsAppend = (items) => {
    const tbody = $("#clients-table-body");
    const emptyState = $("#clients-empty-state");
    if (!tbody) return;

    if (!items || items.length === 0) {
      if (tbody.children.length === 0 && emptyState) {
        emptyState.classList.remove("d-none");
      }
      return;
    }

    if (emptyState) emptyState.classList.add("d-none");

    const frag = document.createDocumentFragment();
    items.forEach((c) => {
      const tr = document.createElement("tr");

      const tdCode = document.createElement("td");
      tdCode.textContent = c.code_client || "";
      tr.appendChild(tdCode);

      const tdName = document.createElement("td");
      tdName.textContent = c.company_name || "";
      tr.appendChild(tdName);

      const tdCity = document.createElement("td");
      const city = (c.zip_code || "") + " " + (c.city || "");
      tdCity.textContent = city.trim();
      tr.appendChild(tdCity);

      const tdActions = document.createElement("td");
      tdActions.className = "text-end";
      const a = document.createElement("a");
      a.href = `/labo/clients/${c.id}`;
      a.className = "btn btn-sm btn-outline-primary";
      a.dataset.i18n = "labo.clients.view_details";
      a.textContent = t("labo.clients.view_details", "Voir détails");
      tdActions.appendChild(a);
      tr.appendChild(tdActions);

      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  };

  const setLoading = (isLoading) => {
    state.loading = isLoading;
    const el = $("#clients-loading");
    if (!el) return;
    el.classList.toggle("d-none", !isLoading);
  };

  const loadPage = () => {
    if (state.loading || !state.hasMore) return;

    setLoading(true);
    const params = {
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      sort: state.sort,
      direction: state.direction,
    };
    const url = `${API_BASE}/clients${buildQS(params)}`;
    // console.log("[labo_clients] Fetch", url);

    authFetch(url)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            console.error("[labo_clients] Unauthorized/Forbidden");
          }
          throw new Error("HTTP " + res.status);
        }
        return res.json();
      })
      .then((data) => {
        const items = data.items || [];
        state.total = data.total || 0;

        renderRowsAppend(items);

        const alreadyLoaded = state.page * state.pageSize;
        if (alreadyLoaded >= state.total || items.length < state.pageSize) {
          state.hasMore = false;
        } else {
          state.page += 1;
        }
      })
      .catch((err) => {
        console.error("[labo_clients] Error loading clients:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const resetAndReload = () => {
    const tbody = $("#clients-table-body");
    const emptyState = $("#clients-empty-state");
    if (tbody) tbody.innerHTML = "";
    if (emptyState) emptyState.classList.add("d-none");
    state.page = 1;
    state.hasMore = true;
    loadPage();
  };

  const initSortHandlers = () => {
    const sortSelect = $("#client-sort");
    if (sortSelect) {
      sortSelect.value = state.sort;
      on(
        sortSelect,
        "change",
        () => {
          state.sort = sortSelect.value || "name";
          resetAndReload();
        }
      );
    }

    // entêtes cliquables
    $$("#clients-table thead th.sortable").forEach((th) => {
      on(th, "click", () => {
        const field = th.dataset.sortField || "name";
        if (state.sort === field) {
          state.direction = state.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort = field;
          state.direction = "asc";
        }
        if (sortSelect) sortSelect.value = state.sort;
        resetAndReload();
      });
    });
  };

  const initScroll = () => {
    on(window, "scroll", () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      if (distanceFromBottom < 200) {
        loadPage();
      }
    });
  };

  const initSearch = () => {
    const input = $("#client-search");
    if (!input) return;
    on(
      input,
      "input",
      debounce(() => {
        state.search = input.value.trim();
        resetAndReload();
      }, 300)
    );
  };

  const init = () => {
    const root = $("#labo-clients-page");
    if (!root) return;
    initSearch();
    initSortHandlers();
    initScroll();
    resetAndReload();
  };

  document.addEventListener("DOMContentLoaded", init);
})();

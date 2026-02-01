// /static/agent/pages/orders/new/index.js

import { fetchClients, fetchLabos, fetchProducts, createOrder } from "./api.js";
import {
  debounce,
  renderClients,
  showPickedClient,
  renderLabosSelect,
  initCatalogTableIfNeeded,
  appendCatalog,
  clearCatalog,
  renderCart,
  toastOK,
  toastERR,
} from "./ui.js";

/* ============================================================
   STATE GLOBAL
   ============================================================ */
const state = {
  client: null,
  labo_id: null,

  productSearch: "",
  sort: "name",
  dir: "asc",

  offset: 0,
  limit: 50,

  loading: false,
  hasMore: true,
  total: null,

  cart: [],
};

let catalogIO = null;

/* ============================================================
   LOG INTELLIGENT
   ============================================================ */
function logCatalog(msg, extra = {}) {
  console.log(
    `%c[CATALOG] ${msg}`,
    "color:#2563eb;font-weight:600;",
    {
      labo_id: state.labo_id,
      offset: state.offset,
      limit: state.limit,
      sort: `${state.sort}:${state.dir}`,
      hasMore: state.hasMore,
      loading: state.loading,
      ...extra,
    }
  );
}

/* ============================================================
   INIT CLIENTS
   ============================================================ */
async function initClientsUI() {
  const input = document.getElementById("client-search");
  const results = document.getElementById("client-results");

  input.addEventListener(
    "input",
    debounce(async () => {
      const s = input.value.trim();
      try {
        const data = await fetchClients({ search: s });
        renderClients(data, (c) => {
          state.client = c;
          showPickedClient(c, () => {
            state.client = null;
            results.style.display = "block";
            input.disabled = false;
            input.value = "";
          });
        });
      } catch (e) {
        results.innerHTML = `<div style="color:#b91c1c;">${e.message}</div>`;
      }
    }, 300)
  );
}

/* ============================================================
   INIT LABOS
   ============================================================ */
async function initLabosUI() {
  const sel = document.getElementById("labo-select");
  const labos = await fetchLabos();
  renderLabosSelect(labos, null);

  sel.addEventListener("change", () => {
    state.labo_id = sel.value ? Number(sel.value) : null;
    resetCatalog();
    loadProducts({ reset: true });
  });
}

/* ============================================================
   CATALOG RESET / IO
   ============================================================ */
function resetCatalog() {
  state.offset = 0;
  state.hasMore = true;
  state.total = null;

  initCatalogTableIfNeeded();
  clearCatalog();

  disconnectCatalogIO();
  setupCatalogInfiniteScroll();

  logCatalog("Reset catalogue");
}

function disconnectCatalogIO() {
  if (catalogIO) {
    catalogIO.disconnect();
    catalogIO = null;
  }
}

function setupCatalogInfiniteScroll() {
  const container = document.getElementById("catalog-table");
  if (!container) return;

  let sentinel = container.querySelector("#catalog-sentinel");
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.id = "catalog-sentinel";
    sentinel.style.height = "1px";
    container.appendChild(sentinel);
  }

  catalogIO = new IntersectionObserver(
    async ([entry]) => {
      if (!entry.isIntersecting) return;
      if (state.loading || !state.hasMore || !state.labo_id) return;

      state.offset += state.limit;
      logCatalog("Scroll → chargement page suivante");

      await loadProducts({ reset: false });
    },
    {
      root: container,
      rootMargin: "600px",
      threshold: 0,
    }
  );

  catalogIO.observe(sentinel);
}

/* ============================================================
   LOAD PRODUCTS
   ============================================================ */
async function loadProducts({ reset = false } = {}) {
  if (!state.labo_id || state.loading) return;

  const loader = document.getElementById("catalog-loader");
  loader.style.display = "block";
  state.loading = true;

  try {
    const data = await fetchProducts({
      labo_id: state.labo_id,
      search: state.productSearch,
      offset: state.offset,
      limit: state.limit,
      sort: state.sort,
      dir: state.dir,
    });

    state.total = data.total;

    appendCatalog(data.items, {
      replace: reset,
      onAdd: (line) => {
        const idx = state.cart.findIndex(
          (l) => l.product_id === line.product_id
        );
        if (idx >= 0) state.cart[idx].qty += line.qty;
        else state.cart.push(line);

        renderCart(state.cart, onQty, onRemove);
        persistCart();
      },
    });

    if (data.items.length < state.limit) {
      state.hasMore = false;
      disconnectCatalogIO();
    }

    logCatalog("Produits chargés", {
      received: data.items.length,
      total: data.total,
    });
  } catch (e) {
    toastERR(e.message);
  } finally {
    loader.style.display = "none";
    state.loading = false;
  }
}

/* ============================================================
   TRI + SEARCH
   ============================================================ */
function initCatalogSearchAndSort() {
  const input = document.getElementById("product-search");
  const sortSel = document.getElementById("product-sort");

  input.addEventListener(
    "input",
    debounce(() => {
      state.productSearch = input.value.trim();
      resetCatalog();
      loadProducts({ reset: true });
    }, 300)
  );

  sortSel.addEventListener("change", () => {
    const [s, d] = sortSel.value.split(":");
    state.sort = s;
    state.dir = d;

    resetCatalog();
    loadProducts({ reset: true });
  });
}

/* ============================================================
   PANIER
   ============================================================ */
function onQty(idx, qty) {
  state.cart[idx].qty = qty;
  renderCart(state.cart, onQty, onRemove);
  persistCart();
}

function onRemove(idx) {
  state.cart.splice(idx, 1);
  renderCart(state.cart, onQty, onRemove);
  persistCart();
}

function persistCart() {
  sessionStorage.setItem("new_order_cart", JSON.stringify(state.cart));
}

function loadCart() {
  try {
    const raw = sessionStorage.getItem("new_order_cart");
    if (raw) state.cart = JSON.parse(raw);
  } catch {}
}

/* ============================================================
   SUBMIT
   ============================================================ */
function initSubmit() {
  document.getElementById("btn-submit").addEventListener("click", async () => {
    if (!state.client) return toastERR("Sélectionne un client");
    if (!state.labo_id) return toastERR("Sélectionne un labo");
    if (!state.cart.length) return toastERR("Panier vide");

    try {
      await createOrder({
        client_id: state.client.id,
        labo_id: state.labo_id,
        items: state.cart,
        delivery_date: document.getElementById("delivery-date").value,
        payment_method: document.getElementById("payment-method").value,
        comment: document.getElementById("order-comment").value,
      });

      toastOK("Commande créée");
      state.cart = [];
      persistCart();
      renderCart(state.cart, onQty, onRemove);
    } catch (e) {
      toastERR(e.message);
    }
  });
}

/* ============================================================
   MAIN
   ============================================================ */
async function main() {
  loadCart();
  renderCart(state.cart, onQty, onRemove);

  await initClientsUI();
  await initLabosUI();
  initCatalogTableIfNeeded();
  setupCatalogInfiniteScroll();
  initCatalogSearchAndSort();
  initSubmit();
}

main();

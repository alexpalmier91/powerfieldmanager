// app/static/labo/products.js

const API_BASE = "/api-zenhub/labo/products";

const state = {
  page: 1,
  pageSize: 20,
  search: "",
  loading: false,
  hasMore: true,

  // Tri par défaut : SKU ASC
  sortBy: "sku", // "sku" | "name" | "stock"
  sortDir: "asc",
};

const tbody = document.getElementById("products-tbody");
const rowEmpty = document.getElementById("row-empty");
const searchInput = document.getElementById("search-input");
const btnExport = document.getElementById("btn-export");

const HAS_PRODUCTS_TABLE = !!tbody;

// Tiers modal
const tiersModal = document.getElementById("tiers-modal");
const tiersProductName = document.getElementById("tiers-product-name");
const tiersClose = document.getElementById("tiers-close");
const tiersTbody = document.getElementById("tiers-tbody");
const tiersEmpty = document.getElementById("tiers-empty");
const tiersForm = document.getElementById("tiers-form");
const tierMinQtyInput = document.getElementById("tier-min-qty");
const tierPriceHtInput = document.getElementById("tier-price-ht");

let currentTiersProductId = null;
let currentTiersProductLabel = "";

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

function showToast(type, message) {
  if (window.ZenToast && typeof window.ZenToast[type] === "function") {
    window.ZenToast[type](message);
    return;
  }
  if (type === "error") {
    console.error(message);
  } else {
    console.log(message);
  }
}

// ============================
//   Chargement produits (infinite scroll + tri serveur)
// ============================

async function fetchProducts({ append = false } = {}) {
  if (!HAS_PRODUCTS_TABLE) return;
  if (state.loading) return;

  if (!append) {
    state.page = 1;
    state.hasMore = true;
    if (tbody) {
      tbody.innerHTML = "";
    }
    if (rowEmpty) rowEmpty.classList.add("hidden");
  }

  if (!state.hasMore) return;

  state.loading = true;

  const params = new URLSearchParams();
  params.set("page", state.page);
  params.set("page_size", state.pageSize);
  if (state.search) params.set("search", state.search);
  if (state.sortBy) params.set("sort_by", state.sortBy);
  if (state.sortDir) params.set("sort_dir", state.sortDir);

  try {
    const res = await authFetch(`${API_BASE}?${params.toString()}`);

    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur chargement produits:", txt);
      state.loading = false;
      return;
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : [];

    if (!items.length && !append) {
      if (rowEmpty) {
        rowEmpty.classList.remove("hidden");
        tbody.appendChild(rowEmpty);
      }
      state.hasMore = false;
      state.loading = false;
      return;
    }

    items.forEach(renderProductRow);

    if (items.length < state.pageSize) {
      state.hasMore = false;
    }

    state.loading = false;
  } catch (err) {
    console.error("Erreur fetchProducts:", err);
    state.loading = false;
  }
}

// Recharge le listing en gardant la position de scroll
async function reloadProductsKeepingScroll() {
  const scrollY = window.scrollY || window.pageYOffset || 0;
  await fetchProducts({ append: false });
  window.scrollTo(0, scrollY);
}

function renderProductRow(p) {
  const v0 = (p.variants && p.variants[0]) || {};
  const price = p.price_ht ?? v0.price_ht ?? "";
  const stock = p.stock ?? v0.stock ?? "";

  const isActive =
    typeof p.is_active === "boolean"
      ? p.is_active
      : true;

  const imgUrl = p.image_url || null;

  let commission = 0;
  if (typeof p.commission === "number") {
    commission = p.commission;
  } else if (p.commission != null) {
    const parsed = parseFloat(p.commission);
    commission = Number.isNaN(parsed) ? 0 : parsed;
  }

  const tiersCount = typeof p.tiers_count === "number" ? p.tiers_count : 0;
  const tiers = Array.isArray(p.tiers) ? p.tiers : [];

  const tr = document.createElement("tr");
  tr.dataset.productId = p.id;
  tr.innerHTML = `
    <td class="col-thumb">
      ${
        imgUrl
          ? `<img src="${imgUrl}" alt="${p.name || ""}" class="product-thumb"/>`
          : `<div class="product-thumb placeholder"></div>`
      }
    </td>
    <td>${p.id}</td>
    <td>
      <a href="/labo/products/${p.id}/stats" class="sku-link">
        ${p.sku}
      </a>
    </td>
    <td>${p.name}</td>

    <!-- Prix HT seul -->
    <td class="price-cell">
      <div class="base-price">${price}</div>
    </td>

    <!-- 👉 Colonne Tiers price (liste + bouton) -->
    <td class="tiers-cell" data-tiers-count="${tiersCount}">
      ${
        tiers.length
          ? `<div class="tiers-list">
              ${tiers
                .map(
                  (t) =>
                    `<div class="tiers-line">≥ ${t.min_qty} : ${t.price_ht}</div>`
                )
                .join("")}
            </div>`
          : ""
      }
      <button class="btn-tiers btn btn-light">Tiers</button>
    </td>

    <td class="commission-cell" data-original-commission="${commission.toFixed(2)}">
      <span class="commission-display" style="cursor:pointer;">
        ${commission.toFixed(2)} %
      </span>
      <input
        type="number"
        class="commission-input"
        min="0"
        max="100"
        step="0.01"
        value="${commission.toFixed(2)}"
        style="width: 80px; display:none;"
      />
    </td>

    <td>${stock}</td>
    <td>${renderVariantsCell(p.variants)}</td>
    <td>${renderActiveCell(isActive)}</td>
  `;
  tbody.appendChild(tr);
}


function renderVariantsCell(variants) {
  if (!variants || variants.length === 0) return "-";
  return variants
    .map(
      (v) =>
        `<div class="variant">
          <div>EAN: ${v.ean13 || "-"}</div>
          <div>Prix HT: ${v.price_ht}</div>
          <div>Stock: ${v.stock}</div>
        </div>`
    )
    .join("");
}

function renderActiveCell(isActive) {
  const label = isActive ? "ON" : "OFF";
  const cls = isActive ? "toggle toggle-on" : "toggle toggle-off";
  return `<button class="${cls}">${label}</button>`;
}

// ============================
//   Edition commission inline
// ============================

async function saveCommission(inputEl) {
  const cell = inputEl.closest(".commission-cell");
  const tr = inputEl.closest("tr");
  if (!cell || !tr) return;

  const span = cell.querySelector(".commission-display");
  const productId = tr.dataset.productId;

  let newVal = parseFloat(inputEl.value);
  if (Number.isNaN(newVal)) {
    const original = parseFloat(cell.dataset.originalCommission || "0") || 0;
    inputEl.value = original.toFixed(2);
    inputEl.style.display = "none";
    if (span) span.style.display = "";
    return;
  }

  if (newVal < 0) newVal = 0;
  if (newVal > 100) newVal = 100;
  inputEl.value = newVal.toFixed(2);

  try {
    const res = await authFetch(`${API_BASE}/${productId}/commission`, {
      method: "PATCH",
      body: JSON.stringify({ commission: newVal }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur MAJ commission:", txt);
      const original = parseFloat(cell.dataset.originalCommission || "0") || 0;
      inputEl.value = original.toFixed(2);
      if (span) span.textContent = `${original.toFixed(2)} %`;
      showToast("error", "Erreur lors de la mise à jour de la commission.");
    } else {
      const data = await res.json();
      const updatedVal = parseFloat(data.commission ?? newVal) || 0;
      cell.dataset.originalCommission = updatedVal.toFixed(2);
      if (span) span.textContent = `${updatedVal.toFixed(2)} %`;
      showToast("success", "Commission mise à jour.");
    }
  } catch (err) {
    console.error("Erreur réseau MAJ commission:", err);
    const original = parseFloat(cell.dataset.originalCommission || "0") || 0;
    inputEl.value = original.toFixed(2);
    if (span) span.textContent = `${original.toFixed(2)} %`;
    showToast("error", "Erreur lors de la mise à jour de la commission.");
  }

  inputEl.style.display = "none";
  if (span) span.style.display = "";
}

// ============================
//   Events lignes tableau (délégation)
// ============================

function setupTableEvents() {
  if (!tbody) return;

  tbody.addEventListener("click", async (e) => {
    const target = e.target;

    // toggle actif
    if (target.classList.contains("toggle")) {
      const tr = target.closest("tr");
      const productId = tr.dataset.productId;
      try {
        const res = await authFetch(`${API_BASE}/${productId}/toggle-active`, {
          method: "POST",
        });
        if (!res.ok) {
          console.error("Erreur toggle:", await res.text());
          showToast("error", "Erreur lors du changement de statut actif.");
          return;
        }
        const data = await res.json();
        target.textContent = data.is_active ? "ON" : "OFF";
        target.className = data.is_active
          ? "toggle toggle-on"
          : "toggle toggle-off";
      } catch (err) {
        console.error("Erreur toggle actif:", err);
        showToast("error", "Erreur lors du changement de statut actif.");
      }
      return;
    }

    // clic sur le texte de commission → entrée en édition
    if (target.classList.contains("commission-display")) {
      const cell = target.closest(".commission-cell");
      if (!cell) return;
      const input = cell.querySelector(".commission-input");
      if (!input) return;
      target.style.display = "none";
      input.style.display = "inline-block";
      input.focus();
      input.select();
      return;
    }

    // bouton Tiers
    if (target.classList.contains("btn-tiers")) {
      const tr = target.closest("tr");
      const productId = tr.dataset.productId;
      const name = tr.children[3].textContent; // 0 vignette, 1 id, 2 sku, 3 nom
      currentTiersProductId = productId;
      currentTiersProductLabel = `${productId} – ${name}`;
      if (tiersProductName) tiersProductName.textContent = currentTiersProductLabel;

      if (tierMinQtyInput) tierMinQtyInput.value = "";
      if (tierPriceHtInput) tierPriceHtInput.value = "";

      await fetchTiers(productId);
      openTiersModal();
      return;
    }
  });

  tbody.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!target.classList.contains("commission-input")) return;

    if (e.key === "Enter") {
      e.preventDefault();
      target.blur();
    } else if (e.key === "Escape") {
      const cell = target.closest(".commission-cell");
      const span = cell ? cell.querySelector(".commission-display") : null;
      const original = cell
        ? parseFloat(cell.dataset.originalCommission || "0") || 0
        : 0;
      target.value = original.toFixed(2);
      target.style.display = "none";
      if (span) span.style.display = "";
    }
  });

  tbody.addEventListener(
    "blur",
    (e) => {
      const target = e.target;
      if (!target.classList.contains("commission-input")) return;
      saveCommission(target);
    },
    true
  );
}

// ============================
//   Tri sur les colonnes (serveur)
// ============================

function setupSortEvents() {
  const headers = document.querySelectorAll("th.sortable");
  headers.forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const sortKey = th.dataset.sort;
      if (!sortKey) return;

      if (state.sortBy === sortKey) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortBy = sortKey;
        state.sortDir = "asc";
      }

      state.page = 1;
      fetchProducts({ append: false });
    });
  });
}

// ============================
//   Search + export
// ============================

if (searchInput) {
  searchInput.addEventListener(
    "input",
    debounce(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      fetchProducts({ append: false });
    }, 300)
  );
}

if (btnExport) {
  btnExport.addEventListener("click", () => {
    window.location.href = `${API_BASE}/export`;
  });
}

// ============================
//   Tiers modal
// ============================

function openTiersModal() {
  if (!tiersModal) return;
  tiersModal.classList.remove("hidden");
  tiersModal.style.display = "flex";
}

function closeTiersModal() {
  if (!tiersModal) return;
  tiersModal.classList.add("hidden");
  tiersModal.style.display = "none";
  // Reload listing en gardant la position
  reloadProductsKeepingScroll();
}

if (tiersClose) {
  tiersClose.addEventListener("click", () => closeTiersModal());
}

if (tiersModal) {
  tiersModal.addEventListener("click", (e) => {
    if (e.target === tiersModal) {
      closeTiersModal();
    }
  });
}

async function fetchTiers(productId) {
  try {
    const res = await authFetch(`${API_BASE}/${productId}/tiers`);
    if (!res.ok) {
      console.error("Erreur chargement tiers:", await res.text());
      return;
    }
    const tiers = await res.json();
    renderTiers(tiers);
  } catch (err) {
    console.error("Erreur fetchTiers:", err);
  }
}

function renderTiers(tiers) {
  if (!tiersTbody) return;
  tiersTbody.innerHTML = "";
  if (!tiers || tiers.length === 0) {
    if (tiersEmpty) {
      tiersEmpty.classList.remove("hidden");
      tiersTbody.appendChild(tiersEmpty);
    }
    return;
  }
  if (tiersEmpty) tiersEmpty.classList.add("hidden");

  tiers.forEach((t) => {
    const tr = document.createElement("tr");
    tr.dataset.tierId = t.id;
    tr.innerHTML = `
      <td>${t.min_qty}</td>
      <td>${t.price_ht}</td>
      <td>
        <button class="btn-del-tier btn btn-danger">Supprimer</button>
      </td>
    `;
    tiersTbody.appendChild(tr);
  });

  bindTiersEvents();
}

function bindTiersEvents() {
  if (!tiersTbody) return;

  tiersTbody.querySelectorAll(".btn-del-tier").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const tierId = tr.dataset.tierId;
      if (!confirm("Supprimer ce palier ?")) return;

      try {
        const res = await authFetch(
          `${API_BASE}/${currentTiersProductId}/tiers/${tierId}`,
          {
            method: "DELETE",
          }
        );
        if (!res.ok) {
          console.error("Erreur suppression tier:", await res.text());
          return;
        }
        await fetchTiers(currentTiersProductId);
      } catch (err) {
        console.error("Erreur delete tier:", err);
      }
    });
  });
}

// ➜ Formulaire d’ajout de palier
if (tiersForm) {
  tiersForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentTiersProductId) return;

    const minQty = parseInt(tierMinQtyInput.value, 10);
    const priceHt = parseFloat(tierPriceHtInput.value);

    if (!minQty || Number.isNaN(priceHt)) {
      showToast("error", "Veuillez saisir une quantité et un prix valides.");
      return;
    }

    const payload = {
      id: null,
      min_qty: minQty,
      price_ht: priceHt,
    };

    try {
      const res = await authFetch(
        `${API_BASE}/${currentTiersProductId}/tiers`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        console.error("Erreur sauvegarde tier:", await res.text());
        showToast("error", "Erreur lors de l'ajout du palier.");
        return;
      }

      await fetchTiers(currentTiersProductId);

      // reset des champs
      tierMinQtyInput.value = "";
      tierPriceHtInput.value = "";

      showToast("success", "Palier ajouté.");
    } catch (err) {
      console.error("Erreur submit tiers:", err);
      showToast("error", "Erreur lors de l'ajout du palier.");
    }
  });
}

// ============================
//   Infinite scroll
// ============================

function setupInfiniteScroll() {
  window.addEventListener("scroll", () => {
    if (!HAS_PRODUCTS_TABLE) return;
    if (!state.hasMore || state.loading) return;

    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.offsetHeight;

    if (scrollBottom >= docHeight - 300) {
      state.page += 1;
      fetchProducts({ append: true });
    }
  });
}

// ============================
//   Initialisation
// ============================

document.addEventListener("DOMContentLoaded", () => {
  if (!HAS_PRODUCTS_TABLE) return;

  setupTableEvents();
  setupSortEvents();
  setupInfiniteScroll();

  // premier chargement : sorted SKU ASC via l'API
  fetchProducts({ append: false });
});

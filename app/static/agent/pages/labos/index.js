// app/static/agent/pages/labos/index.js
import { fetchLabos, fetchCatalogue, exportCsv } from "./api.js?v=5";
import {
  pickEls,
  applyParamsToForm,
  collectParams,
  renderLabosSelect,
  clearRows,
  appendRows,
  setSkeleton,
  setEmpty,
  updateSortIndicators,
  bindSort,
} from "./ui.js?v=5";


const STATE = {
  laboId: null,
  page: 1,
  pageSize: 25,
  sort: "sku",
  dir: "asc",
  search: "",
  loading: false,
  hasMore: true,
};

let infiniteScrollBound = false;

function paramsFromState() {
  return {
    labo_id: STATE.laboId,
    page: String(STATE.page),
    page_size: String(STATE.pageSize),
    sort: STATE.sort,
    dir: STATE.dir,
    search: STATE.search,
  };
}

async function loadPage(els, { append = false } = {}) {
  if (!STATE.laboId) {
    clearRows(els.tbody);
    els.total.textContent = "0";
    setEmpty(els, false);
    return;
  }
  if (STATE.loading) return;

  if (!append) {
    STATE.page = 1;
    STATE.hasMore = true;
    clearRows(els.tbody);
  }
  if (!STATE.hasMore) return;

  STATE.loading = true;
  setSkeleton(els, true);

  try {
    const data = await fetchCatalogue(paramsFromState());
    const items = data.items || [];

    if (!items.length && !append) {
      setEmpty(els, true);
      els.total.textContent = "0";
    } else {
      setEmpty(els, false);
      appendRows(els.tbody, items);
      els.total.textContent = String(data.total ?? 0);
    }

    if (items.length < STATE.pageSize) {
      STATE.hasMore = false;
    }
  } catch (e) {
    console.error(e);
    alert("Erreur lors du chargement du catalogue. Voir console.");
  } finally {
    STATE.loading = false;
    setSkeleton(els, false);
  }
}

function setupInfiniteScroll(els) {
  if (infiniteScrollBound) return;
  infiniteScrollBound = true;

  // Sentinel à la fin du tableau
  let sentinel = document.querySelector("#catalogSentinel");
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.id = "catalogSentinel";
    sentinel.style.height = "1px";
    sentinel.style.width = "100%";
    els.tbody.parentElement?.appendChild(sentinel); // tbody -> table -> wrapper, selon ton HTML
    // Si ça ne marche pas, mets plutôt sentinel juste après la table dans le template.
  }

  // IMPORTANT: si ton scroll est dans un conteneur, mets-le ici :
  // const root = document.querySelector(".dashboard-content"); // exemple
  const root = null; // window par défaut

  const io = new IntersectionObserver(async (entries) => {
    const e = entries[0];
    if (!e.isIntersecting) return;
    if (!STATE.laboId) return;
    if (STATE.loading || !STATE.hasMore) return;

    STATE.page += 1;
    await loadPage(els, { append: true });
  }, { root, rootMargin: "600px 0px 600px 0px", threshold: 0 });

  io.observe(sentinel);
}

async function boot() {
  const els = pickEls();

  // valeurs de base sur le formulaire
  applyParamsToForm({
    page: "1",
    page_size: "25",
    sort: "sku",
    dir: "asc",
  });

  const labos = await fetchLabos();
  renderLabosSelect(els.selLabo, labos.items || [], null);

  const items = labos.items || [];
  if (items.length === 1) {
    STATE.laboId = items[0].id;
    els.selLabo.value = String(STATE.laboId);
  }

  if (!els.form.dataset.bound) {
    // changement de labo
    els.selLabo.addEventListener("change", () => {
      const p = collectParams(els);
      STATE.laboId = els.selLabo.value ? Number(els.selLabo.value) : null;
      STATE.pageSize = Number(p.page_size || 25);
      STATE.search = p.search || "";
      STATE.page = 1;
      STATE.hasMore = true;
      loadPage(els, { append: false });
    });

    // submit filtres
    els.form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const p = collectParams(els);
      STATE.pageSize = Number(p.page_size || 25);
      STATE.sort = p.sort || "sku";
      STATE.dir = p.dir || "asc";
      STATE.search = p.search || "";
      STATE.page = 1;
      STATE.hasMore = true;
      loadPage(els, { append: false });
    });

    // recherche live
    const searchInput = document.querySelector("#filter_search");
    if (searchInput) {
      let timer = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const p = collectParams(els);
          STATE.search = p.search || "";
          STATE.page = 1;
          STATE.hasMore = true;
          loadPage(els, { append: false });
        }, 300);
      });
    }

    // export CSV
    els.exportBtn.addEventListener("click", () => {
      const p = collectParams(els);
      if (!els.selLabo.value) {
        alert("Sélectionne un labo d'abord.");
        return;
      }
      p.labo_id = els.selLabo.value;
      exportCsv(p);
    });

    // tri colonnes
    bindSort(els.thead, (key) => {
      STATE.sort = key;
      STATE.dir = STATE.dir === "asc" ? "desc" : "asc";
      updateSortIndicators(els.thead, STATE.sort, STATE.dir);
      const p = collectParams(els);
      STATE.pageSize = Number(p.page_size || 25);
      STATE.search = p.search || "";
      STATE.page = 1;
      STATE.hasMore = true;
      loadPage(els, { append: false });
    });

    els.form.dataset.bound = "1";
  }

  updateSortIndicators(els.thead, STATE.sort, STATE.dir);
  setupInfiniteScroll(els);

  if (STATE.laboId) {
    await loadPage(els, { append: false });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
});

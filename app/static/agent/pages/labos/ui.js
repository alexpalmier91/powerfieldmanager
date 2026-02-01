console.log("[LABOS_UI] ui.js chargé ✅ v5");
window.__LABOS_UI_V = "v5";

// app/static/agent/pages/labos/ui.js
export const qs  = (sel, ctx=document) => ctx.querySelector(sel);
export const qsa = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

export function pickEls() {
  return {
    selLabo: qs("#agentLaboSelect"),
    form: qs("#catalogFilters"),
    tbody: qs("#catalogBody"),
    thead: qs("#catalogHead"),
    pager: qs("#catalogPager"),
    total: qs("#totalCount"),
    exportBtn: qs("#exportCsvBtn"),
    skeleton: qs("#skeleton"),
    empty: qs("#emptyState"),
  };
}

export function applyParamsToForm(p) {
  qs("#filter_search").value = p.search || "";
  qs("#filter_sku").value = p.sku || "";
  qs("#filter_ean").value = p.ean || "";
  qs("#filter_min_price").value = p.min_price || "";
  qs("#filter_max_price").value = p.max_price || "";
  qs("#filter_page_size").value = p.page_size || "25";
  qs("#filter_sort").value = p.sort || "sku";
  qs("#filter_dir").value = p.dir || "asc";
  qs("#filter_in_stock").checked = (p.in_stock === "true");
  if (p.page) qs("#filter_page").value = p.page;
}

export function collectParams(els) {
  const f = new FormData(els.form);
  const o = Object.fromEntries(f.entries());
  o.in_stock = qs("#filter_in_stock").checked ? "true" : "";
  o.labo_id = els.selLabo.value || "";
  o.page = o.page || "1";
  o.page_size = o.page_size || "25";
  o.sort = o.sort || "sku";
  o.dir = o.dir || "asc";

  // le champ de recherche est lu directement dans le DOM
  o.search = qs("#filter_search")?.value || "";
  return o;
}

export function renderLabosSelect(el, items, selectedId) {
  el.innerHTML =
    `<option value="">-- Sélectionner un labo --</option>` +
    (items || [])
      .map(it => `<option value="${it.id}">${it.name || ("Labo " + it.id)}</option>`)
      .join("");
  if (selectedId) el.value = String(selectedId);
}

function formatPrice(v) {
  const n = Number(v ?? 0);
  return n.toFixed(2).replace(".", ",") + " €";
}

function formatCommission(v) {
  const n = Number(v ?? 0);
  return n.toFixed(2).replace(".", ",") + " %";
}

function renderTiers(tiers) {
  if (!tiers || !tiers.length) {
    return `<span class="tiers-badge tiers-none">Aucun palier</span>`;
  }
  return tiers
    .map(t => {
      const qty = t.min_qty ?? t.qty_min;
      const price = formatPrice(t.price_ht);
      return `<span class="tiers-badge">≥ ${qty} → ${price}</span>`;
    })
    .join("");
}

function renderStockDot(stock) {
  const s = Number(stock ?? 0);
  const cls = s > 0 ? "stock-dot stock-ok" : "stock-dot stock-ko";
  const title = s > 0 ? "En stock" : "Rupture";
  return `<span class="${cls}" title="${title}" aria-label="${title}"></span>`;
}


function rowHtml(p) {
  const imgHtml = p.image_url
    ? `<img src="${p.image_url}"
             alt="${(p.name || p.sku || "").replace(/"/g, "&quot;")}"
             class="product-thumb"
             loading="lazy"
             onerror="this.style.display='none';" />`
    : `<div class="product-thumb placeholder"></div>`;

  const price = formatPrice(p.price_ht);
  const stock = Number(p.stock ?? p.stock_qty ?? 0);
  const commission = formatCommission(p.commission);
  const tiersHtml = renderTiers(p.tiers);

  return `
    <tr>
      <td class="thumb-cell">${imgHtml}</td>
      <td class="sku-cell">${p.sku ?? ""}</td>
      <td class="ean-cell">${p.ean13 ?? ""}</td>
      <td class="name-cell">${p.name ?? ""}</td>
      <td class="num price-cell">${price}</td>
      <td class="num commission-cell">
        <span class="commission-badge">${commission}</span>
      </td>
      <td class="tiers-cell">
        ${tiersHtml}
      </td>
      <td class="stock-cell text-end">${renderStockDot(stock)}</td>
    </tr>
  `;
}

/**
 * Première page : on remplace tout le tbody.
 */
export function renderRows(tbody, items) {
  tbody.innerHTML = (items || []).map(rowHtml).join("");
}

/**
 * Fonction attendue par index.js pour vider le listing
 * (nouvelle recherche / changement de labo).
 */
export function clearRows(tbody) {
  if (!tbody) return;
  tbody.innerHTML = "";
}

/**
 * Infinite scroll : on ajoute les lignes à la suite.
 */
export function appendRows(tbody, items) {
  if (!items || !items.length) return;
  const frag = document.createDocumentFragment();
  const tmp = document.createElement("tbody");
  tmp.innerHTML = items.map(rowHtml).join("");
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  tbody.appendChild(frag);
}

export function renderPager(pager, total, page, page_size, onGoto) {
  const pages = Math.max(1, Math.ceil((total || 0) / (page_size || 25)));
  pager.innerHTML = "";

  const mk = (label, target, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn btn-sm btn-outline-secondary";
    b.disabled = !!disabled;
    b.addEventListener("click", () => onGoto(target));
    return b;
  };

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pages;
  pager.append(mk("«", 1, prevDisabled));
  pager.append(mk("‹", Math.max(1, page - 1), prevDisabled));

  const info = document.createElement("span");
  info.className = "pager-info";
  info.setAttribute("aria-live", "polite");
  info.textContent = `Page ${page}/${pages} — ${total} produits`;
  pager.append(info);

  pager.append(mk("›", Math.min(pages, page + 1), nextDisabled));
  pager.append(mk("»", pages, nextDisabled));
}

export function setSkeleton(els, show) {
  els.skeleton.style.display = show ? "block" : "none";
}
export function setEmpty(els, show) {
  els.empty.style.display = show ? "block" : "none";
}

export function updateSortIndicators(thead, sort, dir) {
  qsa("th[data-sort]", thead).forEach(th => {
    const key = th.getAttribute("data-sort");
    th.dataset.dir = (key === sort) ? dir : "";
    th.tabIndex = 0;
  });
}

export function bindSort(thead, onToggle) {
  qsa("th[data-sort]", thead).forEach(th => {
    const key = th.getAttribute("data-sort");
    th.addEventListener("click", () => onToggle(key));
    th.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onToggle(key);
      }
    });
  });
}

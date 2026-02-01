// /static/agent/pages/orders/new/ui.js

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Formatage pourcentage : 10 -> "10%", 7.5 -> "7,5%" */
function formatPercent(val) {
  const n = Number(val);
  if (!isFinite(n)) return "—";
  if (Number.isInteger(n)) return `${n}%`;
  return `${n.toString().replace(".", ",")}%`;
}

/** Formatage quantité palier : 24 -> ">24" */
function formatTierQty(minQty) {
  const n = Number(minQty);
  if (!isFinite(n)) return "?";
  return `>${n}`;
}

/** Récupère le meilleur prix palier pour une quantité donnée */
function getTierPriceForQty(tiers, qty, fallbackPrice) {
  const q = Number(qty);
  if (!Array.isArray(tiers) || !tiers.length || !isFinite(q) || q <= 0) {
    return Number(fallbackPrice || 0);
  }

  let best = null;

  tiers.forEach((t) => {
    const min = t.min_qty ?? t.qty_min ?? t.min ?? t.from_qty ?? t.qty ?? null;
    if (min == null) return;

    const minNum = Number(min);
    if (!isFinite(minNum) || q < minNum) return;

    const price =
      t.price_ht ??
      t.unit_price_ht ??
      t.price ??
      t.unit_price ??
      t.value ??
      null;

    const priceNum = Number(price);
    if (!isFinite(priceNum)) return;

    if (!best || minNum > best.min_qty) {
      best = { min_qty: minNum, price_ht: priceNum };
    }
  });

  if (!best) return Number(fallbackPrice || 0);
  return best.price_ht;
}

export function renderClients(results, onPick) {
  const wrap = document.getElementById("client-results");
  wrap.innerHTML = "";
  const items = results?.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div style="opacity:.7;">Aucun client</div>`;
    return;
  }
  items.forEach((c) => {
    const row = document.createElement("div");
    row.className = "client-row";
    row.style.cssText =
      "padding:6px;border:1px solid #eee;border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;";
    row.innerHTML = `
      <div>
        <div><strong>${c.company || c.company_name || ""}</strong></div>
        <div style="opacity:.7;">${c.zipcode || c.postcode || ""} ${c.city || ""}</div>
      </div>
      <button class="btn-pick">Sélectionner</button>
    `;
    row.querySelector(".btn-pick").addEventListener("click", () => onPick(c));
    wrap.appendChild(row);
  });
}

export function showPickedClient(client, onClear) {
  const picked = document.getElementById("client-picked");
  const results = document.getElementById("client-results");
  const input = document.getElementById("client-search");
  picked.style.display = "block";
  results.style.display = "none";
  input.disabled = true;
  const label = client.company || client.company_name || `(client #${client.id})`;
  const zip = client.zipcode || client.postcode || "";
  picked.innerHTML = `
    <div style="padding:8px;border:1px solid #e5e7eb;border-radius:6px;display:flex;justify-content:space-between;gap:8px;">
      <div>
        <div><strong>${label}</strong></div>
        <div style="opacity:.7;">${zip} ${client.city || ""}</div>
      </div>
      <button id="clear-client">Changer</button>
    </div>
  `;
  picked.querySelector("#clear-client").addEventListener("click", onClear);
}

export function renderLabosSelect(data, selectedId) {
  const sel = document.getElementById("labo-select");
  const list = Array.isArray(data) ? data : data?.items || [];
  sel.innerHTML =
    `<option value="">— Sélectionner —</option>` +
    list
      .map(
        (l) =>
          `<option value="${l.id}" ${
            String(l.id) === String(selectedId) ? "selected" : ""
          }>${l.name}</option>`
      )
      .join("");
}

/**
 * Popup custom Quantité + Remise %
 * Retourne une Promise<{qty, discount}> ou null si annulé.
 */
function openQtyDiscountDialog(defaultQty = 1, defaultDiscount = 0) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.35);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:9999;
    `;

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;min-width:320px;max-width:90%;padding:16px 18px;box-shadow:0 10px 25px rgba(0,0,0,.12);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-weight:600;margin-bottom:10px;">Ligne de commande</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Quantité</span>
            <input type="number" min="1" step="1" id="dlg-qty"
              value="${defaultQty}"
              style="padding:6px 8px;border-radius:6px;border:1px solid #d1d5db;outline:none;">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Remise (%)</span>
            <input type="number" min="0" max="100" step="0.01" id="dlg-discount"
              value="${defaultDiscount}"
              style="padding:6px 8px;border-radius:6px;border:1px solid #d1d5db;outline:none;">
          </label>
          <div id="dlg-error" style="color:#b91c1c;font-size:0.85rem;display:none;"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button type="button" id="dlg-cancel"
            style="padding:6px 12px;border-radius:6px;border:1px solid #d1d5db;background:#fff;cursor:pointer;">
            Annuler
          </button>
          <button type="button" id="dlg-ok"
            style="padding:6px 12px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;">
            OK
          </button>
        </div>
      </div>
    `;

    const close = (result) => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };

    document.body.appendChild(overlay);

    const qtyInput = overlay.querySelector("#dlg-qty");
    const discInput = overlay.querySelector("#dlg-discount");
    const errEl = overlay.querySelector("#dlg-error");
    const btnOk = overlay.querySelector("#dlg-ok");
    const btnCancel = overlay.querySelector("#dlg-cancel");

    const validateAndClose = () => {
      const q = parseFloat(qtyInput.value || "0");
      const d = parseFloat(discInput.value || "0");

      if (!(q > 0)) {
        errEl.textContent = "Quantité invalide.";
        errEl.style.display = "block";
        qtyInput.focus();
        return;
      }
      if (isNaN(d) || d < 0 || d > 100) {
        errEl.textContent = "La remise doit être comprise entre 0 et 100%.";
        errEl.style.display = "block";
        discInput.focus();
        return;
      }
      close({ qty: q, discount: d });
    };

    btnOk.addEventListener("click", validateAndClose);
    btnCancel.addEventListener("click", () => close(null));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        validateAndClose();
      }
    });

    qtyInput.focus();
  });
}

/**
 * Initialise la table catalogue si besoin.
 */
export function initCatalogTableIfNeeded() {
  const container = document.getElementById("catalog-table");
  if (!container) return;

  if (container.querySelector("#catalog-body")) return;

  container.dataset.init = "1";
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px;border-bottom:1px solid #eee;">Photo</th>
          <th style="text-align:left;padding:6px;border-bottom:1px solid #eee;">SKU</th>
          <th style="text-align:left;padding:6px;border-bottom:1px solid #eee;">Nom</th>
          <th style="text-align:right;padding:6px;border-bottom:1px solid #eee;">Prix HT</th>
          <th style="text-align:right;padding:6px;border-bottom:1px solid #eee;">Commission</th>
          <th style="text-align:left;padding:6px;border-bottom:1px solid #eee;">Tiers price</th>
          <th style="text-align:right;padding:6px;border-bottom:1px solid #eee;"></th>
        </tr>
      </thead>
      <tbody id="catalog-body"></tbody>
    </table>
  `;
}

/**
 * Clear catalogue (à appeler uniquement lors d’un reset : changement labo / nouvelle recherche)
 */
export function clearCatalog() {
  const body = document.getElementById("catalog-body");
  if (body) body.innerHTML = "";
  const container = document.getElementById("catalog-table");
  if (container) {
    delete container.dataset.renderedIds;
  }
}

/**
 * Ajoute des lignes produits au catalogue (SANS effacer le tbody).
 * Anti-doublons via Set stocké dans container.dataset.renderedIds.
 */
export function appendCatalog(items, { onAdd, replace = false } = {}) {
  const container = document.getElementById("catalog-table");
  if (!container) return;

  let body = document.getElementById("catalog-body");
  if (!body) {
    initCatalogTableIfNeeded();
    body = document.getElementById("catalog-body");
    if (!body) return;
  }

  if (replace) {
    body.innerHTML = "";
    delete container.dataset.renderedIds;
  }

  let rendered;
  try {
    rendered = new Set(JSON.parse(container.dataset.renderedIds || "[]"));
  } catch {
    rendered = new Set();
  }

  (items || []).forEach((p) => {
    if (!p || p.id == null) return;
    if (rendered.has(p.id)) return;
    rendered.add(p.id);

    // Commission
    const rawRate =
      p.commission_rate !== undefined && p.commission_rate !== null
        ? p.commission_rate
        : p.commission;

    const commissionLabel =
      rawRate !== undefined && rawRate !== null ? formatPercent(rawRate) : "—";

    // Tiers price
    let tiersLabel = "Aucun palier";
    if (Array.isArray(p.tiers) && p.tiers.length) {
      tiersLabel = p.tiers
        .map((t) => {
          let q = null;
          if (t.min_qty != null) q = t.min_qty;
          else if (t.qty_min != null) q = t.qty_min;
          else if (t.min != null) q = t.min;
          else if (t.qty != null) q = t.qty;

          let price = 0;
          if (t.unit_price_ht != null) price = t.unit_price_ht;
          else if (t.price_ht != null) price = t.price_ht;
          else if (t.price != null) price = t.price;

          const qtyLabel = q != null ? formatTierQty(q) : "?";
          return `${qtyLabel} → ${Number(price).toFixed(2)} €`;
        })
        .join("<br>");
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;width:60px;">
        ${
          p.image_url
            ? `<img src="${p.image_url}" alt="" style="max-width:48px;max-height:48px;object-fit:contain;border-radius:4px;">`
            : ""
        }
      </td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${p.sku || ""}</td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${p.name || ""}</td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">
        ${Number(p.price_ht || 0).toFixed(2)} €
      </td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">
        ${commissionLabel}
      </td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;">
        ${tiersLabel}
      </td>
      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">
        <button class="btn-add">Ajouter</button>
      </td>
    `;

    tr.querySelector(".btn-add").addEventListener("click", async () => {
      const res = await openQtyDiscountDialog(1, 0);
      if (!res) return;

      const { qty, discount } = res;
      const unitPrice = getTierPriceForQty(p.tiers || [], qty, p.price_ht);

      onAdd({
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        price_ht: Number(unitPrice || 0),
        qty,
        commission_rate: rawRate,
        tiers: p.tiers || [],
        discount_percent: discount,
      });
    });

    body.appendChild(tr);
  });

  container.dataset.renderedIds = JSON.stringify(Array.from(rendered));
}

export function renderCart(cart, onQty, onRemove, onDiscount) {
  const wrap = document.getElementById("cart-lines");
  wrap.innerHTML = "";
  if (!cart.length) {
    wrap.innerHTML = `<div style="opacity:.7;">Aucun article</div>`;
    document.getElementById("cart-total").textContent = "0.00 €";
    return;
  }

  let total = 0;
  cart.forEach((l, idx) => {
    const lineTotal = Number(l.qty) * Number(l.price_ht || 0);
    total += lineTotal;

    const commissionInfo =
      l.commission_rate !== null &&
      l.commission_rate !== undefined &&
      l.commission_rate !== ""
        ? formatPercent(l.commission_rate)
        : null;

    const discountInfo =
      l.discount_percent !== null &&
      l.discount_percent !== undefined &&
      l.discount_percent !== "" &&
      Number(l.discount_percent) > 0
        ? formatPercent(l.discount_percent)
        : null;

    let tiersInfo = null;
    if (Array.isArray(l.tiers) && l.tiers.length) {
      tiersInfo = l.tiers
        .map((t) => {
          const minQty =
            t.min_qty != null
              ? t.min_qty
              : t.qty_min != null
              ? t.qty_min
              : t.from_qty != null
              ? t.from_qty
              : t.qty != null
              ? t.qty
              : null;

          let price = 0;
          if (t.price_ht != null) price = t.price_ht;
          else if (t.price != null) price = t.price;
          else if (t.unit_price != null) price = t.unit_price;
          else if (t.value != null) price = t.value;

          const qtyLabel = minQty != null ? formatTierQty(minQty) : "?";
          return `${qtyLabel} ${Number(price).toFixed(2)} €`;
        })
        .join(" • ");
    }

    let metaHtml = "";
    if (commissionInfo || tiersInfo || discountInfo) {
      metaHtml = `<div style="opacity:.7;font-size:0.8rem;margin-top:2px;">
        ${commissionInfo ? `Comm. : ${commissionInfo}` : ""}
        ${commissionInfo && discountInfo ? " — " : ""}
        ${discountInfo ? `Remise : ${discountInfo}` : ""}
        ${(commissionInfo || discountInfo) && tiersInfo ? " — " : ""}
        ${tiersInfo ? `Tiers : ${tiersInfo}` : ""}
      </div>`;
    }

    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;border-bottom:1px solid #eee;padding:6px 0;";
    row.innerHTML = `
      <div>
        <div><strong>${l.sku || ""}</strong> — ${l.name || ""}</div>
        <div style="opacity:.7;">${Number(l.price_ht || 0).toFixed(2)} €</div>
        ${metaHtml}
      </div>
      <input type="number" min="1" step="1" value="${l.qty}" style="width:70px;justify-self:end;">
      <div style="justify-self:end;">${lineTotal.toFixed(2)} €</div>
      <button class="btn-del" style="justify-self:end;">✕</button>
    `;

    const qtyInput = row.querySelector("input");
    qtyInput.addEventListener("change", () => {
      const v = parseFloat(qtyInput.value || "0");
      if (v <= 0) return;
      onQty(idx, v);
    });

    row.querySelector(".btn-del").addEventListener("click", () => onRemove(idx));
    wrap.appendChild(row);
  });

  document.getElementById("cart-total").textContent = `${total.toFixed(2)} €`;
}

export function toastOK(msg) {
  const el = document.getElementById("cart-success");
  if (!el) return;
  el.textContent = msg || "OK";
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}

export function toastERR(msg) {
  const el = document.getElementById("cart-error");
  if (!el) return;
  el.textContent = msg || "Erreur";
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 5000);
}

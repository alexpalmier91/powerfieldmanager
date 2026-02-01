// app/static/labo/editor/product_block.js
import { API_BASE, fetchJSON } from "./api.js?v=12";
import { state, setStatus, uid, clamp } from "./state.js?v=12";
import { getOrCreatePageModel } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";
import { setActiveTool } from "./ui_tools.js?v=12";

/**
 * Product Block:
 * - UI: recherche + sélection produit + options
 * - Action: "Valider bloc produit" => active tool "product_block"
 * - Placement: au clic dans le PDF via window.__ZENHUB_PRODUCT_BLOCK_PLACE__()
 * - Insert: plusieurs items indépendants (image, titre, desc, sku, ean, price, stock, tiers table)
 */

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
function $(id) {
  return document.getElementById(id);
}

function absolutizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return new URL(s, window.location.origin).href;
  return new URL(s, window.location.origin).href;
}

function loadImageNaturalSize(src, timeoutMs = 4500) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";

    const t = setTimeout(() => {
      try { img.src = ""; } catch {}
      resolve(null);
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(t);
      const nw = Number(img.naturalWidth) || 0;
      const nh = Number(img.naturalHeight) || 0;
      if (nw > 0 && nh > 0) return resolve({ nw, nh });
      resolve(null);
    };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

function fitContain(maxW, maxH, nw, nh) {
  maxW = Number(maxW) || 0;
  maxH = Number(maxH) || 0;
  nw = Number(nw) || 0;
  nh = Number(nh) || 0;

  if (maxW <= 0 || maxH <= 0 || nw <= 0 || nh <= 0) return null;

  const scale = Math.min(maxW / nw, maxH / nh);
  const w = Math.max(2, Math.round(nw * scale));
  const h = Math.max(2, Math.round(nh * scale));
  return { w, h };
}

async function fetchImageAsDataUrl(url, timeoutMs = 12000) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (u.startsWith("data:")) return u;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(u, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("image/")) return null;

    const blob = await res.blob();
    if (!blob || !blob.size) return null;

    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });

    return dataUrl && dataUrl.startsWith("data:") ? dataUrl : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function _safeBool(el, fallback = false) {
  if (!el) return fallback;
  return !!el.checked;
}
function _safeVal(el, fallback = "") {
  if (!el) return fallback;
  return String(el.value ?? fallback);
}
function _safeNum(el, fallback = 0) {
  if (!el) return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

function _getOverlaySize(overlay) {
  if (!overlay) return { ow: 0, oh: 0 };
  const cw = Number(overlay.clientWidth) || 0;
  const ch = Number(overlay.clientHeight) || 0;
  if (cw > 0 && ch > 0) return { ow: cw, oh: ch };
  const tag = String(overlay.tagName || "").toLowerCase();
  if (tag === "canvas") return { ow: Number(overlay.width) || 0, oh: Number(overlay.height) || 0 };
  return { ow: 0, oh: 0 };
}

function relToAbs(pageIndex, x_rel, y_rel) {
  const overlay = state.overlaysByPage?.get(pageIndex);
  const { ow, oh } = _getOverlaySize(overlay);
  const x = Math.round(clamp(Number(x_rel) * ow, 0, ow));
  const y = Math.round(clamp(Number(y_rel) * oh, 0, oh));
  return { x, y, ow, oh };
}

function formatEurFr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2).replace(".", ",")} €`;
  }
}

// ✅ NEW: image candidates (WEBP HD -> JPG HD -> THUMB -> legacy)
function pickImageCandidates(p) {
  const candidates = [
    p?.hd_webp_url,
    p?.hd_jpg_url,
    p?.thumb_url,
    // fallback legacy
    p?.image_url,
    p?.cover_url,
    p?.cover,
    p?.image,
    p?.img,
    p?.photo_url,
    p?.photo,
  ]
    .map((u) => absolutizeUrl(u))
    .filter(Boolean);

  // dedupe
  const seen = new Set();
  const out = [];
  for (const u of candidates) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}



function pickSku(p) {
  return p?.sku || p?.reference || p?.ref || "";
}
function pickEan(p) {
  return p?.ean13 || p?.ean || p?.barcode || "";
}
function pickPriceHt(p) {
  const v = p?.price_ht ?? p?.priceHT ?? p?.price ?? p?.unit_price_ht ?? p?.unit_price ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// style minimal (tu peux enrichir si tu veux)
function makeTextObj({ x, y, w, h, text, style = {}, dynamic = null, layer = "front" }) {
  const fontFamily = style.fontFamily || "helv";
  const fontSize = Number(style.fontSize || 18);
  const fontWeight = String(style.fontWeight || "700");
  const color = style.color || "#111827";

  const bgMode = style.bgMode || "semi";
  const bgEnabled = style.bgEnabled !== false && bgMode !== "transparent";
  const bgColor =
    bgMode === "semi"
      ? (style.bgColor || "rgba(255,255,255,0.72)")
      : bgMode === "color"
      ? (style.bgColor || "#ffffff")
      : "transparent";

  const borderEnabled = !!style.borderEnabled;
  const borderColor = style.borderColor || "#111827";
  const borderWidth = Number(style.borderWidth ?? 1);

  const textAlign = style.textAlign || "left";

  return {
    id: uid("txt"),
    type: "text",
    x,
    y,
    w,
    h,
    text: String(text ?? "").toString(),
    layer,
    dynamic,

    // legacy
    fontFamily,
    fontSize,
    fontWeight,
    color,
    bgMode,
    bgEnabled,
    bgColor,
    borderEnabled,
    borderColor,
    borderWidth,
    textAlign,

    // unified
    style: {
      fontFamily,
      fontSize,
      fontWeight,
      color,
      bgMode,
      bgEnabled,
      bgColor,
      borderEnabled,
      borderColor,
      borderWidth,
      textAlign,
    },
  };
}

function makeImageObj({ x, y, w, h, src, name = "image", layer = "front", fit = "contain", src_candidates = null }) {
  const o = {
    id: uid("img"),
    type: "image",
    x, y, w, h,
    src,
    name,
    layer,
    fit, // "contain" | "cover" | "fill"
  };
  if (Array.isArray(src_candidates) && src_candidates.length) {
    o.src_candidates = src_candidates.slice(0, 6);
  }
  return o;
}

// ------------------------------------------------------------
// Cache + API
// ------------------------------------------------------------
function ensurePbCache() {
  if (!state.pbCache) {
    state.pbCache = {
      items: [],
      byId: new Map(),
      tiersByPid: new Map(),
      lastQuery: "",
    };
  }
  return state.pbCache;
}

async function apiSearchProducts(query, limit = 12) {
  const url = `${API_BASE}/marketing/products/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  return await fetchJSON(url, { method: "GET" });
}

async function apiFetchTiers(productId) {
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid <= 0) return [];
  const url = `${API_BASE}/marketing/products/${pid}/tiers`;
  const data = await fetchJSON(url, { method: "GET" });
  const tiers = data?.tiers || data?.items || [];
  return Array.isArray(tiers) ? tiers : [];
}

function normalizeSearchItems(data) {
  const items = data?.items || data?.results || data?.data || [];
  return Array.isArray(items) ? items : [];
}

// ------------------------------------------------------------
// UI wiring
// ------------------------------------------------------------
let __pbTimer = null;

function fillProductResultsSelect(selectEl, items) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— sélectionner —";
  selectEl.appendChild(opt0);

  for (const p of items) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    const sku = pickSku(p);
    const ean = pickEan(p);
    const parts = [p.name || "Produit"];
    if (sku) parts.push(sku);
    if (ean) parts.push(`EAN ${ean}`);
    opt.textContent = parts.join(" • ");
    selectEl.appendChild(opt);
  }
}

async function refreshTierSelectForProduct(pid) {
  const tierSel = $("pb_tier_id");
  if (!tierSel) return;

  tierSel.innerHTML = `<option value="">—</option>`;

  const cache = ensurePbCache();
  if (!cache.tiersByPid.has(pid)) {
    try {
      const tiers = await apiFetchTiers(pid);
      cache.tiersByPid.set(pid, tiers);
    } catch (e) {
      console.warn("[PRODUCT_BLOCK] tiers fetch failed:", e);
      cache.tiersByPid.set(pid, []);
    }
  }

  const tiers = cache.tiersByPid.get(pid) || [];
  for (const t of tiers) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    const qty = t.qty_min ?? t.min_qty ?? t.quantity ?? "";
    const price = t.price_ht ?? t.price ?? "";
    opt.textContent = `Qté ${qty !== "" ? qty : "?"} — ${price !== "" ? formatEurFr(price) : "—"}`;
    tierSel.appendChild(opt);
  }
}

function readPbOptionsFromUI() {
  const include_image = _safeBool($("pb_include_image"), true);
  const include_title = _safeBool($("pb_include_title"), true);
  const include_desc = _safeBool($("pb_include_desc"), true);
  const include_sku = _safeBool($("pb_include_sku"), true);
  const include_ean = _safeBool($("pb_include_ean"), true);
  const include_price = _safeBool($("pb_include_price_ht"), true) || _safeBool($("pb_include_price"), true);
  const include_stock = _safeBool($("pb_include_stock"), true);
  const include_tiers = _safeBool($("pb_include_tiers"), true);

  const tier_mode = _safeVal($("pb_tier_mode"), "tier_selected");
  const tier_id = Number(_safeVal($("pb_tier_id"), "")) || null;

  const preset = _safeVal($("pb_preset"), "left_image");
  const lineH = clamp(_safeNum($("pb_line_h"), 18), 12, 60);
  const gap = clamp(_safeNum($("pb_gap"), 8), 0, 60);

  return {
    include_image,
    include_title,
    include_desc,
    include_sku,
    include_ean,
    include_price,
    include_stock,
    include_tiers,
    tier_mode,
    tier_id,
    preset,
    lineH,
    gap,
  };
}

// ------------------------------------------------------------
// Presets
// ------------------------------------------------------------
const PRODUCT_BLOCK_PRESETS = {
  left_image: ({ x, y, include_image, IMG, GAP, BLOCK_W, BLOCK_H }) => {
    const leftX = Math.max(0, x);
    const topY = Math.max(0, y);

    const imgBox = include_image
      ? { x: leftX, y: topY, w: IMG, h: IMG }
      : null;

    const textX = leftX + (include_image ? IMG + GAP : 0);
    const textW = BLOCK_W - (textX - leftX);

    return {
      block: { x: leftX, y: topY, w: BLOCK_W, h: BLOCK_H },
      imgBox,
      text: { x: textX, y: topY, w: textW },
    };
  },

  top_image: ({ x, y, include_image, GAP, BLOCK_W, IMG_TOP_H }) => {
    const leftX = Math.max(0, x);
    const topY = Math.max(0, y);

    const imgBox = include_image
      ? { x: leftX, y: topY, w: BLOCK_W, h: IMG_TOP_H }
      : null;

    const textY = topY + (include_image ? IMG_TOP_H + GAP : 0);

    return {
      block: { x: leftX, y: topY, w: BLOCK_W, h: (include_image ? IMG_TOP_H : 0) + GAP + 260 },
      imgBox,
      text: { x: leftX, y: textY, w: BLOCK_W },
    };
  },
};

// ------------------------------------------------------------
// ✅ NEW: pick first working image (quick probe)
// ------------------------------------------------------------
async function pickFirstWorkingImage(candidates = []) {
  for (const u of candidates) {
    const nat = await loadImageNaturalSize(u, 3500);
    if (nat && nat.nw > 0 && nat.nh > 0) return { url: u, nat };
  }
  return { url: null, nat: null };
}

// ------------------------------------------------------------
// Placement handler called from ui_tools.js
// ------------------------------------------------------------
async function placeProductBlockAt({ pageIndex, x_rel, y_rel }) {
  const statusEl = $("pb_status");
  const say = (msg) => {
    if (statusEl) statusEl.textContent = msg;
    setStatus(msg);
  };

  const pid = Number(state.productBlockPending?.product_id || 0);
  if (!Number.isFinite(pid) || pid <= 0) {
    say("Bloc produit : sélectionne un produit.");
    return;
  }

  const cache = ensurePbCache();
  const p = cache.byId.get(pid);
  if (!p) {
    say("Bloc produit : produit introuvable en cache (refais une recherche).");
    return;
  }

  const opts = state.productBlockPending?.options || readPbOptionsFromUI();
  const { x, y, ow, oh } = relToAbs(pageIndex, x_rel, y_rel);

  const GAP = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 8;
  const lineH = Number.isFinite(Number(opts.lineH)) ? Number(opts.lineH) : 18;

  const BLOCK_W = 420;
  const IMG = 120;
  const IMG_TOP_H = 190;

  const presetKey = String(opts.preset || "left_image");
  const presetFn = PRODUCT_BLOCK_PRESETS[presetKey] || PRODUCT_BLOCK_PRESETS.left_image;
  const BLOCK_H = Math.max(IMG, 200);

  const layout = presetFn({
    x,
    y,
    include_image: !!opts.include_image,
    IMG,
    GAP,
    BLOCK_W,
    BLOCK_H,
    IMG_TOP_H,
  });

  const objects = [];

  // ----------------------------------------------------------
  // ✅ IMAGE (WEBP HD first, immediate display, async upgrade to dataURL)
  // ----------------------------------------------------------
    // ----------------------------------------------------------
  // Image (HD WEBP + fallback)
  // ----------------------------------------------------------
  if (opts.include_image && layout.imgBox) {
    const candidates = pickImageCandidates(p);
    const first = candidates[0] || null;

    if (first) {
      // 1) taille naturelle (ratio réel) : on essaye, mais sans bloquer trop longtemps
      const nat = await loadImageNaturalSize(first, 1800); // petit timeout pour rester fluide
      const maxW = layout.imgBox.w;
      const maxH = layout.imgBox.h;

      let imgW = maxW;
      let imgH = maxH;

      if (nat) {
        const fitted = fitContain(maxW, maxH, nat.nw, nat.nh);
        if (fitted) {
          imgW = fitted.w;
          imgH = fitted.h;
        }
      }

      let imgX = layout.imgBox.x;
      let imgY = layout.imgBox.y;

      if (presetKey === "top_image") {
        imgX = layout.imgBox.x + Math.round((maxW - imgW) / 2);
        imgY = layout.imgBox.y + Math.round((maxH - imgH) / 2);
      }

      if (presetKey === "left_image") {
        layout.text.x = layout.imgBox.x + imgW + GAP;
        layout.text.w = BLOCK_W - (layout.text.x - layout.block.x);
      }

      const imgObj = makeImageObj({
        x: imgX,
        y: imgY,
        w: imgW,
        h: imgH,

        // ✅ on pose immédiatement la meilleure candidate
        src: first,

        name: `product_${pid}`,
        layer: "front",
        fit: "contain",
      });

      // ✅ on stocke les fallbacks pour l’overlay + PDF renderer
      imgObj.src_candidates = candidates;

      // coords rel (basées sur ow/oh)
      imgObj.x_rel = clamp(ow > 0 ? imgX / ow : 0, 0, 1);
      imgObj.y_rel = clamp(oh > 0 ? imgY / oh : 0, 0, 1);
      imgObj.w_rel = clamp(ow > 0 ? imgW / ow : 0, 0, 1);
      imgObj.h_rel = clamp(oh > 0 ? imgH / oh : 0, 0, 1);
      imgObj.page_box = { w: ow, h: oh };

      objects.push(imgObj);
    } else {
      say("Photo produit indisponible (le reste du bloc sera inséré).");
    }
  }


  // ----------------------------------------------------------
  // Text flow (zone texte)
  // ----------------------------------------------------------
  let ty = layout.text.y;

  if (opts.include_title) {
    const title = (p.name || "").toString().trim() || "Produit";
    objects.push(
      makeTextObj({
        x: layout.text.x,
        y: ty,
        w: layout.text.w,
        h: 34,
        text: title,
        style: {
          fontFamily: "helv",
          fontSize: 18,
          fontWeight: "700",
          color: "#111827",
          bgMode: "transparent",
          bgEnabled: false,
          textAlign: "left",
        },
        layer: "front",
      })
    );
    ty += 34 + 4;
  }

  const metaStyle = {
    fontFamily: "helv",
    fontSize: 12,
    fontWeight: "400",
    color: "#374151",
    bgMode: "transparent",
    bgEnabled: false,
    textAlign: "left",
  };

  if (opts.include_sku) {
    const sku = pickSku(p);
    if (sku) {
      objects.push(
        makeTextObj({
          x: layout.text.x,
          y: ty,
          w: layout.text.w,
          h: lineH + 6,
          text: `SKU : ${sku}`,
          style: metaStyle,
          layer: "front",
        })
      );
      ty += lineH;
    }
  }

  if (opts.include_ean) {
    const ean = pickEan(p);
    if (ean) {
      objects.push(
        makeTextObj({
          x: layout.text.x,
          y: ty,
          w: layout.text.w,
          h: lineH + 6,
          text: `EAN : ${ean}`,
          style: metaStyle,
          layer: "front",
        })
      );
      ty += lineH;
    }
  }

  if (opts.include_price) {
    const price = pickPriceHt(p);
    if (price != null) {
      objects.push(
        makeTextObj({
          x: layout.text.x,
          y: ty,
          w: layout.text.w,
          h: lineH + 6,
          text: `Prix HT : ${formatEurFr(price)}`,
          style: { ...metaStyle, fontWeight: "700", color: "#111827" },
          layer: "front",
        })
      );
      ty += lineH;
    }
  }

  if ((opts.include_sku || opts.include_ean || opts.include_price) && ty > layout.text.y) {
    ty += 6;
  }

  if (opts.include_desc) {
    const desc = (p.description || p.description_short || "").toString().trim();
    if (desc) {
      const h = 54;
      objects.push(
        makeTextObj({
          x: layout.text.x,
          y: ty,
          w: layout.text.w,
          h,
          text: desc,
          style: {
            fontFamily: "helv",
            fontSize: 12,
            fontWeight: "400",
            color: "#111827",
            bgMode: "transparent",
            bgEnabled: false,
            textAlign: "left",
          },
          layer: "front",
        })
      );
      ty += h + 6;
    }
  }

  if (opts.include_stock) {
    objects.push(
      makeTextObj({
        x: layout.text.x,
        y: ty,
        w: Math.min(240, layout.text.w),
        h: 28,
        text: "Rupture de stock",
        dynamic: {
          kind: "product_stock_badge",
          product_id: pid,
          text: "Rupture de stock",
          mode_labo: "show_stock",
          mode_agent: "only_if_zero",
        },
        style: {
          fontFamily: "helv",
          fontSize: 12,
          fontWeight: "700",
          color: "#111827",
          bgMode: "semi",
          bgEnabled: true,
          bgColor: "rgba(255,255,255,0.72)",
          textAlign: "center",
        },
        layer: "front",
      })
    );
    ty += 28 + 6;
  }

  if (opts.include_tiers) {
    let tiers = cache.tiersByPid.get(pid);
    if (!tiers) {
      try {
        tiers = await apiFetchTiers(pid);
        cache.tiersByPid.set(pid, tiers);
      } catch {
        tiers = [];
      }
    }

    if (Array.isArray(tiers) && tiers.length) {
      let lines = [];
      if (opts.tier_mode === "tier_selected" && opts.tier_id) {
        const one = tiers.find((t) => Number(t.id) === Number(opts.tier_id));
        if (one) {
          const q = one.qty_min ?? one.min_qty ?? one.quantity ?? "";
          const pr = one.price_ht ?? one.price ?? null;
          lines = [`Quantité ${q}  -  ${pr != null ? formatEurFr(pr) : "—"}`];
        }
      } else {
        lines = tiers
          .slice()
          .sort(
            (a, b) =>
              Number(a.qty_min ?? a.min_qty ?? a.quantity ?? 0) -
              Number(b.qty_min ?? b.min_qty ?? b.quantity ?? 0)
          )
          .map((t) => {
            const q = t.qty_min ?? t.min_qty ?? t.quantity ?? "";
            const pr = t.price_ht ?? t.price ?? null;
            return `Quantité ${q}  -  ${pr != null ? formatEurFr(pr) : "—"}`;
          });
      }

      if (lines.length) {
        const text = lines.join("\n");
        const h = Math.min(140, Math.max(34, lines.length * 18 + 10));

        objects.push(
          makeTextObj({
            x: layout.text.x,
            y: ty,
            w: layout.text.w,
            h,
            text,
            style: {
              fontFamily: "helv",
              fontSize: 12,
              fontWeight: "400",
              color: "#111827",
              bgMode: "semi",
              bgEnabled: true,
              bgColor: "rgba(255,255,255,0.72)",
              borderEnabled: false,
              textAlign: "left",
            },
            layer: "front",
          })
        );
        ty += h + 6;
      }
    }
  }

  // Push all objects (items indépendants)
  const page = getOrCreatePageModel(pageIndex);
  for (const o of objects) page.objects.push(o);

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);

  // ✅ async upgrade to dataURL for the just inserted image(s)
  for (const o of objects) {
    if (o?.type === "image" && o.__upgrade_to_dataurl__) {
      const url = o.__upgrade_to_dataurl__;
      delete o.__upgrade_to_dataurl__;

      (async () => {
        const dataUrl = await fetchImageAsDataUrl(url);
        if (!dataUrl) return;
        // update in-place
        o.src = dataUrl;
        renderPageOverlay(pageIndex);
        rerenderAllExcept(pageIndex);
      })().catch(() => {});
    }
  }

  say(`Bloc produit inséré ✅ (preset: ${presetKey}) — Clique ailleurs pour en placer un autre (ou change d’outil).`);
  state.productBlockPending = null;
  setActiveTool(null);
  setStatus("Mode: sélection");
}

// Exposé pour ui_tools.js
window.__ZENHUB_PRODUCT_BLOCK_PLACE__ = placeProductBlockAt;

// ------------------------------------------------------------
// Public init
// ------------------------------------------------------------
export function initProductBlockUI() {
  const q = $("pb_query");
  const results = $("pb_results");
  const btnValidate = $("btnInsertProductBlock");
  const statusEl = $("pb_status");
  const tierMode = $("pb_tier_mode");

  if (!q || !results || !btnValidate) {
    console.warn("[PRODUCT_BLOCK] UI missing (pb_query/pb_results/btnInsertProductBlock)");
    return;
  }

  const cache = ensurePbCache();
  const say = (msg) => { if (statusEl) statusEl.textContent = msg; };

  q.addEventListener("input", () => {
    clearTimeout(__pbTimer);
    __pbTimer = setTimeout(async () => {
      const query = String(q.value || "").trim();
      if (!query) {
        cache.items = [];
        cache.byId.clear();
        fillProductResultsSelect(results, []);
        say("");
        return;
      }

      try {
        const data = await apiSearchProducts(query, 12);
        const items = normalizeSearchItems(data);

        cache.items = items;
        cache.byId.clear();
        for (const p of items) {
          if (p && p.id != null) cache.byId.set(Number(p.id), p);
        }

        fillProductResultsSelect(results, items);
        say(items.length ? `${items.length} résultat(s)` : "Aucun résultat");
      } catch (e) {
        console.warn("[PRODUCT_BLOCK] search failed:", e);
        say("Recherche impossible");
      }
    }, 160);
  });

  results.addEventListener("change", async () => {
    const pid = Number(results.value || 0);
    if (!pid) return;
    await refreshTierSelectForProduct(pid);
  });

  if (tierMode) tierMode.addEventListener("change", () => {});

  btnValidate.addEventListener("click", async () => {
    const pid = Number(results.value || 0);
    if (!pid) {
      say("Sélectionne un produit.");
      return;
    }

    try { await refreshTierSelectForProduct(pid); } catch {}

    state.productBlockPending = {
      product_id: pid,
      options: readPbOptionsFromUI(),
    };

    setActiveTool({ type: "product_block", product_id: pid });
    say("Clique dans le PDF pour insérer le bloc produit.");
    setStatus("Mode: Bloc produit (clique dans le PDF)");
  });

  fillProductResultsSelect(results, []);
  say("");
}

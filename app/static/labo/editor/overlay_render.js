// app/static/labo/editor/overlay_render.js
import { state } from "./state.js?v=12";
import { getOrCreatePageModel } from "./draft.js?v=12";
import { API_BASE, fetchJSON } from "./api.js?v=12";

import { sortObjectsByLayer, getZIndexForObject } from "./layer_tools.js?v=12";

function clearOverlay(overlay) {
  overlay.querySelectorAll(".anno-object").forEach((n) => n.remove());
}

/**
 * ✅ UPDATE: support multi-selection (outline bleu) + anchor (outline + épais)
 * - isSelected : élément dans la sélection (single OU multi)
 * - isAnchor   : élément "anchorId" de la multi-sélection
 * - isEditing  : inline edit (vert)
 */
function makeObjectFrameStyles(isSelected, isEditing = false, isAnchor = false) {
  if (isEditing) {
    return {
      outline: "2px solid #16a34a",
      boxShadow: "0 10px 24px rgba(22,163,74,0.20)",
    };
  }

  if (!isSelected) {
    return {
      outline: "none",
      boxShadow: "none",
    };
  }

  // ✅ anchor: contour plus épais
  if (isAnchor) {
    return {
      outline: "3px solid #2563eb",
      boxShadow: "0 10px 24px rgba(37,99,235,0.28)",
    };
  }

  return {
    outline: "2px solid #2563eb",
    boxShadow: "0 10px 24px rgba(37,99,235,0.20)",
  };
}

function addResizeHandles(el) {
  const handles = [
    { k: "nw", x: 0, y: 0 },
    { k: "ne", x: 1, y: 0 },
    { k: "sw", x: 0, y: 1 },
    { k: "se", x: 1, y: 1 },
  ];
  for (const h of handles) {
    const d = document.createElement("div");
    d.className = "anno-handle";
    d.dataset.handle = h.k;
    d.style.position = "absolute";
    d.style.width = "10px";
    d.style.height = "10px";
    d.style.borderRadius = "3px";
    d.style.background = "#ffffff";
    d.style.border = "1px solid rgba(37,99,235,0.9)";
    d.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    d.style.left = h.x === 0 ? "-6px" : "calc(100% - 4px)";
    d.style.top = h.y === 0 ? "-6px" : "calc(100% - 4px)";
    d.style.cursor = h.k === "nw" || h.k === "se" ? "nwse-resize" : "nesw-resize";
    d.style.zIndex = "50";
    d.style.pointerEvents = "auto";
    el.appendChild(d);
  }
}

function sanitizeFontFamily(f) {
  if (!f) return "";
  return String(f).replace(/["']/g, "").trim();
}

function isEditingThisObject(pageIndex, objectId) {
  return (
    !!state.isEditingText &&
    state.selected &&
    state.selected.pageIndex === pageIndex &&
    String(state.selected.objectId) === String(objectId)
  );
}

// ✅ clip_shape: mode "move image inside"
function isClipImageEditingThisObject(pageIndex, objectId) {
  const m = state.clipImageEditMode || state.clipImageEdit || null;
  if (!m) return false;
  if (m === true) {
    return (
      state.selected &&
      state.selected.pageIndex === pageIndex &&
      String(state.selected.objectId) === String(objectId)
    );
  }
  if (typeof m === "object") {
    if (m.pageIndex != null && Number(m.pageIndex) !== Number(pageIndex)) return false;
    if (m.objectId != null && String(m.objectId) !== String(objectId)) return false;
    if (m.enabled === false) return false;
    // enabled true/undefined => ok
    return true;
  }
  return false;
}

function formatEurFr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

// ---------------------------------------------------------------------
// ✅ Overlay sizing + box resolver (supports rel coords)
// ---------------------------------------------------------------------
function _getOverlaySize(overlay) {
  if (!overlay) return { ow: 0, oh: 0 };
  const tag = String(overlay.tagName || "").toLowerCase();

  if (tag === "canvas") {
    const ow = Number(overlay.width) || 0;
    const oh = Number(overlay.height) || 0;
    if (ow > 0 && oh > 0) return { ow, oh };
  }

  const ow = Number(overlay.clientWidth) || 0;
  const oh = Number(overlay.clientHeight) || 0;
  return { ow, oh };
}

function _num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function _clamp01(v) {
  const n = _num(v, 0);
  return Math.max(0, Math.min(1, n));
}

function resolveObjBox(overlay, obj) {
  const { ow, oh } = _getOverlaySize(overlay);

  const hasRel =
    obj &&
    obj.x_rel != null &&
    obj.y_rel != null &&
    obj.w_rel != null &&
    obj.h_rel != null &&
    ow > 0 &&
    oh > 0;

  if (hasRel) {
    const x = Math.round(_clamp01(obj.x_rel) * ow);
    const y = Math.round(_clamp01(obj.y_rel) * oh);
    const w = Math.max(2, Math.round(_clamp01(obj.w_rel) * ow));
    const h = Math.max(2, Math.round(_clamp01(obj.h_rel) * oh));
    return { x, y, w, h };
  }

  return {
    x: Math.max(0, Math.round(_num(obj?.x, 0))),
    y: Math.max(0, Math.round(_num(obj?.y, 0))),
    w: Math.max(2, Math.round(_num(obj?.w, 10))),
    h: Math.max(2, Math.round(_num(obj?.h, 10))),
  };
}

// ---------------------------------------------------------------------
// ✅ dyn cache safety
// ---------------------------------------------------------------------
function ensureDynCache() {
  if (!state.dynCache) {
    state.dynCache = {
      searchResults: [],
      productsById: new Map(),
      tiersByProductId: new Map(),
      lastSelectedProductId: null,
    };
  }
  if (!state.dynCache.productsById) state.dynCache.productsById = new Map();
  if (!state.dynCache.tiersByProductId) state.dynCache.tiersByProductId = new Map();
  if (!state.dynCache.bulkPending) state.dynCache.bulkPending = new Set();

  if (!state.dynCache.priceByKey) state.dynCache.priceByKey = new Map();
  if (!state.dynCache.pricePending) state.dynCache.pricePending = new Set();
}

// ---------------------------------------------------------------------
// ✅ MULTI-SELECTION HELPERS (used by renderer)
// ---------------------------------------------------------------------
function _ensureMultiSelected() {
  if (!state.multiSelected) state.multiSelected = { pageIndex: null, ids: [], anchorId: null };
  if (!Array.isArray(state.multiSelected.ids)) state.multiSelected.ids = [];
  return state.multiSelected;
}

function isObjInMulti(pageIndex, objId) {
  const ms = _ensureMultiSelected();
  if (ms.pageIndex == null || ms.pageIndex !== pageIndex) return false;
  return ms.ids.some((id) => String(id) === String(objId));
}

function isObjAnchor(pageIndex, objId) {
  const ms = _ensureMultiSelected();
  if (ms.pageIndex == null || ms.pageIndex !== pageIndex) return false;
  const a = ms.anchorId || (ms.ids && ms.ids[0]) || null;
  if (!a) return false;
  return String(a) === String(objId);
}

// ---------------------------------------------------------------------
// ✅ DYNAMIC DATA (bulk fetch)
// ---------------------------------------------------------------------
function getRole() {
  // ✅ Labo editor = toujours LABO
  const ds = String(state.root?.dataset?.role || "").toUpperCase();
  if (ds === "LABO") return "LABO";

  // fallback robuste sur l'URL (éditeur labo)
  const p = String(location.pathname || "");
  if (p.includes("/labo/")) return "LABO";

  // sinon, fallback contexte global
  const ctx = window.__ZENHUB_EDITOR_CTX__ || {};
  const r = String(ctx.role || "").toUpperCase();
  return r || "LABO";
}

function buildBulkKey(productId) {
  return `p:${productId}`;
}

async function ensureBulkInfo(productIds = []) {
  ensureDynCache();

  const ids = [...new Set(productIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  if (!ids.length) return;

  const needProducts = ids.filter((id) => !state.dynCache.productsById.has(id));
  const needTiers = ids.filter((id) => !state.dynCache.tiersByProductId.has(id));
  const needAny = [...new Set([...needProducts, ...needTiers])];
  if (!needAny.length) return;

  const toFetch = needAny.filter((id) => !state.dynCache.bulkPending.has(buildBulkKey(id)));
  if (!toFetch.length) return;

  toFetch.forEach((id) => state.dynCache.bulkPending.add(buildBulkKey(id)));

  try {
    const role = getRole();
    const payload = { product_ids: toFetch, role };

    const data = await fetchJSON(`${API_BASE}/marketing/products/bulk-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const products = data?.products || [];
    for (const p of products) {
      if (!p?.id) continue;
      state.dynCache.productsById.set(Number(p.id), p);
    }

    const tiersMap = data?.tiers || {};
    for (const [pid, tiers] of Object.entries(tiersMap)) {
      state.dynCache.tiersByProductId.set(Number(pid), Array.isArray(tiers) ? tiers : []);
    }
  } catch (e) {
    console.warn("[OVERLAY_RENDER] ensureBulkInfo failed:", e);
  } finally {
    toFetch.forEach((id) => state.dynCache.bulkPending.delete(buildBulkKey(id)));
    if (typeof window.__ZENHUB_REQUEST_RENDER__ === "function") window.__ZENHUB_REQUEST_RENDER__();
  }
}

function getTierInfo(productId, tierId) {
  ensureDynCache();
  const tiers = state.dynCache.tiersByProductId.get(Number(productId)) || [];
  const t = tiers.find((x) => String(x.id) === String(tierId));
  return t || null;
}

function mkPriceKey(productId, mode, tierId) {
  return `price:${productId}:${mode}:${tierId || ""}`;
}

// ---------------------------------------------------------------------
// ✅ STYLE NORMALIZER (future-proof)
// ---------------------------------------------------------------------
function normalizeTextStyle(obj = {}) {
  const s = obj && typeof obj.style === "object" && obj.style ? obj.style : {};

  const fontSize = Number.isFinite(Number(s.fontSize)) ? Number(s.fontSize) : Number(obj.fontSize) || 16;
  const fontWeight = (s.fontWeight ?? obj.fontWeight ?? "400") + "";
  const color = (s.color ?? obj.color ?? "#111827") + "";

  const fontFamilyRaw = s.fontFamily ?? obj.fontFamily;
  const fontFamily = sanitizeFontFamily(fontFamilyRaw) || "system-ui, -apple-system, Segoe UI, Roboto, Arial";

  const textAlign = String(s.textAlign ?? obj.textAlign ?? "center").toLowerCase();
  const align = textAlign === "left" || textAlign === "right" || textAlign === "center" ? textAlign : "center";

  const bgEnabled = s.bgEnabled ?? obj.bgEnabled;
  const bgMode = String(s.bgMode ?? obj.bgMode ?? "").trim();
  const bgColor = (s.bgColor ?? obj.bgColor ?? "rgba(255,255,255,0.72)") + "";

  const borderEnabled = !!(s.borderEnabled ?? obj.borderEnabled);
  const borderWidth = Number.isFinite(Number(s.borderWidth)) ? Number(s.borderWidth) : Number(obj.borderWidth) || 1;
  const borderColor = (s.borderColor ?? obj.borderColor ?? "#111827") + "";

  return {
    fontSize,
    fontWeight,
    color,
    fontFamily,
    textAlign: align,
    bgEnabled,
    bgMode,
    bgColor,
    borderEnabled,
    borderWidth,
    borderColor,
  };
}

// ---------------------------------------------------------------------
// ✅ RICH TEXT (paragraphs + bold/size/color/font inside)
// - on supporte HTML léger via obj.text_html / obj.html / obj.rich_html
// - on sanitise pour éviter XSS
// ---------------------------------------------------------------------
function _asStr(v) {
  return v == null ? "" : String(v);
}

function _pickRichHtml(obj) {
  const s = obj && typeof obj.style === "object" && obj.style ? obj.style : {};
  const candidates = [
    obj?.text_html,
    obj?.textHtml,
    obj?.html,
    obj?.rich_html,
    obj?.richHtml,
    s?.text_html,
    s?.textHtml,
    s?.html,
    s?.rich_html,
    s?.richHtml,
  ]
    .map((x) => _asStr(x).trim())
    .filter(Boolean);

  return candidates[0] || "";
}

function _sanitizeAllowedStyle(styleStr) {
  // allow-list CSS (inline runs)
  // NOTE: keep it conservative
  const allowed = new Set([
    "font-weight",
    "font-style",
    "text-decoration",
    "font-size",
    "color",
    "font-family",
    "letter-spacing",
    "line-height",
    "text-align",
    "background-color",
  ]);

  const out = [];
  const parts = _asStr(styleStr).split(";");
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const idx = p.indexOf(":");
    if (idx < 1) continue;

    const prop = p.slice(0, idx).trim().toLowerCase();
    let val = p.slice(idx + 1).trim();

    if (!allowed.has(prop)) continue;
    if (!val) continue;

    // tiny hardening
    if (/expression\s*\(/i.test(val)) continue;
    if (/url\s*\(/i.test(val)) continue;

    // normalize quotes in font-family
    if (prop === "font-family") val = val.replace(/["']/g, "");

    out.push(`${prop}: ${val}`);
  }
  return out.join("; ");
}

export function sanitizeRichHtml(html) {
  if (!html) return "";

  let doc;
  try {
    doc = new DOMParser().parseFromString(String(html), "text/html");
  } catch {
    return "";
  }

  const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "BR", "SPAN", "DIV", "P"]);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null);

  const toClean = [];
  while (walker.nextNode()) toClean.push(walker.currentNode);

  for (const el of toClean) {
    const tag = el.tagName;

    if (!allowedTags.has(tag)) {
      const txt = doc.createTextNode(el.textContent || "");
      el.replaceWith(txt);
      continue;
    }

    const attrs = [...el.attributes].map((a) => a.name);
    for (const a of attrs) {
      if (a === "style" && (tag === "SPAN" || tag === "DIV" || tag === "P")) continue;
      el.removeAttribute(a);
    }

    const st = el.getAttribute("style");
    if (st && (tag === "SPAN" || tag === "DIV" || tag === "P")) {
      const safe = _sanitizeAllowedStyle(st);
      if (safe) el.setAttribute("style", safe);
      else el.removeAttribute("style");
    }
  }

  doc.querySelectorAll("script").forEach((n) => n.remove());
  return doc.body ? doc.body.innerHTML : "";
}




// ---------------------------------------------------------------------
// ✅ SHAPES helpers
// ---------------------------------------------------------------------
function _clampPct(v, fb = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(0, Math.min(100, n));
}

function _normColor(c) {
  const s = String(c ?? "").trim();
  return s || null;
}

// ---------------------------------------------------------------------
// ✅ GRADIENT -> CSS (GLOBAL helper)
// ---------------------------------------------------------------------
function _buildGradientCss(g) {
  if (!g || typeof g !== "object") return null;

  const type = String(g.type || g.kind || "linear").toLowerCase(); // linear|radial
  const angleRaw = g.angle ?? g.deg ?? g.rotation ?? 90;
  const angle = Number.isFinite(Number(angleRaw)) ? Number(angleRaw) : 90;

  const rawStops = Array.isArray(g.stops) ? g.stops : Array.isArray(g.colors) ? g.colors : [];
  const stops = rawStops
    .map((s, i) => {
      if (!s) return null;

      let color =
        (typeof s.color === "string" ? s.color : null) ??
        (typeof s.c === "string" ? s.c : null) ??
        (typeof s.value === "string" ? s.value : null);

      color = (color || "").trim();
      if (!color) return null;

      let pos = s.pos ?? s.pct ?? s.p ?? s.at ?? s.stop ?? s.offset ?? null;
      if (pos == null) pos = i === 0 ? 0 : i === 1 ? 50 : 100;

      let n = Number(pos);
      if (!Number.isFinite(n)) n = i === 0 ? 0 : i === 1 ? 50 : 100;

      // 0..1 -> %
      if (n > 0 && n <= 1) n = n * 100;

      n = Math.max(0, Math.min(100, n));
      return { color, pos: n };
    })
    .filter(Boolean)
    .sort((a, b) => a.pos - b.pos);

  if (stops.length < 2) return null;

  const stopStr = stops.map((s) => `${s.color} ${s.pos}%`).join(", ");

  if (type === "radial") {
    return `radial-gradient(circle at 50% 50%, ${stopStr})`;
  }
  return `linear-gradient(${angle}deg, ${stopStr})`;
}

function normalizeShapeStyle(obj = {}) {
  const s = obj && typeof obj.style === "object" && obj.style ? obj.style : {};

  const shapeStrS = typeof s.shape === "string" ? s.shape.trim().toLowerCase() : "";
  const shapeStrO = typeof obj.shape === "string" ? String(obj.shape).trim().toLowerCase() : "";
  const kindStrS = typeof s.kind === "string" ? s.kind.trim().toLowerCase() : "";
  const kindStrO = typeof obj.kind === "string" ? String(obj.kind).trim().toLowerCase() : "";

  const shapeObjKind =
    obj.shape && typeof obj.shape === "object" && typeof obj.shape.kind === "string"
      ? obj.shape.kind.trim().toLowerCase()
      : "";

  const hasLineGeom = !!(obj && obj.line && typeof obj.line === "object");

  const explicitLine =
    shapeStrS === "line" ||
    shapeStrO === "line" ||
    kindStrS === "line" ||
    kindStrO === "line" ||
    shapeObjKind === "line" ||
    hasLineGeom;

  let safeKind = "rect";
  const wantsRound =
    shapeStrS === "round_rect" ||
    shapeStrO === "round_rect" ||
    kindStrS === "round_rect" ||
    kindStrO === "round_rect" ||
    shapeObjKind === "round_rect";

  const wantsRect =
    shapeStrS === "rect" ||
    shapeStrO === "rect" ||
    kindStrS === "rect" ||
    kindStrO === "rect" ||
    shapeObjKind === "rect";

  if (explicitLine) safeKind = "line";
  else if (wantsRound) safeKind = "round_rect";
  else if (wantsRect) safeKind = "rect";
  else safeKind = "rect";

  const radiusRaw =
    s.radius ?? obj.radius ?? (obj.shape && typeof obj.shape === "object" ? obj.shape.radius : null) ?? 14;

  const radius = Number.isFinite(Number(radiusRaw)) ? Number(radiusRaw) : 14;

  const fillEnabledRaw = s.fillEnabled ?? obj.fillEnabled;
  const strokeEnabledRaw = s.strokeEnabled ?? obj.strokeEnabled;

  const fillColor = String(s.fillColor ?? obj.fillColor ?? "rgba(37,99,235,0.15)").trim();

  const fillTypeRaw = s.fillType ?? obj.fillType ?? s.shapeFillType ?? obj.shapeFillType ?? "solid";
  let fillType = String(fillTypeRaw).toLowerCase() === "gradient" ? "gradient" : "solid";

  let fillGradient =
    s.fillGradient ??
    obj.fillGradient ??
    s.gradient ??
    obj.gradient ??
    s.shapeGradient ??
    obj.shapeGradient ??
    null;

  if (typeof fillGradient === "string") {
    try {
      fillGradient = JSON.parse(fillGradient);
    } catch (_) {}
  }

  const flat = {
    shapeGradType: s.shapeGradType ?? obj.shapeGradType,
    shapeGradAngle: s.shapeGradAngle ?? obj.shapeGradAngle,
    shapeGradColor1: s.shapeGradColor1 ?? obj.shapeGradColor1,
    shapeGradColor2: s.shapeGradColor2 ?? obj.shapeGradColor2,
    shapeGradColor3: s.shapeGradColor3 ?? obj.shapeGradColor3,
    shapeGradPos1: s.shapeGradPos1 ?? obj.shapeGradPos1,
    shapeGradPos2: s.shapeGradPos2 ?? obj.shapeGradPos2,
    shapeGradPos3: s.shapeGradPos3 ?? obj.shapeGradPos3,
  };

  if (!fillGradient && (flat.shapeGradColor1 || flat.shapeGradColor2 || flat.shapeGradColor3)) {
    const gType = String(flat.shapeGradType || "linear").toLowerCase();
    const gAngle = Number.isFinite(Number(flat.shapeGradAngle)) ? Number(flat.shapeGradAngle) : 90;

    const c1 = _normColor(flat.shapeGradColor1);
    const c2 = _normColor(flat.shapeGradColor2);
    const c3 = _normColor(flat.shapeGradColor3);

    const p1 = _clampPct(flat.shapeGradPos1, 0);
    const p2 = _clampPct(flat.shapeGradPos2, 100);
    const p3 = _clampPct(flat.shapeGradPos3, 50);

    const stops = [];
    if (c1) stops.push({ color: c1, pos: p1 });
    if (c3) stops.push({ color: c3, pos: p3 });
    if (c2) stops.push({ color: c2, pos: p2 });

    if (stops.length >= 2) fillGradient = { type: gType, angle: gAngle, stops };
  }

  const stopsArr =
    fillGradient && typeof fillGradient === "object" && Array.isArray(fillGradient.stops) ? fillGradient.stops : null;

  const stopsCount = stopsArr
    ? stopsArr.filter((x) => x && (typeof x.color === "string" || typeof x.c === "string" || typeof x.value === "string"))
        .length
    : 0;

  if (stopsCount >= 2) fillType = "gradient";

  const strokeColor = String(s.strokeColor ?? obj.strokeColor ?? "rgba(37,99,235,0.9)").trim();
  const strokeWidthRaw = s.strokeWidth ?? obj.strokeWidth ?? 2;
  const strokeWidth = Number.isFinite(Number(strokeWidthRaw)) ? Number(strokeWidthRaw) : 2;

  return {
    kind: safeKind,
    fillEnabled: fillEnabledRaw === false ? false : true,
    fillColor,
    fillType,
    fillGradient,
    strokeEnabled: strokeEnabledRaw === false ? false : true,
    strokeColor,
    strokeWidth: Math.max(0, Math.min(24, strokeWidth)),
    radius: Math.max(0, Math.min(200, radius)),
  };
}

function applyShapeStyle(el, obj) {
  const st = normalizeShapeStyle(obj);

  el.style.background = "";
  el.style.backgroundColor = "";
  el.style.backgroundImage = "none";
  el.style.backgroundRepeat = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.border = "none";
  el.style.borderTop = "none";
  el.style.borderRadius = "";
  el.style.boxSizing = "border-box";

  if (st.kind === "line") {
    const sw = Number.isFinite(Number(st.strokeWidth)) ? Number(st.strokeWidth) : 2;
    const thick = Math.max(2, Math.min(24, sw));
    el.style.background = "transparent";
    el.style.borderTop = `${thick}px solid ${st.strokeColor || "#111827"}`;
    el.style.borderRadius = "0px";
    return;
  }

  el.style.borderRadius = st.kind === "round_rect" ? `${st.radius}px` : "0px";

  if (!st.fillEnabled) {
    el.style.background = "transparent";
  } else if (st.fillType === "gradient") {
    const css = _buildGradientCss(st.fillGradient);
    if (css) {
      el.style.background = css;
      el.style.backgroundImage = css;
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundSize = "100% 100%";
      el.style.backgroundPosition = "center";
    } else {
      el.style.backgroundImage = "none";
      el.style.background = st.fillColor || "transparent";
    }
  } else {
    el.style.backgroundImage = "none";
    el.style.background = st.fillColor || "transparent";
  }

  if (st.strokeEnabled && st.strokeWidth > 0) {
    el.style.border = `${st.strokeWidth}px solid ${st.strokeColor || "#111827"}`;
  } else {
    el.style.border = "none";
  }
}

// ---------------------------------------------------------------------
// RENDERERS
// ---------------------------------------------------------------------
function applyTextBoxStyle(el, obj) {
  const st = normalizeTextStyle(obj);

  el.style.fontSize = st.fontSize + "px";
  el.style.fontWeight = st.fontWeight;
  el.style.color = st.color;
  el.style.fontFamily = st.fontFamily;

  el.style.textAlign = st.textAlign;
  if (st.textAlign === "left") el.style.justifyContent = "flex-start";
  else if (st.textAlign === "right") el.style.justifyContent = "flex-end";
  else el.style.justifyContent = "center";

  const bgMode = String(st.bgMode || "").trim();
  if (st.bgEnabled === false || bgMode === "transparent") el.style.background = "transparent";
  else if (bgMode === "color") el.style.background = st.bgColor || "#ffffff";
  else el.style.background = st.bgColor || "rgba(255,255,255,0.72)";

  if (st.borderEnabled) {
    const bw = Number.isFinite(Number(st.borderWidth)) ? Math.max(0, Math.min(12, Number(st.borderWidth))) : 1;
    const bc = st.borderColor || "#111827";
    el.style.border = `${bw}px solid ${bc}`;
  } else {
    el.style.border = "none";
  }

  el.style.borderRadius = "10px";
  el.style.padding = "6px 10px";
  el.style.boxSizing = "border-box";
  el.style.whiteSpace = "pre-wrap";
  el.style.lineHeight = "1.15";

  // ✅ important: permettre plusieurs paragraphes sans casser le layout
  el.style.overflow = "hidden";
}

function renderShapeObject(overlay, obj, isSelected, isAnchor = false) {
  const el = document.createElement("div");
  el.className = "anno-object anno-shape";
  el.dataset.objectId = obj.id;
  
  const pageIndex = Number(overlay.dataset.pageIndex || "0");
el.dataset.objId = String(obj.id);
el.dataset.pageIndex = String(pageIndex);
el.setAttribute("data-obj-id", String(obj.id));
el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";

  el.style.overflow = "visible";
  el.style.boxSizing = "border-box";

  applyShapeStyle(el, obj);

  const frame = makeObjectFrameStyles(isSelected, false, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  if (
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }

  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}


function renderTextContentInto(el, obj) {
  const t = String(obj?.type || "").toLowerCase();

  // ✅ richtext / paragraph => priorité à obj.html
  const isRich =
    t === "richtext" || t === "paragraph" || t === "rich_text" || t === "rich-text" || (obj?.html != null && String(obj.html).trim());

  if (isRich) {
    const html = _asStr(obj?.html || _pickRichHtml(obj)).trim();

    if (html) {
      const safe = sanitizeRichHtml(html);
      el.innerHTML = safe || "";
      el.dataset.rich = "1";
      return;
    }
    // fallback
    el.textContent = _asStr(obj?.text);
    el.dataset.rich = "0";
    return;
  }

  // ✅ autres => priorité à rich fields possibles
  const rich = _pickRichHtml(obj);
  if (rich) {
    const safe = sanitizeRichHtml(rich);
    if (safe) {
      el.innerHTML = safe;
      el.dataset.rich = "1";
      return;
    }
  }

  el.textContent = _asStr(obj?.text);
  el.dataset.rich = "0";
}




function renderTextObject(overlay, obj, isSelected, isAnchor = false) {
  const el = document.createElement("div");
  el.className = "anno-object anno-text";
  el.dataset.objectId = obj.id;

  const pageIndex = Number(overlay.dataset.pageIndex || "0");
  el.dataset.objId = String(obj.id);
  el.dataset.pageIndex = String(pageIndex);
  el.setAttribute("data-obj-id", String(obj.id));
  el.setAttribute("data-page-index", String(pageIndex));
  el.style.pointerEvents = "auto";

  const editing = isEditingThisObject(pageIndex, obj.id);

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  // ✅ conteneur
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.alignItems = "stretch";

  el.style.cursor = editing ? "text" : isSelected ? "default" : "pointer";
  el.style.userSelect = editing ? "text" : "none";

  // ✅ IMPORTANT : allow handle outside box
  el.style.overflow = "visible";

  // ✅ Drag handle (déplacement uniquement via poignée)
  const handle = document.createElement("div");
  handle.className = "zh-drag-handle";
  handle.dataset.dragHandle = "1";
  handle.title = "Déplacer";

  handle.style.position = "absolute";
  handle.style.left = "10px";
  handle.style.top = "-18px";
  handle.style.height = "18px";
 
  handle.style.alignItems = "center";
  handle.style.gap = "6px";
  handle.style.padding = "0 8px";
  handle.style.borderRadius = "9px";
  handle.style.background = "rgba(17,24,39,0.75)";
  handle.style.color = "#fff";
  handle.style.fontSize = "12px";
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";
  handle.style.zIndex = "60";
 
  
    // ✅ poignée visible uniquement si sélectionné (et pas en édition)
  const showHandle = !!isSelected && !editing;
  handle.style.display = showHandle ? "inline-flex" : "none";
handle.style.pointerEvents = "auto";
handle.style.zIndex = "9999";
handle.style.position = "absolute";



  const dots = document.createElement("span");
  dots.textContent = "⋮⋮";
  dots.style.letterSpacing = "1px";

  const lbl = document.createElement("span");
  lbl.textContent = editing ? "Édition" : "Déplacer";
  lbl.style.opacity = "0.9";

  handle.appendChild(dots);
  handle.appendChild(lbl);

dots.style.pointerEvents = "none";
lbl.style.pointerEvents = "none";

  // ✅ Content (zone éditable)
  const content = document.createElement("div");
  content.className = "zh-text-content";
  content.dataset.textContent = "1";

  content.style.flex = "1";
  content.style.width = "100%";
  content.style.height = "100%";
  content.style.minHeight = "0";
  content.style.outline = "none";
  content.style.whiteSpace = "pre-wrap";
  content.style.wordBreak = "break-word";
  content.style.overflow = "hidden";

  // ✅ le contenu (rich/plain) va dans content (PAS dans el)
  renderTextContentInto(content, obj);

  // ✅ style visuel (padding/bg/border etc) sur le conteneur
  applyTextBoxStyle(el, obj);
  
  el.style.overflow = "visible";

  // ✅ force l'alignement sur le contenu (important pour rich HTML)
  const st2 = normalizeTextStyle(obj);
  content.style.textAlign = st2.textAlign;
  content.style.lineHeight = "1.15";
  

  // ✅ en mode édition, content devient contenteditable
// ✅ le renderer ne met JAMAIS contentEditable (géré par beginEditText)

// ✅ IMPORTANT : laisser passer les events pour que le drag/resize marche
// - le drag est déjà verrouillé via .zh-drag-handle dans startAction()
// - le clic dans le contenu déclenche l'édition (startAction)
content.style.pointerEvents = "auto";
content.style.cursor = "inherit";
content.style.userSelect = editing ? "text" : "none";

content.contentEditable = "false";
content.spellcheck = false;

if (editing) {
  content.style.cursor = "text";
}




  el.appendChild(handle);
  el.appendChild(content);

  const frame = makeObjectFrameStyles(isSelected, editing, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  if (editing) {
    el.dataset.editing = "1";
  }

  // ✅ Resize handles : pas pendant édition
  if (
    !editing &&
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }

  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}


function renderImageObject(overlay, obj, isSelected, isAnchor = false) {
  const el = document.createElement("div");
  el.className = "anno-object anno-image";
  el.dataset.objectId = obj.id;
  
	const pageIndex = Number(overlay.dataset.pageIndex || "0");
	el.dataset.objId = String(obj.id);
	el.dataset.pageIndex = String(pageIndex);
	el.setAttribute("data-obj-id", String(obj.id));
	el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";
  el.draggable = false;

  const frame = makeObjectFrameStyles(isSelected, false, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  el.style.overflow = "visible";
  el.style.background = "transparent";

  const clip = document.createElement("div");
  clip.style.position = "absolute";
  clip.style.left = "0";
  clip.style.top = "0";
  clip.style.right = "0";
  clip.style.bottom = "0";
  clip.style.overflow = "hidden";
  clip.style.borderRadius = "10px";
  clip.style.background = "rgba(255,255,255,0.72)";

  const img = document.createElement("img");
  img.alt = obj.name || "image";

  const fit = String(obj.fit || "contain").toLowerCase();
  img.style.objectFit = fit === "cover" ? "cover" : fit === "fill" ? "fill" : "contain";
  img.style.objectPosition = "center center";

  img.style.width = "100%";
  img.style.height = "100%";
  img.draggable = false;

  img.style.pointerEvents = "none";

  const candidatesRaw = Array.isArray(obj?.src_candidates)
    ? obj.src_candidates
    : Array.isArray(obj?.srcCandidates)
      ? obj.srcCandidates
      : [];

  const candidates = [];
  const pushUniq = (u) => {
    const s = String(u || "").trim();
    if (!s) return;
    if (candidates.includes(s)) return;
    candidates.push(s);
  };

  pushUniq(obj?.src);
  for (const u of candidatesRaw) pushUniq(u);

  let idx = 0;
  const setSrcAt = (i) => {
    const u = String(candidates[i] || "").trim();
    if (!u) return false;
    img.src = u;
    return true;
  };

  if (!setSrcAt(idx)) img.src = String(obj?.src || "");

  img.onerror = () => {
    idx += 1;
    if (idx < candidates.length) {
      obj.src = candidates[idx];
      setSrcAt(idx);
      return;
    }
  };

  clip.appendChild(img);
  el.appendChild(clip);

  if (
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }

  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}

// ---------------------------------------------------------------------
// ✅ CLIP SHAPE (image masquée)
// ---------------------------------------------------------------------
function _clamp(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function _getClipRadius(obj) {
  const r = obj?.style?.radius ?? obj?.shape?.radius ?? obj?.radius ?? 0;
  return Math.max(0, Math.min(200, Number(r) || 0));
}

function _ensureClipImagePayload(obj) {
  if (!obj.image || typeof obj.image !== "object") obj.image = {};
  if (!Number.isFinite(Number(obj.image.scale))) obj.image.scale = 1.0;
  if (!Number.isFinite(Number(obj.image.offsetX))) obj.image.offsetX = 0;
  if (!Number.isFinite(Number(obj.image.offsetY))) obj.image.offsetY = 0;
  if (!obj.image.fit) obj.image.fit = "cover";
  return obj.image;
}


function _getClipInset(obj) {
  // stroke peut être défini via style (shape/clip_shape) ou champs legacy
  try {
    const st = normalizeShapeStyle(obj);
    const inset = st.strokeEnabled && st.strokeWidth > 0 ? Number(st.strokeWidth || 0) : 0;
    return Math.max(0, Math.min(48, inset)); // garde-fou
  } catch {
    // fallback simple
    const sw = Number(obj?.style?.strokeWidth ?? obj?.strokeWidth ?? 0);
    const se = obj?.style?.strokeEnabled ?? obj?.strokeEnabled;
    const inset = (se === false) ? 0 : (Number.isFinite(sw) ? sw : 0);
    return Math.max(0, Math.min(48, inset));
  }
}

/**
 * Clamp offsetX/offsetY pour éviter de voir du vide dans le masque.
 */
function clampClipImageOffsets(obj, frameW, frameH) {
  const im = _ensureClipImagePayload(obj);

  const fit = String(im.fit || "cover").toLowerCase();
  if (fit === "fill") return im;

  const nw = Number(im.nw || im.naturalW || 0);
  const nh = Number(im.nh || im.naturalH || 0);
  if (!(nw > 0 && nh > 0)) return im;

  const scale = Math.max(0.01, Number(im.scale || 1));

  const imgAR = nw / nh;
  const frameAR = frameW / Math.max(1, frameH);

  let baseW = frameW;
  let baseH = frameH;

  if (fit === "contain") {
    im.offsetX = 0;
    im.offsetY = 0;
    return im;
  }

  if (imgAR > frameAR) {
    baseH = frameH;
    baseW = frameH * imgAR;
  } else {
    baseW = frameW;
    baseH = frameW / imgAR;
  }

  const dispW = baseW * scale;
  const dispH = baseH * scale;

  const maxOffX = Math.max(0, (dispW - frameW) / 2);
  const maxOffY = Math.max(0, (dispH - frameH) / 2);

  im.offsetX = Math.max(-maxOffX, Math.min(maxOffX, Number(im.offsetX || 0)));
  im.offsetY = Math.max(-maxOffY, Math.min(maxOffY, Number(im.offsetY || 0)));

  return im;
}

// ✅ expose pour interactions.js (simple)
window.__ZENHUB_CLAMP_CLIP_OFFSETS__ = function (obj, totalW, totalH) {
  try {
    const inset = _getClipInset(obj);
    const frameW = Math.max(1, Number(totalW || 0) - inset * 2);
    const frameH = Math.max(1, Number(totalH || 0) - inset * 2);
    clampClipImageOffsets(obj, frameW, frameH);
  } catch {}
};


function applyClipImgLayout(img, obj, frameW, frameH) {
  const im = obj.image || {};
  const fit = String(im.fit || "cover").toLowerCase();

  const nw = Number(im.nw || 0);
  const nh = Number(im.nh || 0);
  const scale = Math.max(0.01, Number(im.scale || 1));
  const ox = Number(im.offsetX || 0);
  const oy = Number(im.offsetY || 0);

  if (!(nw > 0 && nh > 0) || !(frameW > 0 && frameH > 0)) {
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = fit === "contain" ? "contain" : fit === "fill" ? "fill" : "cover";
    img.style.transform = "none";
    return;
  }

  if (fit === "fill") {
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "fill";
    img.style.transform = "none";
    return;
  }

  const imgAR = nw / nh;
  const frameAR = frameW / Math.max(1, frameH);

  let baseW, baseH;

  if (fit === "contain") {
    if (imgAR > frameAR) {
      baseW = frameW;
      baseH = frameW / imgAR;
    } else {
      baseH = frameH;
      baseW = frameH * imgAR;
    }
  } else {
    if (imgAR > frameAR) {
      baseH = frameH;
      baseW = frameH * imgAR;
    } else {
      baseW = frameW;
      baseH = frameW / imgAR;
    }
  }

  const dispW = baseW * scale;
  const dispH = baseH * scale;

  img.style.objectFit = "unset";
  img.style.width = `${dispW}px`;
  img.style.height = `${dispH}px`;
  img.style.left = "50%";
  img.style.top = "50%";
  img.style.transformOrigin = "center center";
  img.style.transform = `translate(-50%, -50%) translate(${ox}px, ${oy}px)`;
}

function renderClipShapeObject(overlay, obj, isSelected, isAnchor = false) {
  const el = document.createElement("div");
  el.className = "anno-object anno-clip-shape";
  el.dataset.objectId = obj.id;

  const pageIndex = Number(overlay.dataset.pageIndex || "0");
	el.dataset.objId = String(obj.id);
	el.dataset.pageIndex = String(pageIndex);
	el.setAttribute("data-obj-id", String(obj.id));
	el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.userSelect = "none";
  el.style.overflow = "visible";
  el.style.background = "transparent";
  el.style.boxSizing = "border-box";


  const editingImage = isClipImageEditingThisObject(pageIndex, obj.id);

  el.style.cursor = editingImage ? "grab" : isSelected ? "move" : "pointer";

  const radius = _getClipRadius(obj);

  const clip = document.createElement("div");
  clip.className = "anno-clip-inner";
  clip.style.position = "absolute";
  clip.style.left = "0";
  clip.style.top = "0";
  clip.style.right = "0";
  clip.style.bottom = "0";
  clip.style.overflow = "hidden";
  clip.style.borderRadius = `${radius}px`;
  clip.style.boxSizing = "border-box";

  applyShapeStyle(clip, obj);

  const st = normalizeShapeStyle(obj);
  const inset = st.strokeEnabled && st.strokeWidth > 0 ? Number(st.strokeWidth || 0) : 0;

  if (inset > 0) {
    el.style.border = `${inset}px solid ${st.strokeColor || "#111827"}`;
    el.style.borderRadius = `${radius}px`;
    clip.style.border = "none";
  } else {
    el.style.border = "none";
    el.style.borderRadius = `${radius}px`;
    clip.style.border = "none";
  }

  const frameW = Math.max(1, box.w - inset * 2);
  const frameH = Math.max(1, box.h - inset * 2);

  const src =
    obj?.image && typeof obj.image.src === "string" && obj.image.src.trim()
      ? obj.image.src.trim()
      : typeof obj?.src === "string" && obj.src.trim()
        ? obj.src.trim()
        : "";

  const candidatesRaw = []
    .concat(Array.isArray(obj?.image?.src_candidates) ? obj.image.src_candidates : [])
    .concat(Array.isArray(obj?.src_candidates) ? obj.src_candidates : []);

  const candidates = candidatesRaw.map((u) => String(u || "").trim()).filter(Boolean);

  if (!obj.image || typeof obj.image !== "object") obj.image = {};
  if (!Number.isFinite(Number(obj.image.scale))) obj.image.scale = 1.0;
  if (!Number.isFinite(Number(obj.image.offsetX))) obj.image.offsetX = 0;
  if (!Number.isFinite(Number(obj.image.offsetY))) obj.image.offsetY = 0;
  if (!obj.image.fit) obj.image.fit = "cover";

  if (src) {
    const img = document.createElement("img");
    img.alt = "clipped";
    img.draggable = false;

    let idx = 0;
    const trySet = (i) => {
      const u = String(candidates[i] || "").trim();
      if (!u) return false;
      img.src = u;
      return true;
    };
    if (!trySet(idx)) img.src = src;

    img.onerror = () => {
      idx += 1;
      if (idx < candidates.length) {
        if (!obj.image) obj.image = {};
        obj.image.src = candidates[idx];
        trySet(idx);
      }
    };

    img.style.position = "absolute";
    img.style.pointerEvents = "none";
    img.style.transformOrigin = "center center";

    applyClipImgLayout(img, obj, frameW, frameH);

    img.onload = () => {
      try {
        if (!obj.image) obj.image = {};
        obj.image.nw = img.naturalWidth || 0;
        obj.image.nh = img.naturalHeight || 0;

        clampClipImageOffsets(obj, frameW, frameH);
        applyClipImgLayout(img, obj, frameW, frameH);
      } catch {}
    };

    clip.appendChild(img);

    if (editingImage) {
      const imgFrame = document.createElement("div");
      imgFrame.style.position = "absolute";
      imgFrame.style.left = "0";
      imgFrame.style.top = "0";
      imgFrame.style.right = "0";
      imgFrame.style.bottom = "0";
      imgFrame.style.outline = "2px dashed rgba(22,163,74,0.95)";
      imgFrame.style.outlineOffset = "-2px";
      imgFrame.style.pointerEvents = "none";
      clip.appendChild(imgFrame);
      el.dataset.clipEditing = "1";
    }
  } else {
    const ph = document.createElement("div");
    ph.style.position = "absolute";
    ph.style.left = "0";
    ph.style.top = "0";
    ph.style.right = "0";
    ph.style.bottom = "0";
    ph.style.pointerEvents = "none";

    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.left = "-15%";
    line.style.top = "50%";
    line.style.width = "130%";
    line.style.height = "2px";
    line.style.background = "rgba(17,24,39,0.35)";
    line.style.transform = "rotate(-35deg)";
    line.style.transformOrigin = "center center";
    ph.appendChild(line);

    clip.appendChild(ph);
  }

  el.appendChild(clip);

  const frame = makeObjectFrameStyles(isSelected, !!editingImage, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  if (
    isSelected &&
    !editingImage &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }

  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}

// ✅ renderer Product Price
function renderProductPriceObject(overlay, obj, isSelected, isAnchor = false) {
  ensureDynCache();

  const el = document.createElement("div");
  el.className = "anno-object anno-text anno-product-price";
  el.dataset.objectId = obj.id;
  
  const pageIndex = Number(overlay.dataset.pageIndex || "0");
	el.dataset.objId = String(obj.id);
	el.dataset.pageIndex = String(pageIndex);
	el.setAttribute("data-obj-id", String(obj.id));
	el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";

  applyTextBoxStyle(el, obj);

  const frame = makeObjectFrameStyles(isSelected, false, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  const dyn = obj.dynamic && obj.dynamic.kind === "product_price" ? obj.dynamic : null;
  const productId = Number(obj.product_id ?? dyn?.product_id);
  const priceMode = String(obj.price_mode ?? dyn?.price_mode ?? "base");
  const tierId = obj.tier_id ?? dyn?.tier_id ?? null;

  if (!Number.isFinite(productId) || productId <= 0) {
    el.textContent = "—";
    if (
      isSelected &&
      (isAnchor ||
        !state.multiSelected ||
        !Array.isArray(state.multiSelected.ids) ||
        state.multiSelected.ids.length <= 1)
    ) {
      addResizeHandles(el);
    }
    el.style.zIndex = getZIndexForObject(obj, isSelected);
    overlay.appendChild(el);
    return;
  }

  const cached = state.dynCache.productsById.get(productId);
  let priceValue = null;

  if (priceMode === "tier" && tierId) {
    const t = getTierInfo(productId, tierId);
    if (t && t.price_ht != null) priceValue = t.price_ht;
  } else if (cached && cached.price_ht != null) {
    priceValue = cached.price_ht;
  }

  const key = mkPriceKey(productId, priceMode, tierId || "");
  const cachedText = state.dynCache.priceByKey.get(key) || null;

  if (priceValue != null) {
    el.textContent = formatEurFr(priceValue);
    state.dynCache.priceByKey.set(key, el.textContent);
  } else if (cachedText) {
    el.textContent = cachedText;
  } else {
    el.textContent = "…";
    ensureBulkInfo([productId]).catch(() => {});
  }

  if (
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }
  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}

// ✅ renderer Product EAN
function renderProductEanObject(overlay, obj, isSelected, isAnchor = false) {
  ensureDynCache();

  const el = document.createElement("div");
  el.className = "anno-object anno-text anno-product-ean";
  el.dataset.objectId = obj.id;
  
  const pageIndex = Number(overlay.dataset.pageIndex || "0");
	el.dataset.objId = String(obj.id);
	el.dataset.pageIndex = String(pageIndex);
	el.setAttribute("data-obj-id", String(obj.id));
	el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";

  applyTextBoxStyle(el, obj);

  const frame = makeObjectFrameStyles(isSelected, false, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  const dyn = obj.dynamic && obj.dynamic.kind === "product_ean" ? obj.dynamic : null;
  const productId = Number(obj.product_id ?? dyn?.product_id);

  if (!Number.isFinite(productId) || productId <= 0) {
    el.textContent = "—";
    if (
      isSelected &&
      (isAnchor ||
        !state.multiSelected ||
        !Array.isArray(state.multiSelected.ids) ||
        state.multiSelected.ids.length <= 1)
    ) {
      addResizeHandles(el);
    }
    el.style.zIndex = getZIndexForObject(obj, isSelected);
    overlay.appendChild(el);
    return;
  }

  const cached = state.dynCache.productsById.get(productId);

  if (!cached) {
    el.textContent = "…";
    ensureBulkInfo([productId]).catch(() => {});
  } else {
    const ean13 = cached.ean13 == null ? "" : String(cached.ean13).trim();
    el.textContent = ean13 ? ean13 : "—";
  }

  if (
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }
  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}

// ✅ renderer Stock Badge
function renderStockBadgeObject(overlay, obj, isSelected, isAnchor = false) {
  ensureDynCache();

  const role = getRole();
  const dyn = obj.dynamic && obj.dynamic.kind === "product_stock_badge" ? obj.dynamic : null;

  const productId = Number(obj.product_id ?? dyn?.product_id);
  if (!Number.isFinite(productId) || productId <= 0) return;

  const cached = state.dynCache.productsById.get(productId);

  const text = String(obj.text ?? dyn?.text ?? "Rupture de stock");
  const modeLabo = String(obj.mode_labo ?? dyn?.mode_labo ?? "show_stock");
  const modeAgent = String(obj.mode_agent ?? dyn?.mode_agent ?? "only_if_zero");

  let label = "";
  let dimBecauseNotZeroInLaboTextMode = false;

  if (!cached) {
    label = "…";
    ensureBulkInfo([productId]).catch(() => {});
  } else {
    const stockRaw = cached.stock;
    const stock = stockRaw == null ? null : Number(stockRaw);
    const stockKnown = Number.isFinite(stock);
    const isZero = stockKnown ? stock <= 0 : false;

    if (role === "AGENT") {
      if (modeAgent === "always") {
        label = text;
      } else {
        if (!isZero) return;
        label = text;
      }
    } else {
      const stockLabel = `Dispo stock: ${stockKnown ? stock : "—"}`;

      if (modeLabo === "show_text") {
        label = text;
        if (stockKnown && !isZero) dimBecauseNotZeroInLaboTextMode = true;
      } else if (modeLabo === "show_both") {
        label = `${stockLabel} • ${text}`;
        if (stockKnown && !isZero) dimBecauseNotZeroInLaboTextMode = true;
      } else {
        label = stockLabel || text || "…";
      }

      if (!label) label = text || stockLabel || "…";
    }
  }

  if (!label) label = "…";

  const el = document.createElement("div");
  el.className = "anno-object anno-text anno-stock-badge";
  el.dataset.objectId = obj.id;
  
  const pageIndex = Number(overlay.dataset.pageIndex || "0");
	el.dataset.objId = String(obj.id);
	el.dataset.pageIndex = String(pageIndex);
	el.setAttribute("data-obj-id", String(obj.id));
	el.setAttribute("data-page-index", String(pageIndex));

  const box = resolveObjBox(overlay, obj);

  el.style.position = "absolute";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";

  el.textContent = label;

  applyTextBoxStyle(el, obj);

  if (dimBecauseNotZeroInLaboTextMode) {
    el.style.opacity = "0.35";
    el.title = "Stock > 0 : ce badge sera masqué côté agent (mode only_if_zero).";
  }

  const frame = makeObjectFrameStyles(isSelected, false, isAnchor);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  if (
    isSelected &&
    (isAnchor || !state.multiSelected || !Array.isArray(state.multiSelected.ids) || state.multiSelected.ids.length <= 1)
  ) {
    addResizeHandles(el);
  }
  el.style.zIndex = getZIndexForObject(obj, isSelected);
  overlay.appendChild(el);
}

// ---------------------------------------------------------------------
// PAGE RENDER
// ---------------------------------------------------------------------
export function renderPageOverlay(pageIndex) {
  ensureDynCache();
  _ensureMultiSelected();

  const overlay = state.overlaysByPage.get(pageIndex);
  if (!overlay) return;

  clearOverlay(overlay);

  const pageModel = getOrCreatePageModel(pageIndex);

  // ✅ safe: objects peut être undefined
  const rawObjects = Array.isArray(pageModel?.objects) ? pageModel.objects : [];

  // ---------------------------------------------------
  // Prefetch dyn data (products / tiers)
  // ---------------------------------------------------
  const idsToPrefetch = [];
  for (const obj of rawObjects) {
    const dyn = obj?.dynamic || null;
    const kind = dyn?.kind;

    if (obj?.type === "product_price" || kind === "product_price") {
      const pid = Number(obj.product_id ?? dyn?.product_id);
      if (pid) idsToPrefetch.push(pid);
    }
    if (obj?.type === "product_stock_badge" || kind === "product_stock_badge") {
      const pid = Number(obj.product_id ?? dyn?.product_id);
      if (pid) idsToPrefetch.push(pid);
    }
    if (obj?.type === "text" && kind === "product_ean") {
      const pid = Number(obj.product_id ?? dyn?.product_id);
      if (pid) idsToPrefetch.push(pid);
    }
    if (obj?.type === "product_ean" || kind === "product_ean") {
      const pid = Number(obj.product_id ?? dyn?.product_id);
      if (pid) idsToPrefetch.push(pid);
    }
  }
  if (idsToPrefetch.length) ensureBulkInfo(idsToPrefetch).catch(() => {});

  // ✅ tri couche
  const objects = sortObjectsByLayer(rawObjects);

  for (const obj of objects) {
    const isSelSingle =
      state.selected &&
      state.selected.pageIndex === pageIndex &&
      String(state.selected.objectId) === String(obj.id);

    const isSelMulti = isObjInMulti(pageIndex, obj.id);
    const isAnchor = isObjAnchor(pageIndex, obj.id);
    const isSel = isSelSingle || isSelMulti;

    const dyn = obj?.dynamic || null;
    const dynKind = dyn?.kind || null;

    // ✅ normalise type/kind pour routing
    const typeNorm = String(obj?.type || obj?.kind || "").toLowerCase();

    if (typeNorm === "image") {
      renderImageObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    if (typeNorm === "clip_shape" || typeNorm === "clip-shape") {
      renderClipShapeObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    if (typeNorm === "product_price" || dynKind === "product_price") {
      renderProductPriceObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    if (typeNorm === "product_stock_badge" || dynKind === "product_stock_badge") {
      renderStockBadgeObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    if (typeNorm === "product_ean" || dynKind === "product_ean") {
      renderProductEanObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    if (typeNorm === "shape") {
      renderShapeObject(overlay, obj, isSel, isAnchor);
      continue;
    }

    // ✅ TEXT (supporte text + richtext + paragraph + variantes)
  // ✅ TEXT (supporte text + richtext + paragraph + variantes)
	if (
	  typeNorm === "text" ||
	  typeNorm === "richtext" ||
	  typeNorm === "paragraph" ||
	  typeNorm === "rich_text" ||
	  typeNorm === "rich-text"
	) {
	  // ✅ ne touche pas obj.type !
	  renderTextObject(overlay, obj, isSel, isAnchor);
	  continue;
	}


    // (optionnel) debug léger si un type inconnu arrive
    // console.debug("[renderPageOverlay] unknown obj type:", obj?.type, obj?.kind, obj);
  }
}


export function rerenderAllExcept(pageIndex) {
  state.overlaysByPage.forEach((_, i) => {
    if (i !== pageIndex) renderPageOverlay(i);
  });
}

console.log("[OVERLAY_RENDER] loaded ✅ v=12");

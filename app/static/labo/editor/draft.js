// app/static/labo/editor/draft.js
import { state, uid } from "./state.js?v=12";

console.log("[DRAFT] loaded ✅ v=12");

function _ensureRoot() {
  if (!state.currentDraft) {
    throw new Error("Draft non chargé (state.currentDraft est null)");
  }
  if (!state.currentDraft.data_json || typeof state.currentDraft.data_json !== "object") {
    state.currentDraft.data_json = {};
  }
  if (!state.currentDraft.data_json.pages || !Array.isArray(state.currentDraft.data_json.pages)) {
    state.currentDraft.data_json.pages = [];
  }
}

export function ensureDraftShape() {
  if (!state.currentDraft) return;

  if (!state.currentDraft.data_json || typeof state.currentDraft.data_json !== "object") {
    state.currentDraft.data_json = {};
  }
  if (!state.currentDraft.data_json.pages || !Array.isArray(state.currentDraft.data_json.pages)) {
    state.currentDraft.data_json.pages = [];
  }
}

/**
 * ✅ RichText uses the same "pages/objects" root structure.
 * We keep a dedicated function for clarity / future evolutions.
 */
export function ensureDraftRichText() {
  if (!state.currentDraft) return;
  if (!state.currentDraft.data_json || typeof state.currentDraft.data_json !== "object") {
    state.currentDraft.data_json = {};
  }
  if (!state.currentDraft.data_json.pages || !Array.isArray(state.currentDraft.data_json.pages)) {
    state.currentDraft.data_json.pages = [];
  }
}

export function getOrCreatePageModel(pageIndex) {
  _ensureRoot();

  const pages = state.currentDraft.data_json.pages;

  while (pages.length <= pageIndex) {
    pages.push({
      pageIndex: pages.length,
      objects: [],
    });
  }

  const page = pages[pageIndex];
  if (!page.objects || !Array.isArray(page.objects)) page.objects = [];
  return page;
}

export function getObject(pageIndex, objectId) {
  try {
    const page = getOrCreatePageModel(pageIndex);
    return page.objects.find((o) => String(o.id) === String(objectId)) || null;
  } catch {
    return null;
  }
}

export function removeObject(pageIndex, objectId) {
  _ensureRoot();
  const page = getOrCreatePageModel(pageIndex);
  page.objects = (page.objects || []).filter((o) => String(o.id) !== String(objectId));
}

// ------------------------------------------------------------
// Generic helpers
// ------------------------------------------------------------
export function upsertObject(pageIndex, obj) {
  _ensureRoot();
  if (!obj || obj.id == null) return null;

  const page = getOrCreatePageModel(pageIndex);
  if (!page.objects || !Array.isArray(page.objects)) page.objects = [];

  const oid = String(obj.id);
  const idx = page.objects.findIndex((o) => String(o.id) === oid);

  if (idx >= 0) {
    // merge pour garder d’éventuels champs existants
    page.objects[idx] = { ...page.objects[idx], ...obj, id: page.objects[idx].id };
    return page.objects[idx];
  }

  page.objects.push(obj);
  return obj;
}

// ------------------------------------------------------------
// ✅ RichText object (paragraph with inline runs)
// ------------------------------------------------------------
export function addRichTextObject(pageIndex, opts = {}) {
  _ensureRoot();
  const page = getOrCreatePageModel(pageIndex);

  const id = uid ? uid("rt") : (Date.now() + "_" + Math.random().toString(16).slice(2));

  const x = Number(opts.x ?? 120);
  const y = Number(opts.y ?? 120);
  const w = Number(opts.w ?? 340);
  const h = Number(opts.h ?? 140);

  const fontFamily = String(opts.fontFamily ?? "helv");
  const fontSize = Number(opts.fontSize ?? 16);
  const fontWeight = String(opts.fontWeight ?? "400");
  const color = String(opts.color ?? "#111827");

  const alignRaw = String(opts.align ?? "left").toLowerCase();
  const align = ["left", "center", "right", "justify"].includes(alignRaw) ? alignRaw : "left";

  const lineHeight = Number(opts.lineHeight ?? 1.25);
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1.25;

  const layerRaw = String(opts.layer ?? "front").toLowerCase();
  const layer = layerRaw === "back" ? "back" : "front";

  const runs = Array.isArray(opts.runs)
    ? opts.runs
        .map((r) => {
          const text = String(r?.text ?? "");
          if (!text) return null;
          const out = { text };

          if (r.bold != null) out.bold = !!r.bold;
          if (r.fontSize != null) {
            const fs = Number(r.fontSize);
            if (Number.isFinite(fs) && fs > 0) out.fontSize = fs;
          }
          if (r.color != null) out.color = String(r.color);
          if (r.fontFamily != null) out.fontFamily = String(r.fontFamily);
          if (r.fontWeight != null) out.fontWeight = String(r.fontWeight);

          return out;
        })
        .filter(Boolean)
    : null;

  const obj = {
    id,
    type: "richtext",
    pageIndex, // ✅ utile côté UI

    x,
    y,
    w,
    h,

    // ✅ rel coords explicites
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,

    // default block style
    fontFamily,
    fontSize,
    fontWeight,
    color,
    align,
    lineHeight: safeLineHeight,

    // layer (front/back)
    layer,

    // styled segments
    runs: (runs && runs.length) ? runs : [{ text: "Nouveau paragraphe", bold: false }],
  };

  page.objects.push(obj);
  return obj;
}

// ------------------------------------------------------------
// Dynamic objects helpers
// ------------------------------------------------------------
export function addProductEanObject(pageIndex, opts = {}) {
  _ensureRoot();
  const page = getOrCreatePageModel(pageIndex);

  const productId = Number(opts.product_id ?? opts.productId ?? 0);
  const id = uid ? uid("obj") : (Date.now() + "_" + Math.random().toString(16).slice(2));

  const fontFamily = String(opts.fontFamily ?? "helv"); // ✅ safe default
  const fontSize = Number(opts.fontSize ?? 16);
  const fontWeight = String(opts.fontWeight ?? "400");
  const color = opts.color ?? "#111827";

  const bgEnabled = opts.bgEnabled ?? false;
  const bgMode = opts.bgMode ?? "transparent";
  const bgColor = opts.bgColor ?? "rgba(255,255,255,0.72)";

  const borderEnabled = opts.borderEnabled ?? false;
  const borderWidth = Number(opts.borderWidth ?? 1);
  const borderColor = opts.borderColor ?? "#111827";

  const obj = {
    id,
    type: "text",

    x: 120,
    y: 120,
    w: 240,
    h: 48,

    // ✅ patch: rel coords explicites
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,

    text: "—",

    // legacy
    fontFamily,
    fontSize,
    fontWeight,
    color,

    bgEnabled,
    bgMode,
    bgColor,

    borderEnabled,
    borderWidth,
    borderColor,

    textAlign: "center",

    // ✅ NEW style object (overlay_render reads it first)
    style: {
      fontFamily,
      fontSize,
      fontWeight,
      color,
      bgEnabled,
      bgMode,
      bgColor,
      borderEnabled,
      borderWidth,
      borderColor,
      textAlign: "center",
    },

    dynamic: {
      kind: "product_ean",
      product_id: Number.isFinite(productId) && productId > 0 ? productId : null,
    },
  };

  page.objects.push(obj);
  return obj;
}

// ------------------------------------------------------------
// Clip-Shape object (shape + image inside with clipping mask)
// ------------------------------------------------------------
export function addClipShapeObject(pageIndex, opts = {}) {
  _ensureRoot();
  const page = getOrCreatePageModel(pageIndex);

  const id = uid ? uid("obj") : Date.now() + "_" + Math.random().toString(16).slice(2);

  const x = Number(opts.x ?? 120);
  const y = Number(opts.y ?? 120);
  const w = Number(opts.w ?? 240);
  const h = Number(opts.h ?? 160);

  const radius = Number(opts.radius ?? 14);

  // Shape style defaults
  const fillEnabled = opts.fillEnabled ?? true;
  const fillType = String(opts.fillType ?? "solid").toLowerCase() === "gradient" ? "gradient" : "solid";
  const fillColor = String(opts.fillColor ?? "rgba(37,99,235,0.12)");

  const strokeEnabled = opts.strokeEnabled ?? true;
  const strokeWidth = Number(opts.strokeWidth ?? 2);
  const strokeColor = String(opts.strokeColor ?? "rgba(37,99,235,0.9)");

  // Internal image defaults
  const src = String(opts.src ?? "").trim();
  const fitRaw = String(opts.fit ?? "cover").toLowerCase();
  const fit = fitRaw === "contain" ? "contain" : fitRaw === "fill" ? "fill" : "cover";
  const scale = Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1;
  const offsetX = Number.isFinite(Number(opts.offsetX)) ? Number(opts.offsetX) : 0;
  const offsetY = Number.isFinite(Number(opts.offsetY)) ? Number(opts.offsetY) : 0;

  // ✅ patch: fallbacks HD possibles
  const src_candidates = Array.isArray(opts.src_candidates)
    ? opts.src_candidates.map((u) => String(u || "").trim()).filter(Boolean)
    : Array.isArray(opts.srcCandidates)
      ? opts.srcCandidates.map((u) => String(u || "").trim()).filter(Boolean)
      : [];

  // ✅ dedupe + ensure root src included first
  const uniq = [];
  const pushUniq = (u) => {
    const s = String(u || "").trim();
    if (!s) return;
    if (uniq.includes(s)) return;
    uniq.push(s);
  };
  pushUniq(src);
  for (const u of src_candidates) pushUniq(u);

  const obj = {
    id,
    type: "clip_shape",
    pageIndex, // ✅ utile (tu l'utilises côté UI)

    x,
    y,
    w,
    h,

    // ✅ rel coords explicites
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,

    // shape descriptor (arrondis)
    shape: { kind: "round_rect", radius },

    // legacy (si besoin)
    radius,

    // ✅ IMPORTANT: overlay_render lit obj.src / obj.src_candidates
    src,
    src_candidates: uniq,

    // ✅ style (reprend normalizeShapeStyle)
    style: {
      kind: "round_rect",
      radius,
      fillEnabled,
      fillType,
      fillColor,
      fillGradient: opts.fillGradient ?? null,
      strokeEnabled,
      strokeWidth,
      strokeColor,
    },

    // ✅ image interne (déplacée/zoomée dans le masque)
    image: {
      scale,
      offsetX,
      offsetY,
      fit,
    },
  };

  page.objects.push(obj);
  return obj;
}

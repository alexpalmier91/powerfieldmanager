// app/static/labo/editor/shapes_tools.js
// ------------------------------------------------------------
// Shapes tool (rectangles / rounded rectangles / lines)
// - create shapes in draft
// - edit shape properties (fill/stroke/radius)
// - helper: center a text inside a shape (1 shape + 1 text selected)
//   with optional mode: X / Y / XY
// ------------------------------------------------------------

import { state, uid, clamp, setStatus } from "./state.js?v=12";
import { getOrCreatePageModel, getObject } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";
import { getActiveSelectionInfo, setSelected } from "./interactions.js?v=12";

// ✅ signature de chargement
console.log("[SHAPES_TOOLS] LOADED ✅", import.meta.url, "ts=", Date.now());

// ------------------------------------------------------------
// Gradient helpers (soft migration + sanitizers)
// Draft format:
// - fillColor: kept for retro-compat (solid fill)
// - fillType: "solid" | "gradient" (optional; default "solid")
// - fillGradient: { type:"linear"|"radial", angle:number, stops:[{pos:0..1,color:"#rrggbb"|...}] }
// ------------------------------------------------------------
function _clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function _normAngle(a) {
  const n = Number(a);
  if (!Number.isFinite(n)) return 0;
  // keep 0..360 (inclusive OK)
  let v = n % 360;
  if (v < 0) v += 360;
  return v;
}

function _sanitizeStops(stops, fallbackColor = "#ffffff") {
  const arr = Array.isArray(stops) ? stops : [];
  const out = arr
    .map((s) => ({
      pos: _clamp01(s?.pos),
      color: String(s?.color || fallbackColor),
    }))
    .sort((a, b) => a.pos - b.pos);

  if (out.length < 2) {
    return [
      { pos: 0, color: fallbackColor },
      { pos: 1, color: "#000000" },
    ];
  }

  // force bounds
  out[0].pos = 0;
  out[out.length - 1].pos = 1;

  return out;
}

/**
 * Soft migration: old shapes => fillType="solid"
 * Ensure fillColor always exists
 * Ensure fillGradient is valid when fillType="gradient"
 */
export function normalizeShapeFill(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (!obj.fillType) obj.fillType = "solid";
  const ft = String(obj.fillType || "solid").toLowerCase();

  if (obj.fillColor == null) obj.fillColor = DEFAULT_SHAPE.fillColor;

  if (ft === "gradient") {
    if (!obj.fillGradient || typeof obj.fillGradient !== "object") {
      obj.fillGradient = {
        type: "linear",
        angle: 0,
        stops: [
          { pos: 0, color: String(obj.fillColor || "#ffffff") },
          { pos: 1, color: "#000000" },
        ],
      };
    }

    const g = obj.fillGradient;
    g.type = String(g.type || "linear").toLowerCase() === "radial" ? "radial" : "linear";
    g.angle = _normAngle(g.angle);
    g.stops = _sanitizeStops(g.stops, String(obj.fillColor || "#ffffff"));
  } else {
    // solid => keep fillColor, drop gradient payload to keep JSON clean
    obj.fillType = "solid";
    // Do NOT delete blindly if you prefer keeping it, but spec says "cleanly store"
    if (obj.fillGradient != null) obj.fillGradient = null;
  }

  return obj;
}

function _makeDefaultGradientFromFillColor(fillColor) {
  const base = String(fillColor || "#ffffff");
  return {
    type: "linear",
    angle: 0,
    stops: [
      { pos: 0, color: base },
      { pos: 1, color: "#000000" },
    ],
  };
}

// ------------------------------------------------------------
// Shape defaults
// ------------------------------------------------------------
export const DEFAULT_SHAPE = {
  kind: "rect", // "rect" | "round_rect" | "line"
  radius: 12,
  fillColor: "rgba(37,99,235,0.15)",
  strokeColor: "rgba(37,99,235,0.9)",
  strokeWidth: 2,
  layer: "front",
  // Gradient defaults (not stored unless used)
  fillType: "solid",
  fillGradient: null,
};

// ------------------------------------------------------------
// Center mode helpers (X / Y / XY)
// ------------------------------------------------------------
function _normCenterMode(mode) {
  const m = String(mode ?? state.centerTextMode ?? "x").toLowerCase().trim();
  if (m === "y") return "y";
  if (m === "xy" || m === "both") return "xy";
  return "x";
}

export function setCenterTextMode(mode) {
  state.centerTextMode = _normCenterMode(mode);
  const label = state.centerTextMode.toUpperCase();
  setStatus(`Centrage texte : ${label}`);
}

// ------------------------------------------------------------
// Tool activation
// ------------------------------------------------------------
export function setActiveShapeTool(kind = "rect") {
  const k = String(kind || "rect").toLowerCase();
  const safe = k === "round_rect" || k === "line" || k === "rect" ? k : "rect";

  state.activeTool = {
    type: "shape",
    kind: safe,
    preset: { ...DEFAULT_SHAPE, kind: safe },
  };

  setStatus(
    safe === "line"
      ? "Outil forme : ligne"
      : safe === "round_rect"
      ? "Outil forme : rectangle arrondi"
      : "Outil forme : rectangle"
  );
}

// ------------------------------------------------------------
// Insert shape on overlay click (called by insertOnOverlayClick)
// ------------------------------------------------------------
export function insertShapeAtClick(e, overlay) {
  if (!overlay || !state.currentDraft) return;
  if (!state.activeTool || state.activeTool.type !== "shape") return;

  const pageIndex = Number(overlay.dataset.pageIndex || "0");
  const pm = getOrCreatePageModel(pageIndex);

  const rect = overlay.getBoundingClientRect();
  const x = Math.round(
    (e.clientX - rect.left) * ((overlay.width || overlay.clientWidth) / rect.width)
  );
  const y = Math.round(
    (e.clientY - rect.top) * ((overlay.height || overlay.clientHeight) / rect.height)
  );

  const preset = state.activeTool.preset || DEFAULT_SHAPE;
  const kind = String(preset.kind || "rect").toLowerCase();

  let w = 220;
  let h = 90;
  if (kind === "line") {
    w = 240;
    h = 16;
  }

  const obj = {
    id: uid(),
    type: "shape",
    x: clamp(x - Math.round(w / 2), 0, 999999),
    y: clamp(y - Math.round(h / 2), 0, 999999),
    w,
    h,
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,
    layer: preset.layer || "front",
    shape: {
      kind,
      radius: Number(preset.radius ?? DEFAULT_SHAPE.radius),
    },

    // Fill (solid/gradient)
    fillColor: preset.fillColor ?? DEFAULT_SHAPE.fillColor,
    fillType: String(preset.fillType || "solid").toLowerCase() === "gradient" ? "gradient" : "solid",
    fillGradient:
      String(preset.fillType || "solid").toLowerCase() === "gradient"
        ? (preset.fillGradient && typeof preset.fillGradient === "object"
            ? {
                type: String(preset.fillGradient.type || "linear").toLowerCase() === "radial" ? "radial" : "linear",
                angle: _normAngle(preset.fillGradient.angle),
                stops: _sanitizeStops(preset.fillGradient.stops, String(preset.fillColor ?? DEFAULT_SHAPE.fillColor)),
              }
            : _makeDefaultGradientFromFillColor(preset.fillColor ?? DEFAULT_SHAPE.fillColor))
        : null,

    strokeColor: preset.strokeColor ?? DEFAULT_SHAPE.strokeColor,
    strokeWidth: Number(preset.strokeWidth ?? DEFAULT_SHAPE.strokeWidth),

    line:
      kind === "line"
        ? { x0: 0.05, y0: 0.5, x1: 0.95, y1: 0.5 }
        : null,
  };

  // normalize for safety (ensures clean JSON)
  normalizeShapeFill(obj);

  pm.objects.push(obj);

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);

  window.__ZENHUB_LAST_SHAPE__ = obj;
  console.log("[SHAPES] created obj =", obj);

  setStatus("Forme ajoutée");

  state.selected = { pageIndex, objectId: obj.id };
  state.activeTool = null;
}

// ------------------------------------------------------------
// Selection helpers + robust object lookup
// ------------------------------------------------------------
function _findObjectOnPage(pageIndex, id) {
  const oid = String(id);

  try {
    const o = getObject(pageIndex, oid);
    if (o) return o;
  } catch (_) {}

  try {
    const pm = getOrCreatePageModel(pageIndex);

    if (pm && Array.isArray(pm.objects)) {
      const inObjects = pm.objects.find((o) => o && String(o.id) === oid);
      if (inObjects) return inObjects;
    }

    if (pm && Array.isArray(pm.overlays)) {
      const inOverlays = pm.overlays.find((o) => o && String(o.id) === oid);
      if (inOverlays) return inOverlays;
    }
  } catch (_) {}

  try {
    if (Array.isArray(window.__ZENHUB_ALL_OBJS__)) {
      const g = window.__ZENHUB_ALL_OBJS__.find((o) => o && String(o.id) === oid);
      if (g) return g;
    }
  } catch (_) {}

  return null;
}

function _patchAllByIdOnPage(pageIndex, id, patch = {}) {
  const oid = String(id);
  let touched = 0;

  try {
    const pm = getOrCreatePageModel(pageIndex);

    const apply = (o) => {
      if (!o || String(o.id) !== oid) return false;
      Object.assign(o, patch);
      return true;
    };

    if (pm && Array.isArray(pm.objects)) {
      for (const o of pm.objects) if (apply(o)) touched++;
    }
    if (pm && Array.isArray(pm.overlays)) {
      for (const o of pm.overlays) if (apply(o)) touched++;
    }
  } catch (_) {}

  try {
    if (Array.isArray(window.__ZENHUB_ALL_OBJS__)) {
      for (const o of window.__ZENHUB_ALL_OBJS__) {
        if (!o || String(o.id) !== oid) continue;
        Object.assign(o, patch);
        touched++;
      }
    }
  } catch (_) {}

  return touched;
}

function _getSelectedObjectsOnSamePage() {
  const anyPageIndex = state.selected?.pageIndex ?? state.multiSelected?.pageIndex ?? null;
  if (anyPageIndex == null) return { pageIndex: null, objs: [], ids: [] };

  const info = getActiveSelectionInfo(Number(anyPageIndex));
  const pageIndex = info.pageIndex;

  if (!info.ids || !info.ids.length) return { pageIndex, objs: [], ids: [] };

  const ids = info.ids.map(String);
  const objs = ids.map((id) => _findObjectOnPage(pageIndex, id)).filter(Boolean);

  return { pageIndex, objs, ids };
}

function _onlyOneSelectedShape() {
  const { pageIndex, objs } = _getSelectedObjectsOnSamePage();
  if (pageIndex == null) return { pageIndex: null, shape: null };

  const shapes = objs.filter((o) => o && String(o.type || "").toLowerCase() === "shape");
  if (shapes.length !== 1) return { pageIndex, shape: null };
  return { pageIndex, shape: shapes[0] };
}

// ------------------------------------------------------------
// Type guards
// ------------------------------------------------------------
function _isRectShape(obj) {
  if (!obj) return false;

  const oid = String(obj.id || "");
  const type = String(obj.type || "").toLowerCase();

  const rawKind =
    obj.shape?.kind ??
    obj.shapeKind ??
    obj.shape_kind ??
    obj.kind ??
    obj.shape_type ??
    "";

  const kind = String(rawKind || "").toLowerCase();

  const hasBox =
    Number.isFinite(Number(obj.x)) &&
    Number.isFinite(Number(obj.y)) &&
    Number.isFinite(Number(obj.w)) &&
    Number.isFinite(Number(obj.h));

  const looksLikeShapeStyle =
    obj.fillColor != null ||
    obj.strokeColor != null ||
    obj.strokeWidth != null ||
    obj.fillType != null ||
    obj.fillGradient != null ||
    (obj.shape && typeof obj.shape === "object");

  const idSaysShape = oid.startsWith("shp_");
  const typeSaysShape = type === "shape";

  if (kind === "rect" || kind === "round_rect") return true;
  if (kind === "line") return false;

  if ((idSaysShape || typeSaysShape) && hasBox && looksLikeShapeStyle) return true;

  return false;
}

function _isTextObj(obj) {
  if (!obj) return false;

  const oid = String(obj.id || "");
  if (oid.startsWith("txt_")) return true;

  const type = String(obj.type || "").toLowerCase();
  if (type === "text") return true;

  const kind = String(obj.kind || "").toLowerCase();
  if (kind === "text") return true;

  const hasContent =
    typeof obj.text === "string" ||
    typeof obj.value === "string" ||
    typeof obj.content === "string";

  return Boolean(hasContent);
}

// ------------------------------------------------------------
// DOM estimates (w/h) when missing in draft
// ------------------------------------------------------------
function _estimateTextSizeFromDom(textId) {
  if (!textId) return null;

  const id = String(textId);
  const selectors = [
    `[data-oid="${CSS.escape(id)}"]`,
    `[data-object-id="${CSS.escape(id)}"]`,
    `[data-id="${CSS.escape(id)}"]`,
    `#overlay-${CSS.escape(id)}`,
    `#obj-${CSS.escape(id)}`,
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;

    const r = el.getBoundingClientRect?.();
    const w = el.offsetWidth || r?.width;
    const h = el.offsetHeight || r?.height;

    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      return { w, h };
    }
  }

  return null;
}

function _getPageWidthPx(pageIndex) {
  const pi = String(pageIndex);
  const candidates = [
    `canvas[data-page-index="${CSS.escape(pi)}"]`,
    `#pdfContainer canvas[data-page-index="${CSS.escape(pi)}"]`,
    `.pdf-page-overlay[data-page-index="${CSS.escape(pi)}"]`,
    `.page-overlay[data-page-index="${CSS.escape(pi)}"]`,
    `[data-page-index="${CSS.escape(pi)}"]`,
  ];

  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;

    const w = el.width || el.clientWidth || el.getBoundingClientRect?.().width;
    if (Number.isFinite(w) && w > 0) return w;
  }
  return null;
}

function _getPageHeightPx(pageIndex) {
  const pi = String(pageIndex);
  const candidates = [
    `canvas[data-page-index="${CSS.escape(pi)}"]`,
    `#pdfContainer canvas[data-page-index="${CSS.escape(pi)}"]`,
    `.pdf-page-overlay[data-page-index="${CSS.escape(pi)}"]`,
    `.page-overlay[data-page-index="${CSS.escape(pi)}"]`,
    `[data-page-index="${CSS.escape(pi)}"]`,
  ];

  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;

    const h = el.height || el.clientHeight || el.getBoundingClientRect?.().height;
    if (Number.isFinite(h) && h > 0) return h;
  }
  return null;
}

// ------------------------------------------------------------
// Apply properties to selected shapes
// Now supports: fillType + fillGradient (soft migration)
// ------------------------------------------------------------
export function applyShapePropsToSelection(props = {}) {
  const { pageIndex, objs } = _getSelectedObjectsOnSamePage();
  if (pageIndex == null) return;

  const targets = objs.filter((o) => o && String(o.type || "").toLowerCase() === "shape");
  if (!targets.length) return;

  for (const obj of targets) {
    // Ensure fill fields exist (retro-compat)
    normalizeShapeFill(obj);

    if (props.layer === "back" || props.layer === "front") obj.layer = props.layer;

    // ---------- Fill (solid/gradient) ----------
    // If user explicitly changes fillType:
    if (props.fillType != null) {
      const ft = String(props.fillType || "solid").toLowerCase();
      obj.fillType = ft === "gradient" ? "gradient" : "solid";

      if (obj.fillType === "solid") {
        // Solid: keep fillColor, remove gradient data
        if (props.fillColor != null) obj.fillColor = String(props.fillColor);
        obj.fillGradient = null;
      } else {
        // Gradient: keep fillColor for compat and define fillGradient
        if (props.fillColor != null) obj.fillColor = String(props.fillColor);

        if (props.fillGradient && typeof props.fillGradient === "object") {
          const g = props.fillGradient;
          obj.fillGradient = {
            type: String(g.type || "linear").toLowerCase() === "radial" ? "radial" : "linear",
            angle: _normAngle(g.angle),
            stops: _sanitizeStops(g.stops, String(obj.fillColor || DEFAULT_SHAPE.fillColor)),
          };
        } else if (!obj.fillGradient) {
          obj.fillGradient = _makeDefaultGradientFromFillColor(obj.fillColor);
        }
      }
    } else {
      // No fillType change, allow updating pieces
      if (props.fillColor != null) obj.fillColor = String(props.fillColor);

      if (props.fillGradient != null) {
        // If gradient updated, switch to gradient implicitly (UX-friendly)
        obj.fillType = "gradient";
        const g = props.fillGradient || {};
        obj.fillGradient = {
          type: String(g.type || "linear").toLowerCase() === "radial" ? "radial" : "linear",
          angle: _normAngle(g.angle),
          stops: _sanitizeStops(g.stops, String(obj.fillColor || DEFAULT_SHAPE.fillColor)),
        };
      }
    }

    // ---------- Stroke ----------
    if (props.strokeColor != null) obj.strokeColor = String(props.strokeColor);

    if (props.strokeWidth != null) {
      const sw = Number(props.strokeWidth);
      obj.strokeWidth = Number.isFinite(sw) ? Math.max(0, Math.min(64, sw)) : obj.strokeWidth;
    }

    // ---------- Shape kind ----------
    const sk = props.kind != null ? String(props.kind).toLowerCase() : null;
    if (sk === "rect" || sk === "round_rect" || sk === "line") {
      obj.shape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
      obj.shape.kind = sk;
      if (sk !== "line" && obj.line) obj.line = null;
      if (sk === "line" && !obj.line) obj.line = { x0: 0.05, y0: 0.5, x1: 0.95, y1: 0.5 };
    }

    // ---------- Radius ----------
    if (props.radius != null) {
      const r = Number(props.radius);
      const rr = Number.isFinite(r) ? Math.max(0, Math.min(200, r)) : 0;
      obj.shape = obj.shape && typeof obj.shape === "object" ? obj.shape : {};
      obj.shape.radius = rr;
    }

    // Final normalize to keep JSON clean
    normalizeShapeFill(obj);
  }

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);
  setStatus(`Forme(s) mise(s) à jour (${targets.length})`);
}

// ------------------------------------------------------------
// Center text in shape (mode: x | y | xy)
// - X: newX = shape.x + (shape.w - text.w)/2
// - Y: newY = shape.y + (shape.h - text.h)/2
// ------------------------------------------------------------
export function centerTextInsideShapeSelection(mode = null) {
  const centerMode = _normCenterMode(mode);

  const { pageIndex, objs, ids } = _getSelectedObjectsOnSamePage();
  if (pageIndex == null) return;

  if (!ids || ids.length !== 2 || !objs || objs.length !== 2) {
    setStatus("Sélectionne 1 texte + 1 forme (rectangle)");
    return;
  }

  let shape = null;
  let text = null;

  for (const o of objs) {
    if (!shape && _isRectShape(o)) shape = o;
    else if (!text && _isTextObj(o)) text = o;
  }

  if (!shape || !text) {
    setStatus("Sélectionne 1 texte + 1 forme (rectangle)");
    return;
  }

  const sx = Number(shape.x);
  const sy = Number(shape.y);
  const sw = Number(shape.w);
  const sh = Number(shape.h);

  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(sw) ||
    !Number.isFinite(sh) ||
    sw <= 0 ||
    sh <= 0
  ) {
    setStatus("Forme invalide (x/y/w/h requis)");
    return;
  }

  // resolve text w/h
  let tw = Number(text.w);
  let th = Number(text.h);

  if (!Number.isFinite(tw) || tw <= 0 || !Number.isFinite(th) || th <= 0) {
    const est = _estimateTextSizeFromDom(text.id);
    if (est) {
      if (!Number.isFinite(tw) || tw <= 0) tw = est.w;
      if (!Number.isFinite(th) || th <= 0) th = est.h;
    }
  }

  // For X-mode we only need w, for Y-mode we only need h
  if ((centerMode === "x" || centerMode === "xy") && (!Number.isFinite(tw) || tw <= 0)) {
    setStatus("Impossible d’estimer la largeur du texte (w manquant)");
    return;
  }
  if ((centerMode === "y" || centerMode === "xy") && (!Number.isFinite(th) || th <= 0)) {
    setStatus("Impossible d’estimer la hauteur du texte (h manquant)");
    return;
  }

  const oldX = Number(text.x);
  const oldY = Number(text.y);

  let newX = oldX;
  let newY = oldY;

  if (centerMode === "x" || centerMode === "xy") {
    newX = Math.round(sx + (sw - tw) / 2);
  }
  if (centerMode === "y" || centerMode === "xy") {
    newY = Math.round(sy + (sh - th) / 2);
  }

  // compute rels if present
  let newXRel = null;
  let newYRel = null;

  if (text.x_rel != null && (centerMode === "x" || centerMode === "xy")) {
    const pageW = _getPageWidthPx(pageIndex);
    if (Number.isFinite(pageW) && pageW > 0) newXRel = newX / pageW;
  }
  if (text.y_rel != null && (centerMode === "y" || centerMode === "xy")) {
    const pageH = _getPageHeightPx(pageIndex);
    if (Number.isFinite(pageH) && pageH > 0) newYRel = newY / pageH;
  }

  // patch canonique (toutes les copies)
  const patch = {};
  if (centerMode === "x" || centerMode === "xy") {
    patch.x = newX;
    if (newXRel != null) patch.x_rel = newXRel;
  }
  if (centerMode === "y" || centerMode === "xy") {
    patch.y = newY;
    if (newYRel != null) patch.y_rel = newYRel;
  }

  _patchAllByIdOnPage(pageIndex, text.id, patch);

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);

  try {
    const anchorId = String(state.multiSelected?.anchorId || ids[0]);
    setSelected(pageIndex, ids, anchorId);
  } catch (_) {}

  const label = centerMode.toUpperCase();
  setStatus(`Texte centré (${label}) ✅`);
}

// ------------------------------------------------------------
// Optional: sync shape tool preset from selected shape
// Now also remembers gradient fields
// ------------------------------------------------------------
export function rememberShapePresetFromSelected() {
  const { pageIndex, shape } = _onlyOneSelectedShape();
  if (pageIndex == null || !shape) return;

  normalizeShapeFill(shape);

  const kind = String(shape?.shape?.kind || "rect").toLowerCase();

  state.shapePreset = {
    kind: kind === "round_rect" || kind === "line" || kind === "rect" ? kind : "rect",
    radius: Number(shape?.shape?.radius ?? DEFAULT_SHAPE.radius),

    fillColor: String(shape.fillColor ?? DEFAULT_SHAPE.fillColor),
    fillType: String(shape.fillType || "solid") === "gradient" ? "gradient" : "solid",
    fillGradient:
      String(shape.fillType || "solid") === "gradient" && shape.fillGradient
        ? {
            type: String(shape.fillGradient.type || "linear").toLowerCase() === "radial" ? "radial" : "linear",
            angle: _normAngle(shape.fillGradient.angle),
            stops: _sanitizeStops(shape.fillGradient.stops, String(shape.fillColor ?? DEFAULT_SHAPE.fillColor)),
          }
        : null,

    strokeColor: String(shape.strokeColor ?? DEFAULT_SHAPE.strokeColor),
    strokeWidth: Number(shape.strokeWidth ?? DEFAULT_SHAPE.strokeWidth),
    layer: String(shape.layer || "front"),
  };
}

// ------------------------------------------------------------
// Programmatic creation (used by insertToolObjectAt)
// ------------------------------------------------------------
export function createShapeObjAt(pageIndex, x, y, presetOverride = null) {
  if (!state.currentDraft) return null;

  const pm = getOrCreatePageModel(Number(pageIndex || 0));
  const preset = presetOverride || state.activeTool?.preset || DEFAULT_SHAPE;
  const kind = String(preset.kind || "rect").toLowerCase();

  let w = 220;
  let h = 90;
  if (kind === "line") {
    w = 240;
    h = 16;
  }

  const fillType = String(preset.fillType || "solid").toLowerCase() === "gradient" ? "gradient" : "solid";
  const fillColor = preset.fillColor ?? DEFAULT_SHAPE.fillColor;

  const obj = {
    id: uid(),
    type: "shape",
    x: clamp(Math.round(x - w / 2), 0, 999999),
    y: clamp(Math.round(y - h / 2), 0, 999999),
    w,
    h,
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,
    layer: preset.layer || "front",
    shape: {
      kind: kind === "round_rect" || kind === "line" || kind === "rect" ? kind : "rect",
      radius: Number(preset.radius ?? DEFAULT_SHAPE.radius),
    },

    // Fill (solid/gradient)
    fillColor: fillColor,
    fillType: fillType,
    fillGradient:
      fillType === "gradient"
        ? (preset.fillGradient && typeof preset.fillGradient === "object"
            ? {
                type: String(preset.fillGradient.type || "linear").toLowerCase() === "radial" ? "radial" : "linear",
                angle: _normAngle(preset.fillGradient.angle),
                stops: _sanitizeStops(preset.fillGradient.stops, String(fillColor)),
              }
            : _makeDefaultGradientFromFillColor(fillColor))
        : null,

    strokeColor: preset.strokeColor ?? DEFAULT_SHAPE.strokeColor,
    strokeWidth: Number(preset.strokeWidth ?? DEFAULT_SHAPE.strokeWidth),
    line: kind === "line" ? { x0: 0.05, y0: 0.5, x1: 0.95, y1: 0.5 } : null,
  };

  normalizeShapeFill(obj);

  pm.objects.push(obj);

  renderPageOverlay(Number(pageIndex || 0));
  rerenderAllExcept(Number(pageIndex || 0));
  return obj;
}

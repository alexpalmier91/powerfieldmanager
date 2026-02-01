// app/static/labo/editor/ui_tools.js
import { state, setStatus, uid, clamp } from "./state.js?v=12";
import { getGridSettings, snapRect } from "./grid_tools.js";

import { getOrCreatePageModel, getObject, addClipShapeObject, addRichTextObject } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";
import { setSelected } from "./interactions.js?v=12";
import { API_BASE, fetchJSON } from "./api.js?v=12";
import { createShapeObjAt } from "./shapes_tools.js?v=12";


import {
  setObjLayer,
  bindLayerSwitchesUI,
  syncLayerSwitchesFromSelection,
} from "./layer_tools.js?v=12";

// =====================================================
// ✅ LAYERS (front/back) — buttons (no on/off)
// =====================================================
function _ensureLayerPresets() {
  if (!state.layerPresets || typeof state.layerPresets !== "object") {
    state.layerPresets = {
      text: "front",
      image: "front",
      dyn: "front",
      shape: "front",
      clip_shape: "front",
    };
  } else {
    if (!state.layerPresets.text) state.layerPresets.text = "front";
    if (!state.layerPresets.image) state.layerPresets.image = "front";
    if (!state.layerPresets.dyn) state.layerPresets.dyn = "front";
    if (!state.layerPresets.shape) state.layerPresets.shape = "front";
    if (!state.layerPresets.clip_shape) state.layerPresets.clip_shape = "front";
  }
  return state.layerPresets;
}


function _normalizeLayer(v) {
  return String(v || "").toLowerCase() === "back" ? "back" : "front";
}

function _getActiveIdsOnCurrentPage() {
  const ms = state.multiSelected;
  if (ms && ms.pageIndex != null && Array.isArray(ms.ids) && ms.ids.length) {
    return { pageIndex: ms.pageIndex, ids: ms.ids.map(String) };
  }
  if (state.selected) {
    return { pageIndex: state.selected.pageIndex, ids: [String(state.selected.objectId)] };
  }
  return null;
}

// =====================================================
// Multi selection helpers
// =====================================================
function getSelectionForAlign() {
  const ms = state.multiSelected;
  if (ms && ms.pageIndex != null && Array.isArray(ms.ids) && ms.ids.length) {
    return {
      pageIndex: ms.pageIndex,
      ids: ms.ids.map(String),
      anchorId: String(ms.anchorId || ms.ids[0]),
    };
  }
  if (state.selected) {
    return {
      pageIndex: state.selected.pageIndex,
      ids: [String(state.selected.objectId)],
      anchorId: String(state.selected.objectId),
    };
  }
  return null;
}

// ✅ robust overlay size (same as interactions.js)
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

// conversion client pixels -> overlay units
function getOverlayMetrics(overlay) {
  const rect = overlay.getBoundingClientRect();
  const { ow, oh } = _getOverlaySize(overlay);

  const rw = Number(rect.width) || 0;
  const rh = Number(rect.height) || 0;

  const sx = ow > 0 && rw > 0 ? ow / rw : 1;
  const sy = oh > 0 && rh > 0 ? oh / rh : 1;

  return { rect, ow, oh, sx, sy };
}

function updateRelX(obj, overlay) {
  if (!obj || !overlay) return;
  const { ow, oh } = _getOverlaySize(overlay);
  if (ow <= 0 || oh <= 0) return;
  if (obj.x_rel != null && obj.w_rel != null) {
    obj.x_rel = Math.max(0, Math.min(1, (Number(obj.x) || 0) / ow));
    obj.page_box_w = ow;
    obj.page_box_h = oh;
  }
}

export function installAlignTools() {
  state._alignSelectionVertical = () => {
    const sel = getSelectionForAlign();
    if (!sel) return;

    const overlay = state.overlaysByPage.get(sel.pageIndex);
    if (!overlay) return;

    const anchor = getObject(sel.pageIndex, sel.anchorId);
    if (!anchor) return;

    const { ow } = _getOverlaySize(overlay);
    if (ow <= 0) return;

    const refX = Number(anchor.x) || 0;

    for (const id of sel.ids) {
      const obj = getObject(sel.pageIndex, id);
      if (!obj) continue;

      const maxX = Math.max(0, ow - (Number(obj.w) || 0));
      obj.x = Math.round(clamp(refX, 0, maxX));

      updateRelX(obj, overlay);
    }

    renderPageOverlay(sel.pageIndex);
    rerenderAllExcept(sel.pageIndex);
    setStatus(`Alignement vertical (${sel.ids.length})`);
  };

  if (state.btnAlignVertical) {
    state.btnAlignVertical.addEventListener("click", () => {
      if (typeof state._alignSelectionVertical === "function") state._alignSelectionVertical();
    });
  }
}

// =====================================================
// Helpers style
// =====================================================



function ensureToolSectionCollapsible() {
  if (state._toolSectionReady) return;
  state._toolSectionReady = true;

  state.toolSection = document.getElementById("toolSection");
  state.toolSectionToggle = document.getElementById("toolSectionToggle");
  state.toolSectionBody = document.getElementById("toolSectionBody");

  if (!state.toolSection || !state.toolSectionToggle) return;

  // restore persisted state (optional)
  try {
    const saved = localStorage.getItem("mdoc_tool_section_collapsed");
    if (saved === "1") state.toolSection.dataset.collapsed = "1";
  } catch {}

  const setCollapsed = (collapsed) => {
    if (!state.toolSection) return;
    state.toolSection.dataset.collapsed = collapsed ? "1" : "0";
    try {
      localStorage.setItem("mdoc_tool_section_collapsed", collapsed ? "1" : "0");
    } catch {}
  };

  state._collapseToolSection = () => setCollapsed(true);
  state._expandToolSection = () => setCollapsed(false);
  state._toggleToolSection = () => setCollapsed(state.toolSection.dataset.collapsed !== "1");

  state.toolSectionToggle.addEventListener("click", () => {
    state._toggleToolSection();
  });
}



// -----------------------------------------------------
// ✅ PRESETS (memo last used style per tool)
// -----------------------------------------------------
function _ensurePresetsRoot() {
  if (!state.presets || typeof state.presets !== "object") state.presets = {};
  return state.presets;
}

// =====================================================
// ✅ SHAPE STYLE (preset + helpers)
// =====================================================
function normalizeShapeKind(v) {
  const s = String(v || "").toLowerCase();
  if (s === "round_rect" || s === "line" || s === "rect") return s;
  return "rect";
}

function clampShapeNum(n, min, max, fallback) {
  const x = Number(n);
  if (Number.isFinite(x)) return Math.max(min, Math.min(max, x));
  return fallback;
}

const DEFAULT_SHAPE_STYLE = {
  shape: "rect",

  fillEnabled: true,
  fillColor: "rgba(223,22,64,0.90)",

  // ✅ NEW
  fillType: "solid", // "solid" | "gradient"
  fillGradient: null, // {type, angle, stops:[{color,pos}]}

  strokeEnabled: true,
  strokeColor: "rgba(37,99,235,0.9)",
  strokeWidth: 2,
  radius: 14,
};


function _ensureShapeStylePreset() {
  if (!state._shapeStylePreset) state._shapeStylePreset = { ...DEFAULT_SHAPE_STYLE };
  return state._shapeStylePreset;
}

function _rememberShapeStylePreset(style) {
  if (!style) return;
  const cur = _ensureShapeStylePreset();
  state._shapeStylePreset = {
    ...cur,
    ...style,
    shape: normalizeShapeKind(style.shape ?? cur.shape),
    strokeWidth: clampShapeNum(style.strokeWidth ?? cur.strokeWidth, 0, 24, 2),
    radius: clampShapeNum(style.radius ?? cur.radius, 0, 80, 14),
    fillEnabled: style.fillEnabled === false ? false : !!(style.fillEnabled ?? cur.fillEnabled),
    strokeEnabled: style.strokeEnabled === false ? false : !!(style.strokeEnabled ?? cur.strokeEnabled),
  };
}

function readShapeStyleFromObj(obj) {
  const s = obj && typeof obj.style === "object" && obj.style ? obj.style : {};

  const shape = normalizeShapeKind(
    obj?.shape?.kind ?? obj?.shape ?? s.shape ?? "rect"
  );

  const fillTypeRaw = s.fillType ?? obj.fillType ?? s.shapeFillType ?? obj.shapeFillType ?? "solid";
  const fillType = String(fillTypeRaw).toLowerCase() === "gradient" ? "gradient" : "solid";

  let fillGradient = s.fillGradient ?? obj.fillGradient ?? s.gradient ?? obj.gradient ?? null;
  if (typeof fillGradient === "string") {
    try { fillGradient = JSON.parse(fillGradient); } catch {}
  }

  // ✅ radius : priorité à obj.shape.radius si présent
  const radiusRaw = obj?.shape?.radius ?? s.radius ?? obj.radius ?? 14;

  return {
    shape,
    fillEnabled: (s.fillEnabled ?? obj.fillEnabled) === false ? false : !!(s.fillEnabled ?? obj.fillEnabled ?? true),
    fillColor: String(s.fillColor ?? obj.fillColor ?? "rgba(255,255,255,0.0)").trim(),

    fillType,
    fillGradient,

    strokeEnabled: (s.strokeEnabled ?? obj.strokeEnabled) === false ? false : !!(s.strokeEnabled ?? obj.strokeEnabled ?? true),
    strokeColor: String(s.strokeColor ?? obj.strokeColor ?? "#111827").trim(),
    strokeWidth: clampShapeNum(s.strokeWidth ?? obj.strokeWidth ?? 2, 0, 24, 2),

    radius: clampShapeNum(radiusRaw, 0, 80, 14),
  };
}


function writeShapeStyleToObj(obj, style) {
  if (!obj || !style) return;

  const fillType = String(style.fillType || "solid").toLowerCase() === "gradient" ? "gradient" : "solid";
  let fillGradient = style.fillGradient ?? null;

  // accepte JSON string
  if (typeof fillGradient === "string") {
    try { fillGradient = JSON.parse(fillGradient); } catch {}
  }

  const st = {
    shape: normalizeShapeKind(style.shape),
    fillEnabled: style.fillEnabled === false ? false : !!style.fillEnabled,
    fillColor: String(style.fillColor || "rgba(255,255,255,0.0)").trim(),

    // ✅ NEW
    fillType,
    fillGradient,

    strokeEnabled: style.strokeEnabled === false ? false : !!style.strokeEnabled,
    strokeColor: String(style.strokeColor || "#111827").trim(),
    strokeWidth: clampShapeNum(style.strokeWidth, 0, 24, 2),

    radius: clampShapeNum(style.radius, 0, 80, 14),
  };

  // legacy mirrors
  // legacy mirrors
  // ✅ si obj.shape est un objet, on garde la structure {kind,radius}
  if (obj.shape && typeof obj.shape === "object") {
    obj.shape.kind = st.shape;
    obj.shape.radius = st.radius;
  } else {
    obj.shape = st.shape;
  }

  obj.fillEnabled = st.fillEnabled;
  obj.fillColor = st.fillColor;

  obj.fillType = st.fillType;
  obj.fillGradient = st.fillGradient;

  obj.strokeEnabled = st.strokeEnabled;
  obj.strokeColor = st.strokeColor;
  obj.strokeWidth = st.strokeWidth;
  obj.radius = st.radius;


  ensureObjStyle(obj);
  obj.style = { ...(obj.style || {}), ...st };
}


function readShapeStyleFromUI(existingObj) {
  _ensureShapeStylePreset();

  // seed defaults from tool preset when creating new
  const presetFromTool = existingObj ? null : _getPresetForTool(state.activeTool);
  const presetBase = existingObj ? null : { ..._ensureShapeStylePreset(), ...(presetFromTool || {}) };

  const shape = normalizeShapeKind(
    state.shapeKind?.value ?? existingObj?.style?.shape ?? existingObj?.shape ?? presetBase?.shape ?? "rect"
  );

  const fillEnabled = !!(
    state.shapeFillEnabled?.checked ??
    existingObj?.style?.fillEnabled ??
    existingObj?.fillEnabled ??
    presetBase?.fillEnabled ??
    true
  );

  const fillColor = String(
    state.shapeFillColor?.value ||
      existingObj?.style?.fillColor ||
      existingObj?.fillColor ||
      presetBase?.fillColor ||
      "rgba(255,255,255,0.0)"
  ).trim();

  const strokeEnabled = !!(
    state.shapeStrokeEnabled?.checked ??
    existingObj?.style?.strokeEnabled ??
    existingObj?.strokeEnabled ??
    presetBase?.strokeEnabled ??
    true
  );

  const strokeColor = String(
    state.shapeStrokeColor?.value ||
      existingObj?.style?.strokeColor ||
      existingObj?.strokeColor ||
      presetBase?.strokeColor ||
      "#111827"
  ).trim();

  const strokeWidth = clampShapeNum(
    state.shapeStrokeWidth?.value ??
      existingObj?.style?.strokeWidth ??
      existingObj?.strokeWidth ??
      presetBase?.strokeWidth ??
      2,
    0,
    24,
    2
  );

  const radius = clampShapeNum(
    state.shapeRadius?.value ?? existingObj?.style?.radius ?? existingObj?.radius ?? presetBase?.radius ?? 14,
    0,
    80,
    14
  );


  const grad = _readFillGradientFromUI(existingObj, presetBase);

    const style = {
    shape,
    fillEnabled,
    fillColor,

    // ✅ NEW
    fillType: grad.fillType,
    fillGradient: grad.fillGradient,

    strokeEnabled,
    strokeColor,
    strokeWidth,
    radius
  };


  _rememberShapeStylePreset(style);
  _rememberShapePresetForTool(state.activeTool, style);

  return style;
}

// -----------------------------------------------------
// ✅ PRESETS keying (text/dyn + shape per kind)
// -----------------------------------------------------
function _presetKeyForTool(activeTool) {
  const t = activeTool?.type;

  if (t === "product_price") return "product_price";
  if (t === "product_stock_badge") return "product_stock_badge";
  if (t === "product_ean") return "product_ean";

  if (t === "shape") {
    const shp = normalizeShapeKind(activeTool?.shape || "rect");
    return `shape_${shp}`; // shape_rect | shape_round_rect | shape_line
  }

  if (t === "text") return "text";
  return "text";
}

function _getPresetForTool(activeTool) {
  const presets = _ensurePresetsRoot();
  const key = _presetKeyForTool(activeTool);
  return key && presets[key] ? presets[key] : presets.text || {};
}

function _rememberPresetForTool(activeTool, style) {
  if (!style) return;
  const presets = _ensurePresetsRoot();
  const key = _presetKeyForTool(activeTool);

  presets[key] = {
    fontFamily: normalizeFontFamily(style.fontFamily),
    fontSize: clampNum(style.fontSize, 8, 200, 18),
    fontWeight: normalizeWeight(style.fontWeight),
    color: String(style.color || "#111827").trim(),

    bgMode: normalizeBgMode(style.bgMode),
    bgEnabled: style.bgEnabled === false ? false : !!style.bgEnabled,
    bgColor: String(style.bgColor || "rgba(255,255,255,0.72)").trim(),

    borderEnabled: !!style.borderEnabled,
    borderColor: String(style.borderColor || "#111827").trim(),
    borderWidth: clampNum(style.borderWidth, 0, 12, 1),

    textAlign: String(style.textAlign || "center"),
  };
}

function _rememberShapePresetForTool(activeTool, shapeStyle) {
  if (!shapeStyle) return;
  const presets = _ensurePresetsRoot();
  const key = _presetKeyForTool(activeTool);

  presets[key] = {
    shape: normalizeShapeKind(shapeStyle.shape),

    fillEnabled: shapeStyle.fillEnabled === false ? false : !!shapeStyle.fillEnabled,
    fillColor: String(shapeStyle.fillColor || "rgba(255,255,255,0.0)").trim(),

    // ✅ NEW
    fillType: String(shapeStyle.fillType || "solid").toLowerCase() === "gradient" ? "gradient" : "solid",
    fillGradient: shapeStyle.fillGradient ?? null,

    strokeEnabled: shapeStyle.strokeEnabled === false ? false : !!shapeStyle.strokeEnabled,
    strokeColor: String(shapeStyle.strokeColor || "#111827").trim(),
    strokeWidth: clampShapeNum(shapeStyle.strokeWidth, 0, 24, 2),

    radius: clampShapeNum(shapeStyle.radius, 0, 80, 14),
  };
}

// -----------------------------------------------------
// ✅ READ preset-aware styles from UI
// -----------------------------------------------------
function _mergePresetDefault(base, preset) {
  return { ...(base || {}), ...(preset || {}) };
}

// -----------------------------------------------------
// existing helpers
// -----------------------------------------------------
function normalizeWeight(v) {
  const s = String(v ?? "").trim();
  if (s === "300" || s === "400" || s === "700") return s;
  if (s === "bold") return "700";
  if (s === "normal") return "400";
  return "400";
}

function normalizeBgMode(v) {
  const s = String(v ?? "").trim();
  if (s === "transparent" || s === "semi" || s === "color") return s;
  return "transparent";
}

function clampNum(n, min, max, fallback) {
  const x = Number(n);
  if (Number.isFinite(x)) return Math.max(min, Math.min(max, x));
  return fallback;
}

function isHexColor(s) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || "").trim());
}


function _toPct(v, fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(0, Math.min(100, n));
}

function _normHexOrCss(c) {
  const s = String(c || "").trim();
  return s || null;
}

function _readFillGradientFromUI(existingObj, presetBase) {
  // IDs possibles (tu peux en avoir d'autres : on fait large)
  const fillTypeEl =
    state.shapeFillType ||
    document.getElementById("shapeFillType") ||
    document.getElementById("shapeFillMode");

  const gTypeEl =
    state.shapeGradType ||
    document.getElementById("shapeGradType");

  const gAngleEl =
    state.shapeGradAngle ||
    document.getElementById("shapeGradAngle");

  const c1El = state.shapeGradColor1 || document.getElementById("shapeGradColor1");
  const c2El = state.shapeGradColor2 || document.getElementById("shapeGradColor2");
  const c3El = state.shapeGradColor3 || document.getElementById("shapeGradColor3");

  const p1El = state.shapeGradPos1 || document.getElementById("shapeGradPos1");
  const p2El = state.shapeGradPos2 || document.getElementById("shapeGradPos2");
  const p3El = state.shapeGradPos3 || document.getElementById("shapeGradPos3");

  // source fallback: existingObj -> presetBase
  const fallbackFillType =
    existingObj?.style?.fillType ?? existingObj?.fillType ??
    presetBase?.fillType ?? "solid";

  const fillType = String(fillTypeEl?.value ?? fallbackFillType).toLowerCase() === "gradient"
    ? "gradient"
    : "solid";

  if (fillType !== "gradient") return { fillType: "solid", fillGradient: null };

  // stops
  // stops (✅ 2 couleurs only)
  const c1 = _normHexOrCss(c1El?.value ?? existingObj?.style?.shapeGradColor1 ?? existingObj?.shapeGradColor1 ?? null);
  const c2 = _normHexOrCss(c2El?.value ?? existingObj?.style?.shapeGradColor2 ?? existingObj?.shapeGradColor2 ?? null);

  const p1 = _toPct(p1El?.value ?? existingObj?.style?.shapeGradPos1 ?? existingObj?.shapeGradPos1 ?? 0, 0);
  const p2 = _toPct(p2El?.value ?? existingObj?.style?.shapeGradPos2 ?? existingObj?.shapeGradPos2 ?? 100, 100);

  const stops = [];
  if (c1) stops.push({ color: c1, pos: p1 });
  if (c2) stops.push({ color: c2, pos: p2 });

  if (stops.length < 2) {
    return { fillType: "solid", fillGradient: null };
  }


  const gType = String(gTypeEl?.value ?? existingObj?.style?.shapeGradType ?? existingObj?.shapeGradType ?? "linear").toLowerCase();
  const angleRaw = gAngleEl?.value ?? existingObj?.style?.shapeGradAngle ?? existingObj?.shapeGradAngle ?? 90;
  const angle = Number.isFinite(Number(angleRaw)) ? Number(angleRaw) : 90;

  return {
    fillType: "gradient",
    fillGradient: { type: (gType === "radial" ? "radial" : "linear"), angle, stops },
  };
}


// =====================================================
// Fonts – default must be PyMuPDF-safe
// =====================================================
const DEFAULT_FONT_FAMILY = "helv"; // PyMuPDF builtin safe font

function sanitizeFontFamily(f) {
  if (f == null) return "";
  return String(f).replace(/["']/g, "").trim();
}

function normalizeFontFamily(input) {
  const v = sanitizeFontFamily(input);
  if (!v || v === "default") return DEFAULT_FONT_FAMILY;
  return v;
}

// -----------------------------------------------------
// ✅ Select UI helpers
// -----------------------------------------------------
function _setSelectValueSafe(selectEl, wantedValue, fallbackValue = "default") {
  if (!selectEl) return;

  const want = String(wantedValue ?? "").trim();
  const fb = String(fallbackValue ?? "default").trim();

  const opts = Array.from(selectEl.options || []);
  const has = opts.some((o) => String(o.value) === want);

  if (has) {
    selectEl.value = want;
    return;
  }

  // helv <-> default (selon tes options)
  if (want === "helv") {
    const hasDefault = opts.some((o) => String(o.value) === "default");
    if (hasDefault) {
      selectEl.value = "default";
      return;
    }
  }

  const hasFb = opts.some((o) => String(o.value) === fb);
  selectEl.value = hasFb ? fb : opts[0] ? opts[0].value : "";
}

function _dispatchSelectRefresh(selectEl) {
  if (!selectEl) return;
  try {
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {}
}

// =====================================================
// ✅ style object (future-proof)
// overlay_render.js lit obj.style.* si présent
// =====================================================
function ensureObjStyle(obj) {
  if (!obj) return obj;
  if (!obj.style || typeof obj.style !== "object") obj.style = {};
  return obj;
}

function writeStyleToObj(obj, style) {
  if (!obj || !style) return;

  // legacy fields (compat)
  obj.fontFamily = normalizeFontFamily(style.fontFamily);
  obj.fontSize = style.fontSize;
  obj.fontWeight = normalizeWeight(style.fontWeight);
  obj.color = style.color;

  obj.bgMode = normalizeBgMode(style.bgMode);
  obj.bgEnabled = !!style.bgEnabled;
  obj.bgColor = style.bgColor;

  obj.borderEnabled = !!style.borderEnabled;
  obj.borderColor = style.borderColor;
  obj.borderWidth = style.borderWidth;

  obj.textAlign = style.textAlign || "center";

  // new unified style
  ensureObjStyle(obj);
  obj.style = {
    ...(obj.style || {}),
    fontFamily: obj.fontFamily,
    fontSize: obj.fontSize,
    fontWeight: obj.fontWeight,
    color: obj.color,
    bgMode: obj.bgMode,
    bgEnabled: obj.bgEnabled,
    bgColor: obj.bgColor,
    borderEnabled: obj.borderEnabled,
    borderColor: obj.borderColor,
    borderWidth: obj.borderWidth,
    textAlign: obj.textAlign,
  };
}

function readStyleFromObj(obj) {
  const s = obj && typeof obj.style === "object" && obj.style ? obj.style : {};
  return {
    fontFamily: normalizeFontFamily(s.fontFamily ?? obj.fontFamily ?? DEFAULT_FONT_FAMILY),
    fontSize: clampNum(s.fontSize ?? obj.fontSize ?? 18, 8, 120, 18),
    fontWeight: normalizeWeight(s.fontWeight ?? obj.fontWeight ?? "400"),
    color: String(s.color ?? obj.color ?? "#111827").trim(),

    bgMode: normalizeBgMode(s.bgMode ?? obj.bgMode ?? "transparent"),
    bgEnabled: (s.bgEnabled ?? obj.bgEnabled) === false ? false : !!(s.bgEnabled ?? obj.bgEnabled ?? true),
    bgColor: String(s.bgColor ?? obj.bgColor ?? "rgba(255,255,255,0.72)").trim(),

    borderEnabled: !!(s.borderEnabled ?? obj.borderEnabled ?? false),
    borderColor: String(s.borderColor ?? obj.borderColor ?? "#111827").trim(),
    borderWidth: clampNum(s.borderWidth ?? obj.borderWidth ?? 1, 0, 12, 1),

    textAlign: String(s.textAlign ?? obj.textAlign ?? "center"),
  };
}

// =====================================================
// ✅ preset style dynamique (prix + rupture + ean)
// =====================================================
const DEFAULT_DYN_STYLE = {
  fontSize: 18,
  color: "#111827",
  fontWeight: "700",
  fontFamily: DEFAULT_FONT_FAMILY,
  bgMode: "semi",
  bgEnabled: true,
  bgColor: "rgba(255,255,255,0.72)",
  borderEnabled: false,
  borderColor: "#111827",
  borderWidth: 1,
  textAlign: "center",
};

function _ensureDynStylePreset() {
  if (!state._dynStylePreset) state._dynStylePreset = { ...DEFAULT_DYN_STYLE };
  return state._dynStylePreset;
}

function _rememberDynStylePreset(style) {
  if (!style) return;
  const cur = _ensureDynStylePreset();
  state._dynStylePreset = {
    ...cur,
    ...style,
    fontFamily: normalizeFontFamily(style.fontFamily ?? cur.fontFamily ?? DEFAULT_FONT_FAMILY),
    fontWeight: normalizeWeight(style.fontWeight ?? cur.fontWeight ?? "400"),
    bgMode: normalizeBgMode(style.bgMode ?? cur.bgMode ?? "transparent"),
    borderEnabled: !!(style.borderEnabled ?? cur.borderEnabled ?? false),
    bgEnabled: style.bgEnabled === false ? false : !!(style.bgEnabled ?? cur.bgEnabled ?? true),
    textAlign: String(style.textAlign ?? cur.textAlign ?? "center"),
  };
}

function _applyDynStylePresetToUI() {
  const p = _ensureDynStylePreset();

  if (state.dynFontFamily) state.dynFontFamily.value = normalizeFontFamily(p.fontFamily) || DEFAULT_FONT_FAMILY;
  if (state.dynFontSize) state.dynFontSize.value = String(clampNum(p.fontSize ?? 18, 8, 120, 18));
  if (state.dynFontWeight) state.dynFontWeight.value = normalizeWeight(p.fontWeight ?? "400");
  if (state.dynColor) state.dynColor.value = (p.color || "#111827").trim();

  if (state.dynBgMode) state.dynBgMode.value = normalizeBgMode(p.bgMode ?? "transparent");

  if (state.dynBgColor) {
    const c = (p.bgColor || "#ffffff").trim();
    if (isHexColor(c)) state.dynBgColor.value = c;
    else state.dynBgColor.value = isHexColor(state.dynBgColor.value) ? state.dynBgColor.value : "#ffffff";
    state.dynBgColor.disabled = normalizeBgMode(state.dynBgMode?.value || "transparent") !== "color";
  }

  if (state.dynBorderEnabled) state.dynBorderEnabled.checked = !!p.borderEnabled;
  if (state.dynBorderColor) state.dynBorderColor.value = (p.borderColor || "#111827").trim();
  if (state.dynBorderWidth) state.dynBorderWidth.value = String(clampNum(p.borderWidth ?? 1, 0, 12, 1));

  const on = !!p.borderEnabled;
  if (state.dynBorderColor) state.dynBorderColor.disabled = !on;
  if (state.dynBorderWidth) state.dynBorderWidth.disabled = !on;
}

// =====================================================
// ✅ Selection -> remember preset (called from interactions.js)
// =====================================================
function _rememberPresetFromSelected() {
  if (!state.selected) return;
  const obj = getObject(state.selected.pageIndex, state.selected.objectId);
  if (!obj) return;

  // shapes
  if (obj.type === "shape") {
    const st = readShapeStyleFromObj(obj);
    _rememberShapeStylePreset(st);
    _rememberShapePresetForTool({ type: "shape", shape: obj.shape }, st);
    return;
  }

  // text only
  if (obj.type !== "text") return;

  const st = readStyleFromObj(obj);

  // dynamic kind?
  const kind = String(obj.dynamic?.kind || "");
  if (kind === "product_price" || kind === "product_stock_badge" || kind === "product_ean") {
    _rememberDynStylePreset(st);
    _rememberPresetForTool({ type: kind }, st);
    return;
  }

  // plain text
  if (!obj.dynamic) {
    _rememberPresetForTool({ type: "text" }, st);
  }
}

state._rememberPresetFromSelected = _rememberPresetFromSelected;

// unify style sync hook (interactions.js calls state._syncStyleUiFromSelected())
state._syncStyleUiFromSelected = () => {
  if (!state.selected) return;
  const obj = getObject(state.selected.pageIndex, state.selected.objectId);
  if (!obj) return;
  
  
    if (obj.type === "clip_shape") {
    if (typeof state._syncClipShapeUiFromSelected === "function") {
      try { state._syncClipShapeUiFromSelected(); } catch {}
    }
    return;
  }


  if (obj.type === "shape") {
    if (typeof state._syncShapeUiFromSelected === "function") {
      try {
        state._syncShapeUiFromSelected();
      } catch {}
    }
    return;
  }
  
    if (obj.type === "richtext") {
    if (typeof state._syncRichTextUiFromSelected === "function") {
      try { state._syncRichTextUiFromSelected(); } catch {}
    }
    return;
  }

  

  if (obj.type === "text") {
    const kind = String(obj.dynamic?.kind || "");
    if (kind === "product_price" || kind === "product_stock_badge" || kind === "product_ean") {
      if (typeof state._syncDynamicUiFromSelected === "function") {
        try {
          state._syncDynamicUiFromSelected();
        } catch {}
      }
    } else {
      if (typeof state._syncTextUiFromSelected === "function") {
        try {
          state._syncTextUiFromSelected();
        } catch {}
      }
    }
  }
};

// =====================================================
// Price style (meta)
// =====================================================
function setPriceIntPlus1pt(dynamic, enabled) {
  if (!dynamic) dynamic = {};
  if (!enabled) {
    if (dynamic.priceStyle) delete dynamic.priceStyle;
    return dynamic;
  }
  dynamic.priceStyle = { kind: "int_plus_1pt", euros_plus_pt: 7 };
  return dynamic;
}

function isPriceIntPlus1pt(dynamic) {
  return !!(dynamic && dynamic.priceStyle && dynamic.priceStyle.kind === "int_plus_1pt");
}

// ----------------------------------------------------
// ✅ RELATIVE COORDS helper
// ----------------------------------------------------
function _clamp01(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function attachRelToObj(obj, overlayMetrics) {
  if (!obj || !overlayMetrics) return obj;

  const ow = Number(overlayMetrics.ow) || 0;
  const oh = Number(overlayMetrics.oh) || 0;
  if (ow <= 0 || oh <= 0) return obj;

  const x = Number(obj.x ?? 0) || 0;
  const y = Number(obj.y ?? 0) || 0;
  const w = Number(obj.w ?? 0) || 0;
  const h = Number(obj.h ?? 0) || 0;

  obj.x_rel = _clamp01(x / ow);
  obj.y_rel = _clamp01(y / oh);
  obj.w_rel = _clamp01(w / ow);
  obj.h_rel = _clamp01(h / oh);

  obj.page_box = { w: ow, h: oh };
  obj.page_box_w = ow;
  obj.page_box_h = oh;

  return obj;
}

// =====================================================
// Style readers from UI (preset-aware)
// =====================================================
function readDynamicStyleFromUI(existingObj) {
  const presetFromTool = existingObj ? null : _getPresetForTool(state.activeTool);
  const preset = existingObj ? null : _mergePresetDefault(_ensureDynStylePreset(), presetFromTool);

  const fontSize = clampNum(
    state.dynFontSize?.value ?? existingObj?.style?.fontSize ?? existingObj?.fontSize ?? preset?.fontSize ?? 18,
    8,
    120,
    18
  );

  const color = (
    state.dynColor?.value || existingObj?.style?.color || existingObj?.color || preset?.color || "#111827"
  ).trim();

  const fontWeight = normalizeWeight(
    state.dynFontWeight?.value ||
      existingObj?.style?.fontWeight ||
      existingObj?.fontWeight ||
      preset?.fontWeight ||
      "400"
  );

  const fontFamily = normalizeFontFamily(
    state.dynFontFamily?.value ||
      existingObj?.style?.fontFamily ||
      existingObj?.fontFamily ||
      preset?.fontFamily ||
      DEFAULT_FONT_FAMILY
  );

  const bgMode = normalizeBgMode(
    state.dynBgMode?.value || existingObj?.style?.bgMode || existingObj?.bgMode || preset?.bgMode || "transparent"
  );

  let bgEnabled = true;
  let bgColor = "transparent";

  if (bgMode === "transparent") {
    bgEnabled = false;
    bgColor = "transparent";
  } else if (bgMode === "semi") {
    bgEnabled = true;
    bgColor = "rgba(255,255,255,0.72)";
    const ui = (state.dynBgColor?.value || "").trim();
    if (ui) bgColor = ui;
    else if (preset?.bgColor) bgColor = preset.bgColor;
  } else {
    bgEnabled = true;
    const ui = (state.dynBgColor?.value || "").trim();
    const existing = (existingObj?.style?.bgColor || existingObj?.bgColor || preset?.bgColor || "").trim();
    if (isHexColor(ui)) bgColor = ui;
    else if (isHexColor(existing)) bgColor = existing;
    else bgColor = "#ffffff";
  }

  const borderEnabled = !!(
    state.dynBorderEnabled?.checked ??
    existingObj?.style?.borderEnabled ??
    existingObj?.borderEnabled ??
    preset?.borderEnabled ??
    false
  );

  const borderColor = (
    state.dynBorderColor?.value ||
    existingObj?.style?.borderColor ||
    existingObj?.borderColor ||
    preset?.borderColor ||
    "#111827"
  ).trim();

  const borderWidth = clampNum(
    state.dynBorderWidth?.value ??
      existingObj?.style?.borderWidth ??
      existingObj?.borderWidth ??
      preset?.borderWidth ??
      1,
    0,
    12,
    1
  );

  const style = {
    fontSize,
    color,
    fontWeight,
    fontFamily,
    bgMode,
    bgEnabled,
    bgColor,
    borderEnabled,
    borderColor,
    borderWidth,
    textAlign: "center",
  };

  _rememberDynStylePreset(style);
  _rememberPresetForTool(state.activeTool, style);

  return style;
}

function readTextStyleFromUI(existingObj) {
  const preset = existingObj ? null : _getPresetForTool({ type: "text" });

  const fontSize = clampNum(
    state.textToolSize?.value ?? existingObj?.style?.fontSize ?? existingObj?.fontSize ?? preset?.fontSize ?? 18,
    8,
    96,
    18
  );
  const color = (
    state.textToolColor?.value || existingObj?.style?.color || existingObj?.color || preset?.color || "#111827"
  ).trim();

  const weightFromSelect = state.textToolWeight?.value;
  const weightFromBold = state.textToolBold?.checked ? "700" : "400";
  const fontWeight = normalizeWeight(
    weightFromSelect ||
      existingObj?.style?.fontWeight ||
      existingObj?.fontWeight ||
      preset?.fontWeight ||
      weightFromBold
  );

  const fontFamily = sanitizeFontFamily(
    (state.textToolFont?.value || existingObj?.style?.fontFamily || existingObj?.fontFamily || preset?.fontFamily || "")
      .trim()
  );

  const bgMode = normalizeBgMode(
    state.textToolBgMode?.value || existingObj?.style?.bgMode || existingObj?.bgMode || preset?.bgMode
  );

  let bgEnabled = true;
  let bgColor = "transparent";

  if (bgMode === "transparent") {
    bgEnabled = false;
    bgColor = "transparent";
  } else if (bgMode === "semi") {
    bgEnabled = true;
    bgColor = "rgba(255,255,255,0.72)";
  } else {
    bgEnabled = true;
    const ui = (state.textToolBgColor?.value || "").trim();
    const existing = (existingObj?.style?.bgColor || existingObj?.bgColor || preset?.bgColor || "").trim();
    if (isHexColor(ui)) bgColor = ui;
    else if (isHexColor(existing)) bgColor = existing;
    else bgColor = "#ffffff";
  }

  const borderEnabled = !!(
    state.textToolBorderEnabled?.checked ??
    existingObj?.style?.borderEnabled ??
    existingObj?.borderEnabled ??
    preset?.borderEnabled ??
    false
  );
  const borderColor = (
    state.textToolBorderColor?.value ||
    existingObj?.style?.borderColor ||
    existingObj?.borderColor ||
    preset?.borderColor ||
    "#111827"
  ).trim();
  const borderWidth = clampNum(
    state.textToolBorderWidth?.value ??
      existingObj?.style?.borderWidth ??
      existingObj?.borderWidth ??
      preset?.borderWidth ??
      1,
    0,
    12,
    1
  );

  const style = {
    fontSize,
    color,
    fontWeight,
    fontFamily,
    bgMode,
    bgEnabled,
    bgColor,
    borderEnabled,
    borderColor,
    borderWidth,
    textAlign: "center",
  };

  _rememberPresetForTool({ type: "text" }, style);
  return style;
}

// =====================================================
// Dynamic toolboxes
// =====================================================
function showDynamicToolBoxes(kind) {
  const isPrice = kind === "product_price";
  const isStock = kind === "product_stock_badge";
  const isEan = kind === "product_ean";

  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = isPrice || isStock || isEan ? "block" : "none";
  if (state.productPriceToolBox) state.productPriceToolBox.style.display = isPrice ? "block" : "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = isStock ? "block" : "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = isEan ? "block" : "none";
}

function makeTextObjAt({ x, y, text, style, meta }) {
  const s = style || readDynamicStyleFromUI(null);
  const txt = String(text || "").trim() || "—";

  const w = Math.max(90, Math.min(520, Math.round(txt.length * (s.fontSize * 0.62) + 34)));
  const h = Math.max(34, Math.round(s.fontSize * 1.85));

  const obj = {
    id: uid("txt"),
    type: "text",
    x: Math.max(0, x - Math.round(w / 2)),
    y: Math.max(0, y - Math.round(h / 2)),
    w,
    h,
    text: txt,
    dynamic: meta || null,
  };

  writeStyleToObj(obj, s);
  return obj;
}

// =====================================================
// Apply style to selected (single + multi)
// =====================================================
function _isTextObj(obj) {
  return obj && obj.type === "text";
}

function _isDynamicTextObj(obj) {
  const k = obj?.dynamic?.kind;
  return obj && obj.type === "text" && (k === "product_price" || k === "product_stock_badge" || k === "product_ean");
}

function _isShapeObj(obj) {
  return obj && obj.type === "shape";
}

function applyTextStyleToSelection() {
  const sel = _getActiveIdsOnCurrentPage();
  if (!sel) return;

  let changed = 0;
  for (const id of sel.ids) {
    const obj = getObject(sel.pageIndex, id);
    if (!obj || !_isTextObj(obj) || _isDynamicTextObj(obj)) continue;

    const style = readTextStyleFromUI(obj);
    writeStyleToObj(obj, style);
    changed++;
  }

  if (changed) {
    renderPageOverlay(sel.pageIndex);
    rerenderAllExcept(sel.pageIndex);
  }
}

function applyDynamicStyleToSelection() {
  const sel = _getActiveIdsOnCurrentPage();
  if (!sel) return;

  let changed = 0;
  for (const id of sel.ids) {
    const obj = getObject(sel.pageIndex, id);
    if (!obj || !_isDynamicTextObj(obj)) continue;

    const style = readDynamicStyleFromUI(obj);
    writeStyleToObj(obj, style);
    changed++;
  }

  if (changed) {
    renderPageOverlay(sel.pageIndex);
    rerenderAllExcept(sel.pageIndex);
  }
}

function applyShapeStyleToSelection() {
  const sel = _getActiveIdsOnCurrentPage();
  if (!sel) return;

  let changed = 0;
  for (const id of sel.ids) {
    const obj = getObject(sel.pageIndex, id);
    if (!obj || (obj.type !== "shape" && obj.type !== "clip_shape")) continue;

    const style = readShapeStyleFromUI(obj);
    writeShapeStyleToObj(obj, style);
    changed++;
  }

  if (changed) {
    renderPageOverlay(sel.pageIndex);
    rerenderAllExcept(sel.pageIndex);
  }
}


function _toHexForColorInput(c, fallback = "#ffffff") {
  const s = String(c || "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;

  const m = s.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (!m) return fallback;

  const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
  const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
  const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2,"0")).join("");
}

// =====================================================
// ✅ RICHTEXT helpers (paragraph with runs)
// =====================================================
function _isRichTextObj(obj) {
  return obj && obj.type === "richtext";
}

/**
 * Parser ultra simple:
 * - **gras** => run.bold = true
 * - le reste => run.bold = false
 * (on garde volontairement minimal; on étendra taille/couleur inline ensuite)
 */
// =====================================================
// ✅ RICHTEXT parser (runs with inline bold/size/color/font)
// Syntax supported:
// - **bold**
// - [size=18]...[/size]
// - [color=#RRGGBB]...[/color]
// - [font=helv]...[/font]
// Tags can be nested in a simple way.
// =====================================================
function parseRichTextRuns(raw) {
  const input = String(raw ?? "");
  if (!input.trim()) return [{ text: "Nouveau paragraphe", bold: false }];

  const clampFontSize = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.max(6, Math.min(200, Math.round(x)));
  };

  const normColor = (c) => {
    const s = String(c || "").trim();
    if (!s) return null;
    // accept hex or css-ish
    return s;
  };

  const normFont = (f) => {
    const s = sanitizeFontFamily(f);
    return s ? normalizeFontFamily(s) : null;
  };

  // We build a token stream from two syntaxes: **...** and [tag=val]...[/tag]
  const tokens = [];
  const re = /(\*\*|\[\/?(?:size|color|font)(?:=[^\]]+)?\])/gi;

  let last = 0;
  let m;
  while ((m = re.exec(input)) !== null) {
    const idx = m.index;
    const tok = m[0];

    if (idx > last) tokens.push({ t: "text", v: input.slice(last, idx) });
    tokens.push({ t: "mark", v: tok });
    last = idx + tok.length;
  }
  if (last < input.length) tokens.push({ t: "text", v: input.slice(last) });

  // style stack
  const base = { bold: false, fontSize: null, color: null, fontFamily: null };
  const stack = [base];

  const cur = () => stack[stack.length - 1];

  const pushStyle = (patch) => {
    stack.push({ ...cur(), ...patch });
  };

  const popStyleBy = (key) => {
    // pop until we remove one that changed "key" (simple + safe)
    for (let i = stack.length - 1; i >= 1; i--) {
      if (stack[i][key] !== stack[i - 1][key]) {
        stack.splice(i, 1);
        return;
      }
    }
    // fallback: pop one
    if (stack.length > 1) stack.pop();
  };

  let boldOpen = false;

  const runs = [];

  const emit = (txt) => {
    const text = String(txt || "");
    if (!text) return;
    const s = cur();
    runs.push({
      text,
      bold: !!s.bold,
      ...(s.fontSize != null ? { fontSize: s.fontSize } : {}),
      ...(s.color != null ? { color: s.color } : {}),
      ...(s.fontFamily != null ? { fontFamily: s.fontFamily } : {}),
    });
  };

  const parseTag = (tagRaw) => {
    // examples: [size=18], [/size], [color=#fff], [/color], [font=helv], [/font]
    const tag = String(tagRaw || "").trim();
    const isClose = tag.startsWith("[/");

    const name = tag
      .replace(/^\[\/?/, "")
      .replace(/\]$/, "")
      .split("=")[0]
      .toLowerCase();

    const val = tag.includes("=") ? tag.slice(tag.indexOf("=") + 1).replace(/\]$/, "") : null;

    return { isClose, name, val };
  };

  for (const t of tokens) {
    if (t.t === "text") {
      emit(t.v);
      continue;
    }

    const mark = t.v;

    if (mark === "**") {
      // toggle bold (like markdown)
      boldOpen = !boldOpen;
      pushStyle({ bold: boldOpen });
      // IMPORTANT: when toggling bold off, restore previous bold value
      if (!boldOpen) {
        popStyleBy("bold");
      }
      continue;
    }

    const { isClose, name, val } = parseTag(mark);

    if (name === "size") {
      if (isClose) popStyleBy("fontSize");
      else pushStyle({ fontSize: clampFontSize(val) });
      continue;
    }

    if (name === "color") {
      if (isClose) popStyleBy("color");
      else pushStyle({ color: normColor(val) });
      continue;
    }

    if (name === "font") {
      if (isClose) popStyleBy("fontFamily");
      else pushStyle({ fontFamily: normFont(val) });
      continue;
    }

    // unknown tag => ignore
  }

  // cleanup: merge adjacent runs with same style
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    const same =
      prev &&
      prev.bold === r.bold &&
      (prev.fontSize ?? null) === (r.fontSize ?? null) &&
      (prev.color ?? null) === (r.color ?? null) &&
      (prev.fontFamily ?? null) === (r.fontFamily ?? null);

    if (same) prev.text += r.text;
    else merged.push(r);
  }

  return merged.filter((r) => String(r.text || "").length > 0);
}


function readRichTextBlockStyleFromUI(existingObj) {
  // inputs optionnels (si pas présents => fallback)
  state.richTextFont = state.richTextFont || document.getElementById("richTextFont");
  state.richTextSize = state.richTextSize || document.getElementById("richTextSize");
  state.richTextColor = state.richTextColor || document.getElementById("richTextColor");
  state.richTextAlign = state.richTextAlign || document.getElementById("richTextAlign");
  state.richTextLineHeight = state.richTextLineHeight || document.getElementById("richTextLineHeight");

  const fontFamily = normalizeFontFamily(
    state.richTextFont?.value ??
    existingObj?.fontFamily ??
    existingObj?.style?.fontFamily ??
    DEFAULT_FONT_FAMILY
  );

  const fontSize = clampNum(
    state.richTextSize?.value ??
    existingObj?.fontSize ??
    existingObj?.style?.fontSize ??
    16,
    8,
    200,
    16
  );

  const color = String(
    state.richTextColor?.value ??
    existingObj?.color ??
    existingObj?.style?.color ??
    "#111827"
  ).trim();

  const alignRaw = String(
    state.richTextAlign?.value ??
    existingObj?.align ??
    existingObj?.style?.align ??
    "left"
  ).toLowerCase();
  const align = ["left","center","right","justify"].includes(alignRaw) ? alignRaw : "left";

  const lh = Number(state.richTextLineHeight?.value ?? existingObj?.lineHeight ?? 1.25);
  const lineHeight = Number.isFinite(lh) && lh > 0 ? lh : 1.25;

  return { fontFamily, fontSize, color, align, lineHeight };
}




// =====================================================
// Active tool
// =====================================================
export function setActiveTool(tool) {
  state.activeTool = tool;
  
    ensureToolSectionCollapsible();
  // ✅ dès qu'on choisit un outil => on replie "Outil"
  try { state._collapseToolSection?.(); } catch {}
  

  _ensureLayerPresets();

  const isText = state.activeTool?.type === "text";
  const isImage = state.activeTool?.type === "image";
  const isPrice = state.activeTool?.type === "product_price";
  const isStock = state.activeTool?.type === "product_stock_badge";
  const isEan = state.activeTool?.type === "product_ean";
  const isShape = state.activeTool?.type === "shape";
  const isRichText = state.activeTool?.type === "richtext";
  
  if (state.textToolBox) state.textToolBox.style.display = isText ? "block" : "none";
  if (state.imageToolBox) state.imageToolBox.style.display = isImage ? "block" : "none";
  
  if (state.richTextToolBox == null) state.richTextToolBox = document.getElementById("richTextToolBox");
  
  if (state.richTextToolBox) state.richTextToolBox.style.display = isRichText ? "block" : "none";
  
  

  showDynamicToolBoxes(isPrice ? "product_price" : isStock ? "product_stock_badge" : isEan ? "product_ean" : null);

  // dyn presets
  if (isPrice || isStock || isEan) {
    _applyDynStylePresetToUI();
    const p = _getPresetForTool(state.activeTool);
    if (p && typeof p === "object") {
      if (state.dynFontFamily) state.dynFontFamily.value = normalizeFontFamily(p.fontFamily) || state.dynFontFamily.value;
      if (state.dynFontSize) state.dynFontSize.value = String(clampNum(p.fontSize ?? state.dynFontSize.value, 8, 120, 18));
      if (state.dynFontWeight) state.dynFontWeight.value = normalizeWeight(p.fontWeight ?? state.dynFontWeight.value);
      if (state.dynColor) state.dynColor.value = (p.color || state.dynColor.value || "#111827").trim();

      if (state.dynBgMode) state.dynBgMode.value = normalizeBgMode(p.bgMode ?? state.dynBgMode.value ?? "transparent");

      if (state.dynBgColor) {
        const c = (p.bgColor || "").trim();
        if (isHexColor(c)) state.dynBgColor.value = c;
      }

      if (state.dynBorderEnabled && p.borderEnabled != null) state.dynBorderEnabled.checked = !!p.borderEnabled;
      if (state.dynBorderColor && p.borderColor) state.dynBorderColor.value = String(p.borderColor).trim();
      if (state.dynBorderWidth && p.borderWidth != null) state.dynBorderWidth.value = String(clampNum(p.borderWidth, 0, 12, 1));

      if (state.dynFontFamily) _dispatchSelectRefresh(state.dynFontFamily);
    }
  }

  // shape presets (UI optional)
  // shape presets (UI optional)
  if (isShape) {
    _ensureShapeStylePreset();

    const toolShape = normalizeShapeKind(state.activeTool?.shape || "rect");
    const p = _getPresetForTool({ type: "shape", shape: toolShape });

    if (p && typeof p === "object") {
      // hydrate optional UI if present
      if (state.shapeKind) state.shapeKind.value = normalizeShapeKind(p.shape ?? toolShape);

      if (state.shapeFillEnabled) state.shapeFillEnabled.checked = p.fillEnabled !== false;
      if (state.shapeFillColor) state.shapeFillColor.value = _toHexForColorInput(p.fillColor);

      if (state.shapeStrokeEnabled) state.shapeStrokeEnabled.checked = p.strokeEnabled !== false;
      if (state.shapeStrokeColor) state.shapeStrokeColor.value = _toHexForColorInput(p.strokeColor);

      if (state.shapeStrokeWidth) state.shapeStrokeWidth.value = String(clampShapeNum(p.strokeWidth ?? 2, 0, 24, 2));
      if (state.shapeRadius) state.shapeRadius.value = String(clampShapeNum(p.radius ?? 14, 0, 80, 14));

      // ✅ NEW: fillType + gradient -> UI
      if (state.shapeFillType) {
        const ft = String(p.fillType || "solid").toLowerCase() === "gradient" ? "gradient" : "solid";
        state.shapeFillType.value = ft;
      }

      const g = p.fillGradient && typeof p.fillGradient === "object" ? p.fillGradient : null;
      const stops = Array.isArray(g?.stops) ? g.stops : [];

      if (state.shapeGradType) {
        const gt = String(g?.type || "linear").toLowerCase();
        state.shapeGradType.value = gt === "radial" ? "radial" : "linear";
      }

      if (state.shapeGradAngle) {
        const ang = Number(g?.angle);
        state.shapeGradAngle.value = String(Number.isFinite(ang) ? ang : 90);
      }

      const s1 = stops[0] || null;
      const s2 = stops[1] || null;
      const s3 = stops[2] || null;

      // couleurs: si tes inputs sont type="color", garde du #rrggbb
      if (state.shapeGradColor1) state.shapeGradColor1.value = s1?.color ? _toHexForColorInput(s1.color, "#ffffff") : (state.shapeGradColor1.value || "#ffffff");
      if (state.shapeGradPos1) state.shapeGradPos1.value = s1?.pos != null ? String(s1.pos) : (state.shapeGradPos1.value || "0");

      if (state.shapeGradColor2) state.shapeGradColor2.value = s2?.color ? _toHexForColorInput(s2.color, "#ffffff") : (state.shapeGradColor2.value || "#ffffff");
      if (state.shapeGradPos2) state.shapeGradPos2.value = s2?.pos != null ? String(s2.pos) : (state.shapeGradPos2.value || "100");

      if (state.shapeGradColor3) state.shapeGradColor3.value = s3?.color ? _toHexForColorInput(s3.color, "#ffffff") : (state.shapeGradColor3.value || "#ffffff");
      if (state.shapeGradPos3) state.shapeGradPos3.value = s3?.pos != null ? String(s3.pos) : (state.shapeGradPos3.value || "50");
    }
  }





	if (state.pdfContainer) {
	  state.pdfContainer.style.cursor =
		isText || isRichText || isImage || isPrice || isStock || isEan || isShape ? "crosshair" : "default";
	}

  if (isText) setStatus("Mode: Ajouter texte (clique dans le PDF)");
  else if (isRichText) setStatus("Mode: Ajouter paragraphe (clique dans le PDF)");
  else if (isImage) setStatus("Mode: Ajouter image (clique dans le PDF)");
  else if (isPrice) setStatus("Mode: Ajouter prix produit (clique dans le PDF)");
  else if (isStock) setStatus("Mode: Ajouter rupture/stock (clique dans le PDF)");
  else if (isEan) setStatus("Mode: Ajouter EAN produit (clique dans le PDF)");
  else if (isShape) setStatus(`Mode: Ajouter forme (${state.activeTool.shape}) (clique dans le PDF)`);
  else setStatus("PDF chargé");
}

export async function handleImagePicked(file) {
  const maxBytes = 1.8 * 1024 * 1024;
  if (file.size > maxBytes) {
    setStatus("Image trop lourde. Réduis-la (<= ~1.8MB) avant import.");
    return null;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Lecture image impossible"));
    r.readAsDataURL(file);
  });

  const dims = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });

  return { dataUrl, dims };
}

// ---------------------------------------------------------------------
// Autocomplete produits
// ---------------------------------------------------------------------
let __searchT = null;

function ensureDynCache() {
  if (!state.dynCache) {
    state.dynCache = {
      searchResults: [],
      productsById: new Map(),
      tiersByProductId: new Map(),
      lastSelectedProductId: null,
      lastQuery: "",
      priceByKey: new Map(),
      pricePending: new Set(),
      bulkPending: new Set(),
    };
  }
  _ensureDynStylePreset();
  _ensureShapeStylePreset();
  _ensurePresetsRoot();
  _ensureLayerPresets();
}

async function doSearchProducts(q, force = false) {
  ensureDynCache();
  const query = String(q || "").trim();

  if (!state.dynProductResults) return;

  if (!query) {
    state.dynProductResults.innerHTML = "";
    state.dynProductResults.style.display = "none";
    state.dynCache.searchResults = [];
    state.dynCache.lastQuery = "";
    return;
  }

  if (!force && query === state.dynCache.lastQuery && state.dynCache.searchResults.length) {
    renderDynResultsFromCache();
    return;
  }

  state.dynCache.lastQuery = query;

  try {
    const data = await fetchJSON(`${API_BASE}/marketing/products/search?q=${encodeURIComponent(query)}&limit=12`, {
      method: "GET",
    });

    const items = data?.items || data?.results || [];
    state.dynCache.searchResults = Array.isArray(items) ? items : [];

    renderDynResultsFromCache();
  } catch (e) {
    console.warn("[UI_TOOLS] product search failed:", e);
  }
}

function renderDynResultsFromCache() {
  if (!state.dynProductResults) return;

  const items = state.dynCache?.searchResults || [];
  state.dynProductResults.innerHTML = "";

  if (!items.length) {
    state.dynProductResults.style.display = "none";
    return;
  }

  for (const p of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mdoc-suggest-item";
    btn.dataset.productId = String(p.id);

    const sku = p.sku ? ` • ${p.sku}` : p.reference ? ` • ${p.reference}` : "";
    const ean = p.ean13 ? ` • EAN ${p.ean13}` : p.ean ? ` • EAN ${p.ean}` : "";
    btn.textContent = `${p.name || "Produit"}${sku}${ean}`;

    btn.addEventListener("click", async () => {
      if (
        !state.activeTool ||
        (state.activeTool.type !== "product_price" &&
          state.activeTool.type !== "product_stock_badge" &&
          state.activeTool.type !== "product_ean")
      )
        return;

      const pid = Number(p.id);
      state.activeTool.product_id = pid;

      ensureDynCache();
      state.dynCache.productsById.set(pid, p);
      state.dynCache.lastSelectedProductId = pid;

      if (state.activeTool.type === "product_price") {
        await ensureTiersForProduct(pid);
        syncTierUIFromCache(pid);
      }

      if (state.dynProductSearch) state.dynProductSearch.value = p.name || "";
      if (state.dynProductResults) state.dynProductResults.style.display = "none";

      setStatus(`Produit sélectionné: ${p.name || p.id}`);
    });

    state.dynProductResults.appendChild(btn);
  }

  state.dynProductResults.style.display = "block";
}

async function ensureTiersForProduct(productId) {
  ensureDynCache();
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid <= 0) return;

  if (state.dynCache.tiersByProductId.has(pid)) return;

  try {
    const data = await fetchJSON(`${API_BASE}/marketing/products/${pid}/tiers`, { method: "GET" });
    const tiers = data?.tiers || data?.items || [];
    state.dynCache.tiersByProductId.set(pid, Array.isArray(tiers) ? tiers : []);
  } catch (e) {
    console.warn("[UI_TOOLS] ensureTiersForProduct failed:", e);
    state.dynCache.tiersByProductId.set(pid, []);
  }
}

function syncTierUIFromCache(productId) {
  if (!state.tierSelect) return;
  ensureDynCache();

  const tiers = state.dynCache.tiersByProductId.get(Number(productId)) || [];
  state.tierSelect.innerHTML = `<option value="">—</option>`;

  for (const t of tiers) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    const min = t.qty_min ?? t.min_qty ?? t.quantity ?? "";
    const price = t.price_ht ?? t.price ?? "";
    const label = `Palier ${t.id}${min !== "" ? ` (min ${min})` : ""}${price !== "" ? ` • ${price}€` : ""}`;
    opt.textContent = label;
    state.tierSelect.appendChild(opt);
  }

  state.tierSelect.disabled = String(state.priceMode?.value || "base") !== "tier";
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

function _readBasePriceFromProduct(p) {
  if (!p) return null;
  const v = p.price_ht ?? p.priceHT ?? p.price ?? p.unit_price_ht ?? p.unit_price ?? p.prix_ht ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _readTierPrice(t) {
  if (!t) return null;
  const v = t.price_ht ?? t.priceHT ?? t.price ?? t.unit_price_ht ?? t.unit_price ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchPriceText(productId, mode, tierId) {
  ensureDynCache();

  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid <= 0) return null;

  const m = mode === "tier" ? "tier" : "base";
  const p = state.dynCache.productsById.get(pid) || null;

  if (m === "base") {
    const base = _readBasePriceFromProduct(p);
    return base != null ? formatEurFr(base) : null;
  }

  if (!state.dynCache.tiersByProductId.has(pid)) {
    await ensureTiersForProduct(pid);
  }

  const tiers = state.dynCache.tiersByProductId.get(pid) || [];
  const tid = Number(tierId || 0);
  if (!Number.isFinite(tid) || tid <= 0) return null;

  const t = tiers.find((x) => Number(x.id) === tid) || tiers.find((x) => Number(x.tier_id) === tid) || null;
  const price = _readTierPrice(t);
  return price != null ? formatEurFr(price) : null;
}

// ---------------------------------------------------------------------
// INSERTION
// ---------------------------------------------------------------------
function clearDynSearchUI() {
  try {
    if (state.dynProductSearch) state.dynProductSearch.value = "";
    if (state.dynProductResults) state.dynProductResults.innerHTML = "";
  } catch {}
}

function _shouldSnapInsertion(g) {
  if (!g || !g.snap) return false;
  if (g.snapDuringMoveOnly) return false;
  return true;
}

function _snapPointIfEnabled(x, y, overlayMetrics, ev) {
  const g = getGridSettings(state);
  if (!_shouldSnapInsertion(g)) return { x, y };

  const ow = Number(overlayMetrics?.ow) || 0;
  const oh = Number(overlayMetrics?.oh) || 0;
  if (ow <= 0 || oh <= 0) return { x, y };

  const r = snapRect({ x, y, w: 1, h: 1 }, g, ow, oh, ev, { snapWH: false, snapXY: true });
  return { x: r.x, y: r.y };
}

export async function insertToolObjectAt(a, b, c, d) {
  // ✅ Supporte plusieurs signatures:
  // (event, overlay)
  // (x, y, overlay)
  // (pageIndex, x, y, overlay)

  let e = null;
  let overlay = null;
  let forcedPageIndex = null;
  let forcedX = null;
  let forcedY = null;

  // (event, overlay)
  if (a && typeof a === "object" && "clientX" in a && b) {
    e = a;
    overlay = b;
  }
  // (x, y, overlay)
  else if (typeof a === "number" && typeof b === "number" && c) {
    forcedX = a;
    forcedY = b;
    overlay = c;
  }
  // (pageIndex, x, y, overlay)
  else if (typeof a === "number" && typeof b === "number" && typeof c === "number" && d) {
    forcedPageIndex = a;
    forcedX = b;
    forcedY = c;
    overlay = d;
  } else {
    console.warn("[UI_TOOLS] insertToolObjectAt: signature inconnue", a, b, c, d);
    return;
  }

  if (!overlay) return;
  const m = getOverlayMetrics(overlay);

  const pageIndex =
    forcedPageIndex != null
      ? Number(forcedPageIndex)
      : Number(overlay.dataset.pageIndex || "0");

  if (!state.activeTool) return;

  _ensureLayerPresets();

  let x, y;

  if (forcedX != null && forcedY != null) {
    // coords déjà en unités overlay
    x = Math.max(0, Math.round(forcedX));
    y = Math.max(0, Math.round(forcedY));
  } else {
    // event souris -> conversion
    const rawX = (e?.clientX || 0) - m.rect.left;
    const rawY = (e?.clientY || 0) - m.rect.top;

    x = Math.max(0, Math.round(rawX * m.sx));
    y = Math.max(0, Math.round(rawY * m.sy));
  }

  const snapped = _snapPointIfEnabled(x, y, m, e);
  x = snapped.x;
  y = snapped.y;

  // ✅ le reste de ta fonction ne change pas
  // ... (ton code actuel)

  // ---------------- PRODUCT BLOCK ----------------
  if (state.activeTool?.type === "product_block") {
    const ow = Number(m.ow) || 0;
    const oh = Number(m.oh) || 0;
    const x_rel = ow > 0 ? x / ow : 0;
    const y_rel = oh > 0 ? y / oh : 0;

    if (typeof window.__ZENHUB_PRODUCT_BLOCK_PLACE__ === "function") {
      await window.__ZENHUB_PRODUCT_BLOCK_PLACE__({
        pageIndex,
        x_rel,
        y_rel,
      });
      return;
    }

    setStatus("Bloc produit: handler manquant", "warn");
    return;
  }

  // ---------------- SHAPE (rect / round_rect / line / clip_shape) ----------------
  if (state.activeTool?.type === "shape") {
    const pm = getOrCreatePageModel(pageIndex);

    // ✅ kind demandé
    const kindRaw = String(state.activeTool.shape || state.activeTool.kind || "rect").toLowerCase();

    // ✅ LIRE LE STYLE depuis UI/presets (au lieu de state.activeTool.preset)
    const st = readShapeStyleFromUI(null);

    // =====================================================
    // ✅ CLIP SHAPE (image dans masque) — PRIORITAIRE
    // =====================================================
    if (kindRaw === "clip_shape") {
      let w = 240, h = 160;

      const obj = {
        id: uid("clip"),
        type: "clip_shape",

        x: clamp(x - Math.round(w / 2), 0, 999999),
        y: clamp(y - Math.round(h / 2), 0, 999999),
        w, h,

        x_rel: null, y_rel: null, w_rel: null, h_rel: null,

        layer: (state.layerPresets?.shape === "back" ? "back" : "front"),

        // ✅ forme (arrondis)
        shape: { kind: "round_rect", radius: Number(st.radius) || 14 },
        radius: Number(st.radius) || 14, // legacy si tu t’en sers ailleurs

        // ✅ style (comme tes shapes, + gradient si présent)
        style: {
          kind: "round_rect",
          radius: Number(st.radius) || 14,

          fillEnabled: st.fillEnabled ?? true,
          fillType: st.fillType || "solid",
          fillColor: st.fillColor || "#ffffff",
          fillGradient: (st.fillType === "gradient") ? (st.fillGradient || null) : null,

          strokeEnabled: st.strokeEnabled ?? true,
          strokeWidth: Number(st.strokeWidth ?? 1),
          strokeColor: st.strokeColor || "#111827",
        },

        // ✅ image interne (au départ vide)
        image: {
          src: "",
          src_candidates: [],
          fit: "cover",
          scale: 1.0,
          offsetX: 0,
          offsetY: 0,
        },
      };

      // ✅ coords relatives
      attachRelToObj(obj, m);

      pm.objects.push(obj);

      try { setSelected({ pageIndex, objectId: obj.id }); } catch {}

      renderPageOverlay(pageIndex);
      rerenderAllExcept(pageIndex);
      setStatus("Forme masquée ajoutée (double-clic pour choisir l’image)");

      // one-shot (comme tes shapes)
      state.activeTool = null;
      return;
    }

    // =====================================================
    // ✅ SHAPES classiques : rect / round_rect / line
    // =====================================================
    const safeKind = (kindRaw === "rect" || kindRaw === "round_rect" || kindRaw === "line") ? kindRaw : "rect";
    st.shape = safeKind;

    let w = 220, h = 90;
    if (safeKind === "line") { w = 240; h = 10; }

    const obj = {
      id: uid("shp"),
      type: "shape",
      x: clamp(x - Math.round(w / 2), 0, 999999),
      y: clamp(y - Math.round(h / 2), 0, 999999),
      w, h,

      x_rel: null, y_rel: null, w_rel: null, h_rel: null,

      layer: (state.layerPresets?.shape === "back" ? "back" : "front"),

      shape: { kind: safeKind, radius: Number(st.radius) || 14 },
      line: safeKind === "line" ? { x0: 0.05, y0: 0.5, x1: 0.95, y1: 0.5 } : null,
    };

    writeShapeStyleToObj(obj, st);
    attachRelToObj(obj, m);

    pm.objects.push(obj);

    try { setSelected({ pageIndex, objectId: obj.id }); } catch {}

    renderPageOverlay(pageIndex);
    rerenderAllExcept(pageIndex);
    setStatus("Forme ajoutée");

    state.activeTool = null;
    return;
  }

  // ---------------- RICHTEXT (paragraph) ----------------
  if (state.activeTool.type === "richtext") {
    // input texte (optionnel)
    state.richTextValue = state.richTextValue || document.getElementById("richTextValue");

    const raw = (state.richTextValue?.value || "Nouveau paragraphe").toString();
    const runs = parseRichTextRuns(raw);

    const blockStyle = readRichTextBlockStyleFromUI(null);

    // taille initiale (simple)
    const approxChars = runs.reduce((acc, r) => acc + String(r.text || "").length, 0);
    const w = clamp(Math.round(Math.max(220, Math.min(720, approxChars * (blockStyle.fontSize * 0.55) + 60))), 180, 999999);
    const h = clamp(Math.round(Math.max(80, Math.min(520, blockStyle.fontSize * blockStyle.lineHeight * 4 + 40))), 60, 999999);

    const obj = {
      id: uid("rt"),
      type: "richtext",
      x: Math.max(0, x - Math.round(w / 2)),
      y: Math.max(0, y - Math.round(h / 2)),
      w,
      h,

      x_rel: null, y_rel: null, w_rel: null, h_rel: null,

      // block style
      fontFamily: blockStyle.fontFamily,
      fontSize: blockStyle.fontSize,
      color: blockStyle.color,
      align: blockStyle.align,
      lineHeight: blockStyle.lineHeight,

      // runs
      runs,
    };

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.text || "front"));
    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);
    rerenderAllExcept(pageIndex);

    setActiveTool(null);
    setStatus(`Paragraphe ajouté (page ${pageIndex + 1})`);
    return;
  }



  // ---------------- TEXT ----------------
  if (state.activeTool.type === "text") {
    const text = (state.textToolValue?.value || "Texte").trim() || "Texte";
    const style = readTextStyleFromUI(null);

    const w = Math.max(120, Math.min(520, Math.round(text.length * (style.fontSize * 0.62) + 34)));
    const h = Math.max(34, Math.round(style.fontSize * 1.85));

    const obj = {
      id: uid("txt"),
      type: "text",
      x: Math.max(0, x - Math.round(w / 2)),
      y: Math.max(0, y - Math.round(h / 2)),
      w,
      h,
      text,
    };

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.text || "front"));

    writeStyleToObj(obj, style);
    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);
    clearDynSearchUI();

    setActiveTool(null);
    setStatus(`Texte ajouté (page ${pageIndex + 1})`);
    return;
  }

  // ---------------- IMAGE ----------------
  if (state.activeTool.type === "image") {
    if (!state.activeTool.src) {
      setStatus("Choisis une image d’abord.");
      return;
    }

    const maxInit = 320;
    let w = state.activeTool.w0 || 240;
    let h = state.activeTool.h0 || 240;
    const ratio = w > 0 && h > 0 ? w / h : 1;

    if (w > maxInit) {
      w = maxInit;
      h = Math.round(w / ratio);
    }
    if (h > maxInit) {
      h = maxInit;
      w = Math.round(h * ratio);
    }

    const src = state.activeTool.src;
    const src_original = state.activeTool.src_original || src;
    const removed_bg = !!state.activeTool.removed_bg;

    const obj = {
      id: uid("img"),
      type: "image",
      x: Math.max(0, x - Math.round(w / 2)),
      y: Math.max(0, y - Math.round(h / 2)),
      w,
      h,

      src,
      name: state.activeTool.name || "image",

      src_original,
      removed_bg,
      remove_bg_meta: removed_bg ? { provider: "backend_or_fallback", updated_at: new Date().toISOString() } : null,
    };

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.image || "front"));

    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);

    setActiveTool(null);
    setStatus(`Image ajoutée (page ${pageIndex + 1})`);
    return;
  }

  // ---------------- PRODUCT EAN ----------------
  if (state.activeTool.type === "product_ean") {
    const productId = Number(state.activeTool.product_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      setStatus("Sélectionne d’abord un produit.");
      return;
    }

    ensureDynCache();
    const p = state.dynCache.productsById.get(productId) || null;
    const ean = (p?.ean13 || p?.ean || "").toString().trim();

    if (!ean) {
      setStatus("EAN introuvable pour ce produit.");
      return;
    }

    const style = readDynamicStyleFromUI(null);
    const obj = makeTextObjAt({
      x,
      y,
      text: ean,
      style,
      meta: { kind: "product_ean", product_id: productId },
    });

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.dyn || "front"));

    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);

    setStatus(`EAN ajouté (page ${pageIndex + 1}) — clique pour en placer un autre`);
    return;
  }

  // ---------------- PRODUCT PRICE ----------------
  if (state.activeTool.type === "product_price") {
    const productId = Number(state.activeTool.product_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      setStatus("Sélectionne d’abord un produit.");
      return;
    }

    const mode = String(state.priceMode?.value || "base"); // "base" | "tier"
    const tierId = mode === "tier" ? Number(state.tierSelect?.value || 0) : 0;

    const text = (await fetchPriceText(productId, mode, tierId)) || "—";
    const style = readDynamicStyleFromUI(null);

    const meta = {
      kind: "product_price",
      product_id: productId,
      price_mode: mode,
      tier_id: tierId > 0 ? tierId : null,
    };

    if (state.priceIntPlus1pt?.checked) {
      meta.priceStyle = { kind: "int_plus_1pt", euros_plus_pt: 7 };
    }

    const obj = makeTextObjAt({ x, y, text, style, meta });

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.dyn || "front"));
    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);

    setStatus(`Prix ajouté (page ${pageIndex + 1}) — clique pour en placer un autre`);
    return;
  }

  // ---------------- STOCK BADGE ----------------
  if (state.activeTool.type === "product_stock_badge") {
    const productId = Number(state.activeTool.product_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      setStatus("Sélectionne d’abord un produit.");
      return;
    }

    const text = (state.stockText?.value || state.activeTool.text || "Rupture de stock").trim() || "Rupture de stock";
    const modeLabo = String(state.stockModeLabo?.value || state.activeTool.mode_labo || "show_stock");

    state.activeTool.text = text;
    state.activeTool.mode_labo = modeLabo;

    const style = readDynamicStyleFromUI(null);

    const obj = makeTextObjAt({
      x,
      y,
      text,
      style,
      meta: {
        kind: "product_stock_badge",
        product_id: productId,
        text,
        mode_labo: modeLabo,
        mode_agent: "only_if_zero",
      },
    });

    setObjLayer(obj, _normalizeLayer(state.layerPresets?.dyn || "front"));

    attachRelToObj(obj, m);

    getOrCreatePageModel(pageIndex).objects.push(obj);
    setSelected({ pageIndex, objectId: obj.id });
    renderPageOverlay(pageIndex);

    setStatus(`Rupture/stock ajouté (page ${pageIndex + 1}) — clique pour en placer un autre`);
    return;
  }
}


// ---------------------------------------------------------------------
// Bind texte
// ---------------------------------------------------------------------
export function bindTextToolInputs() {
  _ensureLayerPresets();

  state.textToolFont = document.getElementById("textToolFont");
  state.textToolWeight = document.getElementById("textToolWeight");
  state.textToolBgMode = document.getElementById("textToolBgMode");
  state.textToolBgColor = document.getElementById("textToolBgColor");
  state.textToolBorderEnabled = document.getElementById("textToolBorderEnabled");
  state.textToolBorderColor = document.getElementById("textToolBorderColor");
  state.textToolBorderWidth = document.getElementById("textToolBorderWidth");

  const applyToSelected = () => {
    if (state._syncingStyleUi) return;
    applyTextStyleToSelection();
  };

  const syncUIFromSelected = () => {
    if (!state.selected) return;
    const obj = getObject(state.selected.pageIndex, state.selected.objectId);
    if (!obj || obj.type !== "text" || obj.dynamic) return;

    const st = readStyleFromObj(obj);
    _rememberPresetForTool({ type: "text" }, st);

    if (state.textToolSize) state.textToolSize.value = String(st.fontSize || 18);
    if (state.textToolColor) state.textToolColor.value = st.color || "#111827";
    if (state.textToolBold) state.textToolBold.checked = normalizeWeight(st.fontWeight) === "700";
    if (state.textToolWeight) state.textToolWeight.value = normalizeWeight(st.fontWeight || "400");

    state._syncingStyleUi = true;
    try {
      if (state.textToolFont) {
        const ff = normalizeFontFamily(st.fontFamily);
        _setSelectValueSafe(state.textToolFont, ff, "default");
        _dispatchSelectRefresh(state.textToolFont);
      }
    } finally {
      state._syncingStyleUi = false;
    }

    if (state.textToolValue) state.textToolValue.value = obj.text || "";

    const bgMode = normalizeBgMode(st.bgMode || (st.bgEnabled === false ? "transparent" : "semi"));
    if (state.textToolBgMode) state.textToolBgMode.value = bgMode;

    if (state.textToolBgColor) {
      const c = (st.bgColor || "#ffffff").trim();
      state.textToolBgColor.value = isHexColor(c) ? c : "#ffffff";
      state.textToolBgColor.disabled = bgMode !== "color";
    }

    if (state.textToolBorderEnabled) state.textToolBorderEnabled.checked = !!st.borderEnabled;
    if (state.textToolBorderColor) state.textToolBorderColor.value = st.borderColor || "#111827";
    if (state.textToolBorderWidth) state.textToolBorderWidth.value = String(clampNum(st.borderWidth ?? 1, 0, 12, 1));

    const borderOn = !!st.borderEnabled;
    if (state.textToolBorderColor) state.textToolBorderColor.disabled = !borderOn;
    if (state.textToolBorderWidth) state.textToolBorderWidth.disabled = !borderOn;

    if (obj.layer === "back" || obj.layer === "front") {
      state.layerPresets.text = _normalizeLayer(obj.layer);
    }
    try {
      syncLayerSwitchesFromSelection();
    } catch {}
  };

  state._syncTextUiFromSelected = syncUIFromSelected;

  const bind = (el, evt) => {
    if (!el) return;
    el.addEventListener(evt, applyToSelected);
  };

  bind(state.textToolSize, "input");
  bind(state.textToolColor, "input");
  bind(state.textToolBold, "change");
  bind(state.textToolWeight, "change");
  bind(state.textToolFont, "change");

  if (state.textToolBgMode) {
    state.textToolBgMode.addEventListener("change", () => {
      const mode = normalizeBgMode(state.textToolBgMode.value);
      if (state.textToolBgColor) state.textToolBgColor.disabled = mode !== "color";
      applyToSelected();
    });
  }

  bind(state.textToolBgColor, "input");

  if (state.textToolBorderEnabled) {
    state.textToolBorderEnabled.addEventListener("change", () => {
      const on = !!state.textToolBorderEnabled.checked;
      if (state.textToolBorderColor) state.textToolBorderColor.disabled = !on;
      if (state.textToolBorderWidth) state.textToolBorderWidth.disabled = !on;
      applyToSelected();
    });
  }

  bind(state.textToolBorderColor, "input");
  bind(state.textToolBorderWidth, "input");

  if (state.textToolValue) {
    state.textToolValue.addEventListener("input", () => {
      const sel = _getActiveIdsOnCurrentPage();
      if (!sel) return;

      let changed = 0;
      for (const id of sel.ids) {
        const obj = getObject(sel.pageIndex, id);
        if (!obj || obj.type !== "text" || obj.dynamic) continue;
        obj.text = (state.textToolValue.value || "").toString();
        changed++;
      }
      if (changed) {
        renderPageOverlay(sel.pageIndex);
        rerenderAllExcept(sel.pageIndex);
      }
    });
  }

  try {
    bindLayerSwitchesUI();
  } catch {}

  if (state.selected) {
    try {
      syncUIFromSelected();
    } catch {}
  }
}




// ---------------------------------------------------------------------
// ✅ Bind richtext (optionnel : si toolbox existe)
// ---------------------------------------------------------------------
export function bindRichTextToolInputs() {
  _ensureLayerPresets();

  state.richTextToolBox = state.richTextToolBox || document.getElementById("richTextToolBox");
  state.richTextValue = state.richTextValue || document.getElementById("richTextValue");
  state.richTextFont = state.richTextFont || document.getElementById("richTextFont");
  state.richTextSize = state.richTextSize || document.getElementById("richTextSize");
  state.richTextColor = state.richTextColor || document.getElementById("richTextColor");
  state.richTextAlign = state.richTextAlign || document.getElementById("richTextAlign");
  state.richTextLineHeight = state.richTextLineHeight || document.getElementById("richTextLineHeight");

  const applyToSelected = () => {
    if (state._syncingStyleUi) return;
    const sel = _getActiveIdsOnCurrentPage();
    if (!sel) return;

    let changed = 0;
    for (const id of sel.ids) {
      const obj = getObject(sel.pageIndex, id);
      if (!obj || obj.type !== "richtext") continue;

      const bs = readRichTextBlockStyleFromUI(obj);
      obj.fontFamily = bs.fontFamily;
      obj.fontSize = bs.fontSize;
      obj.color = bs.color;
      obj.align = bs.align;
      obj.lineHeight = bs.lineHeight;

      // si on change le texte complet => on regen runs
      if (state.richTextValue) {
        const raw = String(state.richTextValue.value || "");
        if (raw.trim()) obj.runs = parseRichTextRuns(raw);
      }

      changed++;
    }

    if (changed) {
      renderPageOverlay(sel.pageIndex);
      rerenderAllExcept(sel.pageIndex);
    }
  };

  const bind = (el, evt) => el && el.addEventListener(evt, applyToSelected);

  bind(state.richTextFont, "change");
  bind(state.richTextSize, "input");
  bind(state.richTextColor, "input");
  bind(state.richTextAlign, "change");
  bind(state.richTextLineHeight, "input");
  bind(state.richTextValue, "input");

  state._syncRichTextUiFromSelected = () => {
    if (!state.selected) return;
    const obj = getObject(state.selected.pageIndex, state.selected.objectId);
    if (!obj || obj.type !== "richtext") return;

    state._syncingStyleUi = true;
    try {
      if (state.richTextFont) _setSelectValueSafe(state.richTextFont, normalizeFontFamily(obj.fontFamily), "default");
      if (state.richTextSize) state.richTextSize.value = String(clampNum(obj.fontSize ?? 16, 8, 200, 16));
      if (state.richTextColor) state.richTextColor.value = (obj.color || "#111827").trim();
      if (state.richTextAlign) state.richTextAlign.value = String(obj.align || "left");
      if (state.richTextLineHeight) state.richTextLineHeight.value = String(Number(obj.lineHeight ?? 1.25) || 1.25);

      if (state.richTextValue) {
        // recompose simple (⚠️ on perd la structure exacte, mais ok pour MVP)
        const txt = Array.isArray(obj.runs)
		  ? obj.runs.map(r => {
			  const t = String(r?.text || "");
			  if (!t) return "";
			  let out = t;
			  if (r.fontFamily) out = `[font=${r.fontFamily}]${out}[/font]`;
			  if (r.color) out = `[color=${r.color}]${out}[/color]`;
			  if (r.fontSize != null) out = `[size=${r.fontSize}]${out}[/size]`;
			  if (r.bold) out = `**${out}**`;
			  return out;
			}).join("")
		  : "";
		state.richTextValue.value = txt || "Nouveau paragraphe";

      }
    } finally {
      state._syncingStyleUi = false;
    }

    if (obj.layer === "back" || obj.layer === "front") {
      state.layerPresets.text = _normalizeLayer(obj.layer);
    }
    try { syncLayerSwitchesFromSelection(); } catch {}
  };

  if (state.selected) {
    try { state._syncRichTextUiFromSelected(); } catch {}
  }
}

// ---------------------------------------------------------------------
// Bind dyn tools
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Bind shapes
// ---------------------------------------------------------------------
export function bindShapeToolInputs() {
  _ensureLayerPresets();

  // -----------------------------------------------------
  // ✅ IDs HTML (fallbacks)
  // -----------------------------------------------------
  state.shapeKind = state.shapeKind || document.getElementById("shapeKind");
  state.shapeFillEnabled = state.shapeFillEnabled || document.getElementById("shapeFillEnabled");
  state.shapeToolBox = state.shapeToolBox || document.getElementById("shapeToolBox");

  state.shapeFillColor =
    state.shapeFillColor ||
    document.getElementById("shapeFill") ||
    document.getElementById("shapeFillColor");

  state.shapeStrokeEnabled = state.shapeStrokeEnabled || document.getElementById("shapeStrokeEnabled");

  state.shapeStrokeColor =
    state.shapeStrokeColor ||
    document.getElementById("shapeStroke") ||
    document.getElementById("shapeStrokeColor");

  state.shapeStrokeWidth = state.shapeStrokeWidth || document.getElementById("shapeStrokeWidth");
  state.shapeRadius = state.shapeRadius || document.getElementById("shapeRadius");

  // Dégradé
  state.shapeFillType =
    state.shapeFillType ||
    document.getElementById("shapeFillType") ||
    document.getElementById("shapeFillMode") ||
    document.getElementById("shapeFillKind");

  state.shapeGradType = state.shapeGradType || document.getElementById("shapeGradType");
  state.shapeGradAngle = state.shapeGradAngle || document.getElementById("shapeGradAngle");

  state.shapeGradColor1 = state.shapeGradColor1 || document.getElementById("shapeGradColor1");
  state.shapeGradColor2 = state.shapeGradColor2 || document.getElementById("shapeGradColor2");
  state.shapeGradColor3 = state.shapeGradColor3 || document.getElementById("shapeGradColor3");

  state.shapeGradPos1 = state.shapeGradPos1 || document.getElementById("shapeGradPos1");
  state.shapeGradPos2 = state.shapeGradPos2 || document.getElementById("shapeGradPos2");
  state.shapeGradPos3 = state.shapeGradPos3 || document.getElementById("shapeGradPos3");

  // -----------------------------------------------------
  // Apply -> applique les changements UI à la sélection
  // -----------------------------------------------------
  const apply = () => {
    if (state._syncingStyleUi) return;
    applyShapeStyleToSelection();
  };

  const bind = (el, evt) => {
    if (!el) return;
    el.addEventListener(evt, apply);
  };

  bind(state.shapeKind, "change");
  bind(state.shapeFillEnabled, "change");
  bind(state.shapeFillColor, "input");

  bind(state.shapeStrokeEnabled, "change");
  bind(state.shapeStrokeColor, "input");
  bind(state.shapeStrokeWidth, "input");
  bind(state.shapeRadius, "input");

  // Dégradé
  bind(state.shapeFillType, "change");
  bind(state.shapeGradType, "change");
  bind(state.shapeGradAngle, "input");
  bind(state.shapeGradColor1, "input");
  bind(state.shapeGradColor2, "input");
  bind(state.shapeGradColor3, "input");
  bind(state.shapeGradPos1, "input");
  bind(state.shapeGradPos2, "input");
  bind(state.shapeGradPos3, "input");

  // -----------------------------------------------------
  // Sync UI depuis la shape sélectionnée
  // -----------------------------------------------------
  state._syncShapeUiFromSelected = () => {
    if (!state.selected) return;
    const obj = getObject(state.selected.pageIndex, state.selected.objectId);
    if (!obj || obj.type !== "shape") return;

    const st = readShapeStyleFromObj(obj);
    _rememberShapeStylePreset(st);
    _rememberShapePresetForTool({ type: "shape", shape: st.shape }, st);

    state._syncingStyleUi = true;
    try {
      if (state.shapeKind) state.shapeKind.value = normalizeShapeKind(st.shape);
      if (state.shapeFillEnabled) state.shapeFillEnabled.checked = st.fillEnabled !== false;

      // inputs type="color" => hex
      if (state.shapeFillColor) state.shapeFillColor.value = _toHexForColorInput(st.fillColor, "#ffffff");

      if (state.shapeStrokeEnabled) state.shapeStrokeEnabled.checked = st.strokeEnabled !== false;
      if (state.shapeStrokeColor) state.shapeStrokeColor.value = _toHexForColorInput(st.strokeColor, "#111827");

      if (state.shapeStrokeWidth) state.shapeStrokeWidth.value = String(clampShapeNum(st.strokeWidth ?? 2, 0, 24, 2));
      if (state.shapeRadius) state.shapeRadius.value = String(clampShapeNum(st.radius ?? 14, 0, 80, 14));

      // fillType + gradient
      if (state.shapeFillType) state.shapeFillType.value = st.fillType === "gradient" ? "gradient" : "solid";

      const g = st.fillGradient && typeof st.fillGradient === "object" ? st.fillGradient : null;
      const stops = Array.isArray(g?.stops) ? g.stops : [];

      if (state.shapeGradType) {
        const gt = String(g?.type || "linear").toLowerCase();
        state.shapeGradType.value = gt === "radial" ? "radial" : "linear";
      }
      if (state.shapeGradAngle) {
        const ang = Number(g?.angle);
        state.shapeGradAngle.value = String(Number.isFinite(ang) ? ang : 90);
      }

      const s1 = stops[0] || null;
      const s2 = stops[1] || null;
      const s3 = stops[2] || null;

      if (state.shapeGradColor1) state.shapeGradColor1.value = _toHexForColorInput(s1?.color, state.shapeGradColor1.value || "#ffffff");
      if (state.shapeGradPos1) state.shapeGradPos1.value = String(s1?.pos ?? 0);

      if (state.shapeGradColor2) state.shapeGradColor2.value = _toHexForColorInput(s2?.color, state.shapeGradColor2.value || "#ffffff");
      if (state.shapeGradPos2) state.shapeGradPos2.value = String(s2?.pos ?? 100);

      if (state.shapeGradColor3) state.shapeGradColor3.value = _toHexForColorInput(s3?.color, state.shapeGradColor3.value || "#ffffff");
      if (state.shapeGradPos3) state.shapeGradPos3.value = String(s3?.pos ?? 50);

      if (obj.layer === "back" || obj.layer === "front") {
        state.layerPresets.shape = _normalizeLayer(obj.layer);
      }
    } finally {
      state._syncingStyleUi = false;
    }

    try {
      syncLayerSwitchesFromSelection();
    } catch {}
  };

  // Si déjà une sélection au moment du bind
  if (state.selected) {
    try {
      state._syncShapeUiFromSelected();
    } catch {}
  }

  // layer UI
  try {
    bindLayerSwitchesUI();
  } catch {}
}

// ---------------------------------------------------------------------
// ✅ Bind CLIP SHAPE (image masquée) — UI panneau gauche
// ---------------------------------------------------------------------
export function bindClipShapeToolInputs() {
  _ensureLayerPresets();

  // Panneau
  state.clipShapeToolBox = state.clipShapeToolBox || document.getElementById("clipShapeToolBox");

  // Boutons / inputs (IDs proposés dans ton prompt)
  state.btnClipPickImage = state.btnClipPickImage || document.getElementById("btnClipPickImage");
  state.btnClipCenterImage = state.btnClipCenterImage || document.getElementById("btnClipCenterImage");
  state.clipZoom = state.clipZoom || document.getElementById("clipZoom");
  state.clipRadius = state.clipRadius || document.getElementById("clipRadius");
  state.clipStrokeColor = state.clipStrokeColor || document.getElementById("clipStrokeColor");
  state.clipStrokeWidth = state.clipStrokeWidth || document.getElementById("clipStrokeWidth");
  state.clipFillColor = state.clipFillColor || document.getElementById("clipFillColor"); // optionnel (fond derrière image)

  // input file (dédié ou réutilisé)
  state.clipImageFileInput =
    state.clipImageFileInput ||
    document.getElementById("clipImageFileInput") ||
    document.getElementById("imageFileInput"); // fallback si tu réutilises celui des images

  // Helpers sélection
  const _getSel = () => {
    if (!state.selected) return null;
    const pageIndex = state.selected.pageIndex;
    const obj = getObject(pageIndex, state.selected.objectId);
    if (!obj || obj.type !== "clip_shape") return null;
    return { pageIndex, obj };
  };

  const _ensureImageState = (obj) => {
    if (!obj.image || typeof obj.image !== "object") {
      obj.image = { scale: 1.0, offsetX: 0, offsetY: 0, fit: "cover" };
    } else {
      if (obj.image.scale == null) obj.image.scale = 1.0;
      if (obj.image.offsetX == null) obj.image.offsetX = 0;
      if (obj.image.offsetY == null) obj.image.offsetY = 0;
      if (!obj.image.fit) obj.image.fit = "cover";
    }
    return obj;
  };

	  const _apply = () => {
	  if (state._syncingStyleUi) return;

	  const sel = _getSel();
	  if (!sel) return;
	  const { pageIndex, obj } = sel;

	  // ✅ toujours travailler via le même writer que les shapes
	  const cur = readShapeStyleFromObj(obj);

	  // radius
	  if (state.clipRadius) {
		const r = Number(state.clipRadius.value);
		cur.radius = Number.isFinite(r) ? Math.max(0, Math.min(80, r)) : cur.radius;
	  }

	  // stroke
	  if (state.clipStrokeWidth) {
		const sw = Number(state.clipStrokeWidth.value);
		cur.strokeWidth = Number.isFinite(sw) ? Math.max(0, Math.min(24, sw)) : cur.strokeWidth;
		cur.strokeEnabled = cur.strokeWidth > 0;
	  }
	  if (state.clipStrokeColor) {
		cur.strokeColor = String(state.clipStrokeColor.value || cur.strokeColor || "#111827").trim();
	  }

	  // fill derrière image (optionnel)
	  if (state.clipFillColor) {
		cur.fillColor = String(state.clipFillColor.value || cur.fillColor || "#ffffff").trim();
		cur.fillEnabled = true;
		cur.fillType = "solid";
		cur.fillGradient = null;
	  }

	  // ✅ applique AU BON ENDROIT (obj.style.* + legacy mirrors)
	  writeShapeStyleToObj(obj, cur);

	  // zoom image
	  if (state.clipZoom) {
		_ensureImageState(obj);
		const z = Number(state.clipZoom.value);
		obj.image.scale = Number.isFinite(z) ? Math.max(0.5, Math.min(3.0, z)) : (obj.image.scale ?? 1.0);
	  }

	  // layer preset sync
	  if (obj.layer === "back" || obj.layer === "front") {
		state.layerPresets.clip_shape = _normalizeLayer(obj.layer);
	  }

	  renderPageOverlay(pageIndex);
	  rerenderAllExcept(pageIndex);
	};


  // Sync UI depuis l'objet sélectionné
	state._syncClipShapeUiFromSelected = () => {
	  const sel = _getSel();
	  if (!sel) {
		if (state.clipShapeToolBox) state.clipShapeToolBox.style.display = "none";
		return;
	  }

	  const { obj } = sel;
	  _ensureImageState(obj);

	  const st = readShapeStyleFromObj(obj);

	  if (state.clipShapeToolBox) state.clipShapeToolBox.style.display = "block";

	  state._syncingStyleUi = true;
	  try {
		if (state.clipZoom) state.clipZoom.value = String(Number(obj.image?.scale ?? 1.0) || 1.0);

		if (state.clipRadius) state.clipRadius.value = String(clampShapeNum(st.radius ?? 0, 0, 80, 0));
		if (state.clipStrokeWidth) state.clipStrokeWidth.value = String(clampShapeNum(st.strokeWidth ?? 0, 0, 24, 0));
		if (state.clipStrokeColor) state.clipStrokeColor.value = _toHexForColorInput(st.strokeColor, "#111827");

		if (state.clipFillColor) state.clipFillColor.value = _toHexForColorInput(st.fillColor, "#ffffff");

		if (obj.layer === "back" || obj.layer === "front") {
		  state.layerPresets.clip_shape = _normalizeLayer(obj.layer);
		}
	  } finally {
		state._syncingStyleUi = false;
	  }

	  try { syncLayerSwitchesFromSelection(); } catch {}
	};


  // Bind UI events
  const bind = (el, evt) => el && el.addEventListener(evt, _apply);

  bind(state.clipZoom, "input");
  bind(state.clipRadius, "input");
  bind(state.clipStrokeColor, "input");
  bind(state.clipStrokeWidth, "input");
  bind(state.clipFillColor, "input");

  // Choisir / remplacer image
  if (state.btnClipPickImage) {
    state.btnClipPickImage.addEventListener("click", () => {
      const sel = _getSel();
      if (!sel) return;

      // Si clip_shape.js expose un handler global, on le privilégie
      if (typeof window.__ZENHUB_CLIP_SHAPE_PICK_IMAGE__ === "function") {
        try {
          window.__ZENHUB_CLIP_SHAPE_PICK_IMAGE__({
            pageIndex: sel.pageIndex,
            objectId: sel.obj.id,
          });
          return;
        } catch (e) {
          console.warn("[UI_TOOLS] __ZENHUB_CLIP_SHAPE_PICK_IMAGE__ failed:", e);
        }
      }

      // Fallback: file input + handleImagePicked (dataURL)
      if (!state.clipImageFileInput) return;
      state._clipPickTarget = { pageIndex: sel.pageIndex, objectId: sel.obj.id };
      state.clipImageFileInput.value = "";
      state.clipImageFileInput.click();
    });
  }

  // Fallback file input change
  if (state.clipImageFileInput) {
    state.clipImageFileInput.addEventListener("change", async (ev) => {
      const file = ev.target?.files?.[0];
      if (!file) return;

      const tgt = state._clipPickTarget;
      state._clipPickTarget = null;
      if (!tgt) return;

      const obj = getObject(tgt.pageIndex, tgt.objectId);
      if (!obj || obj.type !== "clip_shape") return;

      const picked = await handleImagePicked(file);
      if (!picked || !picked.dataUrl) return;

		_ensureImageState(obj);

		obj.image.src = picked.dataUrl;
		obj.image.src_original = picked.dataUrl;
		obj.image.src_candidates = obj.image.src_candidates || [];

      _ensureImageState(obj);

      // Optionnel: reset offsets à l’import
      obj.image.offsetX = 0;
      obj.image.offsetY = 0;
      if (!Number.isFinite(Number(obj.image.scale))) obj.image.scale = 1.0;

      renderPageOverlay(tgt.pageIndex);
      rerenderAllExcept(tgt.pageIndex);
      try { state._syncClipShapeUiFromSelected(); } catch {}
      setStatus("Image associée au bloc masqué");
    });
  }

  // Centrer image (reset offsets)
  if (state.btnClipCenterImage) {
    state.btnClipCenterImage.addEventListener("click", () => {
      const sel = _getSel();
      if (!sel) return;
      _ensureImageState(sel.obj);
      sel.obj.image.offsetX = 0;
      sel.obj.image.offsetY = 0;
      renderPageOverlay(sel.pageIndex);
      rerenderAllExcept(sel.pageIndex);
      try { state._syncClipShapeUiFromSelected(); } catch {}
      setStatus("Image centrée");
    });
  }

  // Si déjà sélectionné au moment du bind
  if (state.selected) {
    try { state._syncClipShapeUiFromSelected(); } catch {}
  }
}

  


export function bindDynamicToolsUI() {
  ensureDynCache();

  state.btnAddProductPrice = state.btnAddProductPrice || document.getElementById("btnAddProductPrice");
  state.btnAddStockBadge = state.btnAddStockBadge || document.getElementById("btnAddStockBadge");
  state.btnAddProductEan = state.btnAddProductEan || document.getElementById("btnAddProductEan");

  state.dynamicCommonBox = state.dynamicCommonBox || document.getElementById("dynamicCommonBox");
  state.productPriceToolBox = state.productPriceToolBox || document.getElementById("productPriceToolBox");
  state.stockBadgeToolBox = state.stockBadgeToolBox || document.getElementById("stockBadgeToolBox");
  state.productEanToolBox = state.productEanToolBox || document.getElementById("productEanToolBox");

  state.dynProductSearch = state.dynProductSearch || document.getElementById("dynProductSearch");
  state.dynProductResults = state.dynProductResults || document.getElementById("dynProductResults");

  state.dynFontFamily = state.dynFontFamily || document.getElementById("dynFontFamily");
  state.dynFontSize = state.dynFontSize || document.getElementById("dynFontSize");
  state.dynFontWeight = state.dynFontWeight || document.getElementById("dynFontWeight");
  state.dynColor = state.dynColor || document.getElementById("dynColor");
  state.dynBgMode = state.dynBgMode || document.getElementById("dynBgMode");
  state.dynBgColor = state.dynBgColor || document.getElementById("dynBgColor");
  state.dynBorderEnabled = state.dynBorderEnabled || document.getElementById("dynBorderEnabled");
  state.dynBorderColor = state.dynBorderColor || document.getElementById("dynBorderColor");
  state.dynBorderWidth = state.dynBorderWidth || document.getElementById("dynBorderWidth");

  state.btnCancelToolDynamic = state.btnCancelToolDynamic || document.getElementById("btnCancelToolDynamic");
  state.priceMode = state.priceMode || document.getElementById("priceMode");
  state.tierSelect = state.tierSelect || document.getElementById("tierSelect");
  state.priceIntPlus1pt = state.priceIntPlus1pt || document.getElementById("priceIntPlus1pt");

  state.stockText = state.stockText || document.getElementById("stockText");
  state.stockModeLabo = state.stockModeLabo || document.getElementById("stockModeLabo");

  _applyDynStylePresetToUI();

  const seedFromToolPreset = () => {
    const p = _getPresetForTool(state.activeTool || { type: "product_price" });
    if (!p || typeof p !== "object") return;

    if (state.dynFontFamily && p.fontFamily)
      _setSelectValueSafe(state.dynFontFamily, normalizeFontFamily(p.fontFamily), "default");

    if (state.dynFontSize && p.fontSize != null) state.dynFontSize.value = String(clampNum(p.fontSize, 8, 120, 18));
    if (state.dynFontWeight && p.fontWeight) state.dynFontWeight.value = normalizeWeight(p.fontWeight);
    if (state.dynColor && p.color) state.dynColor.value = String(p.color).trim();

    if (state.dynBgMode && p.bgMode) state.dynBgMode.value = normalizeBgMode(p.bgMode);
    if (state.dynBgColor && p.bgColor && isHexColor(p.bgColor)) state.dynBgColor.value = p.bgColor;

    if (state.dynBorderEnabled && p.borderEnabled != null) state.dynBorderEnabled.checked = !!p.borderEnabled;
    if (state.dynBorderColor && p.borderColor) state.dynBorderColor.value = String(p.borderColor).trim();
    if (state.dynBorderWidth && p.borderWidth != null) state.dynBorderWidth.value = String(clampNum(p.borderWidth, 0, 12, 1));

    if (state.dynFontFamily) _dispatchSelectRefresh(state.dynFontFamily);
  };

  seedFromToolPreset();

  if (state.btnAddProductPrice) {
    state.btnAddProductPrice.addEventListener("click", () => {
      setActiveTool({ type: "product_price" });
      showDynamicToolBoxes("product_price");
      seedFromToolPreset();
      setStatus("Mode: Ajouter prix produit (clique dans le PDF)");
    });
  }

  if (state.btnAddStockBadge) {
    state.btnAddStockBadge.addEventListener("click", () => {
      setActiveTool({ type: "product_stock_badge" });
      showDynamicToolBoxes("product_stock_badge");
      seedFromToolPreset();
      setStatus("Mode: Ajouter rupture/stock (clique dans le PDF)");
    });
  }

  if (state.btnAddProductEan) {
    state.btnAddProductEan.addEventListener("click", () => {
      setActiveTool({ type: "product_ean" });
      showDynamicToolBoxes("product_ean");
      seedFromToolPreset();
      setStatus("Mode: Ajouter EAN produit (clique dans le PDF)");
    });
  }

  const onDynUIChanged = () => {
    if (state._syncingStyleUi) return;

    const style = readDynamicStyleFromUI(null);
    _rememberDynStylePreset(style);
    _rememberPresetForTool(state.activeTool || { type: "product_price" }, style);
    applyDynamicStyleToSelection();
  };

  const bindDyn = (el, evt) => el && el.addEventListener(evt, onDynUIChanged);

  bindDyn(state.dynFontFamily, "change");
  bindDyn(state.dynFontSize, "input");
  bindDyn(state.dynFontWeight, "change");
  bindDyn(state.dynColor, "input");
  bindDyn(state.dynBgMode, "change");
  bindDyn(state.dynBgColor, "input");
  bindDyn(state.dynBorderEnabled, "change");
  bindDyn(state.dynBorderColor, "input");
  bindDyn(state.dynBorderWidth, "input");

  state._syncDynamicUiFromSelected = () => {
    if (!state.selected) return;
    const obj = getObject(state.selected.pageIndex, state.selected.objectId);
    if (!obj || obj.type !== "text" || !obj.dynamic) return;

    const style = readStyleFromObj(obj);
    _rememberDynStylePreset(style);

    const kind = String(obj.dynamic.kind || "");
    if (kind === "product_price" || kind === "product_stock_badge" || kind === "product_ean") {
      _rememberPresetForTool({ type: kind }, style);
    }

    state._syncingStyleUi = true;
    try {
      _applyDynStylePresetToUI();

      if (state.dynFontFamily) {
        const ff = normalizeFontFamily(style.fontFamily);
        _setSelectValueSafe(state.dynFontFamily, ff, "default");
        _dispatchSelectRefresh(state.dynFontFamily);
      }

      if (state.dynFontSize) state.dynFontSize.value = String(clampNum(style.fontSize ?? 18, 8, 120, 18));
      if (state.dynFontWeight) state.dynFontWeight.value = normalizeWeight(style.fontWeight ?? "400");
      if (state.dynColor) state.dynColor.value = String(style.color || "#111827").trim();

      if (obj.layer === "back" || obj.layer === "front") {
        state.layerPresets.dyn = _normalizeLayer(obj.layer);
      }
    } finally {
      state._syncingStyleUi = false;
    }

    if (state.priceIntPlus1pt && obj.dynamic?.kind === "product_price") {
      state.priceIntPlus1pt.checked = isPriceIntPlus1pt(obj.dynamic);
    }
    try {
      syncLayerSwitchesFromSelection();
    } catch {}
  };

  if (state.dynProductSearch) {
    state.dynProductSearch.addEventListener("input", () => {
      clearTimeout(__searchT);
      __searchT = setTimeout(() => doSearchProducts(state.dynProductSearch.value), 160);
    });

    state.dynProductSearch.addEventListener("focus", () => {
      const q = String(state.dynProductSearch.value || "").trim();
      if (q) doSearchProducts(q, true);
    });
  }

  if (state.priceMode) {
    state.priceMode.addEventListener("change", () => {
      if (state.tierSelect) state.tierSelect.disabled = String(state.priceMode.value || "base") !== "tier";
    });
  }

  if (state.priceIntPlus1pt) {
    state.priceIntPlus1pt.addEventListener("change", () => {
      const sel = _getActiveIdsOnCurrentPage();
      if (!sel) return;

      let changed = 0;
      for (const id of sel.ids) {
        const obj = getObject(sel.pageIndex, id);
        if (!obj || obj.type !== "text" || obj.dynamic?.kind !== "product_price") continue;
        obj.dynamic = setPriceIntPlus1pt(obj.dynamic, !!state.priceIntPlus1pt.checked);
        changed++;
      }
      if (changed) {
        renderPageOverlay(sel.pageIndex);
        rerenderAllExcept(sel.pageIndex);
      }
    });
  }

  try {
    bindLayerSwitchesUI();
  } catch {}

  if (state.btnCancelToolDynamic) {
    state.btnCancelToolDynamic.addEventListener("click", () => {
      setActiveTool(null);
      setStatus("Outil annulé");
    });
  }
}


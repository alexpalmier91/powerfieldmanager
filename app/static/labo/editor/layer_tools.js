// app/static/labo/editor/layer_tools.js
// =====================================================
// Layer tools (back / front)
// Centralized & draft-safe
// =====================================================

import { state, setStatus } from "./state.js?v=12";
import { getObject } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";

export const LAYER_BACK = "back";
export const LAYER_FRONT = "front";

// z-index conventions (HTML overlay)
const Z_BACK = 10;
const Z_FRONT = 100;
const Z_SELECTED = 1000;

// -----------------------------------------------------
// Basic helpers
// -----------------------------------------------------
export function getObjLayer(obj) {
  if (!obj || !obj.layer) return LAYER_FRONT;
  return obj.layer === LAYER_BACK ? LAYER_BACK : LAYER_FRONT;
}

export function setObjLayer(obj, layer) {
  if (!obj) return;
  obj.layer = layer === LAYER_BACK ? LAYER_BACK : LAYER_FRONT;
}

// Normalize one object (soft-migration)
export function normalizeLayer(obj) {
  if (!obj) return;
  if (!obj.layer) obj.layer = LAYER_FRONT;
  if (obj.layer !== LAYER_BACK && obj.layer !== LAYER_FRONT) obj.layer = LAYER_FRONT;
}

// -----------------------------------------------------
// Draft migration (safe for old drafts)
// -----------------------------------------------------
export function migrateDraftLayers(draft) {
  if (!draft || !Array.isArray(draft.pages)) return;
  draft.pages.forEach((page) => {
    if (!Array.isArray(page.objects)) return;
    page.objects.forEach(normalizeLayer);
  });
}

// -----------------------------------------------------
// Sorting helpers
// -----------------------------------------------------
export function sortObjectsByLayer(objects = []) {
  return [...objects].sort((a, b) => {
    const la = getObjLayer(a);
    const lb = getObjLayer(b);
    if (la === lb) return 0;
    return la === LAYER_BACK ? -1 : 1;
  });
}

// -----------------------------------------------------
// z-index resolver (overlay)
// -----------------------------------------------------
export function getZIndexForObject(obj, isSelected = false) {
  if (isSelected) return Z_SELECTED;
  return getObjLayer(obj) === LAYER_BACK ? Z_BACK : Z_FRONT;
}

// -----------------------------------------------------
// Selection helpers (multi + single)
// -----------------------------------------------------
function _getActiveSelection() {
  const ms = state.multiSelected;
  if (ms && ms.pageIndex != null && Array.isArray(ms.ids) && ms.ids.length) {
    return { pageIndex: ms.pageIndex, ids: ms.ids.map(String) };
  }
  if (state.selected) {
    return { pageIndex: state.selected.pageIndex, ids: [String(state.selected.objectId)] };
  }
  return null;
}

// -----------------------------------------------------
// Switch helpers
// UI convention: checked = FRONT (Premier), unchecked = BACK (Arrière)
// -----------------------------------------------------
function _layerFromSwitch(input) {
  return input && input.checked ? LAYER_FRONT : LAYER_BACK;
}

function _setSwitchFromLayer(input, layer) {
  if (!input) return;
  input.checked = layer !== LAYER_BACK; // front => checked
}

// -----------------------------------------------------
// Layer presets (used by ui_tools.js when inserting)
// -----------------------------------------------------
function _ensureLayerPresets() {
  if (!state.layerPresets || typeof state.layerPresets !== "object") {
    state.layerPresets = { text: "front", image: "front", dyn: "front" };
  } else {
    if (!state.layerPresets.text) state.layerPresets.text = "front";
    if (!state.layerPresets.image) state.layerPresets.image = "front";
    if (!state.layerPresets.dyn) state.layerPresets.dyn = "front";
  }
  return state.layerPresets;
}

function _inferPresetKeyFromInput(input) {
  const id = String(input?.id || "");
  if (/Text/i.test(id)) return "text";
  if (/Dyn/i.test(id)) return "dyn";
  if (/Image/i.test(id)) return "image";

  // fallback: active tool
  const t = state.activeTool?.type;
  if (t === "text") return "text";
  if (t === "image") return "image";
  if (t === "product_price" || t === "product_stock_badge" || t === "product_ean") return "dyn";

  return "text";
}

// -----------------------------------------------------
// Apply layer to selection
// -----------------------------------------------------
function _applyLayerToSelection(layer) {
  const sel = _getActiveSelection();
  if (!sel) return 0;

  const L = layer === LAYER_BACK ? LAYER_BACK : LAYER_FRONT;
  let changed = 0;

  for (const id of sel.ids) {
    const obj = getObject(sel.pageIndex, id);
    if (!obj) continue;
    if (getObjLayer(obj) === L) continue;
    setObjLayer(obj, L);
    changed++;
  }

  if (changed) {
    renderPageOverlay(sel.pageIndex);
    rerenderAllExcept(sel.pageIndex);
  }

  return changed;
}

// -----------------------------------------------------
// Public: bind switches in UI
// Behavior:
// - if selection exists => apply to selection
// - else => update insertion preset for the corresponding toolbox
// -----------------------------------------------------
export function bindLayerSwitchesUI() {
  _ensureLayerPresets();

  const inputs = Array.from(document.querySelectorAll("input.js-layer-switch"));
  if (!inputs.length) return;

  for (const input of inputs) {
    if (input.dataset.layerBound === "1") continue;
    input.dataset.layerBound = "1";

    input.addEventListener("change", () => {
      const layer = _layerFromSwitch(input);

      const sel = _getActiveSelection();
      if (sel) {
        const n = _applyLayerToSelection(layer);
        if (n) setStatus(layer === LAYER_FRONT ? "Premier plan" : "Arrière-plan");
        syncLayerSwitchesFromSelection();
        return;
      }

      // ✅ no selection => preset for next insert
      const key = _inferPresetKeyFromInput(input);
      state.layerPresets[key] = layer;

      setStatus(layer === LAYER_FRONT ? "Insertion: Premier plan" : "Insertion: Arrière-plan");
    });
  }

  syncLayerSwitchesFromSelection();
}

// -----------------------------------------------------
// Public: sync all switches with current selection (and presets)
// -----------------------------------------------------
export function syncLayerSwitchesFromSelection() {
  _ensureLayerPresets();

  const inputs = Array.from(document.querySelectorAll("input.js-layer-switch"));
  if (!inputs.length) return;

  // If something selected => reflect object layer
  if (state.selected) {
    const obj = getObject(state.selected.pageIndex, state.selected.objectId);
    if (!obj) return;

    const layer = getObjLayer(obj);
    for (const input of inputs) _setSwitchFromLayer(input, layer);

    // keep presets aligned with selection type
    if (obj.type === "image") state.layerPresets.image = layer;
    if (obj.type === "text") {
      const k = String(obj.dynamic?.kind || "");
      if (k) state.layerPresets.dyn = layer;
      else state.layerPresets.text = layer;
    }
    return;
  }

  // If nothing selected => reflect presets (per switch)
  for (const input of inputs) {
    const key = _inferPresetKeyFromInput(input);
    const layer = state.layerPresets?.[key] || "front";
    _setSwitchFromLayer(input, layer);
  }
}

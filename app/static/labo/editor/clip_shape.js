// app/static/labo/editor/clip_shape.js
import { state, setStatus, uid, clamp } from "./state.js?v=12";
import { getOrCreatePageModel, getObject, upsertObject } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";

// ------------------------------------------------------------
// Defaults
// ------------------------------------------------------------
export function makeDefaultClipShape(pageIndex, x, y) {
  const w = 180;
  const h = 120;

  return {
    id: uid("clip"),
    type: "clip_shape",
    pageIndex,
    x,
    y,
    w,
    h,
    x_rel: null,
    y_rel: null,
    w_rel: null,
    h_rel: null,
    layer: "front",

    radius: 0,
    strokeWidth: 1,
    strokeColor: "#111827",
    fillColor: "#ffffff",

    // compat
    src: "",
    src_candidates: [],

    image: {
      scale: 1.0,
      offsetX: 0,
      offsetY: 0,
      fit: "cover",
      src: "",
      src_candidates: [],
    },
  };
}

// ------------------------------------------------------------
// Tool activation
// ------------------------------------------------------------
export function setToolClipShape() {
  state.activeTool = { type: "shape", kind: "clip_shape" };
  setStatus("Outil: Forme masquée (image) — clique dans le PDF pour placer");
}

// ------------------------------------------------------------
// Insert on click
// ------------------------------------------------------------
export function insertClipShapeAt(pageIndex, x, y) {
  const page = getOrCreatePageModel(pageIndex);
  const obj = makeDefaultClipShape(pageIndex, x, y);
  page.objects.push(obj);
  state.selected = { pageIndex, objectId: String(obj.id) };
  state.multiSelected = null;
  renderPageOverlay(pageIndex);
  setStatus("Bloc forme masquée ajouté");
  return obj;
}

// ------------------------------------------------------------
// UI panel (left)
// ------------------------------------------------------------
function _qs(sel) {
  return document.querySelector(sel);
}

function _setPanelVisible(visible) {
  const panel = _qs("#clipShapePanel");
  if (!panel) return;
  panel.style.display = visible ? "block" : "none";
}

function _getSelectedClipShape() {
  const sel = state.selected;
  if (!sel || sel.pageIndex == null || !sel.objectId) return null;
  const obj = getObject(sel.pageIndex, sel.objectId);
  if (!obj || obj.type !== "clip_shape") return null;
  return obj;
}

function _ensureImageFields(obj) {
  if (!obj.image) obj.image = { scale: 1.0, offsetX: 0, offsetY: 0, fit: "cover" };
  if (typeof obj.image.scale !== "number") obj.image.scale = 1.0;
  if (typeof obj.image.offsetX !== "number") obj.image.offsetX = 0;
  if (typeof obj.image.offsetY !== "number") obj.image.offsetY = 0;
  if (!obj.image.fit) obj.image.fit = "cover";

  if (!Array.isArray(obj.src_candidates)) obj.src_candidates = [];
  if (!Array.isArray(obj.image.src_candidates)) obj.image.src_candidates = [];

  if (typeof obj.image.src !== "string") obj.image.src = obj.src || "";
}

export function refreshClipShapePanel() {
  const obj = _getSelectedClipShape();
  _setPanelVisible(!!obj);
  if (!obj) return;

  _ensureImageFields(obj);

  const btnPick = _qs("#btnClipPickImage");
  const btnCenter = _qs("#btnClipCenterImage");
  const zoom = _qs("#clipZoom");
  const zoomVal = _qs("#clipZoomVal");
  const radius = _qs("#clipRadius");
  const strokeW = _qs("#clipStrokeWidth");
  const strokeC = _qs("#clipStrokeColor");
  const fillC = _qs("#clipFillColor");
  const layer = _qs("#clipLayer");

  if (zoom) {
    zoom.value = String(clamp(obj.image.scale, 0.5, 3.0));
    if (zoomVal) zoomVal.textContent = `${Number(zoom.value).toFixed(2)}×`;
  }
  if (radius) radius.value = String(obj.radius || 0);
  if (strokeW) strokeW.value = String(obj.strokeWidth ?? 1);
  if (strokeC) strokeC.value = String(obj.strokeColor || "#111827");
  if (fillC) fillC.value = String(obj.fillColor || "#ffffff");
  if (layer) layer.value = obj.layer || "front";

  if (btnPick && !btnPick.dataset.bound) {
    btnPick.dataset.bound = "1";
    btnPick.addEventListener("click", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      openClipShapeFilePicker(o);
    });
  }

  if (btnCenter && !btnCenter.dataset.bound) {
    btnCenter.dataset.bound = "1";
    btnCenter.addEventListener("click", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      _ensureImageFields(o);
      o.image.offsetX = 0;
      o.image.offsetY = 0;
      upsertObject(o.pageIndex, o);
      renderPageOverlay(o.pageIndex);
      setStatus("Image recentrée");
      refreshClipShapePanel();
    });
  }

  if (zoom && !zoom.dataset.bound) {
    zoom.dataset.bound = "1";
    zoom.addEventListener("input", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      _ensureImageFields(o);
      const v = clamp(parseFloat(zoom.value || "1"), 0.5, 3.0);
      o.image.scale = v;
      upsertObject(o.pageIndex, o);
      rerenderAllExcept(o.pageIndex, null);
      renderPageOverlay(o.pageIndex);
      if (zoomVal) zoomVal.textContent = `${v.toFixed(2)}×`;
    });
  }

  const bindNumber = (el, key, min, max, integer = false) => {
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      let v = parseFloat(el.value || "0");
      if (Number.isNaN(v)) v = 0;
      v = clamp(v, min, max);
      if (integer) v = Math.round(v);
      o[key] = v;
      upsertObject(o.pageIndex, o);
      renderPageOverlay(o.pageIndex);
    });
  };

  bindNumber(radius, "radius", 0, 200, true);
  bindNumber(strokeW, "strokeWidth", 0, 30, false);

  const bindColor = (el, key) => {
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("input", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      o[key] = el.value || "";
      upsertObject(o.pageIndex, o);
      renderPageOverlay(o.pageIndex);
    });
  };

  bindColor(strokeC, "strokeColor");
  bindColor(fillC, "fillColor");

  if (layer && !layer.dataset.bound) {
    layer.dataset.bound = "1";
    layer.addEventListener("change", () => {
      const o = _getSelectedClipShape();
      if (!o) return;
      o.layer = layer.value === "back" ? "back" : "front";
      upsertObject(o.pageIndex, o);
      renderPageOverlay(o.pageIndex);
    });
  }
}

// ------------------------------------------------------------
// Event helpers (robustes)
// ------------------------------------------------------------
function _getOverlayFromTarget(target) {
  return target?.closest?.(".pdf-overlay") || null;
}

function _getPageIndexFromTarget(target) {
  const ov = _getOverlayFromTarget(target);
  if (!ov) return null;
  const pi = Number(ov.dataset.pageIndex);
  return Number.isFinite(pi) ? pi : null;
}

function _getObjectIdFromTarget(target) {
  const el = target?.closest?.("[data-object-id],[data-obj-id],[data-objectid],[data-id]");
  if (!el) return null;
  return el.dataset.objectId || el.dataset.objId || el.dataset.objectid || el.dataset.id || null;
}

/**
 * Essaie d'ouvrir le picker depuis la cible (dblclick),
 * sinon fallback sur la sélection courante.
 */
function _tryOpenFromEventTarget(evTarget) {
  const pageIndex = _getPageIndexFromTarget(evTarget);
  const objectId = _getObjectIdFromTarget(evTarget);

  if (pageIndex != null && objectId) {
    const obj = getObject(pageIndex, objectId);
    if (obj && obj.type === "clip_shape") {
      state.selected = { pageIndex, objectId: String(objectId) };
      state.multiSelected = null;
      refreshClipShapePanel();
      openClipShapeFilePicker(obj);
      return true;
    }
  }

  // fallback: si aucun data-object-id => on ouvre sur l’objet sélectionné
  const selObj = _getSelectedClipShape();
  if (selObj) {
    refreshClipShapePanel();
    openClipShapeFilePicker(selObj);
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// ✅ UI init (export attendu par editor_bootstrap.js)
// ------------------------------------------------------------
let __uiInstalled = false;

/**
 * IMPORTANT :
 * - dblclick en CAPTURE pour bypass stopPropagation() des autres modules.
 * - pointerdown en CAPTURE pour "sélectionner" proprement un clip_shape
 *   avant que d'autres handlers ne fassent leur logique.
 */
export function initClipShapeUI() {
  if (__uiInstalled) return;
  __uiInstalled = true;

  // 1) dblclick en capture
  document.addEventListener(
    "dblclick",
    (ev) => {
      const ov = _getOverlayFromTarget(ev.target);
      if (!ov) return;

      const opened = _tryOpenFromEventTarget(ev.target);
      if (opened) {
        try {
          ev.preventDefault();
        } catch {}
      }
    },
    true
  );

  // 2) pointerdown => refresh panel quand on clique un clip_shape (capture)
  document.addEventListener(
    "pointerdown",
    (ev) => {
      const ov = _getOverlayFromTarget(ev.target);
      if (!ov) return;

      const pageIndex = _getPageIndexFromTarget(ev.target);
      const objectId = _getObjectIdFromTarget(ev.target);
      if (pageIndex == null || !objectId) return;

      const obj = getObject(pageIndex, objectId);
      if (!obj || obj.type !== "clip_shape") return;

      state.selected = { pageIndex, objectId: String(objectId) };
      state.multiSelected = null;
      refreshClipShapePanel();
    },
    true
  );
}

// ------------------------------------------------------------
// File picker + image assign (ROBUSTE pageIndex/id)
// ------------------------------------------------------------
function _resolvePageIndexForWrite(obj) {
  // 1) obj.pageIndex si dispo
  const pi1 = Number(obj?.pageIndex);
  if (Number.isFinite(pi1) && pi1 >= 0) return pi1;

  // 2) sélection (le plus fiable)
  const pi2 = Number(state?.selected?.pageIndex);
  if (Number.isFinite(pi2) && pi2 >= 0) return pi2;

  return 0;
}

function _resolveObjectIdForWrite(obj) {
  const id1 = obj?.id ? String(obj.id) : "";
  if (id1) return id1;

  const id2 = state?.selected?.objectId ? String(state.selected.objectId) : "";
  if (id2) return id2;

  return "";
}

export function openClipShapeFilePicker(obj) {
  const input = document.querySelector("#clipShapeFileInput");
  if (!input) {
    setStatus("Input file manquant (#clipShapeFileInput)");
    return;
  }

  input.value = "";

  input.onchange = async () => {
    try {
      const file = input.files && input.files[0];
      if (!file) return;

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = reject;
        r.readAsDataURL(file);
      });

      const pageIndex = _resolvePageIndexForWrite(obj);
      const objectId = _resolveObjectIdForWrite(obj);

      if (!objectId) {
        setStatus("Objet clip introuvable (id manquant)");
        return;
      }

      const o = getObject(pageIndex, objectId);
      if (!o) {
        console.warn("[clip_shape] getObject failed", { pageIndex, objectId, obj, selected: state?.selected });
        setStatus("Objet clip introuvable sur cette page");
        return;
      }

      _ensureImageFields(o);

      // remplit toutes les variantes possibles
      o.src = dataUrl;
      o.src_candidates = [];

      o.image.src = dataUrl;
      o.image.src_candidates = [];

      o.image.offsetX = 0;
      o.image.offsetY = 0;
      o.image.scale = 1.0;

      upsertObject(pageIndex, o);
      renderPageOverlay(pageIndex);

      setStatus("Image appliquée à la forme masquée ✅");
      refreshClipShapePanel();

      console.log("[clip_shape] image saved", {
        pageIndex,
        id: objectId,
        src_top: (o.src || "").slice(0, 30),
        src_image: (o.image?.src || "").slice(0, 30),
      });
    } catch (e) {
      console.warn(e);
      setStatus("Import image impossible");
    }
  };

  input.click();
}

// ------------------------------------------------------------
// Helper: tell interactions that we’re editing inside image
// ------------------------------------------------------------
export function setClipImageEditMode(on) {
  state.clipImageEditMode = !!on;
  const root = document.querySelector(".mdoc-editor");
  if (root) root.classList.toggle("clip-image-editing", !!on);
}

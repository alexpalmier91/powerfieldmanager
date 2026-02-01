// app/static/labo/editor/interactions.js
import { state, clamp, setStatus } from "./state.js?v=12";
import { getGridSettings, snapRect } from "./grid_tools.js";
import { getObject, removeObject } from "./draft.js?v=12";

import { renderPageOverlay, rerenderAllExcept, sanitizeRichHtml } from "./overlay_render.js?v=12";

console.log("[INTERACTIONS] loaded ✅ v=12");

// -----------------------------------------------------
// ✅ TOOL SECTION (collapsible) helpers (DOM-side)
// -----------------------------------------------------
function _setToolSectionCollapsed(collapsed) {
  const toolSection = document.getElementById("toolSection");
  const toolBody = document.getElementById("toolSectionBody");
  const toolToggle = document.getElementById("toolSectionToggle");
  const icon = toolToggle?.querySelector(".mdoc-collapsible-icon");

  if (!toolSection || !toolBody) return;

  toolSection.setAttribute("data-collapsed", collapsed ? "1" : "0");
  toolBody.style.display = collapsed ? "none" : "block";

  if (toolToggle) toolToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

// kind resolver (gère plusieurs schémas)
function _getDynamicKind(obj) {
  return obj?.kind || obj?.dynamic?.kind || obj?.meta?.kind || obj?.data?.kind || null;
}

// -----------------------------------------------------
// ✅ CLIP SHAPE EDIT MODE (move/scale image inside)
// -----------------------------------------------------
function _getClipEdit() {
  const m = state.clipImageEditMode || state.clipImageEdit || null;
  if (!m) return null;
  if (m === true) return { enabled: true, pageIndex: state.selected?.pageIndex ?? null, objectId: state.selected?.objectId ?? null };
  if (typeof m === "object") return { enabled: m.enabled !== false, pageIndex: m.pageIndex ?? null, objectId: m.objectId ?? null };
  return null;
}

function _setClipEdit(pageIndex, objectId, enabled) {
  if (!enabled) {
    state.clipImageEditMode = null;
    state.clipImageEdit = null;
    return;
  }
  const payload = { enabled: true, pageIndex, objectId: String(objectId) };
  state.clipImageEditMode = payload;
  state.clipImageEdit = payload;
}

function _isClipEditFor(pageIndex, objectId) {
  const m = _getClipEdit();
  if (!m || !m.enabled) return false;
  if (m.pageIndex == null || m.objectId == null) return false;
  return Number(m.pageIndex) === Number(pageIndex) && String(m.objectId) === String(objectId);
}

function _clearClipEdit() {
  _setClipEdit(null, null, false);
}

function _ensureClipImageObj(obj) {
  if (!obj) return;
  if (!obj.image || typeof obj.image !== "object") obj.image = {};
  if (obj.image.scale == null) obj.image.scale = 1.0;
  if (obj.image.offsetX == null) obj.image.offsetX = 0;
  if (obj.image.offsetY == null) obj.image.offsetY = 0;
  if (!obj.image.fit) obj.image.fit = "cover";
    return obj.image;
}

// -----------------------------------------------------
// gestion layer arriere plan - avant plan
// -----------------------------------------------------
export function applyLayerToSelection(layer) {
  if (layer !== "back" && layer !== "front") return;

  const ms = _ensureMulti();

  let pageIndex = null;
  let ids = [];

  if (ms.pageIndex != null && ms.ids.length) {
    pageIndex = ms.pageIndex;
    ids = ms.ids.map(String);
  } else if (state.selected) {
    pageIndex = state.selected.pageIndex;
    ids = [String(state.selected.objectId)];
  }

  if (pageIndex == null || !ids.length) return;

  for (const id of ids) {
    const obj = getObject(pageIndex, id);
    if (!obj) continue;
    obj.layer = layer;
  }

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);

  setStatus(layer === "back" ? `Placée en arrière-plan (${ids.length})` : `Placée au premier plan (${ids.length})`);
}

// -----------------------------------------------------
// ✅ MULTI SELECTION HELPERS (same page)
// -----------------------------------------------------
function _ensureMulti() {
  if (!state.multiSelected) {
    state.multiSelected = { pageIndex: null, ids: [], anchorId: null };
  }
  if (!Array.isArray(state.multiSelected.ids)) state.multiSelected.ids = [];
  return state.multiSelected;
}

function clearMultiSelection() {
  const ms = _ensureMulti();
  ms.pageIndex = null;
  ms.ids = [];
  ms.anchorId = null;
}

/** ✅ centralise "clear selection" (single + multi) */
function clearAllSelectionAndSync(pageIndexForRender = -1) {
  state.selected = null;
  clearMultiSelection();
  _clearClipEdit(); // ✅ important
  _syncUiAfterSelectionChange(pageIndexForRender);
}

function hasMultiSelection() {
  const ms = _ensureMulti();
  return ms.pageIndex != null && ms.ids.length > 0;
}

function isIdInMulti(pageIndex, objectId) {
  const ms = _ensureMulti();
  if (ms.pageIndex !== pageIndex) return false;
  return ms.ids.some((id) => String(id) === String(objectId));
}

// ✅ exportable: ids uniquement (conservé)
function getActiveSelection(pageIndex) {
  const ms = _ensureMulti();
  if (ms.pageIndex === pageIndex && ms.ids.length) return [...ms.ids];

  if (state.selected && state.selected.pageIndex === pageIndex && state.selected.objectId) {
    return [String(state.selected.objectId)];
  }
  return [];
}

// ✅ NOUVEAU: sélection complète (pageIndex + ids + anchorId)
export function getActiveSelectionInfo(pageIndex) {
  const ms = _ensureMulti();
  if (ms.pageIndex === pageIndex && ms.ids.length) {
    return {
      pageIndex,
      ids: ms.ids.map(String),
      anchorId: String(ms.anchorId || ms.ids[0]),
      mode: "multi",
    };
  }
  if (state.selected && state.selected.pageIndex === pageIndex && state.selected.objectId) {
    return {
      pageIndex,
      ids: [String(state.selected.objectId)],
      anchorId: String(state.selected.objectId),
      mode: "single",
    };
  }
  return { pageIndex, ids: [], anchorId: null, mode: "none" };
}

// ✅ on expose aussi sur state (pratique pour ui_tools.js)
state.getActiveSelectionInfo = getActiveSelectionInfo;

// -----------------------------------------------------
// ✅ UI Sync helper (single + multi)
// -----------------------------------------------------
function _syncUiAfterSelectionChange(pageIndexForRender) {
  const ms = _ensureMulti();
  const hasSel = !!state.selected;
  const canDelete = hasSel || (ms.pageIndex != null && ms.ids.length > 0);
  if (state.btnDeleteSelected) state.btnDeleteSelected.disabled = !canDelete;

  if (!state.currentDraft) return;

  // panneaux (texte / image / dynamique)
  syncPanelsWithSelection(state.selected);

  // ✅ Outils : ouverts par défaut, repliés dès qu'on sélectionne/édite (single ou multi)
  try {
    const hasAnySelection = !!state.selected || (ms.pageIndex != null && Array.isArray(ms.ids) && ms.ids.length > 0);
    const shouldCollapseTools = hasAnySelection || !!state.isEditingText;

    if (shouldCollapseTools) {
      if (typeof state._collapseToolSection === "function") state._collapseToolSection();
      else _setToolSectionCollapsed(true);
    } else {
      if (typeof state._expandToolSection === "function") state._expandToolSection();
      else _setToolSectionCollapsed(false);
    }
  } catch {}

  // ✅ mémorise les presets depuis l’objet sélectionné (géré par ui_tools.js)
  try {
    if (typeof state._rememberPresetFromSelected === "function") {
      state._rememberPresetFromSelected();
    }
  } catch {}

  // sync outils existants
  if (state.selected && typeof state._syncTextUiFromSelected === "function") {
    try {
      state._syncTextUiFromSelected();
    } catch {}
  }
  if (state.selected && typeof state._syncDynamicUiFromSelected === "function") {
    try {
      state._syncDynamicUiFromSelected();
    } catch {}
  }

  // ✅ sync panneau Style (si présent)
  if (typeof state._syncStyleUiFromSelected === "function") {
    try {
      state._syncStyleUiFromSelected();
    } catch {}
  }

  if (state.isEditingText) return;

  // rendu
  if (pageIndexForRender != null && pageIndexForRender >= 0) {
    renderPageOverlay(pageIndexForRender);
    rerenderAllExcept(pageIndexForRender);
  } else {
    rerenderAllExcept(-1);
  }
}

function _isResizeHandle(target) {
  return !!(target && target.closest && target.closest(".anno-handle"));
}

function _isDragHandle(target) {
  if (!target) return false;
  // ✅ si on clique sur un span dans la poignée, closest remonte au handle
  return !!target.closest(".zh-drag-handle,[data-drag-handle='1']");
}


function _isTextObjectEl(target) {
  return !!(target && target.closest && target.closest(".anno-object.anno-text"));
}

function _enterTextEditFromElement(objectEl) {
  try {
    const overlayEl = objectEl.closest(".pdf-overlay");
    const pageIndex = Number(overlayEl?.dataset?.pageIndex ?? "0");
    const objectId = String(objectEl.dataset.objectId || "");
    if (!objectId) return;

    beginEditText(objectEl, pageIndex, objectId);
  } catch (e) {
    console.warn("[TEXT_EDIT] enter failed:", e);
  }
}

function _commitEditingTextIfAny() {
  try {
    const sel = state.selected;
    if (!sel) return;

    const overlay = state.overlaysByPage.get(sel.pageIndex);
    if (!overlay) return;

    const objectEl = overlay.querySelector(`.anno-object[data-object-id="${sel.objectId}"]`);
    if (!objectEl) return;

    const content = objectEl.querySelector(".zh-text-content") || objectEl;
    if (content?.dataset?.editing === "1") {
      content.blur(); // déclenche ton commit() via blur handler
    }
  } catch {}
}


function _exitTextEditIfAny() {
  if (!state.isEditingText) return;

  _commitEditingTextIfAny(); // ✅ commit via blur

  state.isEditingText = false;

  const sel = state.selected;
  if (sel && Number.isFinite(sel.pageIndex)) {
    try { renderPageOverlay(sel.pageIndex); } catch {}
  }
}




// -----------------------------------------------------
// Multi toggle (SHIFT)
// -----------------------------------------------------
function toggleMultiSelect(pageIndex, objectId) {
  const ms = _ensureMulti();
  const oid = String(objectId);

  if (ms.pageIndex == null || ms.pageIndex !== pageIndex) {
    ms.pageIndex = pageIndex;
    ms.ids = [oid];
    ms.anchorId = oid;

    // ✅ keep state.selected coherent with anchor
    state.selected = { pageIndex, objectId: oid };
    return;
  }

  const exists = ms.ids.some((id) => String(id) === oid);
  if (exists) {
    ms.ids = ms.ids.filter((id) => String(id) !== oid);
    if (String(ms.anchorId) === oid) ms.anchorId = ms.ids[0] || null;
  } else {
    ms.ids.push(oid);
    if (!ms.anchorId) ms.anchorId = oid;
  }

  const keep = ms.anchorId || ms.ids[0] || null;
  state.selected = keep ? { pageIndex, objectId: String(keep) } : null;
}

// -----------------------------------------------------
// ✅ RELATIVE COORDS UPDATE (keep x_rel/y_rel in sync)
// -----------------------------------------------------
function _num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function _clamp01(v) {
  const n = _num(v, 0);
  return Math.max(0, Math.min(1, n));
}

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

function updateRelFromAbs(obj, overlay) {
  if (!obj || !overlay) return;
  const { ow, oh } = _getOverlaySize(overlay);
  if (ow <= 0 || oh <= 0) return;

  obj.x_rel = _clamp01((_num(obj.x, 0) || 0) / ow);
  obj.y_rel = _clamp01((_num(obj.y, 0) || 0) / oh);
  obj.w_rel = _clamp01((_num(obj.w, 0) || 0) / ow);
  obj.h_rel = _clamp01((_num(obj.h, 0) || 0) / oh);

  obj.page_box = { w: ow, h: oh };
  obj.page_box_w = ow;
  obj.page_box_h = oh;
}

function _resolveObjBoxAbs(overlay, obj) {
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

function _getOverlayMetrics(overlay) {
  const rect = overlay.getBoundingClientRect();
  const { ow, oh } = _getOverlaySize(overlay);
  const rw = Number(rect.width) || 0;
  const rh = Number(rect.height) || 0;
  const sx = ow > 0 && rw > 0 ? ow / rw : 1;
  const sy = oh > 0 && rh > 0 ? oh / rh : 1;
  return { rect, ow, oh, sx, sy };
}

// -----------------------------------------------------
// ✅ CLIP_SHAPE image edit helpers
// -----------------------------------------------------

function _setClipImageEditMode(pageIndex, objectId, enabled = true) {
  state.clipImageEditMode = { pageIndex, objectId: String(objectId), enabled: !!enabled };
}



function _isClipShape(obj) {
  return !!obj && String(obj.type) === "clip_shape";
}



function _clampScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.25, Math.min(6.0, n));
}



// =====================================================
// ✅ ALIGN TOOLS EXPORT (FIX IMPORT ERROR)
// =====================================================
export function alignSelectedVertical() {
  if (typeof state._alignSelectionVertical === "function") {
    state._alignSelectionVertical();
    return;
  }

  const ms = _ensureMulti();

  let pageIndex = null;
  let ids = [];
  let anchorId = null;

  if (ms.pageIndex != null && ms.ids.length) {
    pageIndex = ms.pageIndex;
    ids = ms.ids.map(String);
    anchorId = String(ms.anchorId || ms.ids[0]);
  } else if (state.selected) {
    pageIndex = state.selected.pageIndex;
    ids = [String(state.selected.objectId)];
    anchorId = String(state.selected.objectId);
  }

  if (pageIndex == null || !ids.length) return;

  const overlay = state.overlaysByPage.get(pageIndex);
  if (!overlay) return;

  const { ow } = _getOverlaySize(overlay);
  if (ow <= 0) return;

  const anchor = getObject(pageIndex, anchorId);
  if (!anchor) return;

  if (!Number.isFinite(Number(anchor.x)) || !Number.isFinite(Number(anchor.w))) {
    const bb = _resolveObjBoxAbs(overlay, anchor);
    anchor.x = bb.x;
    anchor.w = bb.w;
  }

  const refX = Number(anchor.x) || 0;

  for (const id of ids) {
    const obj = getObject(pageIndex, id);
    if (!obj) continue;

    if (!Number.isFinite(Number(obj.x)) || !Number.isFinite(Number(obj.w))) {
      const bb = _resolveObjBoxAbs(overlay, obj);
      obj.x = bb.x;
      obj.w = bb.w;
    }

    const maxX = Math.max(0, ow - (Number(obj.w) || 0));
    obj.x = Math.round(clamp(refX, 0, maxX));

    if (obj.x_rel != null && obj.w_rel != null) {
      updateRelFromAbs(obj, overlay);
    }
  }

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);
  setStatus(`Alignement vertical (${ids.length})`);
}

// ----------------------------
// Sidebar helpers
// ----------------------------
function showTextPanel() {
  if (state.textToolBox) state.textToolBox.style.display = "block";
  if (state.imageToolBox) state.imageToolBox.style.display = "none";
  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = "none";
  if (state.productPriceToolBox) state.productPriceToolBox.style.display = "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = "none";
  if (state.shapeToolBox) state.shapeToolBox.style.display = "none";
}

function showImagePanel() {
  if (state.textToolBox) state.textToolBox.style.display = "none";
  if (state.imageToolBox) state.imageToolBox.style.display = "block";
  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = "none";
  if (state.productPriceToolBox) state.productPriceToolBox.style.display = "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = "none";
  if (state.shapeToolBox) state.shapeToolBox.style.display = "none";
}

function showShapePanel() {
  if (state.textToolBox) state.textToolBox.style.display = "none";
  if (state.imageToolBox) state.imageToolBox.style.display = "none";
  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = "none";
  if (state.productPriceToolBox) state.productPriceToolBox.style.display = "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = "none";
  if (state.shapeToolBox) state.shapeToolBox.style.display = "block";
}

function showDynamicPanel(kind) {
  if (state.textToolBox) state.textToolBox.style.display = "none";
  if (state.imageToolBox) state.imageToolBox.style.display = "none";

  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = "block";

  if (state.productPriceToolBox) state.productPriceToolBox.style.display = kind === "product_price" ? "block" : "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = kind === "product_stock_badge" ? "block" : "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = kind === "product_ean" ? "block" : "none";

  if (state.shapeToolBox) state.shapeToolBox.style.display = "none";
}

function hidePanels() {
  if (state.textToolBox) state.textToolBox.style.display = "none";
  if (state.imageToolBox) state.imageToolBox.style.display = "none";
  if (state.dynamicCommonBox) state.dynamicCommonBox.style.display = "none";
  if (state.productPriceToolBox) state.productPriceToolBox.style.display = "none";
  if (state.stockBadgeToolBox) state.stockBadgeToolBox.style.display = "none";
  if (state.productEanToolBox) state.productEanToolBox.style.display = "none";
  if (state.shapeToolBox) state.shapeToolBox.style.display = "none";
}

function syncPanelsWithSelection(sel) {
  if (!sel) {
    hidePanels();
    return;
  }

  const obj = getObject(sel.pageIndex, sel.objectId);
  if (!obj) {
    hidePanels();
    return;
  }

  // ✅ CLIP SHAPE => panneau shape (mêmes contrôles)
  if (obj.type === "clip_shape") {
    showShapePanel();
    return;
  }

  // ✅ SHAPE
  if (obj.type === "shape") {
    showShapePanel();
    return;
  }

  // ✅ IMAGE
  if (obj.type === "image") {
    showImagePanel();
    return;
  }

  // ✅ DYNAMIC (nouveau schéma courant)
  if (obj.type === "dynamic") {
    const k = _getDynamicKind(obj);
    if (k === "product_price") return showDynamicPanel("product_price");
    if (k === "product_stock_badge") return showDynamicPanel("product_stock_badge");
    if (k === "product_ean") return showDynamicPanel("product_ean");

    showDynamicPanel(k || "");
    return;
  }

  // ✅ TEXT (avec éventuellement obj.dynamic.kind)
  if (obj.type === "text") {
    const k = _getDynamicKind(obj);
    if (k === "product_price") return showDynamicPanel("product_price");
    if (k === "product_stock_badge") return showDynamicPanel("product_stock_badge");
    if (k === "product_ean") return showDynamicPanel("product_ean");
    showTextPanel();
    return;
  }

  // ✅ anciens types
  if (obj.type === "product_price") return showDynamicPanel("product_price");
  if (obj.type === "product_stock_badge") return showDynamicPanel("product_stock_badge");
  if (obj.type === "product_ean") return showDynamicPanel("product_ean");

  hidePanels();
}

// ----------------------------
// Selection
// ----------------------------
export function setSelected(sel) {
  state.selected = sel || null;

  // ✅ si on sélectionne autre chose qu’un clip_shape => on sort du mode édition image
  if (!sel) {
    _clearClipEdit();
  } else {
    const o = getObject(sel.pageIndex, sel.objectId);
    if (!o || o.type !== "clip_shape") _clearClipEdit();
  }

  // Multi selection state (reset to single when setSelected is called)
  if (!state.multiSelected) {
    state.multiSelected = { pageIndex: null, ids: [], anchorId: null };
  }
  if (!Array.isArray(state.multiSelected.ids)) state.multiSelected.ids = [];

  if (!sel) {
    state.multiSelected.pageIndex = null;
    state.multiSelected.ids = [];
    state.multiSelected.anchorId = null;
  } else {
    state.multiSelected.pageIndex = sel.pageIndex;
    state.multiSelected.ids = [String(sel.objectId)];
    state.multiSelected.anchorId = String(sel.objectId);
  }

  if (!state.currentDraft) return;

  _syncUiAfterSelectionChange(sel ? sel.pageIndex : -1);
}

// ----------------------------
// Inline text edit helpers
// ----------------------------
function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function _pickRichHtml(obj) {
  return (
    obj?.html ??
    obj?.text_html ??
    obj?.textHtml ??
    obj?.rich_html ??
    obj?.richHtml ??
    obj?.style?.html ??
    obj?.style?.text_html ??
    obj?.style?.textHtml ??
    ""
  );
}



function _isRichTextObject(obj) {
  const t = String(obj?.type || "").toLowerCase();
  const hasRich = !!String(_pickRichHtml(obj) || "").trim();
  return (
    hasRich ||
    t === "paragraph" ||
    t === "richtext" ||
    t === "rich_text" ||
    t === "rich-text"
  );
}



function beginEditText(objectEl, pageIndex, objectId) {
  const obj = getObject(pageIndex, objectId);
  if (!obj) return;

  const t = String(obj?.type || "").toLowerCase();
  const hasRich = !!String(_pickRichHtml(obj) || "").trim();

  const isTextLike =
    t === "text" || t === "paragraph" || t === "richtext" || t === "rich_text" || t === "rich-text";

  if (!isTextLike) return;

  const content = objectEl.querySelector(".zh-text-content") || objectEl;

  // ✅ sélection + état
  setSelected({ pageIndex, objectId });

  state.isEditingText = true;

  try {
    if (typeof state._collapseToolSection === "function") state._collapseToolSection();
  } catch {}

  state.editing = { pageIndex, objectId };
  state.action = null;
  state.lastMove = null;
  state.dragHasMoved = false;

  // ✅ rich si champ html existant OU type rich/paragraph
  const isRich =
    hasRich || t === "paragraph" || t === "richtext" || t === "rich_text" || t === "rich-text";

  // ---------------------------------------------------
  // ✅ LOAD initial content
  // ---------------------------------------------------
  if (isRich) {
    const safe = sanitizeRichHtml(_pickRichHtml(obj));
    content.innerHTML = safe || (obj.text || "");
  } else {
    content.textContent = obj.text || "";
  }

  // mode édition
  content.contentEditable = "true";
  content.spellcheck = false;
  content.dataset.editing = "1";
  content.style.userSelect = "text";
  content.style.cursor = "text";
  content.style.pointerEvents = "auto";
  

  // ✅ anti double-commit
  let done = false;

  const cleanup = () => {
    try {
      content.removeEventListener("keydown", onKeyDown);
    } catch {}
    try {
      content.removeEventListener("blur", onBlur);
    } catch {}
  };

  const finish = () => {
    content.contentEditable = "false";
    delete content.dataset.editing;

    state.isEditingText = false;
    state.editing = null;

    renderPageOverlay(pageIndex);

    try {
      if (typeof state._syncTextUiFromSelected === "function") state._syncTextUiFromSelected();
    } catch {}
    try {
      if (typeof state._syncStyleUiFromSelected === "function") state._syncStyleUiFromSelected();
    } catch {}
  };

  const commit = () => {
    if (done) return;
    if (content.dataset.editing !== "1") return;
    done = true;
    cleanup();

    if (isRich) {
      const rawHtml = (content.innerHTML || "").toString();
      const safeHtml = sanitizeRichHtml(rawHtml);

      // ✅ standardise : on stocke dans obj.html
      obj.html = safeHtml;
      obj.text = (content.textContent || "").toString();
    } else {
      obj.text = (content.textContent || "").toString();
    }

    finish();
    setStatus("Texte modifié");
  };

  const cancel = () => {
    if (done) return;
    if (content.dataset.editing !== "1") return;
    done = true;
    cleanup();

    // restore
    if (isRich) {
      const safe = sanitizeRichHtml(obj.html || _pickRichHtml(obj));
      content.innerHTML = safe || (obj.text || "");
    } else {
      content.textContent = obj.text || "";
    }

    finish();
    setStatus("Édition annulée");
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    // Enter: laisser le navigateur gérer (BR/DIV/P selon le contexte)
  };

  const onBlur = () => {
    // blur => commit (sauf si déjà cancel/commit)
    commit();
  };

  content.addEventListener("keydown", onKeyDown);
  content.addEventListener("blur", onBlur, { once: true });

  content.focus({ preventScroll: true });
  placeCaretAtEnd(content);
}



// ----------------------------
// Drag / Resize
// ----------------------------

function _hasRelBox(o) {
  return o && o.x_rel != null && o.y_rel != null && o.w_rel != null && o.h_rel != null;
}

function _writeBoxAbsAndRel(o, box, ow, oh) {
  // abs
  o.x = Math.max(0, Math.round(Number(box.x) || 0));
  o.y = Math.max(0, Math.round(Number(box.y) || 0));
  o.w = Math.max(2, Math.round(Number(box.w) || 2));
  o.h = Math.max(2, Math.round(Number(box.h) || 2));

  // rel (si l’objet est en mode rel, ou si tu veux standardiser)
  if (_hasRelBox(o) && ow > 0 && oh > 0) {
    o.x_rel = o.x / ow;
    o.y_rel = o.y / oh;
    o.w_rel = o.w / ow;
    o.h_rel = o.h / oh;
  }
}


const DRAGGABLE_TYPES = new Set([
  "text",
  "paragraph",
  "richtext",
  "rich_text",
  "rich-text",

  "image",
  "shape",
  "clip_shape",

  "dynamic",
  "product_price",
  "product_stock_badge",
  "product_ean",
]);


function startAction(e, overlay, objectEl) {
  console.log(
    "[START_ACTION]",
    "target =", e.target,
    "closest drag handle =", e.target.closest(".zh-drag-handle"),
    "closest resize handle =", e.target.closest(".anno-handle")
  );

  if (!overlay || !objectEl) return;

  const pageIndex = Number(overlay.dataset.pageIndex || "0");
  const objectId = objectEl.dataset.objectId;
  if (!objectId) return;

  const obj = getObject(pageIndex, objectId);
  if (!obj) return;

  const typeNorm = String(obj?.type || "").toLowerCase();
  const dynKind = _getDynamicKind(obj); // ex: product_price / product_stock_badge / product_ean

  const isDynamicText =
    typeNorm === "dynamic" ||
    dynKind === "product_price" ||
    dynKind === "product_stock_badge" ||
    dynKind === "product_ean";

  const isTextLike =
    (typeNorm === "text" ||
      typeNorm === "paragraph" ||
      typeNorm === "richtext" ||
      typeNorm === "rich_text" ||
      typeNorm === "rich-text") &&
    !isDynamicText;

  // ✅ détecte directement les zones
  const handleEl = e.target.closest(".anno-handle");
  const onDragHandle = !!e.target.closest(".zh-drag-handle");
  const onResizeHandle = !!handleEl;

  // ---------------------------------------------------
  // ✅ Si l’élément DOM est marqué editing: ne pas relancer un drag/resize dessus
  // ---------------------------------------------------
  if (objectEl.dataset.editing === "1") return;

  // ---------------------------------------------------
  // ✅ Si on est en édition et qu'on clique ailleurs => commit puis continue
  //    - si on clique sur le même objet (hors handle/poignée) => on laisse l’édition
  // ---------------------------------------------------
  if (state.isEditingText) {
    try {
      const sel = state.selected;
      const same =
        sel && Number(sel.pageIndex) === Number(pageIndex) && String(sel.objectId) === String(objectId);

      // si clic sur poignée/handle => on sort d’édition et on autorise drag/resize
      if (onDragHandle || onResizeHandle) {
        _exitTextEditIfAny();
      } else if (same) {
        // clic dans le même objet en édition => on ne démarre pas d'action
        return;
      } else {
        // clic autre objet => commit, puis on continue
        _exitTextEditIfAny();
      }
    } catch {
      state.isEditingText = false;
    }
  }

  // ---------------------------------------------------
  // ✅ clip_shape: SHIFT + drag => move image inside (pas multi-select)
  //    (seulement si pas poignée resize)
  // ---------------------------------------------------
  if (!handleEl && obj.type === "clip_shape" && e.shiftKey) {
    setSelected({ pageIndex, objectId });
    try {
      if (typeof _setClipImageEditMode === "function") _setClipImageEditMode(pageIndex, objectId, true);
      else if (typeof _setClipEdit === "function") _setClipEdit(pageIndex, objectId, true);
      else state.clipImageEditMode = { pageIndex, objectId: String(objectId), enabled: true };
    } catch {}

    try {
      if (typeof _ensureClipImageObj === "function") _ensureClipImageObj(obj);
      else {
        if (!obj.image || typeof obj.image !== "object") obj.image = {};
        if (!Number.isFinite(Number(obj.image.scale))) obj.image.scale = 1;
        if (!Number.isFinite(Number(obj.image.offsetX))) obj.image.offsetX = 0;
        if (!Number.isFinite(Number(obj.image.offsetY))) obj.image.offsetY = 0;
      }
    } catch {}

    const m = _getOverlayMetrics(overlay);

    state.action = {
      type: "clip_image_drag",
      pageIndex,
      objectId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      sx: m.sx,
      sy: m.sy,
      ow: m.ow,
      oh: m.oh,
      baseOffsetX: Number(obj?.image?.offsetX || 0),
      baseOffsetY: Number(obj?.image?.offsetY || 0),
      baseScale: Number(obj?.image?.scale || 1),
    };

    try {
      if (e.pointerId != null && objectEl.setPointerCapture) objectEl.setPointerCapture(e.pointerId);
    } catch {}

    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // ---------------------------------------------------
  // ✅ TEXT-LIKE:
  //    - resize handle => resize normal
  //    - drag handle => drag normal
  //    - clic ailleurs => édition immédiate
  // ---------------------------------------------------
  if (isTextLike && !onResizeHandle && !onDragHandle) {
    e.preventDefault();
    e.stopPropagation();
    _enterTextEditFromElement(objectEl);
    return;
  }

  // ---------------------------------------------------
  // ✅ non-draggable types (SAUF text-like et dyn text)
  // ---------------------------------------------------
  if (!isTextLike && !isDynamicText && !DRAGGABLE_TYPES.has(typeNorm)) {
    if (e.shiftKey) {
      toggleMultiSelect(pageIndex, objectId);
      _syncUiAfterSelectionChange(pageIndex);
    } else {
      setSelected({ pageIndex, objectId });
    }
    return;
  }

  // ---------------------------------------------------
  // ✅ double click legacy => édition (vrai texte seulement)
  // ---------------------------------------------------
  const now = Date.now();
  const last = state._lastPointerDown;

  if (
    last &&
    now - last.t < 350 &&
    last.pageIndex === pageIndex &&
    last.objectId === objectId &&
    isTextLike
  ) {
    state._lastPointerDown = null;
    e.preventDefault();
    e.stopPropagation();
    beginEditText(objectEl, pageIndex, objectId);
    return;
  }

  state._lastPointerDown = { t: now, pageIndex, objectId };

  // ---------------------------------------------------
  // ✅ sélection (shift => multi) (clip_shape shift réservé plus haut)
  // ---------------------------------------------------
  const ms = _ensureMulti();
  const alreadyInMulti =
    ms.pageIndex === pageIndex &&
    Array.isArray(ms.ids) &&
    ms.ids.some((id) => String(id) === String(objectId));

  if (e.shiftKey && obj.type !== "clip_shape") {
    if (!alreadyInMulti) {
      toggleMultiSelect(pageIndex, objectId);
    } else {
      state.selected = { pageIndex, objectId: String(ms.anchorId || objectId) };
    }
    _syncUiAfterSelectionChange(pageIndex);
  } else {
    if (!alreadyInMulti) setSelected({ pageIndex, objectId });
    else _syncUiAfterSelectionChange(pageIndex);
  }

  state.dragHasMoved = false;

  const m = _getOverlayMetrics(overlay);

  const baseBox = _resolveObjBoxAbs(overlay, obj);
  const baseObjSafe = { ...obj, ...baseBox };

  // ---------------------------------------------------
  // ✅ group drag support
  // ---------------------------------------------------
  const msG = _ensureMulti();
  const hasGroup = msG.pageIndex === pageIndex && Array.isArray(msG.ids) && msG.ids.length > 1;

  let dragIds = null;
  let baseById = null;

  if (hasGroup) {
    dragIds = msG.ids.map(String);
    baseById = new Map();
    for (const id of dragIds) {
      const o = getObject(pageIndex, id);
      if (!o) continue;
      const bb = _resolveObjBoxAbs(overlay, o);
      baseById.set(String(id), { ...o, ...bb });
    }
  }

  // ---------------------------------------------------
  // ✅ resize
  // ---------------------------------------------------
  if (handleEl) {
    state.action = {
      type: "resize",
      pageIndex,
      objectId,
      handle: handleEl.dataset.handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      sx: m.sx,
      sy: m.sy,
      ow: m.ow,
      oh: m.oh,
      baseObj: baseObjSafe,
    };
    try {
      if (e.pointerId != null && objectEl.setPointerCapture) objectEl.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
    return;
  }

  // ---------------------------------------------------
  // ✅ drag (single/group)
  // ---------------------------------------------------
  state.action = {
    type: "drag",
    pageIndex,
    objectId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    sx: m.sx,
    sy: m.sy,
    ow: m.ow,
    oh: m.oh,
    baseObj: baseObjSafe,
    dragIds,
    baseById,
    anchorId: String(objectId),
  };

  try {
    if (e.pointerId != null && objectEl.setPointerCapture) objectEl.setPointerCapture(e.pointerId);
  } catch {}
  e.preventDefault();
}




function _shouldSnapNow(grid, actionType, move) {
  if (!grid || !grid.snap) return false;
  if (grid.snapDuringMoveOnly && actionType !== "drag") return false;

  const mode = String(grid.snapMode || "always");
  if (mode === "always") return true;
  if (mode === "shift") return !!move?.shiftKey;
  if (mode === "alt") return !!move?.altKey;
  return true;
}

function applyDragResize() {
  state.rafPending = false;
  if (!state.action || !state.lastMove) return;
  if (state.isEditingText) return;

  const a = state.action;

  const dxCss = state.lastMove.clientX - a.startClientX;
  const dyCss = state.lastMove.clientY - a.startClientY;
  const dx = dxCss * (a.sx || 1);
  const dy = dyCss * (a.sy || 1);

  const overlay = state.overlaysByPage.get(a.pageIndex);
  if (!overlay) return;

  const obj = getObject(a.pageIndex, a.objectId);
  if (!obj) return;

  const typeNorm = String(obj?.type || "").toLowerCase();

  // ✅ log OK (a & obj existent)
  console.log("[APPLY]", a.type, "obj.type=", typeNorm);

  const maxW = Number(a.ow) || _getOverlaySize(overlay).ow || 0;
  const maxH = Number(a.oh) || _getOverlaySize(overlay).oh || 0;
  if (maxW <= 0 || maxH <= 0) return;

  // ✅ CLIP IMAGE DRAG (move image inside)
  if (a.type === "clip_image_drag") {
    if (typeNorm !== "clip_shape") return;
    _ensureClipImageObj(obj);

    obj.image.offsetX = Math.round(Number(a.baseOffsetX || 0) + dx);
    obj.image.offsetY = Math.round(Number(a.baseOffsetY || 0) + dy);

    // ✅ clamp offsets (évite du vide) => utiliser la box RESOLUE (rel coords safe)
    try {
      const clampFn = window.__ZENHUB_CLAMP_CLIP_OFFSETS__;
      if (typeof clampFn === "function") {
        const bb = _resolveObjBoxAbs(overlay, obj);
        clampFn(obj, bb.w, bb.h);
      }
    } catch {}

    renderPageOverlay(a.pageIndex);
    rerenderAllExcept(a.pageIndex);
    return;
  }

  // ✅ autorise drag/resize seulement pour types autorisés
  if (!DRAGGABLE_TYPES.has(typeNorm)) return;

  // harden selected obj
  if (
    !Number.isFinite(Number(obj.x)) ||
    !Number.isFinite(Number(obj.y)) ||
    !Number.isFinite(Number(obj.w)) ||
    !Number.isFinite(Number(obj.h))
  ) {
    const bb = _resolveObjBoxAbs(overlay, obj);
    obj.x = bb.x;
    obj.y = bb.y;
    obj.w = bb.w;
    obj.h = bb.h;
  }

  const g = getGridSettings(state);

  const evSnap = {
    shiftKey: !!state.lastMove.shiftKey,
    altKey: !!state.lastMove.altKey,
  };

  if (a.type === "drag") {
    const ids = Array.isArray(a.dragIds) ? a.dragIds : null;
    const baseById = a.baseById instanceof Map ? a.baseById : null;

    // ✅ group drag
    if (ids && ids.length > 1 && baseById) {
      const anchorId = String(a.anchorId || a.objectId);
      const baseAnchor = baseById.get(anchorId) || a.baseObj;

      let ax = clamp(
        _num(baseAnchor.x, 0) + dx,
        0,
        maxW - (_num(baseAnchor.w, _num(obj.w, 0)) || _num(obj.w, 0))
      );
      let ay = clamp(
        _num(baseAnchor.y, 0) + dy,
        0,
        maxH - (_num(baseAnchor.h, _num(obj.h, 0)) || _num(obj.h, 0))
      );

      if (_shouldSnapNow(g, "drag", state.lastMove)) {
        const snapped = snapRect(
          { x: ax, y: ay, w: _num(baseAnchor.w, _num(obj.w, 0)), h: _num(baseAnchor.h, _num(obj.h, 0)) },
          g,
          maxW,
          maxH,
          evSnap,
          { snapXY: true, snapWH: false }
        );
        ax = snapped.x;
        ay = snapped.y;
      }

      const ddx = ax - _num(baseAnchor.x, 0);
      const ddy = ay - _num(baseAnchor.y, 0);

      for (const id of ids) {
        const o = getObject(a.pageIndex, id);
        if (!o) continue;

        const b = baseById.get(String(id));
        if (!b) continue;

        const w = _num(b.w, _num(o.w, 0));
        const h = _num(b.h, _num(o.h, 0));

        const nx = clamp(_num(b.x, 0) + ddx, 0, maxW - w);
        const ny = clamp(_num(b.y, 0) + ddy, 0, maxH - h);

        o.x = Math.round(nx);
        o.y = Math.round(ny);

        if (o.x_rel != null && o.y_rel != null && o.w_rel != null && o.h_rel != null) {
          updateRelFromAbs(o, overlay);
        }
      }

      renderPageOverlay(a.pageIndex);
      rerenderAllExcept(a.pageIndex);
      return;
    }

    // ✅ single drag
    let nx = clamp(a.baseObj.x + dx, 0, maxW - obj.w);
    let ny = clamp(a.baseObj.y + dy, 0, maxH - obj.h);

    if (_shouldSnapNow(g, "drag", state.lastMove)) {
      const snapped = snapRect({ x: nx, y: ny, w: obj.w, h: obj.h }, g, maxW, maxH, evSnap, {
        snapXY: true,
        snapWH: false,
      });
      nx = snapped.x;
      ny = snapped.y;
    }

    obj.x = Math.round(nx);
    obj.y = Math.round(ny);

    if (obj.x_rel != null && obj.y_rel != null && obj.w_rel != null && obj.h_rel != null) {
      updateRelFromAbs(obj, overlay);
    }

    renderPageOverlay(a.pageIndex);
    rerenderAllExcept(a.pageIndex);
    return;
  }

  // resize branch
  if (a.type === "resize") {
    const b = a.baseObj;
    const minSize = 24;

    let x = b.x,
      y = b.y,
      w = b.w,
      h = b.h;
    const handle = a.handle || "";

    // ✅ IMAGE: keep aspect ratio (corner handles)
    const isImage = typeNorm === "image";
    const ratio = isImage ? _num(b.w, 1) / Math.max(1, _num(b.h, 1)) : null;

    if (isImage && ratio && Number.isFinite(ratio) && ratio > 0) {
      const wFromDx = handle.includes("e") ? b.w + dx : handle.includes("w") ? b.w - dx : b.w;
      const hFromDy = handle.includes("s") ? b.h + dy : handle.includes("n") ? b.h - dy : b.h;

      const useDx = Math.abs(dx) >= Math.abs(dy);

      if (useDx) {
        w = wFromDx;
        h = w / ratio;
      } else {
        h = hFromDy;
        w = h * ratio;
      }

      w = Math.max(minSize, w);
      h = Math.max(minSize, h);

      if (handle.includes("w")) x = b.x + (b.w - w);
      if (handle.includes("n")) y = b.y + (b.h - h);

      x = clamp(x, 0, maxW - w);
      y = clamp(y, 0, maxH - h);

      const maxWAvail = maxW - x;
      const maxHAvail = maxH - y;

      if (w > maxWAvail) {
        w = maxWAvail;
        h = w / ratio;
      }
      if (h > maxHAvail) {
        h = maxHAvail;
        w = h * ratio;
      }

      if (handle.includes("w")) x = b.x + (b.w - w);
      if (handle.includes("n")) y = b.y + (b.h - h);

      x = clamp(x, 0, maxW - w);
      y = clamp(y, 0, maxH - h);
    } else {
      // Default resize
      if (handle.includes("e")) w = b.w + dx;
      if (handle.includes("s")) h = b.h + dy;
      if (handle.includes("w")) {
        w = b.w - dx;
        x = b.x + dx;
      }
      if (handle.includes("n")) {
        h = b.h - dy;
        y = b.y + dy;
      }

      const isLine =
        typeNorm === "shape" &&
        String(obj?.shape?.kind ?? obj?.style?.kind ?? obj?.style?.shape ?? "").toLowerCase() === "line";

      if (isLine) {
        const targetH = Math.max(2, Math.min(12, _num(b.h, 6)));
        h = targetH;
        y = b.y;
      }

      w = clamp(w, minSize, maxW);
      h = clamp(h, minSize, maxH);
      x = clamp(x, 0, maxW - w);
      y = clamp(y, 0, maxH - h);
    }

    const wantResizeSnapWH = !!g.snapOnResize;

    if (_shouldSnapNow(g, "resize", state.lastMove)) {
      const snapped = snapRect({ x, y, w, h }, g, maxW, maxH, evSnap, {
        snapXY: true,
        snapWH: wantResizeSnapWH,
      });

      x = snapped.x;
      y = snapped.y;

      if (isImage && ratio && Number.isFinite(ratio) && ratio > 0) {
        const sw = _num(snapped.w, w);
        const sh = _num(snapped.h, h);

        const wFromSnapH = sh * ratio;
        const hFromSnapW = sw / ratio;

        const errW = Math.abs(sw - wFromSnapH);
        const errH = Math.abs(sh - hFromSnapW);

        if (errH < errW) {
          w = sw;
          h = hFromSnapW;
        } else {
          h = sh;
          w = wFromSnapH;
        }

        w = Math.max(minSize, Math.min(w, maxW - x));
        h = w / ratio;
        if (h > maxH - y) {
          h = Math.max(minSize, maxH - y);
          w = h * ratio;
        }

        if (handle.includes("w")) x = clamp(b.x + (b.w - w), 0, maxW - w);
        if (handle.includes("n")) y = clamp(b.y + (b.h - h), 0, maxH - h);
      } else {
        w = snapped.w;
        h = snapped.h;
        w = clamp(w, minSize, maxW);
        h = clamp(h, minSize, maxH);
        x = clamp(x, 0, maxW - w);
        y = clamp(y, 0, maxH - h);
      }
    }

    obj.x = Math.round(x);
    obj.y = Math.round(y);
    obj.w = Math.round(w);
    obj.h = Math.round(h);

    if (obj.x_rel != null && obj.y_rel != null && obj.w_rel != null && obj.h_rel != null) {
      updateRelFromAbs(obj, overlay);
    }

    renderPageOverlay(a.pageIndex);
    rerenderAllExcept(a.pageIndex);
    return;
  }
}


function onMove(e) {
  if (!state.action) return;
  if (state.isEditingText) return;

  const a = state.action;

  const dxCss = e.clientX - a.startClientX;
  const dyCss = e.clientY - a.startClientY;

  if (Math.abs(dxCss) + Math.abs(dyCss) > 3) state.dragHasMoved = true;

  state.lastMove = {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: !!e.shiftKey,
    altKey: !!e.altKey,
    ctrlKey: !!e.ctrlKey,
    metaKey: !!e.metaKey,
  };

  if (state.rafPending) return;
  state.rafPending = true;
  requestAnimationFrame(applyDragResize);
}

function endAction() {
  if (state.action && state.dragHasMoved) {
    state.suppressOverlayClickUntil = Date.now() + 250;
  }
  state.action = null;
  state.lastMove = null;
  state.dragHasMoved = false;
}

function nudgeSelectedBy(dx, dy, ev) {
  const ms = _ensureMulti();
  const pageIndex = state.selected?.pageIndex ?? ms.pageIndex;
  if (pageIndex == null) return;

  const ids = getActiveSelection(pageIndex);
  if (!ids.length) return;

  if (state.isEditingText) return;

  const overlay = state.overlaysByPage.get(pageIndex);
  if (!overlay) return;

  const { ow: maxW, oh: maxH } = _getOverlaySize(overlay);
  if (maxW <= 0 || maxH <= 0) return;

  const g = getGridSettings(state);
  const moveLikeEv = {
    shiftKey: !!ev?.shiftKey,
    altKey: !!ev?.altKey,
  };

  const wantKeyboardSnap = !!ev?.shiftKey;

  for (const id of ids) {
    const obj = getObject(pageIndex, id);
    if (!obj) continue;

    if (
      !Number.isFinite(Number(obj.x)) ||
      !Number.isFinite(Number(obj.y)) ||
      !Number.isFinite(Number(obj.w)) ||
      !Number.isFinite(Number(obj.h))
    ) {
      const bb = _resolveObjBoxAbs(overlay, obj);
      obj.x = bb.x;
      obj.y = bb.y;
      obj.w = bb.w;
      obj.h = bb.h;
    }

    let nx = clamp((_num(obj.x, 0) || 0) + dx, 0, maxW - (_num(obj.w, 0) || 0));
    let ny = clamp((_num(obj.y, 0) || 0) + dy, 0, maxH - (_num(obj.h, 0) || 0));

    if (wantKeyboardSnap && g && g.snap) {
      const snapped = snapRect({ x: nx, y: ny, w: _num(obj.w, 0), h: _num(obj.h, 0) }, g, maxW, maxH, moveLikeEv, {
        snapXY: true,
        snapWH: false,
      });
      nx = snapped.x;
      ny = snapped.y;
    }

    obj.x = Math.round(nx);
    obj.y = Math.round(ny);

    if (obj.x_rel != null && obj.y_rel != null && obj.w_rel != null && obj.h_rel != null) {
      updateRelFromAbs(obj, overlay);
    }
  }

  renderPageOverlay(pageIndex);
  rerenderAllExcept(pageIndex);
}

// ----------------------------
// Attach handlers
// ----------------------------
export function attachOverlayHandlers(overlay, insertOnOverlayClick) {
  const markPointerDown = (e) => {
    overlay.__mdocPointerDownOnObject = !!e.target.closest(".anno-object");
    overlay.__mdocPointerDownOnHandle = !!e.target.closest(".anno-handle");
  };

  // ---------------------------------------------------
  // ✅ pointerdown => startAction (drag/resize/clip_image_drag)
  // ---------------------------------------------------
  overlay.addEventListener("pointerdown", (e) => {
    markPointerDown(e);

    // ✅ évite le double toggle (pointerdown + click)
    overlay.__mdocSelectionHandled = false;

    const handleEl = e.target.closest(".anno-handle");
    if (handleEl) {
      const objectEl = e.target.closest(".anno-object");
      if (objectEl) {
        overlay.__mdocSelectionHandled = true;
        startAction(e, overlay, objectEl);
      }
      return;
    }

    const objectEl = e.target.closest(".anno-object");
    if (!objectEl) return;

    overlay.__mdocSelectionHandled = true;
    startAction(e, overlay, objectEl);
  });

  // ---------------------------------------------------
  // ✅ click => selection / clear / insert tool
  // ---------------------------------------------------
  overlay.addEventListener("click", (e) => {
    if (Date.now() < (state.suppressOverlayClickUntil || 0)) return;

    const clickedObject = !!e.target.closest(".anno-object");
    const clickedHandle = !!e.target.closest(".anno-handle");
    const startedOnObject = !!overlay.__mdocPointerDownOnObject;
    const startedOnHandle = !!overlay.__mdocPointerDownOnHandle;

    overlay.__mdocPointerDownOnObject = false;
    overlay.__mdocPointerDownOnHandle = false;

    // ----------------------------
    // click on object / handle
    // ----------------------------
    if (clickedObject || clickedHandle || startedOnObject || startedOnHandle) {
      // si pointerdown a déjà géré la sélection/action, on ignore le click
      if (overlay.__mdocSelectionHandled) {
        overlay.__mdocSelectionHandled = false;
        return;
      }

      if (state.isEditingText) return;

      const objectEl = e.target.closest(".anno-object");
      if (!objectEl) return;

      const pageIndex = Number(overlay.dataset.pageIndex || "0");
      const objectId = objectEl.dataset.objectId;
      if (!objectId) return;

      const obj = getObject(pageIndex, objectId);

      // ✅ clip_shape: SHIFT click => activer le mode image interne (sans multi)
      if (obj && obj.type === "clip_shape" && e.shiftKey) {
        setSelected({ pageIndex, objectId });

        try {
          if (typeof _setClipImageEditMode === "function") _setClipImageEditMode(pageIndex, objectId, true);
          else if (typeof _setClipEdit === "function") _setClipEdit(pageIndex, objectId, true);
          else state.clipImageEditMode = { pageIndex, objectId: String(objectId), enabled: true };
        } catch {}

        renderPageOverlay(pageIndex);
        rerenderAllExcept(pageIndex);
        return;
      }

      // ✅ normal selection / multi
      if (e.shiftKey) {
        toggleMultiSelect(pageIndex, objectId);
        _syncUiAfterSelectionChange(pageIndex);
      } else {
        setSelected({ pageIndex, objectId });
      }

      return;
    }

    if (state.isEditingText) return;

    // ----------------------------
    // click empty => clear single + multi + clip edit + sync
    // ----------------------------
    const pageIndex = Number(overlay.dataset.pageIndex || "0");
    const hasClipEdit =
      (typeof _getClipEdit === "function" && !!_getClipEdit()) ||
      !!state.clipImageEditMode ||
      !!state.clipImageEdit;

    if (hasMultiSelection() || state.selected || hasClipEdit) {
      clearAllSelectionAndSync(pageIndex);
      return;
    }

    // ----------------------------
    // insert tool
    // ----------------------------
    if (state.activeTool && state.currentDraft) {
      console.log("[OVERLAY CLICK] activeTool =", state.activeTool);
      console.log("[OVERLAY CLICK] insertOnOverlayClick fn =", insertOnOverlayClick?.name, insertOnOverlayClick);
      insertOnOverlayClick(e, overlay);
      return;
    }
  });

  // ---------------------------------------------------
  // ✅ Ctrl+Wheel sur clip_shape sélectionné => zoom image interne
  //    - si mode clip edit actif sur cet objet
  // ---------------------------------------------------
  overlay.addEventListener(
    "wheel",
    (e) => {
      const sel = state.selected;
      if (!sel) return;

      const obj = getObject(sel.pageIndex, sel.objectId);
      if (!obj || obj.type !== "clip_shape") return;

      // check mode edit actif
      const inEdit =
        (typeof _isClipEditFor === "function" && _isClipEditFor(sel.pageIndex, sel.objectId)) ||
        (() => {
          const m = state.clipImageEditMode || state.clipImageEdit || null;
          if (!m) return false;
          if (m === true) return true;
          if (typeof m === "object") {
            if (m.pageIndex != null && Number(m.pageIndex) !== Number(sel.pageIndex)) return false;
            if (m.objectId != null && String(m.objectId) !== String(sel.objectId)) return false;
            if (m.enabled === false) return false;
            return true;
          }
          return false;
        })();

      if (!inEdit) return;

      // on ne casse pas le scroll normal si pas Ctrl/Meta
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      // ensure payload image
      try {
        if (typeof _ensureClipImageObj === "function") _ensureClipImageObj(obj);
        else {
          if (!obj.image || typeof obj.image !== "object") obj.image = {};
          if (!Number.isFinite(Number(obj.image.scale))) obj.image.scale = 1;
          if (!Number.isFinite(Number(obj.image.offsetX))) obj.image.offsetX = 0;
          if (!Number.isFinite(Number(obj.image.offsetY))) obj.image.offsetY = 0;
        }
      } catch {}

      // zoom step
      const dir = e.deltaY > 0 ? -1 : 1;
      const step = 0.06;
      const next = Number(obj.image.scale || 1) + dir * step;

      obj.image.scale = Math.max(0.25, Math.min(6.0, next));
	  
      try {
        const clampFn = window.__ZENHUB_CLAMP_CLIP_OFFSETS__;
        if (typeof clampFn === "function") {
          const overlay2 = state.overlaysByPage.get(sel.pageIndex);
          const bb = overlay2 ? _resolveObjBoxAbs(overlay2, obj) : { w: obj.w || 0, h: obj.h || 0 };
          clampFn(obj, bb.w, bb.h);
        }
      } catch {}



      renderPageOverlay(sel.pageIndex);
      rerenderAllExcept(sel.pageIndex);
      setStatus(`Zoom image: x${Number(obj.image.scale || 1).toFixed(2)}`);
    },
    { passive: false }
  );

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", endAction);
  window.addEventListener("pointercancel", endAction);
}


// ----------------------------
// Delete (single or multi)
// ----------------------------
export function deleteSelected() {
  const ms = _ensureMulti();

  if (ms.pageIndex != null && ms.ids.length > 0) {
    const pageIndex = ms.pageIndex;
    const ids = [...ms.ids];

    for (const id of ids) {
      try {
        removeObject(pageIndex, id);
      } catch {}
    }

    clearAllSelectionAndSync(pageIndex);

    setStatus(ids.length > 1 ? `Éléments supprimés (${ids.length})` : "Élément supprimé");
    return;
  }

  if (!state.selected) return;
  const pageIndex = state.selected.pageIndex;

  removeObject(pageIndex, state.selected.objectId);

  clearAllSelectionAndSync(pageIndex);

  setStatus("Élément supprimé");
}

// ----------------------------
// Keyboard nudging (arrow keys)
// ----------------------------
function _isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;

  const tag = (el.tagName || "").toLowerCase();

  if (tag === "textarea" || tag === "select") return true;

  if (tag === "input") {
    const type = String(el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox" || type === "radio" || type === "button" || type === "submit" || type === "reset") return false;
    return true;
  }

  if (el.isContentEditable) return true;

  return false;
}

let __keyboardNudgeInstalled = false;

export function installKeyboardNudgesOnce() {
  if (__keyboardNudgeInstalled) return;
  __keyboardNudgeInstalled = true;

  window.addEventListener("keydown", (e) => {
    if (_isTypingContext()) return;

    // ✅ ESC => sort du mode édition image interne (clip_shape)
    if (e.key === "Escape") {
      const m = _getClipEdit?.() || null;
      if (m && m.enabled) {
        e.preventDefault();
        _clearClipEdit?.();

        if (state.selected?.pageIndex != null) {
          renderPageOverlay(state.selected.pageIndex);
          rerenderAllExcept(state.selected.pageIndex);
        }
        setStatus("Mode image interne désactivé");
      }
      return;
    }

    const ms = _ensureMulti();
    if (!state.selected && !(ms.pageIndex != null && ms.ids.length > 0)) return;

    if (state.isEditingText) return;

    const key = e.key;
    const isArrow = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
    if (!isArrow) return;

    // ✅ Si on édite l'image interne d'un clip_shape => flèches déplacent l'image (pas l'objet)
    const clipEdit = _getClipEdit?.() || null;
    if (clipEdit && clipEdit.enabled) {
      const pageIndex = clipEdit.pageIndex ?? state.selected?.pageIndex;
      const objectId = clipEdit.objectId ?? state.selected?.objectId;

      if (pageIndex != null && objectId != null) {
        const obj = getObject(pageIndex, objectId);
        if (obj && obj.type === "clip_shape") {
          e.preventDefault();

          _ensureClipImageObj(obj);

          const step = e.shiftKey ? 10 : 1; // rapide avec SHIFT
          let dx = 0, dy = 0;
          if (key === "ArrowLeft") dx = -step;
          if (key === "ArrowRight") dx = step;
          if (key === "ArrowUp") dy = -step;
          if (key === "ArrowDown") dy = step;

          obj.image.offsetX = Number(obj.image.offsetX || 0) + dx;
          obj.image.offsetY = Number(obj.image.offsetY || 0) + dy;
		  
          try {
            const clampFn = window.__ZENHUB_CLAMP_CLIP_OFFSETS__;
            if (typeof clampFn === "function") {
              const overlay2 = state.overlaysByPage.get(pageIndex);
              const bb = overlay2 ? _resolveObjBoxAbs(overlay2, obj) : { w: obj.w || 0, h: obj.h || 0 };
              clampFn(obj, bb.w, bb.h);
            }
          } catch {}		  

          renderPageOverlay(pageIndex);
          rerenderAllExcept(pageIndex);

          setStatus(`Image interne déplacée (${obj.image.offsetX}, ${obj.image.offsetY})`);
          return;
        }
      }
      // si clipEdit actif mais objet introuvable, on retombe sur nudge normal
    }

    // ✅ Nudge normal (déplace l'objet / groupe)
    e.preventDefault();

    const step = e.shiftKey ? 10 : 1;

    let dx = 0,
      dy = 0;
    if (key === "ArrowLeft") dx = -step;
    if (key === "ArrowRight") dx = step;
    if (key === "ArrowUp") dy = -step;
    if (key === "ArrowDown") dy = step;

    nudgeSelectedBy(dx, dy, e);
  });
}


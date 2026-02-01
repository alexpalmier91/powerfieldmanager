// app/static/labo/editor/state.js?v=12
export const state = {
  root: document.getElementById("editorRoot"),
  pdfContainer: document.getElementById("pdfContainer"),
  statusEl: document.getElementById("editorStatus"),

  btnSave: document.getElementById("btnSaveDraft"),
  btnAddText: document.getElementById("btnAddText"),
  btnAddImage: document.getElementById("btnAddImage"),
  
  _syncingStyleUi: false,

  // ✅ NEW: boutons outils dynamiques
  btnAddProductPrice: document.getElementById("btnAddProductPrice"),
  btnAddStockBadge: document.getElementById("btnAddStockBadge"),
  btnAddProductEan: document.getElementById("btnAddProductEan"),

  // ✅ NEW: Align button (multi-select)
  btnAlignVertical: document.getElementById("btnAlignVertical"),

  // --------------------------------------------------
  // ✅ NEW: Grid UI (Grille)
  // --------------------------------------------------
  gridEnabledChk: document.getElementById("gridEnabledChk"),
  gridSnapChk: document.getElementById("gridSnapChk"),
  gridSizeSel: document.getElementById("gridSizeSel"),
  gridOpacityInp: document.getElementById("gridOpacityInp"),
  gridColorInp: document.getElementById("gridColorInp"),
  gridBigSel: document.getElementById("gridBigSel"),
  gridSnapMoveOnlyChk: document.getElementById("gridSnapMoveOnlyChk"),

  // ✅ NEW: Grid state (persisted in draft._meta.grid by editor_bootstrap.js)
  grid: {
    enabled: false,
    snap: false,
    size: 20,
    opacity: 0.12,
    color: "#2c3e50",
    bigEvery: 5,
    showBig: true,
    snapMode: "always", // "always" | "shift" | "alt"
    snapDuringMoveOnly: false, // si true: insertion non-snap, drag/resize snap
    snapOnResize: true,
    snapToCenter: false,
  },

  // --------------------------------------------------
  // Text tool UI
  // --------------------------------------------------
  textToolBox: document.getElementById("textToolBox"),
  textToolValue: document.getElementById("textToolValue"),
  textToolSize: document.getElementById("textToolSize"),
  textToolColor: document.getElementById("textToolColor"),
  textToolBold: document.getElementById("textToolBold"),
  textToolFont: document.getElementById("textToolFont"),

  // ✅ épaisseur (300/400/700) + fond + bordure
  textToolWeight: document.getElementById("textToolWeight"),
  textToolBgMode: document.getElementById("textToolBgMode"),
  textToolBgColor: document.getElementById("textToolBgColor"),
  textToolBorderEnabled: document.getElementById("textToolBorderEnabled"),
  textToolBorderColor: document.getElementById("textToolBorderColor"),
  textToolBorderWidth: document.getElementById("textToolBorderWidth"),

  btnCancelToolText: document.getElementById("btnCancelToolText"),

  // --------------------------------------------------
  // Image tool UI
  // --------------------------------------------------
  imageToolBox: document.getElementById("imageToolBox"),
  imageFileInput: document.getElementById("imageFileInput"),
  btnPickImage: document.getElementById("btnPickImage"),
  imagePickedInfo: document.getElementById("imagePickedInfo"),
  btnCancelToolImage: document.getElementById("btnCancelToolImage"),

  // --------------------------------------------------
  // ✅ Dynamic tools UI (Prix / Rupture / EAN)
  // --------------------------------------------------
  dynamicCommonBox: document.getElementById("dynamicCommonBox"),

  dynProductSearch: document.getElementById("dynProductSearch"),
  dynProductResults: document.getElementById("dynProductResults"),

  // style commun
  dynFontFamily: document.getElementById("dynFontFamily"),
  dynFontSize: document.getElementById("dynFontSize"),
  dynFontWeight: document.getElementById("dynFontWeight"),
  dynColor: document.getElementById("dynColor"),
  dynBgMode: document.getElementById("dynBgMode"),
  dynBgColor: document.getElementById("dynBgColor"),
  dynBorderEnabled: document.getElementById("dynBorderEnabled"),
  dynBorderColor: document.getElementById("dynBorderColor"),
  dynBorderWidth: document.getElementById("dynBorderWidth"),

  btnCancelToolDynamic: document.getElementById("btnCancelToolDynamic"),

  // prix
  productPriceToolBox: document.getElementById("productPriceToolBox"),
  priceMode: document.getElementById("priceMode"),
  tierSelect: document.getElementById("tierSelect"),
  priceIntPlus1pt: document.getElementById("priceIntPlus1pt"),

  // stock badge
  stockBadgeToolBox: document.getElementById("stockBadgeToolBox"),
  stockText: document.getElementById("stockText"),
  stockModeLabo: document.getElementById("stockModeLabo"),

  // ean
  productEanToolBox: document.getElementById("productEanToolBox"),

  // --------------------------------------------------
  // ✅ Multi-selection
  // --------------------------------------------------
  multiSelected: {
    pageIndex: null,
    ids: [],
    anchorId: null,
  },

  // --------------------------------------------------
  // Common actions
  // --------------------------------------------------
  btnDeleteSelected: document.getElementById("btnDeleteSelected"),

  // --------------------------------------------------
  // Inline edit tracking
  // --------------------------------------------------
  inlineEdit: null, // { pageIndex, objectId } | null (legacy)
  _lastPointerDown: null, // { t, pageIndex, objectId } | null
  isEditingText: false, // utilisé par interactions.js

  // ✅ évite click fantôme après double-clic
  _suppressOverlayClickUntil: 0,

  // --------------------------------------------------
  // ✅ Hooks (installés par ui_tools.js)
  // --------------------------------------------------
  _alignSelectionVertical: null,

  // ✅ NEW: hooks UI sync/preset (installés par ui_tools.js)
  _syncTextUiFromSelected: null,
  _syncDynamicUiFromSelected: null,
  _syncStyleUiFromSelected: null,
  _rememberPresetFromSelected: null,

  // ✅ NEW: preset storage (par outil)
  presets: {},

  // --------------------------------------------------
  // ✅ Fonts state (pour embarquer les vraies typos)
  // --------------------------------------------------
  fonts: [],
  globalFonts: [],
  fontsById: new Map(),
  fontsByFamily: new Map(),

  // --------------------------------------------------
  // Document
  // --------------------------------------------------
  DOC_ID: null,

  // data
  currentDraft: null,
  currentPdfUrl: null,
  PDF_SCALE: 1.2,

  // tool / selection
  activeTool: null,
  selected: null,

  // ✅ objet texte en édition (pour contour vert + rendu)
  editing: null, // { pageIndex, objectId } | null

  // drag/resize
  action: null,
  rafPending: false,
  lastMove: null,
  suppressOverlayClickUntil: 0,
  dragHasMoved: false,

  // overlays
  overlaysByPage: new Map(), // pageIndex -> overlayEl

  // ✅ caches dynamiques
  dynCache: {
    // bulk
    productsById: new Map(),
    tiersByProductId: new Map(),
    bulkPending: new Set(),
    lastSelectedProductId: null,

    // search
    lastQuery: "",
    searchResults: [],

    // price (utilisé par overlay_render.js)
    priceByKey: new Map(),
    pricePending: new Set(),
  },
};

export function setStatus(msg) {
  if (state.statusEl) state.statusEl.textContent = msg || "";
}

export function uid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// DEBUG
window.__mdoc_state = state;
console.log("[STATE] loaded ✅ v=12", {
  hasTextToolBox: !!state.textToolBox,
  hasFontSelect: !!state.textToolFont,
  hasBgMode: !!state.textToolBgMode,
  hasWeight: !!state.textToolWeight,
  hasDynamicCommonBox: !!state.dynamicCommonBox,
  hasAddPriceBtn: !!state.btnAddProductPrice,
  hasAddStockBtn: !!state.btnAddStockBadge,
  hasAddEanBtn: !!state.btnAddProductEan,
  hasAlignBtn: !!state.btnAlignVertical,
  hasSuppressClick: typeof state._suppressOverlayClickUntil === "number",

  // ✅ grid debug
  hasGridEnabledChk: !!state.gridEnabledChk,
  hasGridSnapChk: !!state.gridSnapChk,
  hasGridSizeSel: !!state.gridSizeSel,
  hasGridOpacityInp: !!state.gridOpacityInp,
  hasGridColorInp: !!state.gridColorInp,
  hasGridBigSel: !!state.gridBigSel,
  hasGridSnapMoveOnlyChk: !!state.gridSnapMoveOnlyChk,
  gridDefaults: state.grid,

  // ✅ hooks debug
  hasSyncStyleHook: typeof state._syncStyleUiFromSelected === "function",
  hasRememberPresetHook: typeof state._rememberPresetFromSelected === "function",

  // ✅ presets debug
  presetsKeys: state.presets ? Object.keys(state.presets) : null,

  // ✅ fonts debug
  fontsCount: Array.isArray(state.fonts) ? state.fonts.length : -1,
  globalFontsCount: Array.isArray(state.globalFonts) ? state.globalFonts.length : -1,
});

// app/static/labo/editor/editor_bootstrap.js


import { API_BASE, TOKEN, fetchJSON } from "./api.js?v=12";
import { state, setStatus, uid } from "./state.js?v=12";
import { DEFAULT_GRID, getGridSettings, applyGridToAllOverlays } from "./grid_tools.js";
import { ensureDraftShape } from "./draft.js?v=12";
import { ensurePdfJsReady } from "./pdfjs.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";
import { bindFontUploadForm, refreshFonts } from "./fonts_ui.js?v=12";
import { addClipShapeObject } from "./draft.js?v=12";
import { attachOverlayHandlers, deleteSelected, setSelected, alignSelectedVertical } from "./interactions.js?v=12";
import { installAlignTools } from "./ui_tools.js?v=12";
import { initImageRemoveBgTool } from "./image_remove_bg.js?v=12";
import { initPageAppendTools } from "./page_append_tools.js?v=12";
import { initProductBlockUI } from "./product_block.js?v=12";
import { initToolSectionCollapsible } from "./tool_section.js?v=12";
import { setToolClipShape, initClipShapeUI } from "./clip_shape.js?v=12";




import {
  setActiveShapeTool,
  applyShapePropsToSelection,
  centerTextInsideShapeSelection,
  
} from "./shapes_tools.js?v=12";


import {
  setActiveTool,
  handleImagePicked,
  insertToolObjectAt,
  bindTextToolInputs,
  bindDynamicToolsUI,
  bindShapeToolInputs,
  bindClipShapeToolInputs,
} from "./ui_tools.js?v=12";



console.log("[LABO_EDITOR] module chargé ✅ (bootstrap)");

const V = "12";
const withV = (p) => `${p}?v=${V}`;



function createPageWrapper(pageIndex, viewport) {
  const wrap = document.createElement("div");
  wrap.className = "pdf-page-wrap";
  wrap.style.position = "relative";
  wrap.style.marginBottom = "16px";
  wrap.style.display = "inline-block";

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";
  canvas.style.display = "block";
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const overlay = document.createElement("div");
  overlay.className = "pdf-overlay";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = canvas.width + "px";
  overlay.style.height = canvas.height + "px";
  overlay.style.pointerEvents = "auto";
  overlay.dataset.pageIndex = String(pageIndex);

  wrap.appendChild(canvas);
  wrap.appendChild(overlay);
  return { wrap, canvas, overlay };
}

function computeFitWidthScale(page, containerEl, paddingPx = 24) {
  const base = page.getViewport({ scale: 1 });
  const containerWidth = containerEl?.clientWidth || 900;
  const usable = Math.max(320, containerWidth - paddingPx);
  const s = usable / base.width;
  return Math.max(0.6, Math.min(2.6, s));
}

function $id(id) {
  return document.getElementById(id);
}

function setPublishStatus(msg) {
  const a = $id("publishStatus");
  const b = $id("publishStatusTop");
  if (a) a.textContent = msg || "";
  if (b) b.textContent = msg || "";
}

function setPublishButtonsEnabled(enabled) {
  const ids = ["btnPublish", "btnPublishTop"];
  for (const id of ids) {
    const el = $id(id);
    if (!el) continue;
    el.disabled = !enabled;
    el.style.opacity = enabled ? "1" : "0.6";
    el.style.cursor = enabled ? "pointer" : "not-allowed";
  }
}

let __publishing = false;

// =====================================================
// Fonts – default must be PyMuPDF-safe
// =====================================================
const DEFAULT_FONT_FAMILY = "helv"; // PyMuPDF builtin safe font

function normalizeFontFamily(input) {
  const v = (input ?? "").toString().trim();
  // UI may send "", "default", null, undefined
  if (!v || v === "default") return DEFAULT_FONT_FAMILY;
  return v;
}

function ensureOverlayFontFamily(overlay) {
  // We enforce for the dynamic blocks concerned, but it's safe for all text overlays too.
  overlay.fontFamily = normalizeFontFamily(overlay.fontFamily);
  return overlay;
}

// Price style payload (stored only in draft JSON, renderer agent will read later)
function normalizePriceStyle(dynamic, checked) {
  if (!dynamic) dynamic = {};
  if (!checked) {
    // retro-compatible: remove field if unchecked
    if (dynamic.priceStyle) delete dynamic.priceStyle;
    return dynamic;
  }
  dynamic.priceStyle = {
    kind: "int_plus_1pt",
    euros_plus_pt: 1, // required by spec
  };
  return dynamic;
}

function isIntPlus1pt(dynamic) {
  return !!(dynamic && dynamic.priceStyle && dynamic.priceStyle.kind === "int_plus_1pt");
}

// =====================================================
// ✅ OPTION A : dropdown polices avec preview (custom UI)
// =====================================================

// charge la liste des polices globales (superuser)
async function loadGlobalFonts() {
  try {
    const rows = await fetchJSON(`${API_BASE}/fonts/global`, { method: "GET" });
    state.globalFonts = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn("[LABO_EDITOR] global fonts fetch failed:", e);
    state.globalFonts = [];
  }
}

function _ensureFontPreviewStylesOnce() {
  if (document.getElementById("zenhub-font-preview-ui")) return;

  const s = document.createElement("style");
  s.id = "zenhub-font-preview-ui";
  s.textContent = `
    .zh-font-dd { position: relative; width: 100%; }
    .zh-font-dd-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid rgba(17,24,39,.18);
      background: #fff;
      border-radius: 8px;
      cursor: pointer;
      user-select: none;
      font-size: 14px;
    }
    .zh-font-dd-btn:disabled { opacity: .6; cursor: not-allowed; }
    .zh-font-dd-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zh-font-dd-caret { opacity: .7; font-size: 12px; }
    .zh-font-dd-menu {
      position: absolute;
      z-index: 9999;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      max-height: 260px;
      overflow: auto;
      border: 1px solid rgba(17,24,39,.14);
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.08);
      padding: 6px;
      display: none;
    }
    .zh-font-dd.open .zh-font-dd-menu { display: block; }
    .zh-font-dd-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1.2;
    }
    .zh-font-dd-item:hover { background: rgba(17,24,39,.06); }
    .zh-font-dd-item.active { background: rgba(59,130,246,.10); }
    .zh-font-dd-item small { opacity: .55; font-size: 12px; }
  `;
  document.head.appendChild(s);
}

function _fontFaceFormatFromUrl(url) {
  const u = (url || "").toLowerCase();
  if (u.includes(".woff2")) return "woff2";
  if (u.includes(".woff")) return "woff";
  if (u.includes(".otf")) return "opentype";
  if (u.includes(".ttf")) return "truetype";
  return "truetype";
}

function ensureFontFacesLoaded() {
  const id = "zenhub-fontfaces";
  let styleEl = document.getElementById(id);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }

  // On reconstruit le CSS à chaque refresh : simple et fiable
  const lines = [];

  // Labo fonts (woff2)
  const laboFonts = Array.isArray(state.fonts) ? state.fonts : [];
  for (const f of laboFonts) {
    if (!f || !f.id) continue;
    const family = `LABO_FONT_${f.id}`;
    const url = f.woff2_url || f.url || f.file_url;
    if (!url) continue;
    lines.push(`
@font-face{
  font-family:"${family}";
  src:url("${url}") format("woff2");
  font-display:swap;
}`);
  }

  // Global fonts (ttf/otf)
  const globalFonts = Array.isArray(state.globalFonts) ? state.globalFonts : [];
  for (const g of globalFonts) {
    if (!g || !g.family_key) continue;
    const family = g.family_key;
    const url = g.file_url || g.url;
    if (!url) continue;
    const fmt = _fontFaceFormatFromUrl(url);
    lines.push(`
@font-face{
  font-family:"${family}";
  src:url("${url}") format("${fmt}");
  font-display:swap;
}`);
  }

  styleEl.textContent = lines.join("\n");
}

function buildUnifiedFontItems() {
  const items = [];

  // Default first (Helvetica builtin)
  items.push({
    family: "helv",
    label: "Par défaut (Helvetica)",
    source: "builtin",
  });

  // Global fonts next
  const g = Array.isArray(state.globalFonts) ? state.globalFonts : [];
  for (const f of g) {
    if (!f || !f.family_key) continue;
    items.push({
      family: f.family_key,
      label: f.display_name || f.family_key,
      source: "global",
    });
  }

  // Labo fonts last
  const l = Array.isArray(state.fonts) ? state.fonts : [];
  for (const f of l) {
    if (!f || !f.id) continue;
    items.push({
      family: `LABO_FONT_${f.id}`,
      label: f.display_name || f.name || f.original_name || `Police labo #${f.id}`,
      source: "labo",
    });
  }

  // tri alpha en gardant Helvetica 1er
  const head = items.shift();
  items.sort((a, b) => (a.label || "").localeCompare(b.label || "", "fr", { sensitivity: "base" }));
  items.unshift(head);

  return items;
}

function populateSelectFallback(selectEl, items) {
  // garde l’existant mais remet à plat : option 0 = helv
  selectEl.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.family;
    opt.textContent = it.label;
    selectEl.appendChild(opt);
  }
}

function closeAllFontDropdowns(except = null) {
  document.querySelectorAll(".zh-font-dd.open").forEach((el) => {
    if (except && el === except) return;
    el.classList.remove("open");
  });
}

let __globalFontCloserInstalled = false;

function installGlobalFontDropdownCloserOnce() {
  if (__globalFontCloserInstalled) return;
  __globalFontCloserInstalled = true;

  // ✅ pointerdown (mieux que click) + capture
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target;
      // si on clique dans un dropdown => on ne ferme pas
      if (target && target.closest && target.closest(".zh-font-dd")) return;
      closeAllFontDropdowns();
    },
    { capture: true }
  );

  // ✅ ESC ferme
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllFontDropdowns();
  });
}



function upgradeSelectToFontDropdown(selectEl, items) {
  // déjà remplacé ?
  if (selectEl.dataset.zhUpgraded === "1") return;

  selectEl.dataset.zhUpgraded = "1";

  // fallback options (utile si css/JS custom se casse)
  populateSelectFallback(selectEl, items);

  // wrapper UI
  const dd = document.createElement("div");
  dd.className = "zh-font-dd";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "zh-font-dd-btn";

  const labelSpan = document.createElement("div");
  labelSpan.className = "zh-font-dd-label";

  const caret = document.createElement("div");
  caret.className = "zh-font-dd-caret";
  caret.textContent = "▾";

  btn.appendChild(labelSpan);
  btn.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "zh-font-dd-menu";
  
  
  // ✅ empêche la molette/trackpad de scroller le parent au lieu du menu
		menu.addEventListener(
		  "wheel",
		  (e) => {
			e.stopPropagation();
		  },
		  { passive: true }
		);

		// ✅ évite que le click “inside” ferme le menu via le listener global
		menu.addEventListener("pointerdown", (e) => e.stopPropagation());
		btn.addEventListener("pointerdown", (e) => e.stopPropagation());


  dd.appendChild(btn);
  dd.appendChild(menu);

  // place juste après le select
  selectEl.insertAdjacentElement("afterend", dd);

  // cache le select, mais il reste dans le DOM (important pour le reste de l’app)
  selectEl.style.display = "none";

  const renderActive = () => {
    const v = normalizeFontFamily(selectEl.value);
    const it = items.find((x) => x.family === v) || items[0];
    labelSpan.textContent = it?.label || "Police";
    labelSpan.style.fontFamily = `"${it.family}", helv, Arial, sans-serif`;
  };

  const rebuildMenu = () => {
    menu.innerHTML = "";
    const current = normalizeFontFamily(selectEl.value);

    for (const it of items) {
      const row = document.createElement("div");
      row.className = "zh-font-dd-item" + (it.family === current ? " active" : "");
      row.style.fontFamily = `"${it.family}", helv, Arial, sans-serif`;

      const left = document.createElement("div");
      left.style.flex = "1";
      left.style.minWidth = "0";
      left.textContent = it.label;

      const right = document.createElement("small");
      right.textContent = it.source === "global" ? "Global" : it.source === "labo" ? "Labo" : "";

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener("click", () => {
        // sync select
        selectEl.value = it.family;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));

        // refresh UI
        closeAllFontDropdowns();
        renderActive();
        rebuildMenu();
      });

      menu.appendChild(row);
    }
  };

  btn.addEventListener("click", () => {
    const willOpen = !dd.classList.contains("open");
    closeAllFontDropdowns(dd);
    if (willOpen) {
      dd.classList.add("open");
      rebuildMenu();
    } else {
      dd.classList.remove("open");
    }
  });

  // si le select change (via code), on suit
  selectEl.addEventListener("change", () => {
    renderActive();
    // menu refresh si ouvert
    if (dd.classList.contains("open")) rebuildMenu();
  });

  renderActive();

 
}

function upgradeAllFontSelects() {
 installGlobalFontDropdownCloserOnce();	
  _ensureFontPreviewStylesOnce();

  ensureFontFacesLoaded();

  const items = buildUnifiedFontItems();

  const selects = Array.from(document.querySelectorAll("select.js-font-select"));
  for (const sel of selects) {
    // valeur par défaut sécurisée
    if (!sel.value) sel.value = "helv";
    upgradeSelectToFontDropdown(sel, items);
  }
}

// =====================================================
// Draft migration / sanitation (front only)
// =====================================================
function softMigrateDraftFonts(draft) {
  if (!draft) return draft;

  const fixList = (list) => {
    if (!Array.isArray(list)) return;
    for (const o of list) {
      if (!o || typeof o !== "object") continue;

      const kind = o.dynamic && o.dynamic.kind;
      if (kind === "product_price" || kind === "product_stock_badge") {
        // IMPORTANT: never allow empty/null fontFamily for these
        o.fontFamily = normalizeFontFamily(o.fontFamily);
      }
    }
  };

  const data = draft.data_json || {};

  // Common shapes
  if (Array.isArray(data.pages)) {
    for (const p of data.pages) {
      fixList(p && p.overlays);
      fixList(p && p.objects); // au cas où ton shape utilise "objects"
    }
  }

  fixList(data.overlays); // shape flat

  return draft;
}

function sanitizeDraftBeforeSave(draft) {
  // Idempotent: can be called any time
  return softMigrateDraftFonts(draft);
}

/**
 * ✅ Stamp meta qui doit être partagé avec l'AGENT + backend renderer
 */
function stampDraftMeta(pdfFirstPageViewportBase = null) {
  if (!state.currentDraft) return;
  if (!state.currentDraft.data_json) state.currentDraft.data_json = {};
  if (!state.currentDraft.data_json._meta) state.currentDraft.data_json._meta = {};

  const meta = state.currentDraft.data_json._meta;
  state.currentDraft.data_json._meta.debug_render = false;

  meta.pdf_scale = state.PDF_SCALE || null;
  meta.updated_at = new Date().toISOString();

  if (pdfFirstPageViewportBase) {
    meta.pdf_base_width = Math.round(pdfFirstPageViewportBase.width || 0) || null;
    meta.pdf_base_height = Math.round(pdfFirstPageViewportBase.height || 0) || null;
  }

  // ✅ embarque la table des polices (LABO)
  try {
    const fonts = Array.isArray(state.fonts) ? state.fonts : [];
    const map = {};
    for (const f of fonts) {
      if (!f || !f.id) continue;
      const family = `LABO_FONT_${f.id}`;
      map[family] = {
        id: Number(f.id),
        display_name: f.display_name || f.name || f.original_name || `Font #${f.id}`,
        woff2_url: f.woff2_url || f.url || f.file_url || null,
        file_url: f.file_url || null,
        url: f.url || null,
        original_name: f.original_name || f.filename || null,
        sha1: f.sha1 || null,
        updated_at: f.updated_at || null,
      };
    }
    meta.fonts_map = map;
    meta.fonts_count = Object.keys(map).length;
  } catch (e) {
    console.warn("[LABO_EDITOR] stampDraftMeta fonts_map skipped:", e);
  }

  // ✅ embarque aussi les global fonts (superuser)
  try {
    const gfonts = Array.isArray(state.globalFonts) ? state.globalFonts : [];
    const gmap = {};
    for (const f of gfonts) {
      if (!f || !f.family_key) continue;
      gmap[f.family_key] = {
        family_key: f.family_key,
        display_name: f.display_name || f.family_key,
        file_url: f.file_url || null,
        weight: f.weight ?? null,
        style: f.style ?? null,
      };
    }
    meta.global_fonts_map = gmap;
    meta.global_fonts_count = Object.keys(gmap).length;
  } catch (e) {
    console.warn("[LABO_EDITOR] stampDraftMeta global_fonts_map skipped:", e);
  }
}

async function loadDraft() {
  if (!state.DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");

  setStatus("Chargement du brouillon…");
  const d = await fetchJSON(`${API_BASE}/labo/marketing-documents/${state.DOC_ID}/draft`, { method: "GET" });

  state.currentDraft = d;
  ensureDraftShape();
  state.currentDraft = softMigrateDraftFonts(state.currentDraft);
  setStatus("Brouillon chargé");
}

async function loadPDF() {
  if (!state.DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  if (!state.pdfContainer) throw new Error("#pdfContainer introuvable");

  await ensurePdfJsReady();
  setStatus("Chargement du PDF…");

  const info = await fetchJSON(`${API_BASE}/labo/marketing-documents/${state.DOC_ID}/view-url`, { method: "GET" });
  if (!info?.url) throw new Error("view-url: URL PDF manquante");
  state.currentPdfUrl = info.url;

  const pdf = await window.pdfjsLib.getDocument({ url: state.currentPdfUrl }).promise;
  
  state.pdfDoc = pdf; // ✅ important : basePageCount fiable partout

  state.pdfContainer.innerHTML = "";
  state.overlaysByPage.clear();

  const page1 = await pdf.getPage(1);
  const baseVp = page1.getViewport({ scale: 1 });

 // const savedScale = Number(state.currentDraft?.data_json?._meta?.pdf_scale);
 // const hasSavedScale = Number.isFinite(savedScale) && savedScale > 0;

	const fitScale = computeFitWidthScale(page1, state.pdfContainer, 40);
	const chosenScale = fitScale; // ✅ toujours adapté à la largeur actuelle

	state.PDF_SCALE = chosenScale;

	// garde juste les dimensions base (utile), mais ne force pas le scale
	stampDraftMeta(baseVp);




  // ✅ pages ajoutées depuis le draft (data_json.appended_pages)
  const appended = Array.isArray(state.currentDraft?.data_json?.appended_pages)
    ? state.currentDraft.data_json.appended_pages
    : [];

  const appendedCount = appended.length;
  const totalPages = pdf.numPages + appendedCount;

  // Hook global : utilisé par page_append_tools.js après append/remove
  window.__ZENHUB_SYNC_APPENDED_PAGES__ = async () => {
    try {
      // Recalcule appended (draft peut avoir changé)
      const appendedNow = Array.isArray(state.currentDraft?.data_json?.appended_pages)
        ? state.currentDraft.data_json.appended_pages
        : [];
      const desiredTotal = pdf.numPages + appendedNow.length;

      // 1) Si on a trop de wrappers => supprimer à la fin (sans toucher aux pages originales)
      while (state.pdfContainer.children.length > desiredTotal) {
        const last = state.pdfContainer.lastElementChild;
        if (!last) break;

        // retire overlay map
        const overlays = last.querySelectorAll(".pdf-overlay");
        overlays.forEach((ov) => {
          const pi = Number(ov?.dataset?.pageIndex ?? -1);
          if (Number.isFinite(pi)) state.overlaysByPage.delete(pi);
        });

        last.remove();
      }

      // 2) Si on en manque => ajouter des wrappers de pages blanches
      while (state.pdfContainer.children.length < desiredTotal) {
        const pageIndex = state.pdfContainer.children.length; // 0-based
        if (pageIndex < pdf.numPages) break; // sécurité

        const ai = pageIndex - pdf.numPages;
        const meta = appendedNow[ai] || {};
        const wPt = Number(meta.width || baseVp.width || 595.28);
        const hPt = Number(meta.height || baseVp.height || 841.89);

        const blankViewport = { width: wPt * chosenScale, height: hPt * chosenScale };

        const { wrap, canvas, overlay } = createPageWrapper(pageIndex, blankViewport);

        // canvas blanc
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        state.overlaysByPage.set(pageIndex, overlay);
        attachOverlayHandlers(overlay, insertToolObjectAtWrapped);
        renderPageOverlay(pageIndex);

        applyGridToAllOverlays(wrap, getGridSettings(state));

        state.pdfContainer.appendChild(wrap);
      }

      // 3) rerender overlays de toutes les pages ajoutées (sûr)
      const baseCount = state.pdfDoc?.numPages || pdf.numPages || 0;
		for (let pi = baseCount; pi < state.pdfContainer.children.length; pi++) {
		  renderPageOverlay(pi);
		}


      setStatus("Pages ajoutées synchronisées ✅");
    } catch (e) {
      console.warn("[LABO_EDITOR] __ZENHUB_SYNC_APPENDED_PAGES__ failed:", e);
      setStatus("Sync pages ajoutées impossible");
    }
  };

  // ✅ rendu pages originales + pages ajoutées
  for (let i = 1; i <= totalPages; i++) {
    const pageIndex = i - 1;

    // ------------------------------
    // Pages originales (PDF.js)
    // ------------------------------
    if (i <= pdf.numPages) {
      setStatus(`Rendu page ${i}/${totalPages}…`);
      const page = i === 1 ? page1 : await pdf.getPage(i);
      const viewport = page.getViewport({ scale: chosenScale });

      const { wrap, canvas, overlay } = createPageWrapper(pageIndex, viewport);
      const ctx = canvas.getContext("2d", { alpha: false });

      await page.render({ canvasContext: ctx, viewport }).promise;

      state.overlaysByPage.set(pageIndex, overlay);
      attachOverlayHandlers(overlay, insertToolObjectAtWrapped);
      renderPageOverlay(pageIndex);

      applyGridToAllOverlays(wrap, getGridSettings(state));
      state.pdfContainer.appendChild(wrap);
      continue;
    }

    // ------------------------------
    // Pages ajoutées (canvas blanc)
    // ------------------------------
    const ai = pageIndex - pdf.numPages;
    const meta = appended[ai] || {};

    const wPt = Number(meta.width || baseVp.width || 595.28);
    const hPt = Number(meta.height || baseVp.height || 841.89);

    const blankViewport = { width: wPt * chosenScale, height: hPt * chosenScale };

    setStatus(`Rendu page ${i}/${totalPages}… (ajoutée)`);
    const { wrap, canvas, overlay } = createPageWrapper(pageIndex, blankViewport);

    // canvas blanc
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    state.overlaysByPage.set(pageIndex, overlay);
    attachOverlayHandlers(overlay, insertToolObjectAtWrapped);
    renderPageOverlay(pageIndex);

    applyGridToAllOverlays(wrap, getGridSettings(state));
    state.pdfContainer.appendChild(wrap);
  }


  setStatus("PDF chargé");
}

let __resizeT = null;
function wireFitWidthOnResize() {
  // (vide pour l’instant)
}

async function saveDraft() {
  if (!state.DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  if (!state.currentDraft) return;

  stampDraftMeta();

  setStatus("Sauvegarde…");

  state.currentDraft = sanitizeDraftBeforeSave(state.currentDraft);

  const payload = {
    draft_version: state.currentDraft.draft_version,
    data_json: state.currentDraft.data_json || {},
  };

  const saved = await fetchJSON(`${API_BASE}/labo/marketing-documents/${state.DOC_ID}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  state.currentDraft = saved;
  ensureDraftShape();
  setStatus(`Sauvegardé (v${saved.draft_version})`);
  return saved;
}

async function publish() {
  if (__publishing) return;
  __publishing = true;

  if (!state.DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  if (!TOKEN) throw new Error("Token absent");

  setPublishButtonsEnabled(false);
  setPublishStatus("Publication…");
  setStatus("Publication…");

  try {
    await saveDraft();

    const res = await fetch(`/api-zenhub/marketing/documents/${state.DOC_ID}/publish`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || `Erreur publication (${res.status})`;
      setPublishStatus(`❌ ${msg}`);
      throw new Error(msg);
    }

    const v = data?.version != null ? `v${data.version}` : "OK";
    setPublishStatus(`✅ Publié (${v})`);
    setStatus(`Publié (${v})`);
  } finally {
    __publishing = false;
    setPublishButtonsEnabled(true);
  }
}

// =====================================================
// Dynamic panels helpers (EAN / PRICE / STOCK)
// =====================================================
function hideAllToolPanels() {
  const ids = [
    "textToolBox",
    "richTextToolBox", // ✅ AJOUTE ÇA
    "imageToolBox",
    "dynamicCommonBox",
    "productPriceToolBox",
    "stockBadgeToolBox",
    "productEanToolBox",
    "shapeToolBox",
    "clipShapePanel",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
}


// =====================================================
// ✅ RICHTEXT (Quill modal editor) — bootstrap-only
// =====================================================
let __quillReady = false;
let __quillInstance = null;

function ensureQuillLoadedOnce() {
  // Si tu ajoutes Quill via <script> dans le template, ça passera ici direct.
  if (window.Quill) return Promise.resolve(true);

  // Sinon on tente un chargement depuis un chemin vendor (à adapter si besoin)
  // IMPORTANT: mets ces fichiers côté /static/vendor/quill/
  const jsUrl = "/static/vendor/quill/quill.min.js";
  const cssUrl = "/static/vendor/quill/quill.snow.css";

  return new Promise((resolve) => {
    // CSS
    if (!document.querySelector(`link[data-quill="1"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssUrl;
      link.dataset.quill = "1";
      document.head.appendChild(link);
    }

    // JS
    const already = document.querySelector(`script[data-quill="1"]`);
    if (already) {
      // On attend un tick, au cas où Quill est en train d’arriver
      setTimeout(() => resolve(!!window.Quill), 50);
      return;
    }

    const s = document.createElement("script");
    s.src = jsUrl;
    s.async = true;
    s.dataset.quill = "1";
    s.onload = () => resolve(!!window.Quill);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function ensureRichTextModalDOM() {
  if (document.getElementById("zhRichTextModal")) return;

  const modal = document.createElement("div");
  modal.id = "zhRichTextModal";
  modal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.45);
    display:none; align-items:center; justify-content:center;
    z-index: 99999;
  `;

  modal.innerHTML = `
    <div style="
      width:min(920px, 94vw);
      height:min(680px, 90vh);
      background:#fff;
      border-radius:14px;
      box-shadow:0 25px 80px rgba(0,0,0,.25);
      display:flex; flex-direction:column; overflow:hidden;
    ">
      <div style="
        padding:12px 14px;
        border-bottom:1px solid rgba(17,24,39,.12);
        display:flex; align-items:center; justify-content:space-between; gap:10px;
      ">
        <div style="font-weight:700;">Édition paragraphe</div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="zhRichTextCancel" class="btn btn-secondary">Annuler</button>
          <button type="button" id="zhRichTextSave" class="btn btn-primary">Valider</button>
        </div>
      </div>

      <div style="padding:10px 14px; border-bottom:1px solid rgba(17,24,39,.10);">
        <div id="zhQuillToolbar"></div>
      </div>

      <div style="flex:1; padding:0 14px 14px 14px; overflow:auto;">
        <div id="zhQuillEditor" style="height:100%;"></div>
      </div>
    </div>
  `;

  modal.addEventListener("pointerdown", (e) => {
    // clic hors “carte” => ferme
    if (e.target === modal) {
      const cancel = document.getElementById("zhRichTextCancel");
      if (cancel) cancel.click();
    }
  });

  document.body.appendChild(modal);
}

async function ensureQuillInstance() {
  if (__quillReady && __quillInstance) return __quillInstance;

  ensureRichTextModalDOM();

  const ok = await ensureQuillLoadedOnce();
  if (!ok || !window.Quill) {
    setStatus("Quill introuvable. Ajoute /static/vendor/quill/quill.min.js + quill.snow.css (ou via CDN).");
    return null;
  }

  // Crée l’instance Quill 1 fois
  const toolbarEl = document.getElementById("zhQuillToolbar");
  const editorEl = document.getElementById("zhQuillEditor");
  if (!toolbarEl || !editorEl) return null;

  // Toolbar Quill “classique” (gras, tailles, couleur, align, etc.)
  toolbarEl.innerHTML = `
    <span class="ql-formats">
      <select class="ql-font"></select>
      <select class="ql-size"></select>
    </span>
    <span class="ql-formats">
      <button class="ql-bold"></button>
      <button class="ql-italic"></button>
      <button class="ql-underline"></button>
      <button class="ql-strike"></button>
    </span>
    <span class="ql-formats">
      <select class="ql-color"></select>
      <select class="ql-background"></select>
    </span>
    <span class="ql-formats">
      <select class="ql-align"></select>
    </span>
    <span class="ql-formats">
      <button class="ql-list" value="ordered"></button>
      <button class="ql-list" value="bullet"></button>
      <button class="ql-clean"></button>
    </span>
  `;

  __quillInstance = new window.Quill(editorEl, {
    theme: "snow",
    modules: {
      toolbar: toolbarEl,
    },
  });

  __quillReady = true;
  return __quillInstance;
}

function findObjectById(pageIndex, objectId) {
  const d = state.currentDraft?.data_json || {};
  const pages = Array.isArray(d.pages) ? d.pages : [];
  const page = pages[pageIndex];
  if (!page) return null;

  // suivant tes structures : overlays ou objects (on check les deux)
  const listA = Array.isArray(page.overlays) ? page.overlays : [];
  const listB = Array.isArray(page.objects) ? page.objects : [];

  return (
    listA.find((o) => o && String(o.id) === String(objectId)) ||
    listB.find((o) => o && String(o.id) === String(objectId)) ||
    null
  );
}

async function openRichTextEditorForObject(pageIndex, objectId) {
  const q = await ensureQuillInstance();
  if (!q) return;

  const obj = findObjectById(pageIndex, objectId);
  if (!obj) return;

  const modal = document.getElementById("zhRichTextModal");
  const btnSave = document.getElementById("zhRichTextSave");
  const btnCancel = document.getElementById("zhRichTextCancel");

  if (!modal || !btnSave || !btnCancel) return;

  // charge HTML
  const html = (obj.html || "").toString().trim() || "<p></p>";
  q.root.innerHTML = html;

  const close = () => {
    modal.style.display = "none";
    document.body.style.overflow = "";
  };

  // bind one-shot
  const onCancel = () => {
    btnCancel.removeEventListener("click", onCancel);
    btnSave.removeEventListener("click", onSave);
    close();
  };

  const onSave = () => {
    const out = q.root.innerHTML;

    obj.html = out;

    // re-render overlay
    try {
      renderPageOverlay(pageIndex);
    } catch (e) {
      console.warn("[richtext] renderPageOverlay failed:", e);
    }

    btnCancel.removeEventListener("click", onCancel);
    btnSave.removeEventListener("click", onSave);
    close();
  };

  btnCancel.addEventListener("click", onCancel);
  btnSave.addEventListener("click", onSave);

  // show
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

// Crée un objet richtext dans le draft (sans dépendre de ui_tools)
// ✅ editor_bootstrap.js
import { getOrCreatePageModel } from "./draft.js?v=12";


function createRichTextObjectAt(pageIndex, x, y) {
  if (!state.currentDraft) return null;

  const pIndex = Number(pageIndex);
  const pageModel = getOrCreatePageModel(pIndex);
  if (!pageModel) return null;
  if (!Array.isArray(pageModel.objects)) pageModel.objects = [];

  const layerFrontChk = document.getElementById("layerSwitchFrontRichText");
  const layer = layerFrontChk && layerFrontChk.checked ? "front" : "back";

  const obj = {
    id: uid(),
    type: "richtext",
    x: Math.max(0, Math.round(Number(x) || 0)),
    y: Math.max(0, Math.round(Number(y) || 0)),
    w: 320,
    h: 160,
    layer,
    html: "<p>Votre paragraphe…</p>",
    text: "Votre paragraphe…",
  };

  pageModel.objects.push(obj);
  return obj;
}



function insertToolObjectAtWrapped(a, b, c, ...rest) {
  // Supporte 2 signatures :
  // A) insertToolObjectAtWrapped(e, overlay)
  // B) insertToolObjectAtWrapped(pageIndex, x, y, ...)

  const isRich = state.activeTool && state.activeTool.type === "richtext";

  // -------------------------
  // A) (e, overlayElement)
  // -------------------------
  const looksLikeOverlayEl = (x) => !!(x && typeof x === "object" && typeof x.getBoundingClientRect === "function" && x.classList);
  const looksLikeEvent = (x) => !!(x && typeof x === "object" && ("clientX" in x || "pageX" in x));

  const isSigA = looksLikeEvent(a) && looksLikeOverlayEl(b);

  if (isSigA) {
    const e = a;
    const overlay = b;

    // ✅ si pas richtext => on forward EXACTEMENT la signature d’origine
    if (!isRich) return insertToolObjectAt(e, overlay, c, ...rest);

    const pageIndex = Number(overlay?.dataset?.pageIndex ?? "0");
    if (!Number.isFinite(pageIndex)) {
      console.warn("[richtext] invalid overlay.dataset.pageIndex =", overlay?.dataset?.pageIndex);
      return insertToolObjectAt(e, overlay, c, ...rest);
    }

    const rect = overlay.getBoundingClientRect();
    const x = (Number(e.clientX) || 0) - rect.left;
    const y = (Number(e.clientY) || 0) - rect.top;

    const obj = createRichTextObjectAt(pageIndex, x, y);
    if (!obj) return;

    try { setSelected({ pageIndex, objectId: obj.id }); } catch {}

    try {
      renderPageOverlay(pageIndex);
      rerenderAllExcept(pageIndex);
    } catch (err) {
      console.warn("[richtext] render failed:", err);
    }

    try { openRichTextEditorForObject(pageIndex, obj.id); } catch (err) {
      console.warn("[richtext] open editor failed:", err);
    }

    try { setActiveTool(null); } catch {}
    return;
  }

  // -------------------------
  // B) (pageIndex, x, y, ...)
  // -------------------------
  const pageIndex = Number(a);
  const x = Number(b);
  const y = Number(c);

  if (!Number.isFinite(pageIndex)) {
    console.warn("[INSERT] invalid signature for insertToolObjectAtWrapped:", a, b, c, rest);
    return;
  }

  // ✅ richtext en signature B : ok
  if (isRich) {
    const obj = createRichTextObjectAt(pageIndex, x, y);
    if (!obj) return;

    try { setSelected({ pageIndex, objectId: obj.id }); } catch {}

    try {
      renderPageOverlay(pageIndex);
      rerenderAllExcept(pageIndex);
    } catch (err) {
      console.warn("[richtext] render failed:", err);
    }

    try { openRichTextEditorForObject(pageIndex, obj.id); } catch (err) {
      console.warn("[richtext] open editor failed:", err);
    }

    try { setActiveTool(null); } catch {}
    return;
  }

  // ✅ sinon comportement normal (signature B)
  return insertToolObjectAt(pageIndex, x, y, ...rest);
}






function showDynamicPanels(which) {
  // which: "price" | "stock" | "ean"
  const common = document.getElementById("dynamicCommonBox");
  const price = document.getElementById("productPriceToolBox");
  const stock = document.getElementById("stockBadgeToolBox");
  const ean = document.getElementById("productEanToolBox");

  if (common) common.style.display = "block";

  if (price) price.style.display = which === "price" ? "block" : "none";
  if (stock) stock.style.display = which === "stock" ? "block" : "none";
  if (ean) ean.style.display = which === "ean" ? "block" : "none";
}


function wireUI() {
  console.log("[wireUI] start");

  const btn = document.getElementById("btnAddProductEan");
  console.log("[wireUI] btnAddProductEan =", btn);

  state.btnSave = document.getElementById("btnSaveDraft");
  state.btnAddText = document.getElementById("btnAddText");
  // ✅ Paragraphe / RichText : supporte les 2 ids (au cas où)
state.btnAddParagraph =
  document.getElementById("btnAddRichText") ||
  document.getElementById("btnAddParagraph");

// ✅ Cancel richtext (ton HTML a btnCancelToolRichText)
state.btnCancelToolRichText = document.getElementById("btnCancelToolRichText");

  state.btnCancelToolText = document.getElementById("btnCancelToolText");

  state.btnAddImage = document.getElementById("btnAddImage");
  state.btnPickImage = document.getElementById("btnPickImage");
  state.btnCancelToolImage = document.getElementById("btnCancelToolImage");
  state.imageFileInput = document.getElementById("imageFileInput");
  state.imagePickedInfo = document.getElementById("imagePickedInfo");

  state.btnDeleteSelected = document.getElementById("btnDeleteSelected");

  state.textToolBox = document.getElementById("textToolBox");
  state.imageToolBox = document.getElementById("imageToolBox");
  state.dynamicCommonBox = document.getElementById("dynamicCommonBox");
  state.productPriceToolBox = document.getElementById("productPriceToolBox");
  state.stockBadgeToolBox = document.getElementById("stockBadgeToolBox");
  state.productEanToolBox = document.getElementById("productEanToolBox");

// =====================================================
// ✅ SHAPES (rect / round_rect / line)
// =====================================================
state.btnAddRect = document.getElementById("btnAddRect");
state.btnAddRoundRect = document.getElementById("btnAddRoundRect");
state.btnAddLine = document.getElementById("btnAddLine");

// (optionnel) mini panneau propriétés
state.shapeFill = document.getElementById("shapeFill");
state.shapeStroke = document.getElementById("shapeStroke");
state.shapeStrokeWidth = document.getElementById("shapeStrokeWidth");
state.shapeRadius = document.getElementById("shapeRadius");
state.shapeLayer = document.getElementById("shapeLayer"); // select: front/back
state.btnShapeApply = document.getElementById("btnShapeApply");
state.btnCenterTextInShape = document.getElementById("btnCenterTextInShape");

// ✅ Gradient UI (nouveaux champs)
state.shapeFillType = document.getElementById("shapeFillType");              // select: solid | gradient
state.shapeGradType = document.getElementById("shapeGradType");              // select: linear | radial (optionnel)
state.shapeGradAngle = document.getElementById("shapeGradAngle");            // number 0..360 (linéaire)
state.shapeGradColor1 = document.getElementById("shapeGradColor1");          // color
state.shapeGradColor2 = document.getElementById("shapeGradColor2");          // color
state.shapeGradColor3 = document.getElementById("shapeGradColor3");          // color (optionnel)
state.shapeGradPos1 = document.getElementById("shapeGradPos1");              // number 0..100
state.shapeGradPos2 = document.getElementById("shapeGradPos2");              // number 0..100
state.shapeGradPos3 = document.getElementById("shapeGradPos3");              // number 0..100 (optionnel)
state.shapeGradientBox = document.getElementById("shapeFillGradientBox");    // wrapper (optionnel)

state.btnAddClipShape = document.getElementById("btnAddClipShape");
state.clipShapePanel = document.getElementById("clipShapePanel");
state.clipShapeFileInput = document.getElementById("clipShapeFileInput");

state.btnClipPickImage = document.getElementById("btnClipPickImage");
state.btnClipCenterImage = document.getElementById("btnClipCenterImage");

state.clipZoom = document.getElementById("clipZoom");
state.clipZoomVal = document.getElementById("clipZoomVal");

state.clipRadius = document.getElementById("clipRadius");
state.clipStrokeWidth = document.getElementById("clipStrokeWidth");
state.clipStrokeColor = document.getElementById("clipStrokeColor");
state.clipFillColor = document.getElementById("clipFillColor");
state.clipLayer = document.getElementById("clipLayer");




if (state.shapeFillType && !state.shapeFillType.dataset.bound) {
  state.shapeFillType.dataset.bound = "1";
  state.shapeFillType.addEventListener("change", () => {
    _syncShapeGradientVisibility();
  });
  _syncShapeGradientVisibility();
}

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------
function showShapePanel() {
  hideAllToolPanels();
  const box = document.getElementById("shapeToolBox");
  if (box) box.style.display = "block";
}

function _clamp01(x, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function _readGradientFromUI() {
  const type = (state.shapeGradType?.value || "linear").toLowerCase() === "radial" ? "radial" : "linear";

  const angleRaw = Number(state.shapeGradAngle?.value);
  const angle = Number.isFinite(angleRaw) ? ((angleRaw % 360) + 360) % 360 : 0;

  // Couleurs (fallback safe)
  const c1 = state.shapeGradColor1?.value || "#ff0000";
  const c2 = state.shapeGradColor2?.value || "#0000ff";
  const c3 = state.shapeGradColor3?.value || "";

  // Positions en % -> pos en 0..1
  const p1 = _clamp01((state.shapeGradPos1?.value ?? 0) / 100, 0);
  const p2 = _clamp01((state.shapeGradPos2?.value ?? 100) / 100, 1);
  const p3raw = state.shapeGradPos3?.value;

  const stops = [];
  stops.push({ pos: p1, color: c1 });
  stops.push({ pos: p2, color: c2 });

  // 3e stop optionnel (si couleur présente)
  if (c3 && String(c3).trim()) {
    const p3 = _clamp01((p3raw ?? 50) / 100, 0.5);
    stops.push({ pos: p3, color: c3 });
  }

  // Tri par pos + dédoublonnage minimal
  stops.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));

  return { type, angle, stops };
}

function _syncShapeGradientVisibility() {
  const fillType = (state.shapeFillType?.value || "solid").toLowerCase();
  if (!state.shapeGradientBox) return;
  state.shapeGradientBox.style.display = fillType === "gradient" ? "block" : "none";
}


function _readShapePresetFromUI(kind) {
  // Inputs HTML color => "#rrggbb"
  const fill = state.shapeFill?.value || "#ffffff";
  const stroke = state.shapeStroke?.value || "#111827";

  const sw = Number(state.shapeStrokeWidth?.value);
  const strokeWidth = Number.isFinite(sw) ? Math.max(0, Math.min(64, sw)) : 2;

  const r = Number(state.shapeRadius?.value);
  const radius = Number.isFinite(r) ? Math.max(0, Math.min(200, r)) : 12;

  const layer = state.shapeLayer?.value === "back" ? "back" : "front";

  const fillType = (state.shapeFillType?.value || "solid").toLowerCase() === "gradient"
    ? "gradient"
    : "solid";

  const out = {
    kind,
    fillColor: fill,     // rétro-compat : toujours présent
    strokeColor: stroke,
    strokeWidth,
    radius,
    layer,
    fillType,            // ✅ nouveau
  };

  if (fillType === "gradient") {
    out.fillGradient = _readGradientFromUI(); // ✅ nouveau
  } else {
    out.fillGradient = null;
  }

  return out;
}



function _activateShape(kind) {
  showShapePanel();

  // 1) active tool preset (shapes_tools.js)
  setActiveShapeTool(kind);

  // 2) inject preset depuis UI (✅ clés compatibles : fillColor, strokeColor, strokeWidth, radius, layer)
  if (state.activeTool && state.activeTool.type === "shape") {
    const p = _readShapePresetFromUI(kind);

    // ⚠️ ne mets pas "kind" au mauvais endroit : c'est preset.kind qui est lu par shapes_tools
    state.activeTool.preset = {
      ...(state.activeTool.preset || {}),
      ...p,
      kind, // ✅ important : preset.kind
    };

    // optionnel mais safe : certains endroits lisent state.activeTool.kind
    state.activeTool.kind = kind;
  }

  // ❌ 3) SURTOUT PAS setActiveTool({ type:"shape", shape: kind });
  // => sinon tu écrases le preset et tu perds fill/stroke

  setStatus(
    kind === "line"
      ? "Clique dans la page pour ajouter une ligne"
      : kind === "round_rect"
      ? "Clique dans la page pour ajouter un rectangle arrondi"
      : "Clique dans la page pour ajouter un rectangle"
  );
}

// -----------------------------------------------------
// ✅ un seul bind par bouton (évite double listeners)
// -----------------------------------------------------
if (state.btnAddRect) {
  state.btnAddRect.addEventListener("click", () => _activateShape("rect"));
}

if (state.btnAddRoundRect) {
  state.btnAddRoundRect.addEventListener("click", () => _activateShape("round_rect"));
}

if (state.btnAddLine) {
  state.btnAddLine.addEventListener("click", () => _activateShape("line"));
}


if (state.btnAddClipShape) {
  state.btnAddClipShape.addEventListener("click", () => {
    hideAllToolPanels();
    const p = document.getElementById("shapeToolBox");
    if (p) p.style.display = "block"; // on garde le panel forme ouvert
    // active un “tool” clip-shape via le module dédié
   setToolClipShape();
  });
}


// ✅ Apply props (sur sélection)
if (state.btnShapeApply) {
  state.btnShapeApply.addEventListener("click", () => {
    const kind =
      (state.activeTool?.type === "shape" && state.activeTool?.preset?.kind) ||
      (state.selected?.kind) ||
      null;

    const p = _readShapePresetFromUI(kind || "rect");

    applyShapePropsToSelection({
	  fillType: p.fillType,
	  fillColor: p.fillColor,
	  fillGradient: p.fillType === "gradient" ? p.fillGradient : null,

	  strokeColor: p.strokeColor,
	  strokeWidth: p.strokeWidth,
	  radius: p.radius,
	  layer: p.layer,
	});

    // bonus: garde le preset pour les prochaines créations
    if (state.activeTool && state.activeTool.type === "shape") {
      state.activeTool.preset = { ...(state.activeTool.preset || {}), ...p };
    }
  });
}

// ✅ Center text inside shape (X / Y / XY) — safe bind
const centerModeSel = document.getElementById("centerTextMode");
const btnCenterTextInShapePanel = document.getElementById("btnCenterTextInShapeTextPanel");

if (btnCenterTextInShapePanel && !btnCenterTextInShapePanel.dataset.bound) {
  btnCenterTextInShapePanel.dataset.bound = "1";
  btnCenterTextInShapePanel.addEventListener("click", () => {
    const mode = centerModeSel?.value || "x";
    centerTextInsideShapeSelection(mode);
  });
}



  // ✅ EAN button
  state.btnAddProductEan = document.getElementById("btnAddProductEan");

  // ✅ dynamic cancel button
  state.btnCancelToolDynamic = document.getElementById("btnCancelToolDynamic");

  const btnPublish = document.getElementById("btnPublish");
  const btnPublishTop = document.getElementById("btnPublishTop");

  if (state.btnSave) {
    state.btnSave.addEventListener("click", () =>
      saveDraft().catch((e) => setStatus(e.message || "Erreur sauvegarde"))
    );
  }

  // ✅ Align button (si tu utilises installAlignTools, garde juste le bouton, pas besoin d'un handler ici)
  state.btnAlignVertical = document.getElementById("btnAlignVertical");

  // ⚠️ IMPORTANT:
  // - si tu as déjà installAlignTools() qui fait addEventListener sur btnAlignVertical,
  //   ne re-binde PAS ici.
  // - sinon, garde ton handler existant.
  //
  // ✅ Option safe: ne bind ici que si alignSelectedVertical existe
  if (state.btnAlignVertical && typeof alignSelectedVertical === "function" && !state.btnAlignVertical.dataset.bound) {
    state.btnAlignVertical.dataset.bound = "1";
    state.btnAlignVertical.addEventListener("click", () => {
      try {
        alignSelectedVertical();
      } catch (e) {
        console.warn(e);
        setStatus("Alignement impossible");
      }
    });
  }


  const onPublishClick = () =>
    publish().catch((e) => {
      console.error(e);
      setStatus(e.message || "Erreur publication");
    });

  if (btnPublish) btnPublish.addEventListener("click", onPublishClick);
  if (btnPublishTop) btnPublishTop.addEventListener("click", onPublishClick);

  // -----------------------------
  // TEXT TOOL
  // -----------------------------
  if (state.btnAddText) {
    state.btnAddText.addEventListener("click", () => {
      hideAllToolPanels();
      const t = document.getElementById("textToolBox");
      if (t) t.style.display = "block";
      setActiveTool({ type: "text" });
    });
  }

  if (state.btnCancelToolText) {
    state.btnCancelToolText.addEventListener("click", () => {
      setActiveTool(null);
      hideAllToolPanels();
    });
  }


  // -----------------------------
  // PARAGRAPH TOOL
  // -----------------------------
// -----------------------------
// RICHTEXT / PARAGRAPHE TOOL
// -----------------------------
if (state.btnAddParagraph && !state.btnAddParagraph.dataset.bound) {
  state.btnAddParagraph.dataset.bound = "1";
  state.btnAddParagraph.addEventListener("click", () => {
    hideAllToolPanels();

    const box = document.getElementById("richTextToolBox");
    if (box) box.style.display = "block";

    // ✅ IMPORTANT : type doit matcher ce que ton ui_tools / insertToolObjectAt gère.
    // Si ton impl s'appelle "richtext", utilise "richtext".
    // Sinon garde "paragraph" mais il faut que insertToolObjectAt le supporte.
    setActiveTool({ type: "richtext" });

    setStatus("Clique dans la page pour ajouter un paragraphe");
  });
}

// ✅ Cancel tool RichText
if (state.btnCancelToolRichText && !state.btnCancelToolRichText.dataset.bound) {
  state.btnCancelToolRichText.dataset.bound = "1";
  state.btnCancelToolRichText.addEventListener("click", () => {
    setActiveTool(null);
    hideAllToolPanels();
    setStatus("Outil annulé");
  });
}



  // -----------------------------
  // IMAGE TOOL (UI only)
  // - Pick + remove-bg est géré par image_remove_bg.js
  // -----------------------------
  if (state.btnAddImage) {
    state.btnAddImage.addEventListener("click", () => {
      hideAllToolPanels();
      const i = document.getElementById("imageToolBox");
      if (i) i.style.display = "block";

      // active "image" mode (le module gère src quand une image est pick)
      setActiveTool({ type: "image", src: null, name: null, w0: null, h0: null });

      if (state.imagePickedInfo) state.imagePickedInfo.textContent = "Aucune image sélectionnée.";
    });
  }

  if (state.btnCancelToolImage) {
    state.btnCancelToolImage.addEventListener("click", () => setActiveTool(null));
  }

  // ✅ init remove-bg tool (centralisé)
  // évite ReferenceError si import oublié
  if (typeof initImageRemoveBgTool === "function") {
    try {
      initImageRemoveBgTool();
    } catch (e) {
      console.warn("[wireUI] initImageRemoveBgTool failed:", e);
    }
  } else {
    console.warn("[wireUI] initImageRemoveBgTool is not available (missing import?)");
  }

  // -----------------------------
  // Dynamic tools
  // -----------------------------
  if (typeof bindDynamicToolsUI === "function") {
    try {
      bindDynamicToolsUI();
    } catch (e) {
      console.warn("[wireUI] bindDynamicToolsUI failed:", e);
    }
  }

  // -----------------------------
  // Delete
  // -----------------------------
  if (state.btnDeleteSelected) {
    state.btnDeleteSelected.addEventListener("click", () => deleteSelected());
  }



  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      deleteSelected();
    }
    if (e.key === "Escape") {
      setActiveTool(null);
      setSelected(null);
    }
  });

  // clic ailleurs => ferme dropdowns police
 // document.addEventListener("click", () => closeAllFontDropdowns(), { capture: true });
 
   // =====================================================
  // ✅ Dynamic tools panels (EAN)
  // =====================================================


  // Annuler outil dynamique (prix/rupture/ean)
  if (state.btnCancelToolDynamic) {
    state.btnCancelToolDynamic.addEventListener("click", () => {
      setActiveTool(null);
      hideAllToolPanels();
      setStatus("Outil annulé");
    });
  }

 
}


installAlignTools();

import { installKeyboardNudgesOnce } from "./interactions.js?v=12";


function ensureDraftMetaGrid(dataJson) {
  if (!dataJson._meta) dataJson._meta = {};
  if (!dataJson._meta.grid) dataJson._meta.grid = { ...DEFAULT_GRID };
}

function loadGridFromDraft(dataJson) {
  if (!dataJson) return;
  ensureDraftMetaGrid(dataJson);
  state.grid = { ...DEFAULT_GRID, ...dataJson._meta.grid };
}

function persistGridToDraft(dataJson) {
  if (!dataJson) return;
  ensureDraftMetaGrid(dataJson);
  dataJson._meta.grid = { ...state.grid };
}


function bindGridUI(draft) {
  const $ = (id) => document.getElementById(id);

  const enabledChk = $("gridEnabledChk");
  const snapChk = $("gridSnapChk");
  const sizeSel = $("gridSizeSel");
  const opacityInp = $("gridOpacityInp");
  const colorInp = $("gridColorInp");
  const bigSel = $("gridBigSel");
  const moveOnlyChk = $("gridSnapMoveOnlyChk");

  const syncUIFromState = () => {
    const g = getGridSettings(state);
    if (enabledChk) enabledChk.checked = !!g.enabled;
    if (snapChk) snapChk.checked = !!g.snap;
    if (sizeSel) sizeSel.value = String(g.size);
    if (opacityInp) opacityInp.value = String(g.opacity);
    if (colorInp) colorInp.value = String(g.color || "#2c3e50");
    if (bigSel) bigSel.value = g.showBig ? "1" : "0";
    if (moveOnlyChk) moveOnlyChk.checked = !!g.snapDuringMoveOnly;
  };

  const applyNow = () => {
    const g = getGridSettings(state);
    applyGridToAllOverlays(document, g);
  };

  const onChange = () => {
    const g = getGridSettings(state);

    // read UI -> state.grid
    state.grid.enabled = !!enabledChk?.checked;
    state.grid.snap = !!snapChk?.checked;
    state.grid.size = parseInt(sizeSel?.value || g.size, 10);
    state.grid.opacity = Number(opacityInp?.value ?? g.opacity);
    state.grid.color = String(colorInp?.value || g.color);
    state.grid.showBig = (bigSel?.value || "1") === "1";
    state.grid.snapDuringMoveOnly = !!moveOnlyChk?.checked;

    // persist meta
    persistGridToDraft(draft);

    // apply to overlays
    applyNow();

    // si tu as un saveDraft() debounced, appelle-le ici
    if (typeof window.saveMarketingDraft === "function") {
      window.saveMarketingDraft(); // ou ton mécanisme existant
    }
  };

  // init UI
  syncUIFromState();
  applyNow();

  // listeners
  [enabledChk, snapChk, sizeSel, opacityInp, colorInp, bigSel, moveOnlyChk].forEach((el) => {
    if (!el) return;
    el.addEventListener("change", onChange);
    el.addEventListener("input", onChange);
  });
}

function observeOverlayAdds() {
  const container = document.getElementById("pdfContainer");
  if (!container) return;

  const obs = new MutationObserver((mutations) => {
    // Si de nouvelles pages/overlays arrivent, on applique la grille
    let found = false;
    for (const m of mutations) {
      for (const n of m.addedNodes || []) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.classList?.contains("pdf-overlay") || n.querySelector?.(".pdf-overlay")) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      applyGridToAllOverlays(document, getGridSettings(state));
    }
  });

  obs.observe(container, { childList: true, subtree: true });
}





(async () => {
  try {
    state.root = document.getElementById("editorRoot");
    state.pdfContainer = document.getElementById("pdfContainer");

    if (!state.root) {
      console.error("[LABO_EDITOR] #editorRoot introuvable");
      return;
    }

    state.DOC_ID = state.root?.dataset?.docId || state.root?.getAttribute("data-doc-id") || null;
    console.log("[LABO_EDITOR] DOC_ID =", state.DOC_ID);

    const role = state.root?.dataset?.role || "LABO";
    const laboId = Number(state.root?.dataset?.laboId || 0);
    window.__ZENHUB_EDITOR_CTX__ = { role, laboId };
    console.log("[LABO_EDITOR] ctx =", window.__ZENHUB_EDITOR_CTX__);

	// =====================================================
	// ✅ Debug helpers (console) — robust across shapes
	// =====================================================
	window.__ZENHUB_STATE__ = state;
	window.__ZENHUB_DRAFT__ = () => state.currentDraft;

	// ✅ Grid helpers (debug rapide) — bon chemin: data_json._meta.grid
	window.__ZENHUB_GRID__ = () => state.grid || null;
	window.__ZENHUB_GRID_META__ = () => state.currentDraft?.data_json?._meta?.grid || null;

	window.__ZENHUB_ALL_OBJS__ = () => {
	  const d = state.currentDraft?.data_json || {};
	  const pages = Array.isArray(d.pages) ? d.pages : [];

	  const out = [];
	  for (let i = 0; i < pages.length; i++) {
		const p = pages[i] || {};
		const a = Array.isArray(p.objects) ? p.objects : [];
		const b = Array.isArray(p.overlays) ? p.overlays : [];
		for (const o of a) out.push({ pageIndex: i, obj: o, bucket: "objects" });
		for (const o of b) out.push({ pageIndex: i, obj: o, bucket: "overlays" });
	  }

	  const flatOverlays = Array.isArray(d.overlays) ? d.overlays : [];
	  for (const o of flatOverlays) out.push({ pageIndex: 0, obj: o, bucket: "data.overlays" });

	  return out;
	};

	window.__ZENHUB_LAST_OBJ__ = () => {
	  const all = window.__ZENHUB_ALL_OBJS__();
	  if (all.length) return all[all.length - 1];

	  // fallback: selected (robuste objects + overlays)
	  try {
		const sel = state.selected;
		if (sel && typeof sel.pageIndex === "number" && sel.objectId) {
		  const d = state.currentDraft?.data_json || {};
		  const p = d.pages?.[sel.pageIndex] || {};

		  const listA = Array.isArray(p.objects) ? p.objects : [];
		  const listB = Array.isArray(p.overlays) ? p.overlays : [];

		  const foundA = listA.find((o) => o && o.id === sel.objectId);
		  if (foundA) return { pageIndex: sel.pageIndex, obj: foundA, bucket: "objects" };

		  const foundB = listB.find((o) => o && o.id === sel.objectId);
		  if (foundB) return { pageIndex: sel.pageIndex, obj: foundB, bucket: "overlays" };
		}
	  } catch {}

	  return null;
	};

	window.__ZENHUB_LAST_DYNAMIC__ = () => {
	  const r = window.__ZENHUB_LAST_OBJ__();
	  return r?.obj?.dynamic || null;
	};

	if (!state.DOC_ID) {
	  setStatus("DOC_ID introuvable (data-doc-id manquant).");
	  return;
	}
	if (!TOKEN) {
	  setStatus("Token absent (localStorage 'token').");
	  return;
	}

	setPublishStatus("");
	setPublishButtonsEnabled(true);

	wireUI();
	



	installKeyboardNudgesOnce();
	wireFitWidthOnResize();

	await loadDraft();
	
	  // ✅ init grid depuis le draft + bind UI + observe nouveaux overlays
	loadGridFromDraft(state.currentDraft.data_json || {});
	bindGridUI(state.currentDraft.data_json || {});
	observeOverlayAdds();
	try { initToolSectionCollapsible(); } catch(e){ console.warn(e); }


	// ✅ Hydrate grid depuis data_json._meta.grid (si présent)
  // ✅ Hydrate grid depuis data_json._meta.grid (si présent)
	  try {
		const g = state.currentDraft?.data_json?._meta?.grid;
		state.grid = { ...DEFAULT_GRID, ...(g && typeof g === "object" ? g : {}) };
	  } catch {
		state.grid = { ...DEFAULT_GRID };
	  }


	// ✅ Fonts
// ✅ Fonts
		bindFontUploadForm();
		bindTextToolInputs();

		try {
		  bindShapeToolInputs();
		} catch (e) {
		  console.warn("[LABO_EDITOR] bindShapeToolInputs failed:", e);
		}


	// 1) charge polices LABO existantes (state.fonts)
	await refreshFonts();

	// 2) charge polices GLOBAL superuser (state.globalFonts)
	await loadGlobalFonts();

	// 3) upgrade des selects en dropdown preview
	upgradeAllFontSelects();

	// ✅ après refreshFonts() => on restampe la meta (fonts_map) avant le rendu
	stampDraftMeta();

	// ✅ Restamp meta grid (persistance) — bon chemin: data_json._meta.grid
	try {
	  if (!state.currentDraft.data_json) state.currentDraft.data_json = {};
	  if (!state.currentDraft.data_json._meta) state.currentDraft.data_json._meta = {};
	  state.currentDraft.data_json._meta.grid = {
		...(state.currentDraft.data_json._meta.grid || {}),
		...(state.grid || {}),
	  };
	} catch {}

	await loadPDF();
	try { initClipShapeUI(); } catch(e){ console.warn(e); }
	
	
	
	if (typeof window.__ZENHUB_SYNC_APPENDED_PAGES__ === "function") {
	  await window.__ZENHUB_SYNC_APPENDED_PAGES__();
	}
    // ✅ Product block UI
	try {
	  initProductBlockUI();
	} catch (e) {
	  console.warn("[LABO_EDITOR] initProductBlockUI failed:", e);
	}

	
	// ✅ expose un id pour les outils (si besoin)
	state.currentDocId = state.DOC_ID;

	// ✅ init append pages tools (persistance via ton saveDraft existant)
	try {
	  await initPageAppendTools({ useApi: false });
	} catch (e) {
	  console.warn("[LABO_EDITOR] initPageAppendTools failed:", e);
	}


	setActiveTool(null);
	setSelected(null);

  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Erreur");
  }
})();




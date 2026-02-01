// app/static/labo/editor/page_append_tools.js
import { state, setStatus, uid } from "./state.js?v=12";
import { ensureDraftShape } from "./draft.js?v=12";
import { ensurePdfJsReady } from "./pdfjs.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";
import { API_BASE, fetchJSON } from "./api.js?v=12";

/**
 * Centralise TOUTE la logique métier “append/remove pages”.
 * Source de vérité dans ton app : state.currentDraft.data_json
 * - appended_pages est stocké dans data_json.appended_pages
 * - pages[].objects[] est dans data_json.pages[pageIndex].objects
 */

function _ensureDataJson() {
  if (!state.currentDraft) state.currentDraft = { data_json: {} };
  if (!state.currentDraft.data_json) state.currentDraft.data_json = {};
  ensureDraftShape(); // garde tes invariants existants (pages etc.) si tu en as
  return state.currentDraft.data_json;
}

function _ensureAppendedArrays() {
  const dj = _ensureDataJson();
  if (!Array.isArray(dj.appended_pages)) dj.appended_pages = [];
  if (!Array.isArray(dj.pages)) dj.pages = [];
  return dj;
}

/**
 * Nombre de pages "réelles" du PDF (avant append).
 * Source fiable : state.pdfDoc (set dans editor_bootstrap.js après getDocument()).
 */
function _baseCount() {
  const n = state.pdfDoc?.numPages;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _computeTotalPages() {
  const dj = _ensureAppendedArrays();
  return _baseCount() + (dj.appended_pages?.length || 0);
}

/**
 * Taille par défaut d'une page ajoutée :
 * - on prend la dernière page réelle (format + orientation)
 * - fallback A4
 */
async function _getDefaultAppendPageSize() {
  await ensurePdfJsReady();

  const base = _baseCount();

  try {
    const pdf = state.pdfDoc;
    if (pdf && base > 0) {
      const last = await pdf.getPage(base); // PDF.js = 1-based
      const vp = last.getViewport({ scale: 1 });
      const rotate = (last.rotate ?? 0) % 360;

      return {
        width: vp.width,
        height: vp.height,
        rotate,
      };
    }
  } catch (e) {
    console.warn("[PAGE_APPEND] fallback size (cannot read last page):", e);
  }

  // fallback A4 portrait en points
  return { width: 595.28, height: 841.89, rotate: 0 };
}

function _ensurePageModelForIndex(pageIndex) {
  const dj = _ensureAppendedArrays();
  if (!dj.pages[pageIndex]) dj.pages[pageIndex] = { objects: [] };
  if (!Array.isArray(dj.pages[pageIndex].objects)) dj.pages[pageIndex].objects = [];
  return dj.pages[pageIndex];
}

function _refreshAppendUi() {
  const dj = _ensureAppendedArrays();
  const k = dj.appended_pages.length;

  const badge = document.querySelector("[data-append-pages-badge]");
  if (badge) badge.textContent = String(k);

  const btnRemove = document.querySelector("[data-btn-remove-appended-page]");
  if (btnRemove) btnRemove.disabled = k <= 0;

  const totalEl = document.querySelector("[data-pages-total]");
  if (totalEl) totalEl.textContent = String(_computeTotalPages());
}

async function _syncDomAfterChange() {
  // Hook fourni par editor_bootstrap.js (page blanche + overlay normal)
  if (typeof window.__ZENHUB_SYNC_APPENDED_PAGES__ === "function") {
    await window.__ZENHUB_SYNC_APPENDED_PAGES__();
  } else {
    // fallback : au moins rerender overlays
    rerenderAllExcept(null);
    const total = state.pdfContainer?.children?.length || _computeTotalPages();
    for (let pi = 0; pi < total; pi++) renderPageOverlay(pi);
  }
}

async function _persistDraft(useApi) {
  if (!useApi) return;

  // Mode API dédiée (optionnel). Si tu ne l'utilises pas, initPageAppendTools({useApi:false})
  if (!state.currentDocId && state.DOC_ID) state.currentDocId = state.DOC_ID;
  if (!state.currentDocId) return;

  // Dans ton app actuelle, tu utilises PUT /labo/marketing-documents/{id}/draft
  // avec {draft_version, data_json}. On réutilise ce format.
  const out = await fetchJSON(`${API_BASE}/labo/marketing-documents/${state.currentDocId}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft_version: state.currentDraft?.draft_version,
      data_json: state.currentDraft?.data_json || {},
    }),
  });

  if (out) state.currentDraft = out;
}

async function _renderAndGo(pageIndex) {
  state.pageIndex = pageIndex;
  rerenderAllExcept(null);
  await renderPageOverlay(pageIndex);
}

/**
 * PUBLIC: ajoute une page à la fin
 */
export async function appendPage({ navigate = true, useApi = true } = {}) {
  _ensureAppendedArrays();
  await ensurePdfJsReady();

  const dj = state.currentDraft.data_json;
  const size = await _getDefaultAppendPageSize();

  const newMeta = {
    id: `ap_${uid()}`,
    width: size.width,
    height: size.height,
    rotate: size.rotate || 0,
    created_at: new Date().toISOString(),
  };

  dj.appended_pages.push(newMeta);

  const base = _baseCount();
  const newPageIndex = base + dj.appended_pages.length - 1;

  // garantit dj.pages[newPageIndex].objects[]
  _ensurePageModelForIndex(newPageIndex);

  _refreshAppendUi();
  setStatus(`Page ajoutée ✅ (index ${newPageIndex})`);

  // 🔥 synchro DOM (crée le wrapper + overlay page blanche)
  await _syncDomAfterChange();

  // persiste si mode API (sinon saveDraft() le fera)
  await _persistDraft(useApi);

  if (navigate) {
    await _renderAndGo(newPageIndex);
  } else {
    rerenderAllExcept(null);
  }
}

/**
 * PUBLIC: supprime la dernière page ajoutée
 */
export async function removeLastAppendedPage({ useApi = true } = {}) {
  _ensureAppendedArrays();
  await ensurePdfJsReady();

  const dj = state.currentDraft.data_json;
  const k = dj.appended_pages.length;

  if (k <= 0) {
    setStatus("Aucune page ajoutée à supprimer");
    _refreshAppendUi();
    return;
  }

  const base = _baseCount();
  const lastPageIndex = base + k - 1;

  // 1) remove meta
  dj.appended_pages.pop();

  // 2) nettoyer les objets de la page supprimée (contrôlé)
  if (dj.pages[lastPageIndex]) {
    dj.pages[lastPageIndex].objects = [];
  }

  // 3) si on était sur la page supprimée, on revient sur la dernière page existante
  const totalAfter = _computeTotalPages();
  if (state.pageIndex >= totalAfter) {
    state.pageIndex = Math.max(0, totalAfter - 1);
  }

  _refreshAppendUi();
  setStatus("Dernière page ajoutée supprimée ✅");

  // synchro DOM (supprime wrapper si besoin)
  await _syncDomAfterChange();

  await _persistDraft(useApi);

  await _renderAndGo(state.pageIndex);
}

/**
 * PUBLIC: init hooks UI
 */
export async function initPageAppendTools({ useApi = true } = {}) {
  _ensureAppendedArrays();
  await ensurePdfJsReady();

  state.basePageCount = _baseCount();

  const btnAdd = document.querySelector("[data-btn-append-page]");
  const btnRemove = document.querySelector("[data-btn-remove-appended-page]");

  if (btnAdd) {
    btnAdd.addEventListener("click", async () => {
      try {
        await appendPage({ navigate: true, useApi });
      } catch (e) {
        console.error(e);
        setStatus("Erreur ajout page ❌");
      }
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener("click", async () => {
      try {
        await removeLastAppendedPage({ useApi });
      } catch (e) {
        console.error(e);
        setStatus("Erreur suppression page ❌");
      }
    });
  }

  _refreshAppendUi();
}

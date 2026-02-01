// app/static/labo/marketing_document_editor.js
console.log("[LABO_EDITOR] chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

const root = document.getElementById("editorRoot");
const pdfContainer = document.getElementById("pdfContainer");
const statusEl = document.getElementById("editorStatus");
const btnSave = document.getElementById("btnSaveDraft");

const btnAddText = document.getElementById("btnAddText");
const btnAddImage = document.getElementById("btnAddImage");

const textToolBox = document.getElementById("textToolBox");
const textToolValue = document.getElementById("textToolValue");
const textToolSize = document.getElementById("textToolSize");
const textToolColor = document.getElementById("textToolColor");
const textToolBold = document.getElementById("textToolBold");
const btnCancelToolText = document.getElementById("btnCancelToolText");

const imageToolBox = document.getElementById("imageToolBox");
const imageFileInput = document.getElementById("imageFileInput");
const btnPickImage = document.getElementById("btnPickImage");
const imagePickedInfo = document.getElementById("imagePickedInfo");
const btnCancelToolImage = document.getElementById("btnCancelToolImage");

const btnDeleteSelected = document.getElementById("btnDeleteSelected");

if (!root) console.error("[LABO_EDITOR] #editorRoot introuvable");
const DOC_ID = root?.dataset?.docId;

let currentDraft = null;
let currentPdfUrl = null;

let PDF_SCALE = 1.2;

// outil actif: null | {type:"text"} | {type:"image", src, name, w0, h0}
let activeTool = null;

// sélection
let selected = null; // { pageIndex, objectId }

// drag/resize state
let action = null; // {type:"drag"|"resize", pageIndex, objectId, startX, startY, baseObj, handle}
let rafPending = false;
let lastMove = null;

// anti "duplication" : bloquer le click overlay juste après un drag/resize
let suppressOverlayClickUntil = 0;
let dragHasMoved = false;

// overlays
const overlaysByPage = new Map(); // pageIndex -> overlayEl

/* ------------------ helpers ------------------ */
function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
    ...extra,
  };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  const text = !data ? await res.text().catch(() => "") : "";

  if (!res.ok) {
    if (res.status === 401) throw new Error("401 Unauthorized (token manquant/expiré).");
    throw new Error((data && (data.detail || data.message)) || text || "Erreur API");
  }
  return data ?? { ok: true };
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/* ------------------ draft helpers ------------------ */
function ensureDraftShape() {
  if (!currentDraft) return;
  if (!currentDraft.data_json || typeof currentDraft.data_json !== "object") currentDraft.data_json = {};
  if (!Array.isArray(currentDraft.data_json.pages)) currentDraft.data_json.pages = [];
}

function getOrCreatePageModel(pageIndex) {
  ensureDraftShape();
  let page = currentDraft.data_json.pages.find((p) => Number(p.page) === Number(pageIndex));
  if (!page) {
    page = { page: Number(pageIndex), objects: [] };
    currentDraft.data_json.pages.push(page);
  }
  if (!Array.isArray(page.objects)) page.objects = [];
  return page;
}

function getObject(pageIndex, objectId) {
  const page = getOrCreatePageModel(pageIndex);
  return page.objects.find((o) => o.id === objectId) || null;
}

function removeObject(pageIndex, objectId) {
  const page = getOrCreatePageModel(pageIndex);
  const idx = page.objects.findIndex((o) => o.id === objectId);
  if (idx >= 0) page.objects.splice(idx, 1);
}

/* ------------------ pdfjs ready ------------------ */
function ensurePdfJsWorker() {
  try {
    if (typeof window.pdfjsLib === "undefined") return false;
    if (!window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.js";
    }
    return true;
  } catch {
    return false;
  }
}
async function ensurePdfJsReady() {
  if (ensurePdfJsWorker()) return;
  throw new Error("pdfjsLib indisponible (pdf.min.js non chargé).");
}

/* ------------------ tool UI ------------------ */
function setActiveTool(tool) {
  activeTool = tool;

  const isText = activeTool?.type === "text";
  const isImage = activeTool?.type === "image";

  if (textToolBox) textToolBox.style.display = isText ? "block" : "none";
  if (imageToolBox) imageToolBox.style.display = isImage ? "block" : "none";

  if (pdfContainer) {
    pdfContainer.style.cursor = isText || isImage ? "crosshair" : "default";
  }

  // overlays: pointer events toujours actifs (sélection/drag/resize)
  overlaysByPage.forEach((overlay) => {
    overlay.style.pointerEvents = "auto";
  });

  if (isText) setStatus("Mode: Ajouter texte (clique dans le PDF)");
  else if (isImage) setStatus("Mode: Ajouter image (clique dans le PDF)");
  else setStatus("PDF chargé");
}

function setSelected(sel) {
  selected = sel; // null ou {pageIndex, objectId}
  if (btnDeleteSelected) btnDeleteSelected.disabled = !selected;

  if (!currentDraft) return;

  if (sel) renderPageOverlay(sel.pageIndex);
  overlaysByPage.forEach((_, pageIndex) => {
    if (!sel || pageIndex !== sel.pageIndex) renderPageOverlay(pageIndex);
  });
}

/* ------------------ overlay rendering ------------------ */
function clearOverlay(overlay) {
  overlay.querySelectorAll(".anno-object").forEach((n) => n.remove());
}

function makeObjectFrameStyles(isSelected) {
  return {
    outline: isSelected ? "2px solid #2563eb" : "1px solid rgba(17,24,39,0.12)",
    boxShadow: isSelected ? "0 10px 24px rgba(37,99,235,0.20)" : "0 4px 12px rgba(0,0,0,0.06)",
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
    el.appendChild(d);
  }
}

function renderTextObject(overlay, obj, isSelected) {
  const el = document.createElement("div");
  el.className = "anno-object anno-text";
  el.dataset.objectId = obj.id;

  el.style.position = "absolute";
  el.style.left = `${obj.x}px`;
  el.style.top = `${obj.y}px`;
  el.style.width = `${obj.w}px`;
  el.style.height = `${obj.h}px`;

  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";

  el.style.userSelect = "none";
  el.style.cursor = isSelected ? "move" : "pointer";

  el.style.fontSize = (obj.fontSize || 16) + "px";
  el.style.fontWeight = obj.fontWeight || "normal";
  el.style.color = obj.color || "#111827";

  el.style.background = "rgba(255,255,255,0.72)";
  el.style.borderRadius = "10px";
  el.style.padding = "6px 10px";
  el.style.boxSizing = "border-box";

  const frame = makeObjectFrameStyles(isSelected);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;

  el.textContent = obj.text || "";

  if (isSelected) addResizeHandles(el);

  overlay.appendChild(el);
}

function renderImageObject(overlay, obj, isSelected) {
  const el = document.createElement("div");
  el.className = "anno-object anno-image";
  el.dataset.objectId = obj.id;

  el.style.position = "absolute";
  el.style.left = `${obj.x}px`;
  el.style.top = `${obj.y}px`;
  el.style.width = `${obj.w}px`;
  el.style.height = `${obj.h}px`;
  el.style.cursor = isSelected ? "move" : "pointer";
  el.style.userSelect = "none";
  el.draggable = false;

  const frame = makeObjectFrameStyles(isSelected);
  el.style.outline = frame.outline;
  el.style.boxShadow = frame.boxShadow;
  el.style.borderRadius = "10px";
  el.style.overflow = "hidden";
  el.style.background = "rgba(255,255,255,0.72)";

  const img = document.createElement("img");
  img.alt = obj.name || "image";
  img.src = obj.src;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.draggable = false;

  el.appendChild(img);

  if (isSelected) addResizeHandles(el);

  overlay.appendChild(el);
}

function renderPageOverlay(pageIndex) {
  const overlay = overlaysByPage.get(pageIndex);
  if (!overlay) return;

  clearOverlay(overlay);

  const pageModel = getOrCreatePageModel(pageIndex);
  for (const obj of pageModel.objects) {
    const isSel = selected && selected.pageIndex === pageIndex && selected.objectId === obj.id;
    if (obj.type === "text") renderTextObject(overlay, obj, isSel);
    if (obj.type === "image") renderImageObject(overlay, obj, isSel);
  }
}

/* ------------------ interactions: select / drag / resize ------------------ */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function startAction(e, overlay, objectEl) {
  const pageIndex = Number(overlay.dataset.pageIndex || "0");
  const objectId = objectEl.dataset.objectId;
  if (!objectId) return;

  const obj = getObject(pageIndex, objectId);
  if (!obj) return;

  // sélection
  setSelected({ pageIndex, objectId });

  // init anti-dup
  dragHasMoved = false;

  // resize si poignée
  const handleEl = e.target.closest(".anno-handle");
  if (handleEl) {
    action = {
      type: "resize",
      pageIndex,
      objectId,
      handle: handleEl.dataset.handle,
      startX: e.clientX,
      startY: e.clientY,
      baseObj: { ...obj },
    };
    // capture pointer pour éviter des "mouseup" perdus
    try {
      if (e.pointerId != null && objectEl.setPointerCapture) objectEl.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
    return;
  }

  // drag (autorisé seulement si on n'est PAS en mode insertion)
  if (!activeTool) {
    action = {
      type: "drag",
      pageIndex,
      objectId,
      startX: e.clientX,
      startY: e.clientY,
      baseObj: { ...obj },
    };
    try {
      if (e.pointerId != null && objectEl.setPointerCapture) objectEl.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }
}

function applyDragResize() {
  rafPending = false;
  if (!action || !lastMove) return;

  const { clientX, clientY } = lastMove;
  const dx = clientX - action.startX;
  const dy = clientY - action.startY;

  const overlay = overlaysByPage.get(action.pageIndex);
  if (!overlay) return;

  const rect = overlay.getBoundingClientRect();
  const maxW = rect.width;
  const maxH = rect.height;

  const obj = getObject(action.pageIndex, action.objectId);
  if (!obj) return;

  if (action.type === "drag") {
    const nx = clamp(action.baseObj.x + dx, 0, maxW - obj.w);
    const ny = clamp(action.baseObj.y + dy, 0, maxH - obj.h);
    obj.x = Math.round(nx);
    obj.y = Math.round(ny);
  }

  if (action.type === "resize") {
    const b = action.baseObj;
    const minSize = 24;

    let x = b.x,
      y = b.y,
      w = b.w,
      h = b.h;

    const handle = action.handle;

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

    w = clamp(w, minSize, maxW);
    h = clamp(h, minSize, maxH);

    x = clamp(x, 0, maxW - w);
    y = clamp(y, 0, maxH - h);

    obj.x = Math.round(x);
    obj.y = Math.round(y);
    obj.w = Math.round(w);
    obj.h = Math.round(h);
  }

  renderPageOverlay(action.pageIndex);
}

function onMove(e) {
  if (!action) return;

  // détecter un vrai mouvement (anti click résiduel)
  const dx = e.clientX - action.startX;
  const dy = e.clientY - action.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragHasMoved = true;

  lastMove = { clientX: e.clientX, clientY: e.clientY };
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(applyDragResize);
}

function endAction() {
  if (action && dragHasMoved) {
    // bloque tout click overlay juste après un drag/resize (évite "duplication")
    suppressOverlayClickUntil = Date.now() + 250;
  }
  action = null;
  lastMove = null;
  dragHasMoved = false;
}

function attachOverlayHandlers(overlay) {
  // insertion outils (texte/image) sur overlay vide
  overlay.addEventListener("click", (e) => {
    // anti "click résiduel" après drag/resize
    if (Date.now() < suppressOverlayClickUntil) return;

    // si clic sur un objet -> selection gérée ailleurs
    if (e.target.closest(".anno-object")) return;
    if (!activeTool) return;
    if (!currentDraft) return;

    const rect = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left));
    const y = Math.max(0, Math.round(e.clientY - rect.top));
    const pageIndex = Number(overlay.dataset.pageIndex || "0");

    if (activeTool.type === "text") {
      const text = (textToolValue?.value || "Texte").trim() || "Texte";
      const fontSize = Math.max(8, Math.min(96, Number(textToolSize?.value || 18)));
      const color = textToolColor?.value || "#111827";
      const fontWeight = textToolBold?.checked ? "bold" : "normal";

      const w = Math.max(120, Math.min(520, Math.round(text.length * (fontSize * 0.62) + 34)));
      const h = Math.max(34, Math.round(fontSize * 1.85));

      const obj = {
        id: uid("txt"),
        type: "text",
        x: Math.max(0, x - Math.round(w / 2)),
        y: Math.max(0, y - Math.round(h / 2)),
        w,
        h,
        text,
        fontSize,
        fontWeight,
        color,
      };

      getOrCreatePageModel(pageIndex).objects.push(obj);
      setSelected({ pageIndex, objectId: obj.id });
      renderPageOverlay(pageIndex);

      // ✅ UX: après insertion, revenir en mode sélection (sinon tu restes en crosshair)
      setActiveTool(null);

      setStatus(`Texte ajouté (page ${pageIndex + 1})`);
      return;
    }

    if (activeTool.type === "image") {
      if (!activeTool.src) {
        setStatus("Choisis une image d’abord.");
        return;
      }

      const maxInit = 320;
      let w = activeTool.w0 || 240;
      let h = activeTool.h0 || 240;
      const ratio = w > 0 && h > 0 ? w / h : 1;

      if (w > maxInit) {
        w = maxInit;
        h = Math.round(w / ratio);
      }
      if (h > maxInit) {
        h = maxInit;
        w = Math.round(h * ratio);
      }

      const obj = {
        id: uid("img"),
        type: "image",
        x: Math.max(0, x - Math.round(w / 2)),
        y: Math.max(0, y - Math.round(h / 2)),
        w,
        h,
        src: activeTool.src,
        name: activeTool.name || "image",
      };

      getOrCreatePageModel(pageIndex).objects.push(obj);
      setSelected({ pageIndex, objectId: obj.id });
      renderPageOverlay(pageIndex);

      // ✅ UX: après insertion, revenir en mode sélection (évite les ajouts involontaires)
      setActiveTool(null);

      setStatus(`Image ajoutée (page ${pageIndex + 1})`);
      return;
    }
  });

  // sélection / drag / resize sur objets
  overlay.addEventListener("pointerdown", (e) => {
    const objectEl = e.target.closest(".anno-object");
    if (!objectEl) return;

    startAction(e, overlay, objectEl);
  });

  overlay.addEventListener("click", (e) => {
    const objectEl = e.target.closest(".anno-object");
    if (!objectEl) return;

    const pageIndex = Number(overlay.dataset.pageIndex || "0");
    const objectId = objectEl.dataset.objectId;
    if (objectId) setSelected({ pageIndex, objectId });
  });
}

/* ------------------ load draft/pdf ------------------ */
async function loadDraft() {
  if (!DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  setStatus("Chargement du brouillon…");

  currentDraft = await fetchJSON(`${API_BASE}/labo/marketing-documents/${DOC_ID}/draft`, { method: "GET" });
  ensureDraftShape();

  setStatus("Brouillon chargé");
}

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

async function loadPDF() {
  if (!DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  if (!pdfContainer) throw new Error("#pdfContainer introuvable");

  await ensurePdfJsReady();
  setStatus("Chargement du PDF…");

  const info = await fetchJSON(`${API_BASE}/labo/marketing-documents/${DOC_ID}/view-url`, { method: "GET" });
  if (!info?.url) throw new Error("view-url: URL PDF manquante");
  currentPdfUrl = info.url;

  const pdf = await window.pdfjsLib.getDocument({ url: currentPdfUrl }).promise;

  pdfContainer.innerHTML = "";
  overlaysByPage.clear();

  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`Rendu page ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_SCALE });

    const { wrap, canvas, overlay } = createPageWrapper(i - 1, viewport);
    const ctx = canvas.getContext("2d", { alpha: false });

    await page.render({ canvasContext: ctx, viewport }).promise;

    overlaysByPage.set(i - 1, overlay);
    attachOverlayHandlers(overlay);
    renderPageOverlay(i - 1);

    pdfContainer.appendChild(wrap);
  }

  setStatus("PDF chargé");
}

/* ------------------ save draft ------------------ */
async function saveDraft() {
  if (!DOC_ID) throw new Error("DOC_ID manquant (data-doc-id).");
  if (!currentDraft) return;

  setStatus("Sauvegarde…");

  const payload = {
    draft_version: currentDraft.draft_version,
    data_json: currentDraft.data_json || {},
  };

  const saved = await fetchJSON(`${API_BASE}/labo/marketing-documents/${DOC_ID}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  currentDraft = saved;
  ensureDraftShape();
  setStatus(`Sauvegardé (v${saved.draft_version})`);
}

/* ------------------ buttons ------------------ */
if (btnSave) {
  btnSave.addEventListener("click", async () => {
    try {
      await saveDraft();
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Erreur sauvegarde");
    }
  });
}

if (btnAddText) {
  btnAddText.addEventListener("click", () => {
    setActiveTool({ type: "text" });
  });
}
if (btnCancelToolText) {
  btnCancelToolText.addEventListener("click", () => setActiveTool(null));
}

if (btnAddImage) {
  btnAddImage.addEventListener("click", () => {
    setActiveTool({ type: "image", src: null, name: null, w0: null, h0: null });
    if (imagePickedInfo) imagePickedInfo.textContent = "Aucune image sélectionnée.";
  });
}
if (btnPickImage) {
  btnPickImage.addEventListener("click", () => imageFileInput?.click());
}
if (btnCancelToolImage) {
  btnCancelToolImage.addEventListener("click", () => setActiveTool(null));
}

if (imageFileInput) {
  imageFileInput.addEventListener("change", async () => {
    const f = imageFileInput.files?.[0];
    if (!f) return;

    const maxBytes = 1.8 * 1024 * 1024; // ~1.8MB
    if (f.size > maxBytes) {
      setStatus("Image trop lourde. Réduis-la (<= ~1.8MB) avant import.");
      imageFileInput.value = "";
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("Lecture image impossible"));
      r.readAsDataURL(f);
    });

    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = dataUrl;
    });

    activeTool = { type: "image", src: dataUrl, name: f.name, w0: dims.w, h0: dims.h };
    if (imagePickedInfo) imagePickedInfo.textContent = `Image prête: ${f.name} (${dims.w}×${dims.h})`;
    setStatus("Mode: Ajouter image (clique dans le PDF)");
  });
}

if (btnDeleteSelected) {
  btnDeleteSelected.addEventListener("click", () => {
    if (!selected) return;
    removeObject(selected.pageIndex, selected.objectId);
    const pageIndex = selected.pageIndex;
    setSelected(null);
    renderPageOverlay(pageIndex);
    setStatus("Élément supprimé");
  });
}

/* ------------------ keyboard ------------------ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (!selected) return;

    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    removeObject(selected.pageIndex, selected.objectId);
    const pageIndex = selected.pageIndex;
    setSelected(null);
    renderPageOverlay(pageIndex);
    setStatus("Élément supprimé");
  }

  if (e.key === "Escape") {
    setActiveTool(null);
    setSelected(null);
  }
});

/* ------------------ global pointer move/up ------------------ */
window.addEventListener("pointermove", onMove, { passive: true });
window.addEventListener("pointerup", endAction);
window.addEventListener("pointercancel", endAction);

/* ------------------ init ------------------ */
(async () => {
  try {
    if (!TOKEN) {
      setStatus("Token absent (localStorage 'token').");
      return;
    }
    await loadDraft();
    await loadPDF();
    setActiveTool(null);
    setSelected(null);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Erreur");
  }
})();

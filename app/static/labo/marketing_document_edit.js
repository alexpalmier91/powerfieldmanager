console.log("[LABO_MARKETING_DOC_EDIT] JS chargé");

const API_BASE = (window.__MD_EDIT__ && window.__MD_EDIT__.apiBase) || "/api-zenhub";
const DOC_ID = (window.__MD_EDIT__ && window.__MD_EDIT__.docId) || null;
const TOKEN = localStorage.getItem("token");

const $ = (sel, root = document) => root.querySelector(sel);

function setStatus(msg) {
  const el = $("#mdEditStatus");
  if (el) el.textContent = msg || "";
}

function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// -------------------------
// PDF.js minimal viewer
// -------------------------
let pdfDoc = null;
let page = null;
let zoom = 1.0;

async function renderPage() {
  if (!page) return;

  const canvas = $("#mdPdfCanvas");
  const viewportEl = $("#mdEditViewport");
  const overlay = $("#mdOverlay");
  if (!canvas || !viewportEl) return;

  const ctx = canvas.getContext("2d");

  const vp = page.getViewport({ scale: zoom });

  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);

  // Overlay = même taille que le canvas, centré comme le canvas
  if (overlay) {
    overlay.style.width = `${canvas.width}px`;
    overlay.style.height = `${canvas.height}px`;
  }

  setStatus("Rendu…");
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  setStatus("");
}

function fitWidth() {
  if (!page) return;
  const canvas = $("#mdPdfCanvas");
  const viewportEl = $("#mdEditViewport");
  if (!canvas || !viewportEl) return;

  // largeur utile (viewport - padding)
  const usable = Math.max(300, viewportEl.clientWidth - 60);

  const vp1 = page.getViewport({ scale: 1.0 });
  zoom = usable / vp1.width;
  zoom = Math.max(0.3, Math.min(3.0, zoom));
  renderPage();
}

async function init() {
  if (!DOC_ID) {
    setStatus("docId manquant");
    return;
  }
  if (!TOKEN) {
    setStatus("Token absent (localStorage 'token')");
    return;
  }
  if (!window.pdfjsLib) {
    setStatus("pdfjsLib indisponible (script PDF.js non chargé)");
    return;
  }

  // Worker (CDN)
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";
  } catch (_) {}

  setStatus("Chargement…");

  // 1) Récupère l’URL /media via API LABO (auth)
  const meta = await fetchJSON(`${API_BASE}/labo/marketing-documents/${DOC_ID}/view-url`, { method: "GET" });
  const url = meta.url;

  const openNewTab = $("#mdEditOpenNewTab");
  if (openNewTab) openNewTab.href = url;

  // 2) Charge le PDF
  pdfDoc = await pdfjsLib.getDocument(url).promise;
  page = await pdfDoc.getPage(1);

  // 3) Premier rendu (fit width)
  setStatus("");
  fitWidth();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#mdEditZoomIn")?.addEventListener("click", () => {
    zoom = Math.min(3.0, zoom + 0.15);
    renderPage();
  });
  $("#mdEditZoomOut")?.addEventListener("click", () => {
    zoom = Math.max(0.3, zoom - 0.15);
    renderPage();
  });
  $("#mdEditFitWidth")?.addEventListener("click", () => fitWidth());

  // Refit si resize
  window.addEventListener("resize", () => {
    // évite de spam sur resize continu
    clearTimeout(window.__mdFitT);
    window.__mdFitT = setTimeout(() => fitWidth(), 150);
  });

  init().catch((err) => {
    console.error(err);
    setStatus(err.message || "Erreur init PDF");
  });
});

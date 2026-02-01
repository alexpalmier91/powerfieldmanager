console.log("[AGENT_DOC_VIEW] loaded ✅");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

function parseFilenameFromContentDisposition(cd) {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(String(cd));
  const raw = m && (m[1] || m[2] || m[3]) ? (m[1] || m[2] || m[3]) : null;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.replace(/(^"|"$)/g, "").trim());
  } catch {
    return raw.replace(/(^"|"$)/g, "").trim();
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Erreur API (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function fetchBlobWithFilename(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {}
    const msg = (data && (data.detail || data.message)) || `Erreur API (${res.status})`;
    throw new Error(msg);
  }

  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || res.headers.get("content-disposition");
  const filename = parseFilenameFromContentDisposition(cd);
  return { blob, filename };
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function setStatus(msg) {
  const el = $("#agentDocViewStatus");
  if (el) el.textContent = msg || "";
}

function setModeBadge(isPublished, version) {
  const el = $("#agentDocViewMode");
  if (!el) return;
  if (isPublished) {
    el.textContent = `Publié v${version ?? "?"}`;
    el.style.background = "#ecfdf5";
    el.style.color = "#065f46";
  } else {
    el.textContent = "Source (non publié)";
    el.style.background = "#fffbeb";
    el.style.color = "#92400e";
  }
}

function setMeta(text) {
  const el = $("#agentDocMeta");
  if (el) el.textContent = text || "—";
}

function sanitizeFontFamily(f) {
  if (!f) return "";
  return String(f).replace(/["']/g, "").trim();
}

function formatEurFr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2).replace(".", ",")} €`;
  }
}

// ------------------------------
// PDF.js loader (robuste)
// ------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error(`Cannot load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs() {
  if (window.pdfjsLib && window.pdfjsLib.getDocument) return window.pdfjsLib;

  try {
    const mod = await import("/static/vendor/pdfjs/pdf.mjs");
    const lib = mod?.getDocument ? mod : mod?.pdfjsLib;
    if (lib && lib.getDocument) {
      if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.mjs";
      window.pdfjsLib = lib;
      return lib;
    }
  } catch (e) {
    console.warn("[AGENT_DOC_VIEW] pdf.mjs import failed:", e);
  }

  try {
    await loadScript("/static/vendor/pdfjs/pdf.min.js");
    if (window.pdfjsLib && window.pdfjsLib.getDocument) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.js";
      return window.pdfjsLib;
    }
  } catch (e) {
    console.warn("[AGENT_DOC_VIEW] pdf.min.js fallback failed:", e);
  }

  throw new Error("PDF.js introuvable (window.pdfjsLib).");
}

// ------------------------------
// Cache dynamique produits
// ------------------------------
const dynCache = {
  productsById: new Map(),
  tiersByProductId: new Map(),
  pendingBulk: new Set(),
};

function collectProductIdsFromDraft(draft) {
  const ids = [];
  const pages = draft?.pages || [];
  for (const page of pages) {
    const objects = page?.objects || [];
    for (const obj of objects) {
      const dyn = obj?.dynamic || null;
      const kind = dyn?.kind || null;

      if (kind === "product_price" || kind === "product_stock_badge") {
        const pid = Number(dyn.product_id ?? obj.product_id);
        if (Number.isFinite(pid) && pid > 0) ids.push(pid);
      } else if (obj.type === "product_price" || obj.type === "product_stock_badge") {
        const pid = Number(obj.product_id);
        if (Number.isFinite(pid) && pid > 0) ids.push(pid);
      }
    }
  }
  return [...new Set(ids)];
}

async function agentBulkInfo(productIds = []) {
  const ids = [...new Set(productIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  if (!ids.length) return;

  const missing = ids.filter((id) => !dynCache.productsById.has(id));
  if (!missing.length) return;

  const key = missing.slice().sort((a, b) => a - b).join(",");
  if (dynCache.pendingBulk.has(key)) return;
  dynCache.pendingBulk.add(key);

  try {
    const data = await fetchJSON(`${API_BASE}/agent/marketing/products/bulk-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_ids: missing }),
    });

    for (const p of data?.products || []) {
      if (!p?.id) continue;
      dynCache.productsById.set(Number(p.id), p);
    }

    const tiers = data?.tiers || {};
    for (const [pid, arr] of Object.entries(tiers)) {
      dynCache.tiersByProductId.set(Number(pid), Array.isArray(arr) ? arr : []);
    }
  } finally {
    dynCache.pendingBulk.delete(key);
  }
}

// ------------------------------
// Styling + render overlay
// ------------------------------
function getOverlaySize(overlay) {
  const r = overlay.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
}

function resolveRect(obj, overlayW, overlayH) {
  const hasRel =
    obj &&
    Number.isFinite(Number(obj.x_rel)) &&
    Number.isFinite(Number(obj.y_rel)) &&
    Number.isFinite(Number(obj.w_rel)) &&
    Number.isFinite(Number(obj.h_rel));

  if (hasRel) {
    return {
      x: Math.round(Number(obj.x_rel) * overlayW),
      y: Math.round(Number(obj.y_rel) * overlayH),
      w: Math.round(Number(obj.w_rel) * overlayW),
      h: Math.round(Number(obj.h_rel) * overlayH),
    };
  }

  return {
    x: Math.round(Number(obj.x || 0)),
    y: Math.round(Number(obj.y || 0)),
    w: Math.round(Number(obj.w || 0)),
    h: Math.round(Number(obj.h || 0)),
  };
}

function resolveFontFamily(obj) {
  const fam = sanitizeFontFamily(obj?.fontFamily || "");
  if (fam && /^LABO_FONT_\d+$/i.test(fam)) {
    return "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  }
  return fam || "system-ui, -apple-system, Segoe UI, Roboto, Arial";
}

function applyTextBoxStyle(el, obj) {
  el.style.fontSize = (obj.fontSize || 16) + "px";
  el.style.fontWeight = obj.fontWeight || "400";
  el.style.color = obj.color || "#111827";
  el.style.fontFamily = resolveFontFamily(obj);

  const bgMode = String(obj.bgMode || "").trim();
  if (obj.bgEnabled === false || bgMode === "transparent") el.style.background = "transparent";
  else if (bgMode === "color") el.style.background = obj.bgColor || "#ffffff";
  else el.style.background = obj.bgColor || "rgba(255,255,255,0.72)";

  if (obj.borderEnabled) {
    const bw = Number.isFinite(Number(obj.borderWidth)) ? Math.max(0, Math.min(12, Number(obj.borderWidth))) : 1;
    const bc = obj.borderColor || "#111827";
    el.style.border = `${bw}px solid ${bc}`;
  } else {
    el.style.border = "none";
  }

  el.style.borderRadius = "10px";
  el.style.padding = "6px 10px";
  el.style.boxSizing = "border-box";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.userSelect = "none";
  el.style.whiteSpace = "nowrap";
}

function placeBox(el, overlay, obj) {
  const { w: ow, h: oh } = getOverlaySize(overlay);
  const r = resolveRect(obj, ow, oh);
  el.style.position = "absolute";
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function renderStaticText(overlay, obj) {
  const el = document.createElement("div");
  el.className = "anno-object anno-text";
  placeBox(el, overlay, obj);
  el.textContent = obj.text || "";
  applyTextBoxStyle(el, obj);
  overlay.appendChild(el);
}

function renderImage(overlay, obj) {
  const el = document.createElement("div");
  el.className = "anno-object anno-image";
  placeBox(el, overlay, obj);
  el.style.borderRadius = "10px";
  el.style.overflow = "hidden";
  el.style.background = "rgba(255,255,255,0.72)";

  const img = document.createElement("img");
  img.src = obj.src;
  img.alt = obj.name || "image";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.draggable = false;

  el.appendChild(img);
  overlay.appendChild(el);
}

function renderDynamicPrice(overlay, obj, dyn) {
  const pid = Number(dyn?.product_id ?? obj.product_id);
  const priceMode = String(dyn?.price_mode ?? obj.price_mode ?? "base");
  const tierId = (dyn?.tier_id ?? obj.tier_id) != null ? Number(dyn?.tier_id ?? obj.tier_id) : null;

  const r = resolveRect(obj, overlay.clientWidth, overlay.clientHeight);

  const el = document.createElement("div");
  el.className = "anno-object anno-text anno-product-price";
  el.style.position = "absolute";
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
  applyTextBoxStyle(el, obj);

  const cached = dynCache.productsById.get(pid) || null;

  let priceValue = null;
  if (priceMode === "tier" && tierId) {
    const tiers = dynCache.tiersByProductId.get(pid) || [];
    const t = tiers.find((x) => Number(x.id) === tierId) || null;
    if (t && t.price_ht != null) priceValue = t.price_ht;
  } else if (cached && cached.price_ht != null) {
    priceValue = cached.price_ht;
  }

  el.textContent = priceValue != null ? formatEurFr(priceValue) : "…";
  overlay.appendChild(el);
}

function renderDynamicStock(overlay, obj, dyn) {
  const pid = Number(dyn?.product_id ?? obj.product_id);
  const text = String(dyn?.text ?? obj.text ?? "Rupture de stock");
  const modeAgent = String(dyn?.mode_agent ?? obj.mode_agent ?? "only_if_zero");

  const cached = dynCache.productsById.get(pid) || null;
  if (!cached) {
    const r = resolveRect(obj, overlay.clientWidth, overlay.clientHeight);
    const el = document.createElement("div");
    el.className = "anno-object anno-text anno-stock-badge";
    el.style.position = "absolute";
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.textContent = "…";
    applyTextBoxStyle(el, obj);
    overlay.appendChild(el);
    return;
  }

  const stock = Number(cached.stock ?? 0);
  const isZero = Number.isFinite(stock) ? stock <= 0 : true;

  if (modeAgent !== "always" && !isZero) return;

  const r = resolveRect(obj, overlay.clientWidth, overlay.clientHeight);
  const el = document.createElement("div");
  el.className = "anno-object anno-text anno-stock-badge";
  el.style.position = "absolute";
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
  el.textContent = text;
  applyTextBoxStyle(el, obj);
  overlay.appendChild(el);
}


function renderPageOverlay(overlay, pageObjects) {
  overlay.innerHTML = "";
  for (const obj of pageObjects || []) {
    if (!obj) continue;

    if (obj.type === "image") {
      renderImage(overlay, obj);
      continue;
    }

    if (obj.type === "text") {
      const dyn = obj.dynamic || null;
      const kind = dyn?.kind || null;

      if (kind === "product_price") {
        renderDynamicPrice(overlay, obj, dyn);
        continue;
      }
      if (kind === "product_stock_badge") {
        renderDynamicStock(overlay, obj, dyn);
        continue;
      }

      renderStaticText(overlay, obj);
      continue;
    }

    // compat anciens types directs
    if (obj.type === "product_price") {
      renderDynamicPrice(overlay, obj, obj);
      continue;
    }
    if (obj.type === "product_stock_badge") {
      renderDynamicStock(overlay, obj, obj);
      continue;
    }
  }
}

// ------------------------------
// Scale
// ------------------------------
function getDraftScaleHint(draft) {
  const s = Number(draft?._meta?.pdf_scale);
  return Number.isFinite(s) && s > 0 ? s : null;
}

function computeFitWidthScale(page, containerEl, paddingPx = 24) {
  const base = page.getViewport({ scale: 1 });
  const containerWidth = containerEl?.clientWidth || 900;
  const usable = Math.max(320, containerWidth - paddingPx);
  const s = usable / base.width;
  return Math.max(0.6, Math.min(2.6, s));
}

// ------------------------------
// Download PDF rendu (backend)
// ------------------------------
async function downloadRenderedPdf() {
  const docId = Number(window.__AGENT_DOC_ID__ || 0);
  if (!docId) throw new Error("doc_id manquant");

  setStatus("Génération du PDF final…");

  const { blob, filename } = await fetchBlobWithFilename(
    `${API_BASE}/agent/marketing-documents/${docId}/download-rendered`,
    { method: "GET", cache: "no-store" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `document_${docId}_final.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus("✅ PDF final téléchargé");
}

// ------------------------------
// Main render
// ------------------------------
async function renderDoc({ forceReload = false } = {}) {
  const docId = Number(window.__AGENT_DOC_ID__ || 0);
  if (!docId) {
    setStatus("doc_id manquant");
    return;
  }

  setStatus("Chargement du document…");

  const [view, draftRes] = await Promise.all([
    fetchJSON(`${API_BASE}/agent/marketing-documents/${docId}/view-url`, {
      method: "GET",
      cache: forceReload ? "reload" : "default",
    }),
    fetchJSON(`${API_BASE}/agent/marketing-documents/${docId}/draft`, {
      method: "GET",
      cache: forceReload ? "reload" : "default",
    }),
  ]);

  const pdfUrl = view?.url;
  const draft = draftRes?.draft || { pages: [] };

  if (!pdfUrl) {
    setStatus("URL PDF introuvable");
    return;
  }

  const openPdf = $("#agentDocOpenPdf");
  if (openPdf) openPdf.href = pdfUrl;

  setModeBadge(!!view?.is_published, view?.published_version);

  const pids = collectProductIdsFromDraft(draft);
  if (pids.length) {
    setStatus("Chargement des données produits…");
    await agentBulkInfo(pids);
  }

  setMeta(`Objets dynamiques: ${pids.length} produit(s) • PDF: ${view?.is_published ? "publié" : "source"}`);

  setStatus("Chargement PDF…");
  const pdfjsLib = await ensurePdfJs();

  const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;

  const root = $("#pdfViewerRoot");
  if (!root) throw new Error("Root viewer introuvable");
  root.innerHTML = "";

  const page1 = await pdf.getPage(1);
  const scaleHint = getDraftScaleHint(draft);
  const scale = scaleHint || computeFitWidthScale(page1, root, 32);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pageIndex = pageNum - 1;
    const page = pageNum === 1 ? page1 : await pdf.getPage(pageNum);

    const viewport = page.getViewport({ scale });

    const pageWrap = document.createElement("div");
    pageWrap.style.position = "relative";
    pageWrap.style.margin = "0 auto 14px auto";
    pageWrap.style.background = "#fff";
    pageWrap.style.borderRadius = "12px";
    pageWrap.style.boxShadow = "0 10px 26px rgba(0,0,0,0.08)";
    pageWrap.style.width = `${Math.ceil(viewport.width)}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.display = "block";
    canvas.style.borderRadius = "12px";

    const ctx2d = canvas.getContext("2d");
    await page.render({ canvasContext: ctx2d, viewport }).promise;

    const overlay = document.createElement("div");
    overlay.className = "pdf-overlay";
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = `${canvas.width}px`;
    overlay.style.height = `${canvas.height}px`;
    overlay.style.pointerEvents = "none";

    pageWrap.appendChild(canvas);
    pageWrap.appendChild(overlay);
    root.appendChild(pageWrap);

    const pageModel = draft.pages && draft.pages[pageIndex] ? draft.pages[pageIndex] : { objects: [] };
    renderPageOverlay(overlay, pageModel.objects || []);
  }

  setStatus(`OK — ${pdf.numPages} page(s) • scale=${scaleHint ? "LABO" : "FIT"} (${scale.toFixed(3)})`);
}

function wireUi() {
  const btnReload = $("#agentDocReloadBtn");
  if (btnReload) {
    btnReload.addEventListener("click", (e) => {
      e.preventDefault();
      dynCache.productsById.clear();
      dynCache.tiersByProductId.clear();
      setStatus("Rechargement…");
      renderDoc({ forceReload: true }).catch((err) => {
        console.error(err);
        setStatus(`Erreur: ${err?.message || err}`);
      });
    });
  }

  // ✅ Bouton principal: backend vectoriel
  const btnRendered = $("#agentDocDownloadRenderedBtn");
  if (btnRendered) {
    btnRendered.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btnRendered.dataset.loading === "1") return;
      btnRendered.dataset.loading = "1";

      const prevText = btnRendered.textContent;
      btnRendered.textContent = "Génération…";
      btnRendered.style.pointerEvents = "none";
      btnRendered.style.opacity = "0.7";

      try {
        await downloadRenderedPdf();
      } catch (err) {
        console.error(err);
        setStatus(`Erreur téléchargement: ${err?.message || err}`);
      } finally {
        btnRendered.dataset.loading = "0";
        btnRendered.textContent = prevText || "Télécharger PDF final";
        btnRendered.style.pointerEvents = "";
        btnRendered.style.opacity = "";
      }
    });
  }

  // Fallback: si tu ne l’utilises plus, on le neutralise pour éviter confusion
  const btnFallback = $("#agentDocDownloadBtn");
  if (btnFallback) {
    btnFallback.addEventListener("click", (e) => {
      e.preventDefault();
      setStatus("Le téléchargement fallback est désactivé (utilise “Télécharger PDF final”).");
    });
  }
}

function main() {
  wireUi();
  renderDoc().catch((e) => {
    console.error(e);
    setStatus(`Erreur: ${e.message || e}`);
  });
}

main();

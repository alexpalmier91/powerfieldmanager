// app/static/agent/marketing_documents.js
console.log("[AGENT_MARKETING_DOCS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

const $ = (sel, root = document) => root.querySelector(sel);

function setStatus(msg) {
  const el = $("#agentMarketingDocsStatus");
  if (el) el.textContent = msg || "";
}

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

  const ct = res.headers.get("content-type") || "";
  const status = res.status;

  let bodyText = "";
  let data = null;

  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    bodyText = await res.text().catch(() => "");
  }

  console.log("[fetchJSON]", { url, status, ct, hasToken: !!TOKEN });

  if (!res.ok) {
    if (status === 401) throw new Error("401 Unauthorized (token manquant/expiré).");

    if (data) {
      const msg = data.detail || data.message || `HTTP ${status}`;
      throw new Error(msg);
    }

    const short = (bodyText || "").slice(0, 200);
    throw new Error(`HTTP ${status} sur ${url} (non-JSON): ${short}`);
  }

  if (!data && bodyText) return { ok: true, raw: bodyText.slice(0, 200) };
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

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getViewerBase() {
  const tbody = $("#agentMarketingDocsTbody");
  const base = tbody?.dataset?.viewBase || "/agent/marketing-documents";
  return String(base || "/agent/marketing-documents").replace(/\/+$/, "");
}

function getViewerUrl(docId) {
  // ✅ viewer dashboard (overlays)
  return `${getViewerBase()}/${encodeURIComponent(String(docId))}/view`;
}

async function downloadRenderedPdfByDocId(docId) {
  if (!docId) throw new Error("docId manquant");
  setStatus("Génération du PDF final…");

  const { blob, filename } = await fetchBlobWithFilename(
    `${API_BASE}/agent/marketing-documents/${encodeURIComponent(String(docId))}/download-rendered`,
    { method: "GET", cache: "no-store" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `document_${docId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus("✅ PDF final téléchargé");
}

// ----------------------
// Viewer (modal iframe)
// ----------------------
function ensureViewer() {
  let modal = $("#agentPdfViewerModal");
  if (modal) return modal;

  const html = `
  <div id="agentPdfViewerModal"
       style="position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:none; padding:24px;">
    <div style="background:#fff; border-radius:12px; height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e7eb;">
        <div>
          <div id="agentPdfViewerTitle" style="font-weight:700;"></div>
          <div id="agentPdfViewerMeta" style="color:#6b7280; font-size:13px;"></div>
        </div>
        <div style="display:flex; gap:8px;">
          <a id="agentPdfViewerOpenNewTab" class="btn btn-secondary" target="_blank" rel="noopener">Ouvrir</a>
          <button id="agentPdfViewerClose" class="btn btn-danger" type="button">Fermer</button>
        </div>
      </div>

      <div style="position:relative; flex:1; min-height:0;">
        <div id="agentPdfViewerSplash"
             style="position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:#f9fafb; z-index:2; padding:16px;">
          <div style="max-width:860px; width:100%; display:flex; flex-direction:column; gap:12px; align-items:center;">
            <div id="agentPdfViewerLoader"
                 style="display:flex; align-items:center; gap:10px; color:#374151;">
              <span style="display:inline-block; width:18px; height:18px; border:2px solid #cbd5e1; border-top-color:#111827; border-radius:50%; animation:spin 0.8s linear infinite;"></span>
              <span>Chargement du document…</span>
            </div>
            <img id="agentPdfViewerThumb"
                 alt="Aperçu"
                 style="max-height:70vh; width:auto; border:1px solid #e5e7eb; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.08); display:none;" />
            <div id="agentPdfViewerHint" style="color:#6b7280; font-size:13px; text-align:center;"></div>
          </div>
        </div>

        <iframe id="agentPdfViewerIframe" style="position:absolute; inset:0; width:100%; height:100%; border:0; z-index:1;" src="about:blank"></iframe>
      </div>
    </div>
  </div>

  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  `;

  document.body.insertAdjacentHTML("beforeend", html);

  modal = $("#agentPdfViewerModal");
  $("#agentPdfViewerClose").addEventListener("click", () => closeViewer());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeViewer();
  });

  const iframe = $("#agentPdfViewerIframe");
  iframe.addEventListener("load", () => {
    const splash = $("#agentPdfViewerSplash");
    if (splash) splash.style.display = "none";
  });

  return modal;
}

function closeViewer() {
  const modal = $("#agentPdfViewerModal");
  const iframe = $("#agentPdfViewerIframe");
  const splash = $("#agentPdfViewerSplash");
  const img = $("#agentPdfViewerThumb");

  if (iframe) iframe.src = "about:blank";
  if (img) {
    img.removeAttribute("src");
    img.style.display = "none";
  }
  if (splash) splash.style.display = "none";
  if (modal) modal.style.display = "none";
}

async function openViewer(doc) {
  ensureViewer();

  const modal = $("#agentPdfViewerModal");
  const splash = $("#agentPdfViewerSplash");
  const img = $("#agentPdfViewerThumb");
  const hint = $("#agentPdfViewerHint");
  const iframe = $("#agentPdfViewerIframe");
  const btnOpen = $("#agentPdfViewerOpenNewTab");

  if (splash) splash.style.display = "flex";
  if (iframe) iframe.src = "about:blank";

  $("#agentPdfViewerTitle").textContent = doc.title || "Document";

  const pubTxt = doc.has_published
    ? `Publié v${doc.published_version || "?"}`
    : "Brouillon (non publié)";

  $("#agentPdfViewerMeta").textContent = `${doc.doc_type || ""} • ${fmtDate(doc.created_at)} • ${pubTxt}`.trim();

  // ✅ thumb signé prioritaire (sinon thumb_url)
  const thumbUrl = doc.thumb_signed_url || doc.thumb_url || null;

  if (img) {
    if (thumbUrl) {
      img.src = thumbUrl;
      img.style.display = "block";
      if (hint) hint.textContent = "Aperçu instantané pendant l'ouverture du document.";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      if (hint) hint.textContent = "";
    }
  }

  const baseViewerUrl = getViewerUrl(doc.id);
  const viewerUrl = `${baseViewerUrl}?t=${Date.now()}`;

  if (btnOpen) btnOpen.setAttribute("href", viewerUrl);

  if (modal) modal.style.display = "block";
  if (iframe) iframe.src = viewerUrl;
}

// ----------------------
// Table rendering
// ----------------------
function badgePublished(d) {
  if (d?.has_published) {
    const v = d.published_version != null ? `v${d.published_version}` : "Publié";
    const at = d.published_at ? ` • ${escapeHtml(fmtDate(d.published_at))}` : "";
    return `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; background:#ecfdf5; color:#065f46; font-size:12px; border:1px solid #a7f3d0;">
      ✅ ${escapeHtml(v)}${at}
    </span>`;
  }
  return `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; background:#fff7ed; color:#9a3412; font-size:12px; border:1px solid #fed7aa;">
    ⏳ Brouillon
  </span>`;
}

function renderRows(docs) {
  const tbody = $("#agentMarketingDocsTbody");
  if (!tbody) return;

  if (!docs || docs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#6b7280;">Aucun document.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs
    .map((d) => {
      const title = escapeHtml(d.title);
      const docType = escapeHtml(d.doc_type || "");
      const comment = escapeHtml(d.comment || "");
      const created = escapeHtml(fmtDate(d.created_at));

      // ✅ thumb signé prioritaire
      const thumbUrl = d.thumb_signed_url || d.thumb_url || null;

      const thumb = thumbUrl
        ? `<img src="${escapeHtml(thumbUrl)}" alt="thumb"
                style="width:90px; height:auto; border-radius:8px; border:1px solid #e5e7eb; display:block;" />`
        : `<div style="width:90px; height:120px; border-radius:8px; border:1px dashed #cbd5e1; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px;">—</div>`;

      return `
        <tr data-id="${d.id}">
          <td style="width:120px;">${thumb}</td>
          <td><strong>${title}</strong></td>
          <td style="width:160px;">${docType}</td>
          <td style="max-width:420px;">${comment}</td>
          <td style="width:180px;">${created}</td>
          <td style="width:160px;">${badgePublished(d)}</td>
          <td style="width:240px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn btn-primary js-view-doc" type="button">Lire</button>
              <a class="btn btn-secondary js-open-doc" target="_blank" rel="noopener" href="${escapeHtml(
                getViewerUrl(d.id)
              )}?t=${Date.now()}">Ouvrir</a>
              <button class="btn js-download-final" type="button">Télécharger PDF final</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadDocs(laboId) {
  const docs = await fetchJSON(`${API_BASE}/agent/labos/${laboId}/marketing-documents`, { method: "GET" });
  renderRows(docs);
  return docs;
}

function renderLabosOptions(labos, selectedId = null) {
  const select = $("#agentMarketingDocsLaboSelect");
  if (!select) return;

  select.innerHTML = labos
    .map((l) => {
      const sel = selectedId && Number(l.id) === Number(selectedId) ? "selected" : "";
      return `<option value="${l.id}" ${sel}>${escapeHtml(l.name)}</option>`;
    })
    .join("");

  select.disabled = false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const select = $("#agentMarketingDocsLaboSelect");

  console.log("[AGENT_MARKETING_DOCS] TOKEN ?", !!TOKEN, TOKEN ? `(len=${TOKEN.length})` : "");

  if (!TOKEN) {
    setStatus("Token absent dans localStorage (clé: 'token').");
    return;
  }

  let currentDocs = [];
  let labos = [];

  try {
    setStatus("Chargement des labos…");
    labos = await fetchJSON(`${API_BASE}/agent/marketing-documents/labos`, { method: "GET" });

    if (!Array.isArray(labos) || labos.length === 0) {
      setStatus("Aucun labo accessible.");
      renderRows([]);
      if (select) select.disabled = true;
      return;
    }

    const selected = labos[0].id;
    renderLabosOptions(labos, selected);

    setStatus("Chargement…");
    currentDocs = await loadDocs(selected);
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Erreur chargement labos");
    return;
  }

  if (select) {
    select.addEventListener("change", async () => {
      const laboId = Number(select.value);
      try {
        setStatus("Chargement…");
        currentDocs = await loadDocs(laboId);
        setStatus("");
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Erreur");
      }
    });
  }

  document.addEventListener("click", async (e) => {
    // Lire (modal)
    const btnView = e.target.closest(".js-view-doc");
    if (btnView) {
      const tr = btnView.closest("tr[data-id]");
      const docId = tr ? Number(tr.getAttribute("data-id")) : null;
      if (!docId) return;

      const doc = currentDocs.find((x) => Number(x.id) === docId);
      if (!doc) return;

      try {
        await openViewer(doc);
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Erreur lecture");
      }
      return;
    }

    // Télécharger PDF final (backend)
    const btnDl = e.target.closest(".js-download-final");
    if (btnDl) {
      const tr = btnDl.closest("tr[data-id]");
      const docId = tr ? Number(tr.getAttribute("data-id")) : null;
      if (!docId) return;

      if (btnDl.dataset.loading === "1") return;
      btnDl.dataset.loading = "1";

      const prevText = btnDl.textContent;
      btnDl.textContent = "Génération…";
      btnDl.style.pointerEvents = "none";
      btnDl.style.opacity = "0.7";

      try {
        await downloadRenderedPdfByDocId(docId);
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Erreur téléchargement");
      } finally {
        btnDl.dataset.loading = "0";
        btnDl.textContent = prevText || "Télécharger PDF final";
        btnDl.style.pointerEvents = "";
        btnDl.style.opacity = "";
      }
    }
  });
});

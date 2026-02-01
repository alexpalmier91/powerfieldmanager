// app/static/labo/marketing_documents.js
console.log("[LABO_MARKETING_DOCS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

function setFeedback(msg, ok = false) {
  const el = document.querySelector("#marketingDocsFeedback");
  if (!el) return;
  el.style.color = ok ? "#065f46" : "#b91c1c";
  el.textContent = msg || "";
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  const ct = res.headers.get("content-type") || "";
  let data = null;
  let bodyText = "";

  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    bodyText = await res.text().catch(() => "");
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error("401 Unauthorized (token manquant/expiré).");
    const msg = (data && (data.detail || data.message)) || bodyText || "Erreur API";
    throw new Error(msg);
  }

  return data ?? { ok: true };
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

// ----------------------
// Viewer (modal iframe)
// ----------------------
function ensureViewer() {
  let modal = document.querySelector("#laboPdfViewerModal");
  if (modal) return modal;

  const html = `
  <div id="laboPdfViewerModal"
       style="position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:none; padding:24px;">
    <div style="background:#fff; border-radius:12px; height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e7eb;">
        <div>
          <div id="laboPdfViewerTitle" style="font-weight:700;"></div>
          <div id="laboPdfViewerMeta" style="color:#6b7280; font-size:13px;"></div>
        </div>
        <div style="display:flex; gap:8px;">
          <a id="laboPdfViewerOpenNewTab" class="btn btn-secondary" target="_blank" rel="noopener">Ouvrir</a>
          <button id="laboPdfViewerClose" class="btn btn-danger" type="button">Fermer</button>
        </div>
      </div>

      <div style="position:relative; flex:1; min-height:0;">
        <div id="laboPdfViewerSplash"
             style="position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:#f9fafb; z-index:2; padding:16px;">
          <div style="max-width:860px; width:100%; display:flex; flex-direction:column; gap:12px; align-items:center;">
            <div id="laboPdfViewerLoader"
                 style="display:flex; align-items:center; gap:10px; color:#374151;">
              <span style="display:inline-block; width:18px; height:18px; border:2px solid #cbd5e1; border-top-color:#111827; border-radius:50%; animation:spin 0.8s linear infinite;"></span>
              <span>Chargement du document…</span>
            </div>
            <img id="laboPdfViewerThumb"
                 alt="Aperçu"
                 style="max-height:70vh; width:auto; border:1px solid #e5e7eb; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.08); display:none;" />
            <div id="laboPdfViewerHint" style="color:#6b7280; font-size:13px; text-align:center;"></div>
          </div>
        </div>

        <iframe id="laboPdfViewerIframe" style="position:absolute; inset:0; width:100%; height:100%; border:0; z-index:1;" src="about:blank"></iframe>
      </div>
    </div>
  </div>

  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  modal = document.querySelector("#laboPdfViewerModal");

  document.querySelector("#laboPdfViewerClose")?.addEventListener("click", () => closeViewer());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeViewer();
  });

  const iframe = document.querySelector("#laboPdfViewerIframe");
  iframe?.addEventListener("load", () => {
    const splash = document.querySelector("#laboPdfViewerSplash");
    if (splash) splash.style.display = "none";
  });

  return modal;
}

function closeViewer() {
  const modal = document.querySelector("#laboPdfViewerModal");
  const iframe = document.querySelector("#laboPdfViewerIframe");
  const splash = document.querySelector("#laboPdfViewerSplash");
  const img = document.querySelector("#laboPdfViewerThumb");

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

  const splash = document.querySelector("#laboPdfViewerSplash");
  const img = document.querySelector("#laboPdfViewerThumb");
  const hint = document.querySelector("#laboPdfViewerHint");

  if (splash) splash.style.display = "flex";

  const titleEl = document.querySelector("#laboPdfViewerTitle");
  const metaEl = document.querySelector("#laboPdfViewerMeta");
  if (titleEl) titleEl.textContent = doc.title || "Document";
  if (metaEl) metaEl.textContent = `${doc.doc_type || ""} • ${fmtDate(doc.created_at)}`.trim();

  if (img) {
    if (doc.thumb_url) {
      img.src = doc.thumb_url;
      img.style.display = "block";
      if (hint) hint.textContent = "Aperçu instantané (page 1) pendant l'ouverture du PDF.";
    } else {
      img.style.display = "none";
      if (hint) hint.textContent = "";
    }
  }

  // Viewer = PDF source (car download-rendered force 'attachment')
  const url = doc.pdf_url
    ? doc.pdf_url
    : (await fetchJSON(`${API_BASE}/labo/marketing-documents/${doc.id}/view-url`, { method: "GET" })).url;

  const openNewTab = document.querySelector("#laboPdfViewerOpenNewTab");
  if (openNewTab) openNewTab.setAttribute("href", url);

  const iframe = document.querySelector("#laboPdfViewerIframe");
  if (iframe) iframe.src = url;

  const modal = document.querySelector("#laboPdfViewerModal");
  if (modal) modal.style.display = "block";
}

// ----------------------
// Table rendering
// ----------------------
function renderRows(docs) {
  const tbody = document.querySelector("#marketingDocsTbody");
  if (!tbody) return;

  if (!docs || docs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#6b7280;">Aucun document.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs
    .map((d) => {
      const title = escapeHtml(d.title);
      const docType = escapeHtml(d.doc_type || "");
      const comment = escapeHtml(d.comment || "");
      const created = escapeHtml(fmtDate(d.created_at));

      const thumb = d.thumb_url
        ? `<img src="${escapeHtml(d.thumb_url)}" alt="thumb"
                style="width:90px; height:auto; border-radius:8px; border:1px solid #e5e7eb; display:block;" />`
        : `<div style="width:90px; height:120px; border-radius:8px; border:1px dashed #cbd5e1; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px;">—</div>`;

      const downloadSourceHref = d.pdf_url
        ? escapeHtml(d.pdf_url)
        : `${API_BASE}/labo/marketing-documents/${d.id}/download`;

      const downloadRenderedHref = `${API_BASE}/labo/marketing-documents/${d.id}/download-rendered`;

      // ✅ URL page HTML éditeur (pas l’API)
      const editHref = `/labo/marketing-documents/${encodeURIComponent(d.id)}/edit`;

      return `
        <tr data-id="${d.id}">
          <td style="width:120px;">${thumb}</td>
          <td><strong>${title}</strong></td>
          <td style="width:160px;">${docType}</td>
          <td style="max-width:420px;">${comment}</td>
          <td style="width:180px;">${created}</td>
          <td style="width:360px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-primary js-view-marketing-doc" type="button">Lire</button>
            <a class="btn btn-primary js-edit-marketing-doc" href="${editHref}">Éditer</a>

			<button class="btn btn-secondary js-download-rendered" type="button" data-id="${d.id}">
			  Télécharger rendu
			</button>


            <a class="btn btn-secondary" href="${downloadSourceHref}" target="_blank" rel="noopener">
              Télécharger source
            </a>

            <button class="btn btn-danger js-delete-marketing-doc" type="button">Supprimer</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

let currentDocs = [];

async function loadDocs() {
  const docs = await fetchJSON(`${API_BASE}/labo/marketing-documents`, { method: "GET" });
  currentDocs = Array.isArray(docs) ? docs : [];
  renderRows(currentDocs);
}

function setUploadLoading(isLoading) {
  const form = document.querySelector("#marketingDocUploadForm");
  if (!form) return;

  const btn = form.querySelector('button[type="submit"]');
  const inputs = form.querySelectorAll("input, textarea, select, button");
  if (!btn) return;

  if (isLoading) {
    inputs.forEach((el) => (el.disabled = true));
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;

    btn.innerHTML = `
      <span style="display:inline-flex; align-items:center; gap:8px;">
        <span style="
          width:14px;height:14px;border:2px solid rgba(255,255,255,.6);
          border-top-color:#fff;border-radius:50%;
          display:inline-block;
          animation: zspin .7s linear infinite;
        "></span>
        Upload en cours…
      </span>
    `;

    if (!document.getElementById("zspin-style")) {
      const st = document.createElement("style");
      st.id = "zspin-style";
      st.textContent = `@keyframes zspin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(st);
    }
  } else {
    inputs.forEach((el) => (el.disabled = false));
    btn.textContent = btn.dataset.label || "Uploader";
  }
}


async function downloadRenderedPdf(docId) {
  const url = `${API_BASE}/labo/marketing-documents/${docId}/download-rendered`;

  const res = await fetch(url, {
    method: "GET",
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });

  if (!res.ok) {
    let msg = `Erreur téléchargement (${res.status})`;
    try {
      const d = await res.json();
      msg = (d && (d.detail || d.message)) || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const blob = await res.blob();

  // essaie de récupérer le filename depuis Content-Disposition
  let filename = `document_${docId}_rendu.pdf`;
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename="([^"]+)"/i);
  if (m && m[1]) filename = m[1];

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}


document.addEventListener("DOMContentLoaded", async () => {
  console.log("[LABO_MARKETING_DOCS] TOKEN ?", !!TOKEN, TOKEN ? `(len=${TOKEN.length})` : "");

  if (!TOKEN) {
    setFeedback("Token absent dans localStorage (clé: 'token').");
    return;
  }

  // 1) Load list
  try {
    await loadDocs();
  } catch (err) {
    console.error(err);
    setFeedback(err.message || "Erreur chargement");
  }

  // 2) Upload + LOADER
  const form = document.querySelector("#marketingDocUploadForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFeedback("");

      const fd = new FormData(form);

      try {
        setUploadLoading(true);

        const res = await fetch(`${API_BASE}/labo/marketing-documents`, {
          method: "POST",
          headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
          body: fd,
        });

        if (!res.ok) {
          const d = await res.json().catch(() => null);
          throw new Error((d && (d.detail || d.message)) || "Upload impossible");
        }

        form.reset();
        setFeedback("Document uploadé ✅", true);
        await loadDocs();
      } catch (err) {
        console.error(err);
        setFeedback(err.message || "Erreur upload");
      } finally {
        setUploadLoading(false);
      }
    });
  }

  // 3) Click handlers: Lire + Delete
  document.addEventListener("click", async (e) => {
	  
	// Télécharger rendu (AUTH via fetch)
	const dlRenderedBtn = e.target.closest(".js-download-rendered");
	if (dlRenderedBtn) {
	  const docId = Number(dlRenderedBtn.getAttribute("data-id") || "0");
	  if (!docId) return;

	  try {
		setFeedback("");
		dlRenderedBtn.disabled = true;
		await downloadRenderedPdf(docId);
		setFeedback("Téléchargement rendu lancé ✅", true);
	  } catch (err) {
		console.error(err);
		setFeedback(err.message || "Erreur téléchargement rendu");
	  } finally {
		dlRenderedBtn.disabled = false;
	  }
	  return;
}
  
	  
	  
    // Lire
    const viewBtn = e.target.closest(".js-view-marketing-doc");
    if (viewBtn) {
      const tr = viewBtn.closest("tr[data-id]");
      const docId = tr ? Number(tr.getAttribute("data-id")) : null;
      if (!docId) return;

      const doc = currentDocs.find((x) => Number(x.id) === docId);
      if (!doc) return;

      try {
        await openViewer(doc);
      } catch (err) {
        console.error(err);
        setFeedback(err.message || "Erreur lecture");
      }
      return;
    }

    // Supprimer
    const delBtn = e.target.closest(".js-delete-marketing-doc");
    if (!delBtn) return;

    const tr = delBtn.closest("tr[data-id]");
    const docId = tr ? tr.getAttribute("data-id") : null;
    if (!docId) return;

    if (!confirm("Supprimer ce document ?")) return;

    try {
      await fetchJSON(`${API_BASE}/labo/marketing-documents/${docId}`, { method: "DELETE" });
      setFeedback("Document supprimé ✅", true);
      await loadDocs();
    } catch (err) {
      console.error(err);
      setFeedback(err.message || "Erreur suppression");
    }
  });
});

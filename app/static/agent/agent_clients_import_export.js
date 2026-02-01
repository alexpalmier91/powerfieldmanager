console.log("[AGENT_CLIENTS_IMPORT] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

const $ = (sel, root = document) => root.querySelector(sel);

// =====================================================
// Helpers
// =====================================================
function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

function setFeedback(html) {
  const el = $("#clientsImportExportFeedback");
  if (el) el.innerHTML = html || "";
}

// =====================================================
// UI – Toggle Import / Export (event delegation SAFE)
// =====================================================
function getImportExportPanelEl() {
  // ✅ Mets ici EXACTEMENT l'id que tu utilises dans le template
  return $("#clientsImportExportCard");
}

function toggleClientsImportExport(forceOpen = null) {
  const panel = getImportExportPanelEl();
  const btn = $("#btnToggleClientsImportExport");

  if (!panel) {
    console.warn("[AGENT_CLIENTS_IMPORT] panel introuvable (#clientsImportExportCard)");
    return;
  }

  const isOpen = panel.style.display === "block";
  const next = forceOpen === null ? !isOpen : forceOpen;

  panel.style.display = next ? "block" : "none";

  if (btn) btn.setAttribute("aria-expanded", next ? "true" : "false");
}

// Délégation d’événements
document.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest("#btnToggleClientsImportExport");
  if (toggleBtn) {
    e.preventDefault();
    toggleClientsImportExport();
    return;
  }

  const closeBtn = e.target.closest("#btnCloseClientsImportExport");
  if (closeBtn) {
    e.preventDefault();
    toggleClientsImportExport(false);
  }
});

// ESC pour fermer
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleClientsImportExport(false);
});

// =====================================================
// EXPORT
// GET /api-zenhub/agent/clients/export.xlsx
// =====================================================
async function handleExport() {
  setFeedback("<p style='color:#6b7280;'>Génération du fichier…</p>");

  const url = `${API_BASE}/agent/clients/export.xlsx`;
  const res = await fetch(url, { headers: authHeaders({ Accept: "*/*" }) });

  if (!res.ok) {
    let msg = "Erreur export";
    try {
      const data = await res.json();
      msg = data.detail || msg;
    } catch {}
    setFeedback(`<p style="color:#b91c1c;">${msg}</p>`);
    return;
  }

  const blob = await res.blob();
  const dlUrl = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = dlUrl;
  a.download = "clients.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(dlUrl);
  setFeedback("<p style='color:#15803d;'>Export terminé ✅</p>");
}

// =====================================================
// IMPORT
// POST /api-zenhub/agent/clients/import.xlsx
// =====================================================
async function handleImport() {
  const input = $("#inputImportClientsXlsx");
  if (!input || !input.files || !input.files.length) {
    setFeedback("<p style='color:#b91c1c;'>Sélectionne un fichier .xlsx.</p>");
    return;
  }

  const file = input.files[0];
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    setFeedback("<p style='color:#b91c1c;'>Format invalide : .xlsx requis.</p>");
    return;
  }

  setFeedback("<p style='color:#6b7280;'>Import en cours…</p>");

  const form = new FormData();
  form.append("file", file);

  const url = `${API_BASE}/agent/clients/import.xlsx`;

  const res = await fetch(url, {
    method: "POST",
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    body: form,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || "Erreur import";
    setFeedback(`<p style="color:#b91c1c;">${msg}</p>`);
    return;
  }

  let html = `
    <div style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;">
      <p style="margin:0 0 6px;"><strong>Import terminé ✅</strong></p>
      <ul style="margin:0;padding-left:18px;">
        <li>Total lignes : ${data.total_rows}</li>
        <li>Créés : ${data.created}</li>
        <li>Mis à jour : ${data.updated}</li>
        <li>Ignorés : ${data.skipped}</li>
      </ul>
    </div>
  `;

  if (data.errors && data.errors.length) {
    html += `
      <div style="margin-top:10px;padding:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
        <p style="margin:0 0 6px;"><strong>Erreurs (10 max)</strong></p>
        <ul style="margin:0;padding-left:18px;">
          ${data.errors.slice(0, 10).map(e => `<li>Ligne ${e.row_index} — ${e.message}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  setFeedback(html);
}

// =====================================================
// Init
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
  const panel = getImportExportPanelEl();
  if (panel && !panel.style.display) panel.style.display = "none";

  $("#btnExportClientsXlsx")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleExport().catch((err) => {
      console.error("[AGENT_CLIENTS_IMPORT] export error", err);
      setFeedback(`<p style="color:#b91c1c;">${err.message}</p>`);
    });
  });

  $("#btnImportClientsXlsx")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleImport().catch((err) => {
      console.error("[AGENT_CLIENTS_IMPORT] import error", err);
      setFeedback(`<p style="color:#b91c1c;">${err.message}</p>`);
    });
  });
});

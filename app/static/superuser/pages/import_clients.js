// app/static/superuser/pages/import_clients.js
(() => {
  "use strict";
  const VERSION = "import_clients.js v2025-11-26-1";
  console.log("[SU/IMPORT_CLIENTS] Loaded", VERSION);

  const $ = (sel, root = document) => root.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API_BASE = "/api-zenhub/superuser";

  const authFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (TOKEN) {
      headers.set("Authorization", `Bearer ${TOKEN}`);
    }
    return fetch(url, { ...options, headers });
  };

  const form = $("#import-clients-form");
  const fileInput = $("#clients-file");
  const laboInput = $("#clients-labo-id");
  const statusEl = $("#import-clients-status");
  const resultEl = $("#import-clients-result");

  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg || "";
  };

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      alert("Merci de sélectionner un fichier.");
      return;
    }

    const laboId = laboInput && laboInput.value ? laboInput.value : "1";

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    const url = `${API_BASE}/client-import?labo_id=${encodeURIComponent(
      laboId
    )}`;

    setStatus("Import en cours…");
    if (resultEl) resultEl.textContent = "";

    try {
      const res = await authFetch(url, {
        method: "POST",
        body: formData,
      });

      let data;
      try {
        data = await res.json();
      } catch (err) {
        console.error("[SU/IMPORT_CLIENTS] Invalid JSON response", err);
        throw new Error("Réponse serveur invalide.");
      }

      if (!res.ok) {
        const detail = data?.detail || JSON.stringify(data);
        console.error("[SU/IMPORT_CLIENTS] HTTP error", res.status, detail);
        throw new Error(detail);
      }

      setStatus("Import terminé.");

      const lines = [];
      lines.push(`Lignes lues : ${data.rows_read ?? "?"}`);
      lines.push(
        `Clients créés : ${data.clients_created ?? data.inserted ?? 0}`
      );
      lines.push(
        `Clients mis à jour : ${data.clients_updated ?? data.updated ?? 0}`
      );
      lines.push(
        `Lignes ignorées : ${data.rows_ignored ?? data.errors ?? 0}`
      );

      if (Array.isArray(data.warnings) && data.warnings.length) {
        lines.push("");
        lines.push("⚠ Avertissements :");
        data.warnings.forEach((w) => lines.push(`- ${w}`));
      }

      if (Array.isArray(data.error_details) && data.error_details.length) {
        lines.push("");
        lines.push("Détails erreurs / conversions :");
        data.error_details.forEach((e) => lines.push(`- ${e}`));
      }

      if (resultEl) {
        resultEl.textContent = lines.join("\n");
      }
    } catch (err) {
      console.error("[SU/IMPORT_CLIENTS] Error", err);
      setStatus("Erreur lors de l’import.");
      if (resultEl) {
        resultEl.textContent = String(err);
      }
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!form) return;
    on(form, "submit", handleSubmit);
  });
})();

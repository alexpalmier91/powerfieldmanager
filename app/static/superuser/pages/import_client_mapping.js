// app/static/superuser/pages/import_client_mapping.js
(() => {
  "use strict";
  const VERSION = "import_client_mapping.js v2025-11-26-1";
  console.log("[SU/IMPORT_CLIENT_MAPPING] Loaded", VERSION);

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

  const form = $("#import-client-mapping-form");
  const laboSelect = $("#labo-select");
  const fileInput = $("#mapping-file");
  const statusEl = $("#import-mapping-status");
  const resultEl = $("#import-mapping-result");

  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg || "";
  };

  const handleSubmit = async (evt) => {
    evt.preventDefault();

    if (!laboSelect || !laboSelect.value) {
      alert("Merci de sélectionner un laboratoire.");
      return;
    }

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      alert("Merci de sélectionner un fichier.");
      return;
    }

    const laboId = laboSelect.value;
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    const url = `${API_BASE}/labo-client-mapping/import?labo_id=${encodeURIComponent(
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
        console.error(
          "[SU/IMPORT_CLIENT_MAPPING] Invalid JSON response",
          err
        );
        throw new Error("Réponse serveur invalide.");
      }

      if (!res.ok) {
        const detail = data?.detail || JSON.stringify(data);
        console.error(
          "[SU/IMPORT_CLIENT_MAPPING] HTTP error",
          res.status,
          detail
        );
        throw new Error(detail);
      }

      setStatus("Import terminé.");

      const lines = [];
      lines.push(`Lignes lues : ${data.rows_read ?? "?"}`);
      lines.push(
        `Mappings créés / mis à jour : ${
          data.mappings_created_or_updated ?? data.linked_or_updated ?? 0
        }`
      );
      lines.push(
        `Lignes sans code client : ${
          data.rows_without_code ?? data.skipped_no_code ?? 0
        }`
      );
      lines.push(
        `Lignes client introuvable : ${
          data.rows_client_not_found ?? data.not_found ?? 0
        }`
      );

      if (Array.isArray(data.warnings) && data.warnings.length) {
        lines.push("");
        lines.push("⚠ Avertissements :");
        data.warnings.forEach((w) => lines.push(`- ${w}`));
      }

      if (resultEl) {
        resultEl.textContent = lines.join("\n");
      }
    } catch (err) {
      console.error("[SU/IMPORT_CLIENT_MAPPING] Error", err);
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

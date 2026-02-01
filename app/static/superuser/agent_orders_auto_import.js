// app/static/superuser/agent_orders_auto_import.js
(() => {
  "use strict";
  const VERSION = "agent_orders_auto_import.js v2025-12-03-2";
  console.log("[SU/AGENT_ORDERS_AUTO_IMPORT] Loaded", VERSION);

  const $ = (sel, root = document) => root.querySelector(sel);

  const TOKEN = localStorage.zentro_token || localStorage.token || "";
  const API_BASE = "/api-zenhub/superuser";

  const authFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (TOKEN) {
      headers.set("Authorization", `Bearer ${TOKEN}`);
    }
    return fetch(url, { ...options, headers });
  };

  const laboSelect = $("#labo-id");
  const configSection = $("#config-section");
  const enabledCheckbox = $("#auto-enabled");
  const driveFolderIdInput = $("#drive-folder-id");
  const driveFolderUrlInput = $("#drive-folder-url");
  const runAtInput = $("#run-at");

  const btnSaveConfig = $("#btn-save-config");
  const btnRunNow = $("#btn-run-now");
  const loader = $("#auto-import-loader");
  const messages = $("#auto-import-messages");

  const lastRunAtEl = $("#last-run-at");
  const lastStatusTextEl = $("#last-status-text");
  const lastSummaryEl = $("#last-summary");
  const lastErrorEl = $("#last-error");

  function showMessage(type, text) {
    if (!messages) return;
    messages.innerHTML = `
      <div class="alert alert-${type}" role="alert">
        ${text}
      </div>
    `;
  }

  function clearMessage() {
    if (!messages) return;
    messages.innerHTML = "";
  }

  function setLoader(visible) {
    if (!loader) return;
    loader.style.display = visible ? "inline-block" : "none";
    if (btnSaveConfig) btnSaveConfig.disabled = visible;
    if (btnRunNow) btnRunNow.disabled = visible;
  }

  async function fetchConfig(laboId) {
    const url = `${API_BASE}/agent-orders-auto-import/config?labo_id=${encodeURIComponent(
      laboId
    )}`;
    const res = await authFetch(url, { method: "GET" });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  }

  function fillConfig(config) {
    if (enabledCheckbox) enabledCheckbox.checked = !!config.enabled;
    if (driveFolderIdInput)
      driveFolderIdInput.value = config.drive_folder_id || "";
    if (driveFolderUrlInput)
      driveFolderUrlInput.value = config.drive_folder_url || "";
    if (runAtInput) runAtInput.value = config.run_at || "";

    if (lastRunAtEl)
      lastRunAtEl.textContent = config.last_run_at || "—";
    if (lastStatusTextEl)
      lastStatusTextEl.textContent = config.last_status || "—";

    if (lastSummaryEl) {
      if (config.last_summary) {
        try {
          lastSummaryEl.textContent = JSON.stringify(
            config.last_summary,
            null,
            2
          );
        } catch (e) {
          lastSummaryEl.textContent = String(config.last_summary);
        }
      } else {
        lastSummaryEl.textContent = "—";
      }
    }

    if (lastErrorEl)
      lastErrorEl.textContent = config.last_error || "—";
  }

  async function saveConfig() {
    clearMessage();
    const laboId = laboSelect?.value;
    if (!laboId) {
      showMessage("warning", "Veuillez sélectionner un labo.");
      return;
    }

    const payload = {
      labo_id: parseInt(laboId, 10),
      enabled: enabledCheckbox?.checked || false,
      drive_folder_id: (driveFolderIdInput?.value || "").trim() || null,
      drive_folder_url: (driveFolderUrlInput?.value || "").trim() || null,
      run_at: runAtInput?.value || null,
    };

    setLoader(true);
    try {
      const res = await authFetch(`${API_BASE}/agent-orders-auto-import/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.detail || `Erreur HTTP ${res.status}`;
        showMessage("danger", `Erreur lors de l'enregistrement : ${msg}`);
        return;
      }

      fillConfig(data);
      showMessage("success", "Configuration enregistrée avec succès.");
    } catch (err) {
      showMessage("danger", `Erreur réseau : ${err}`);
    } finally {
      setLoader(false);
    }
  }

  async function runNow() {
    clearMessage();
    const laboId = laboSelect?.value;
    if (!laboId) {
      showMessage("warning", "Veuillez sélectionner un labo.");
      return;
    }

    setLoader(true);
    try {
      const res = await authFetch(
        `${API_BASE}/labos/${encodeURIComponent(
          laboId
        )}/agent-orders-auto-import/run-now`,
        { method: "POST" }
      );

      const data = await res.json();

      if (!res.ok || !data.ok) {
        const msg = data.error || data.detail || `Erreur HTTP ${res.status}`;
        showMessage("danger", `Erreur lors de l'import immédiat : ${msg}`);
        return;
      }

      showMessage(
        "success",
        `Import terminé. Commandes insérées: ${data.summary.total_inserted_orders}, mises à jour: ${data.summary.total_updated_orders}, lignes: ${data.summary.total_rows}.`
      );

      await loadConfigForCurrentLabo();
    } catch (err) {
      showMessage("danger", `Erreur réseau : ${err}`);
    } finally {
      setLoader(false);
    }
  }

  async function loadConfigForCurrentLabo() {
    clearMessage();
    const laboId = laboSelect?.value;
    if (!laboId) {
      if (configSection) configSection.style.display = "none";
      return;
    }

    setLoader(true);
    try {
      const config = await fetchConfig(laboId);
      if (configSection) configSection.style.display = "block";
      fillConfig(config);
    } catch (err) {
      showMessage(
        "danger",
        `Erreur lors du chargement de la configuration : ${err}`
      );
      if (configSection) configSection.style.display = "none";
    } finally {
      setLoader(false);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!laboSelect) return;

    // Si un labo est déjà sélectionné (cas de ta capture), on charge direct
    if (laboSelect.value) {
      loadConfigForCurrentLabo();
    }

    laboSelect.addEventListener("change", () => {
      loadConfigForCurrentLabo();
    });

    if (btnSaveConfig) {
      btnSaveConfig.addEventListener("click", (e) => {
        e.preventDefault();
        saveConfig();
      });
    }

    if (btnRunNow) {
      btnRunNow.addEventListener("click", (e) => {
        e.preventDefault();
        runNow();
      });
    }
  });
})();

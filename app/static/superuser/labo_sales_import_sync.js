// app/static/superuser/labo_sales_import_sync.js
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  let currentLaboId = null;
  let currentConfig = null;

  const $laboSelect = $("#labo-select");
  const $formWrap = $("#sales-import-form-wrap");
  const $selectedLaboName = $("#selected-labo-name");
  const $statusBadge = $("#sales-import-status");
  const $loader = $("#sales-import-loader");

  const $enabled = $("#enabled");
  const $fileUrl = $("#file_url");
  const $runAt = $("#run_at");

  const $btnSave = $("#btn-save-config");
  const $btnRunNow = $("#btn-run-now");

  const $lastRunInfo = $("#last-run-info");
  const $alertError = $("#sales-import-error");
  const $alertSuccess = $("#sales-import-success");
  const $resultMsg = $("#sales-import-result");

  function setLoader(visible) {
    if ($loader) $loader.style.display = visible ? "inline-block" : "none";
    if ($btnSave) $btnSave.disabled = visible;
    if ($btnRunNow) {
      const hasUrl = $fileUrl && $fileUrl.value.trim();
      $btnRunNow.disabled = visible || !hasUrl;
    }
  }

  function clearAlerts() {
    if ($alertError) {
      $alertError.style.display = "none";
      $alertError.textContent = "";
    }
    if ($alertSuccess) {
      $alertSuccess.style.display = "none";
      $alertSuccess.textContent = "";
    }
    if ($resultMsg) {
      // on ne reset plus le message ici,
      // il sert de "résumé du dernier import manuel"
      // $resultMsg.textContent = "";
      $resultMsg.style.color = "#6c757d";
    }
  }

  function showError(msg) {
    if ($alertError) {
      $alertError.style.display = "block";
      $alertError.textContent = msg;
    } else if ($resultMsg) {
      $resultMsg.style.color = "#b30000";
      $resultMsg.textContent = msg;
    }
  }

  function showSuccess(msg) {
    if ($alertSuccess) {
      $alertSuccess.style.display = "block";
      $alertSuccess.textContent = msg;
    } else if ($resultMsg) {
      $resultMsg.style.color = "#155724";
      $resultMsg.textContent = msg;
    }
  }

  function setResultMessage(msg, isError = false) {
    if (!$resultMsg) return;
    $resultMsg.style.color = isError ? "#b30000" : "#333";
    $resultMsg.textContent = msg;
  }

  function updateStatusBadge(config) {
    if (!$statusBadge) return;

    if (!config.last_run_at) {
      $statusBadge.className = "badge bg-secondary";
      $statusBadge.textContent = "Non encore exécuté";
      return;
    }

    if (config.last_error) {
      $statusBadge.className = "badge bg-danger";
      $statusBadge.textContent = "Dernière exécution en erreur";
    } else {
      $statusBadge.className = "badge bg-success";
      $statusBadge.textContent = "Dernière exécution OK";
    }
  }

  function updateLastRunInfo(config) {
    if (!$lastRunInfo) return;

    if (!config.last_run_at) {
      $lastRunInfo.textContent = "Aucune exécution pour le moment.";
      return;
    }

    const dt = new Date(config.last_run_at);
    const dateStr = dt.toLocaleString("fr-FR");
    let text = `Dernière exécution : ${dateStr}`;
    if (config.last_status) {
      text += ` — Statut : ${config.last_status}`;
    }
    if (config.last_error) {
      text += ` — Erreur : ${config.last_error}`;
    }

    $lastRunInfo.textContent = text;
  }

  function updateButtonsState(config) {
    const hasUrl = !!(config && config.file_url);
    if ($btnRunNow) $btnRunNow.disabled = !hasUrl;
  }

  async function fetchJson(url, options = {}) {
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const txt = await resp.text();
      let detail = txt;
      try {
        const j = JSON.parse(txt);
        detail = j.detail || j.error || txt;
      } catch (_) {}
      throw new Error(detail);
    }
    return resp.json();
  }

  async function loadConfig(laboId) {
    if (!laboId) return;
    clearAlerts();
    setLoader(true);

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${laboId}/sales-import-sync`
      );
      currentConfig = data;

      if ($enabled) $enabled.checked = !!data.enabled;
      if ($fileUrl) $fileUrl.value = data.file_url || "";
      if ($runAt) $runAt.value = data.run_at || "";

      updateStatusBadge(data);
      updateLastRunInfo(data);
      updateButtonsState(data);

      // 🔴 NE PLUS EFFACER LE RÉSUMÉ ICI
      // setResultMessage("");
    } catch (e) {
      showError(`Erreur lors du chargement de la configuration : ${e}`);
    } finally {
      setLoader(false);
    }
  }

  async function saveConfig() {
    if (!currentLaboId) {
      showError("Veuillez d'abord sélectionner un laboratoire.");
      return;
    }

    clearAlerts();
    setLoader(true);

    const payload = {
      enabled: !!$enabled.checked,
      file_url: $fileUrl.value.trim() || null,
      run_at: $runAt.value || null,
    };

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${currentLaboId}/sales-import-sync`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      currentConfig = data;
      updateStatusBadge(data);
      updateLastRunInfo(data);
      updateButtonsState(data);

      showSuccess("Configuration enregistrée.");
    } catch (e) {
      showError(`Erreur lors de l'enregistrement : ${e}`);
    } finally {
      setLoader(false);
    }
  }

  async function runNow() {
    if (!currentLaboId) {
      showError("Veuillez d'abord sélectionner un laboratoire.");
      return;
    }

    clearAlerts();
    setLoader(true);
    setResultMessage("⏳ Import des ventes en cours...");

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${currentLaboId}/sales-import-sync/run-now`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const s = data.summary || {};
      const docsInserted = s.documents_inserted ?? "?";
      const docsUpdated = s.documents_updated ?? "?";
      const itemsInserted = s.items_inserted ?? "?";
      const warningsCount =
        Array.isArray(s.warnings) ? s.warnings.length : (s.warnings_count ?? 0);

      let warningsPreview = "";
      if (Array.isArray(s.warnings) && s.warnings.length) {
        const first = s.warnings.slice(0, 5);
        warningsPreview =
          " Exemples de warnings : " +
          first.map((w) => `« ${w} »`).join(" | ");
        if (s.warnings.length > first.length) {
          warningsPreview += ` (… +${s.warnings.length - first.length} autres)`;
        }
      }

      const msg = [
        `✅ Import terminé pour le labo ${data.labo_name || ""}.`,
        `Documents insérés : ${docsInserted}.`,
        `Documents mis à jour : ${docsUpdated}.`,
        `Lignes insérées : ${itemsInserted}.`,
        `Warnings : ${warningsCount}.`,
        warningsPreview,
      ].join(" ");

      // 👉 Ce message reste maintenant affiché sous "Résumé du dernier import manuel"
      setResultMessage(msg, false);
      showSuccess("Import des ventes effectué.");

      // On recharge la config (pour date/ statut) sans effacer le message
      await loadConfig(currentLaboId);
    } catch (e) {
      setResultMessage(`❌ Erreur lors de l'import : ${e}`, true);
      showError(`Erreur lors de l'import : ${e}`);
    } finally {
      setLoader(false);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$laboSelect) return;

    if ($formWrap) $formWrap.style.display = "none";

    $laboSelect.addEventListener("change", () => {
      clearAlerts();
      const val = $laboSelect.value;
      if (!val) {
        currentLaboId = null;
        if ($formWrap) $formWrap.style.display = "none";
        return;
      }

      currentLaboId = parseInt(val, 10);
      if ($selectedLaboName) {
        const opt = $laboSelect.options[$laboSelect.selectedIndex];
        $selectedLaboName.textContent = opt ? `(${opt.textContent})` : "";
      }
      if ($formWrap) $formWrap.style.display = "block";

      loadConfig(currentLaboId);
    });

    if ($btnSave) $btnSave.addEventListener("click", saveConfig);
    if ($btnRunNow) $btnRunNow.addEventListener("click", runNow);
  });
})();

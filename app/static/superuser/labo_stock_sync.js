// app/static/superuser/labo_stock_sync.js
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  let currentLaboId = null;
  let currentConfig = null;

  const $laboSelect = $("#labo-select");
  const $formWrap = $("#stock-sync-form-wrap");
  const $selectedLaboName = $("#selected-labo-name");
  const $statusBadge = $("#stock-sync-status");
  const $loader = $("#stock-sync-loader");

  const $enabled = $("#enabled");
  const $apiUrl = $("#api_url");
  const $apiToken = $("#api_token");
  const $skuField = $("#sku_field");
  const $qtyField = $("#qty_field");
  const $runAt = $("#run_at");

  const $btnSave = $("#btn-save-config");
  const $btnTest = $("#btn-test-connection");
  const $btnRunNow = $("#btn-run-now");

  const $lastRunInfo = $("#last-run-info");
  const $testResult = $("#test-result");
  const $testResultJson = $("#test-result-json");
  const $alertError = $("#stock-sync-error");
  const $alertSuccess = $("#stock-sync-success");
  const $resultMsg = $("#stock-sync-result");

  function setLoader(visible) {
    if ($loader) $loader.style.display = visible ? "inline-block" : "none";
    if ($btnSave) $btnSave.disabled = visible;
    if ($btnTest) $btnTest.disabled = visible || !($apiUrl.value.trim());
    if ($btnRunNow) $btnRunNow.disabled = visible || !($apiUrl.value.trim());
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
      $resultMsg.textContent = "";
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

    let cls = "badge bg-secondary";
    let label = config.last_status || "Inconnu";

    if (config.last_status === "success" || config.last_status === "ok") {
      cls = "badge bg-success";
      label = "Dernière exécution OK";
    } else if (config.last_status === "error") {
      cls = "badge bg-danger";
      label = "Dernière exécution en erreur";
    }

    $statusBadge.className = cls;
    $statusBadge.textContent = label;
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
    const hasApi = !!(config && config.api_url);
    if ($btnTest) $btnTest.disabled = !hasApi;
    if ($btnRunNow) $btnRunNow.disabled = !hasApi;
  }

  async function fetchJson(url, options = {}) {
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const text = await resp.text();
      let detail = text;
      try {
        const j = JSON.parse(text);
        detail = j.detail || j.error || text;
      } catch (_) {
        // ignore
      }
      throw new Error(detail);
    }
    return resp.json();
  }

  async function loadConfig(laboId) {
    if (!laboId) return;
    clearAlerts();
    setLoader(true);
    try {
      const data = await fetchJson(`/api-zenhub/superuser/labos/${laboId}/stock-sync`);
      currentConfig = data;

      if ($enabled) $enabled.checked = !!data.enabled;
      if ($apiUrl) $apiUrl.value = data.api_url || "";
      if ($apiToken) $apiToken.value = data.api_token || "";
      if ($skuField) $skuField.value = data.sku_field || "sku";
      if ($qtyField) $qtyField.value = data.qty_field || "qty";
      if ($runAt) $runAt.value = data.run_at || "";

      updateStatusBadge(data);
      updateLastRunInfo(data);
      updateButtonsState(data);

      if ($testResult) $testResult.style.display = "none";
      if ($testResultJson) $testResultJson.textContent = "";
      setResultMessage("");
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
      api_url: $apiUrl.value.trim() || null,
      api_token: $apiToken.value.trim() || null,
      sku_field: $skuField.value.trim() || "sku",
      qty_field: $qtyField.value.trim() || "qty",
      run_at: $runAt.value || null,
    };

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${currentLaboId}/stock-sync`,
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

  async function testConnection() {
    if (!currentLaboId) {
      showError("Veuillez d'abord sélectionner un laboratoire.");
      return;
    }

    clearAlerts();
    setLoader(true);
    setResultMessage("⏳ Test de l'API labo en cours...");

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${currentLaboId}/stock-sync/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if ($testResult) $testResult.style.display = "block";
      if ($testResultJson) {
        $testResultJson.textContent = JSON.stringify(data, null, 2);
      }

      const msg = `✅ Test OK — ${data.total_items} lignes reçues. Champ SKU: ${data.detected_sku_field}, champ quantité: ${data.detected_qty_field}.`;
      setResultMessage(msg, false);
    } catch (e) {
      setResultMessage(`❌ Erreur lors du test de l'API : ${e}`, true);
      showError(`Erreur lors du test : ${e}`);
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
    setResultMessage("⏳ Mise à jour du stock en cours...");

    try {
      const data = await fetchJson(
        `/api-zenhub/superuser/labos/${currentLaboId}/stock-sync/run-now`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const s = data.summary || {};
      const msg = [
        `✅ Mise à jour terminée pour le labo ${data.labo_name || ""}.`,
        `Lignes API: ${s.total_rows ?? 0}.`,
        `Produits trouvés: ${s.matched ?? 0}.`,
        `Stocks modifiés: ${s.updated ?? 0}.`,
        `SKUs inconnus: ${s.unknown_count ?? 0}.`,
      ].join(" ");

      setResultMessage(msg, false);
      showSuccess("Mise à jour du stock effectuée.");

      // last_run_at / last_status / last_error ont été mis à jour côté API
      await loadConfig(currentLaboId);
    } catch (e) {
      setResultMessage(`❌ Erreur lors de la mise à jour du stock : ${e}`, true);
      showError(`Erreur lors de la mise à jour du stock : ${e}`);
    } finally {
      setLoader(false);
    }
  }

  // ====== Initialisation ======

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
    if ($btnTest) $btnTest.addEventListener("click", testConnection);
    if ($btnRunNow) $btnRunNow.addEventListener("click", runNow);
  });
})();

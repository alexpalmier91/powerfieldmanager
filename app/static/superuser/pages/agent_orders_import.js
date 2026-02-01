// app/static/superuser/pages/agent_orders_import.js
(() => {
  "use strict";
  const VERSION = "agent_orders_import.js v2025-11-25-1";
  console.log("[SU/IMPORT_AGENT_ORDERS] Loaded", VERSION);

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

  const form = $("#agent-orders-import-form");
  const laboSelect = $("#labo-id-input");
  const fileInput = $("#excel-file");
  const btnImport = $("#btn-import");
  const spinner = $("#import-spinner");
  const resultBox = $("#import-result");
  const errorsBox = $("#import-errors");

  const setLoading = (loading) => {
    if (!btnImport || !spinner) return;
    btnImport.disabled = loading;
    spinner.style.display = loading ? "inline-block" : "none";
  };

  const fmtMoney = (v) =>
    (Number(v) || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });

  const renderResult = (data) => {
    if (!resultBox || !errorsBox) return;

    const {
      labo_id,
      total_rows,
      created_orders,
      updated_orders,
      skipped_rows,
      orders,
      errors,
    } = data || {};

    let summary = "";
    summary += `Labo ID : ${labo_id}\n`;
    summary += `Lignes totales lues : ${total_rows}\n`;
    summary += `Commandes créées : ${created_orders}\n`;
    summary += `Commandes mises à jour : ${updated_orders}\n`;
    summary += `Lignes ignorées : ${skipped_rows}\n`;

    if (orders && orders.length) {
      summary += `\nCommandes traitées :\n`;
      for (const o of orders) {
        summary += ` - ${o.order_number} (client_id=${o.client_id || "?"}, agent_id=${o.agent_id || "?"}, total=${fmtMoney(
          o.total_ht
        )})\n`;
      }
    }

    resultBox.textContent = summary;

    if (errors && errors.length) {
      errorsBox.textContent = errors.join("\n");
    } else {
      errorsBox.textContent = "Aucune erreur signalée.";
    }
  };

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (!form || !laboSelect || !fileInput) return;

    const laboId = laboSelect.value;
    const file = fileInput.files && fileInput.files[0];

    if (!laboId) {
      alert("Merci de sélectionner un labo.");
      return;
    }
    if (!file) {
      alert("Merci de sélectionner un fichier Excel.");
      return;
    }

    const fd = new FormData();
    fd.append("file", file);

    const url = `${API_BASE}/agent-orders/import?labo_id=${encodeURIComponent(
      laboId
    )}`;

    setLoading(true);
    resultBox.textContent = "";
    errorsBox.textContent = "";

    try {
      const res = await authFetch(url, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("[IMPORT_AGENT_ORDERS] HTTP error", res.status, text);
        alert(`Erreur HTTP ${res.status} lors de l'import.`);
        return;
      }

      const data = await res.json();
      console.log("[IMPORT_AGENT_ORDERS] Result", data);
      renderResult(data);
    } catch (err) {
      console.error("[IMPORT_AGENT_ORDERS] Network/JS error", err);
      alert("Erreur lors de l'appel à l'API d'import.");
    } finally {
      setLoading(false);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!form) return;
    on(form, "submit", handleSubmit);
  });
})();

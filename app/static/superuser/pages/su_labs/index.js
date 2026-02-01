// /static/superuser/pages/su_labs/index.js
import {
  fetchLabos,
  impersonateLabo,
  stopImpersonation,
  backupSuperuserToken,
  restoreSuperuserToken,
  setToken,
  SU_BACKUP_KEY,
} from "/static/superuser/shared/impersonate/api.js";

import {
  qs, showError, renderLabosTable, bindImpersonateButtons, toggleStopButton
} from "/static/superuser/shared/impersonate/ui.js";

(async function () {
  "use strict";

  const labosList = qs("#labosList") || detectServerRenderedTable();
  const labosErr  = qs("#labosErr");
  const stopBtn   = qs("#btn-stop-impersonation");

  // Afficher le bouton "Quitter le mode Labo" si backup présent
  if (stopBtn && sessionStorage.getItem(SU_BACKUP_KEY)) {
    toggleStopButton(stopBtn, true);
    stopBtn.addEventListener("click", onStopImpersonation);
  }

  // Charger la liste des labos depuis l'API avec JWT
  if (labosList && labosList.dataset.source !== "server") {
    try {
      const data = await fetchLabos();
      const labos = data.items || data || [];
      renderLabosTable(labosList, labos);
      bindImpersonateButtons(labosList, onImpersonateClick);
    } catch (e) {
      showError(labosErr || labosList, e.message);
    }
  } else {
    // Si la table est déjà rendue côté serveur, on bind simplement
    bindImpersonateButtons(document, onImpersonateClick);
  }

  /* ---------- Handlers ---------- */
  async function onImpersonateClick(laboId) {
    try {
      backupSuperuserToken();
      const data = await impersonateLabo(laboId);
      if (data?.token) {
        setToken(data.token);
        location.href = data.redirect || "/labo/dashboard";
      } else {
        throw new Error("Réponse invalide du serveur (pas de token).");
      }
    } catch (e) {
      restoreSuperuserToken();
      alert("Erreur: " + e.message);
    }
  }

  async function onStopImpersonation() {
    try {
      await stopImpersonation();
    } catch (_) {
      // non bloquant
    } finally {
      restoreSuperuserToken();
      location.href = "/superuser/dashboard";
    }
  }

  /* ---------- Utilitaire ---------- */
  function detectServerRenderedTable() {
    const maybe = document.querySelector(".card table.table");
    if (maybe) {
      const phantom = document.createElement("div");
      phantom.dataset.source = "server";
      return phantom;
    }
    return qs("#labosList");
  }
})();

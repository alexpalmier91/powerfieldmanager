// app/static/superuser/presentoir_detail.js

console.log("[PRESENTOIR_DETAIL] script chargé");

(function () {
  console.log("[PRESENTOIR_DETAIL] IIFE start");

  const PRESENTOIR_ID = window.PFM_PRESENTOIR_ID;
  const TOKEN = localStorage.getItem("token");

  console.log(
    "[PRESENTOIR_DETAIL] PRESENTOIR_ID =",
    PRESENTOIR_ID,
    "TOKEN ?",
    !!TOKEN
  );

  if (!PRESENTOIR_ID || !TOKEN) {
    console.warn(
      "[PRESENTOIR_DETAIL] Pas d'ID présentoir ou pas de token, on n'initialise pas."
    );
    return;
  }

  window.addEventListener("DOMContentLoaded", () => {
    console.log("[PRESENTOIR_DETAIL] DOMContentLoaded");
    initPresentoirAssignments(PRESENTOIR_ID, TOKEN);

    // ✅ LIVE polling
    initPresentoirLive(PRESENTOIR_ID, TOKEN);
  });
})();

function initPresentoirLive(presentoirId, token) {
  console.log("[PRESENTOIR_DETAIL] initPresentoirLive");

  const headers = { Accept: "application/json", Authorization: "Bearer " + token };

  async function refresh() {
    try {
      const res = await fetch(
        `/api-zenhub/superuser/presentoirs/${presentoirId}/live`,
        { headers }
      );
      if (!res.ok) return;

      const data = await res.json();
      if (!data || data.status !== "ok") return;

      // payload attendu : { status:"ok", presentoir:{...}, current_items_by_sku:[...], events:[...] }
      const p = data.presentoir || {};
      updateLiveStatus(p);
      updateLiveHeartbeat(p);
      updateLiveProductsCount(p);
      updateLiveLastEvent(data.events || []);
      updateLiveSkuTable(data.current_items_by_sku || []);
      updateLiveEventsTable(data.events || []);
    } catch (err) {
      console.error("[PRESENTOIR_DETAIL] LIVE refresh error:", err);
    }
  }

  refresh();
  setInterval(refresh, 5000);
}

function updateLiveStatus(presentoir) {
  const badge = document.getElementById("live-status-badge");
  if (!badge) return;

  const status = (presentoir.computed_status || "INCONNU").toUpperCase();

  // reset
  badge.style.background = "#e5e7eb";
  badge.style.color = "#374151";
  badge.textContent = "● Inconnu";

  if (status === "ONLINE") {
    badge.style.background = "#dcfce7";
    badge.style.color = "#166534";
    badge.textContent = "● Online";
  } else if (status === "OFFLINE") {
    badge.style.background = "#fee2e2";
    badge.style.color = "#991b1b";
    badge.textContent = "● Offline";
  } else if (status === "ERROR") {
    badge.style.background = "#fef3c7";
    badge.style.color = "#92400e";
    badge.textContent = "● Erreur";
  }
}

function updateLiveHeartbeat(presentoir) {
  const el = document.getElementById("live-heartbeat");
  if (!el) return;

  if (!presentoir.last_seen_at) {
    el.textContent = "—";
    return;
  }

  el.textContent = formatDateTimeFR(presentoir.last_seen_at);
}

function updateLiveProductsCount(presentoir) {
  const el = document.getElementById("live-products-count");
  if (!el) return;
  const n = presentoir.current_num_products ?? 0;
  el.textContent = String(n);
}

function updateLiveLastEvent(events) {
  const el = document.getElementById("live-last-event");
  if (!el) return;

  if (!events || events.length === 0) {
    el.textContent = "Aucun événement enregistré pour le moment.";
    return;
  }

  const ev = events[0];
  const dt = ev.occurred_at ? formatDateTimeFR(ev.occurred_at) : "—";
  const type = ev.event_type === "removal" ? "Retrait" : ev.event_type === "return" || ev.event_type === "return_" ? "Retour" : ev.event_type;
  const sku = ev.sku || "-";
  const epc = ev.epc || "-";

  el.textContent = `${dt} – ${type} (SKU ${sku}, EPC ${epc})`;
}

function updateLiveSkuTable(items) {
  const tbody = document.getElementById("live-sku-body");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3">Aucun produit présent sur le présentoir.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items
    .map((row) => {
      const sku = escapeHtml(row.sku || "(SKU inconnu)");
      const count = row.count ?? 0;
      const last = row.last_movement ? formatDateTimeFR(row.last_movement) : "—";
      return `
        <tr>
          <td>${sku}</td>
          <td>${count}</td>
          <td>${last}</td>
        </tr>
      `;
    })
    .join("");
}

function updateLiveEventsTable(events) {
  const tbody = document.getElementById("live-events-body");
  if (!tbody) return;

  if (!events || events.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4">Aucun événement pour ce présentoir.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = events
    .map((ev) => {
      const dt = ev.occurred_at ? formatDateTimeFR(ev.occurred_at) : "—";
      let typeLabel = ev.event_type;
      if (ev.event_type === "removal") typeLabel = "Retrait";
      else if (ev.event_type === "return" || ev.event_type === "return_") typeLabel = "Retour";

      const sku = escapeHtml(ev.sku || "-");
      const epc = escapeHtml(ev.epc || "-");

      return `
        <tr>
          <td>${dt}</td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${sku}</td>
          <td>${epc}</td>
        </tr>
      `;
    })
    .join("");
}

/* ===================== AFFECTATIONS (inchangé) ===================== */

async function initPresentoirAssignments(presentoirId, token) {
  console.log("[PRESENTOIR_DETAIL] initPresentoirAssignments");

  const ownerSelect = document.querySelector("#ownerSelect");
  const endClientSelect =
    document.querySelector("#endClientSelect") ||
    document.querySelector("#pharmacySelect");

  const statusEl = document.getElementById("presentoirAssignStatus");

  const ownerOk = !!ownerSelect;
  const endClientOk = !!endClientSelect;

  if (!ownerOk || !endClientOk) {
    console.warn(
      "[PRESENTOIR_DETAIL] select(s) introuvable(s) ownerSelect=",
      ownerOk,
      "endClientSelect=",
      endClientOk
    );
    console.log(
      "[PRESENTOIR_DETAIL] Tous les <select> dispo :",
      document.querySelectorAll("select")
    );
    return;
  }

  console.log(
    "[PRESENTOIR_DETAIL] ownerSelect =",
    ownerSelect,
    "endClientSelect =",
    endClientSelect
  );

  const headers = {
    Accept: "application/json",
    Authorization: "Bearer " + token,
  };

  try {
    // ================== OPTIONS PROPRIÉTAIRES ==================
    console.log("[PRESENTOIR_DETAIL] fetch owners-options...");
    const ownersRes = await fetch(
      "/api-zenhub/superuser/presentoirs/owners-options",
      { headers }
    );
    if (!ownersRes.ok) throw new Error("HTTP owners-options " + ownersRes.status);

    const ownersData = await ownersRes.json();
    console.log("[PRESENTOIR_DETAIL] ownersData =", ownersData);

    const currentOwnerId =
      ownerSelect.dataset.currentOwnerId ||
      ownerSelect.getAttribute("data-current-owner-id") ||
      "";

    ownerSelect.innerHTML = '<option value="">— Aucun propriétaire —</option>';

    const ownersList = Array.isArray(ownersData.options)
      ? ownersData.options
      : Array.isArray(ownersData.items)
      ? ownersData.items
      : [];

    ownersList.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.id;
      const label = opt.label || opt.name || `#${opt.id}`;
      o.textContent = label;
      if (currentOwnerId && String(opt.id) === String(currentOwnerId)) o.selected = true;
      ownerSelect.appendChild(o);
    });

    // ================== OPTIONS CLIENTS FINAUX ==================
    console.log("[PRESENTOIR_DETAIL] fetch end-clients-options...");
    const endRes = await fetch(
      "/api-zenhub/superuser/presentoirs/end-clients-options",
      { headers }
    );
    if (!endRes.ok) throw new Error("HTTP end-clients-options " + endRes.status);

    const endData = await endRes.json();
    console.log("[PRESENTOIR_DETAIL] endData =", endData);

    const currentEndClientId =
      endClientSelect.dataset.currentEndClientId ||
      endClientSelect.getAttribute("data-current-end-client-id") ||
      "";

    endClientSelect.innerHTML = '<option value="">— Aucun client final —</option>';

    const endList = Array.isArray(endData.options)
      ? endData.options
      : Array.isArray(endData.items)
      ? endData.items
      : [];

    endList.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.id;
      const label = opt.label || opt.name || `#${opt.id}`;
      o.textContent = label;
      if (currentEndClientId && String(opt.id) === String(currentEndClientId)) o.selected = true;
      endClientSelect.appendChild(o);
    });

    setStatus(statusEl, "Clients chargés.");

    // ================== LISTENERS CHANGE ==================
    ownerSelect.addEventListener("change", () => {
      const newOwnerId = ownerSelect.value || null;
      console.log("[PRESENTOIR_DETAIL] change owner =>", newOwnerId);
      patchPresentoirOwnership(presentoirId, { owner_id: newOwnerId }, token);
    });

    endClientSelect.addEventListener("change", () => {
      const newEndId = endClientSelect.value || null;
      console.log("[PRESENTOIR_DETAIL] change end client =>", newEndId);
      // côté API : pharmacy_id => end_client_id (mapping serveur)
      patchPresentoirOwnership(presentoirId, { pharmacy_id: newEndId }, token);
    });
  } catch (err) {
    console.error("[PRESENTOIR_DETAIL] Erreur chargement options:", err);
    setStatus(statusEl, "Erreur lors du chargement des clients.", true);
  }
}

async function patchPresentoirOwnership(presentoirId, payload, token) {
  console.log("[PRESENTOIR_DETAIL] patchPresentoirOwnership", payload);

  const statusEl = document.getElementById("presentoirAssignStatus");
  setStatus(statusEl, "Enregistrement en cours…");

  try {
    const res = await fetch(
      `/api-zenhub/superuser/presentoirs/${presentoirId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error("[PRESENTOIR_DETAIL] PATCH error", res.status, txt);
      throw new Error("HTTP PATCH " + res.status);
    }

    const data = await res.json();
    console.log("[PRESENTOIR_DETAIL] PATCH ok", data);
    setStatus(statusEl, "Affectation mise à jour.");
  } catch (err) {
    console.error("[PRESENTOIR_DETAIL] Erreur PATCH:", err);
    setStatus(statusEl, "Erreur lors de la mise à jour de l'affectation.", true);
  }
}

function setStatus(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#6b7280";
}

/* ===================== helpers ===================== */

function formatDateTimeFR(isoString) {
  // isoString peut être un ISO complet, ou un objet déjà affichable
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    return String(isoString);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

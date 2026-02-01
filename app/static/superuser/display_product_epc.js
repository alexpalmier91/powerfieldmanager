// app/static/superuser/display_product_epc.js

console.log("[DISPLAY_PRODUCT_EPC] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

function $(sel, root = document) {
  return root.querySelector(sel);
}

async function fetchJSON(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });

  // On essaye de lire json, sinon texte
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const payload = ct.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    let msg = "Erreur lors de l'appel API";
    if (payload && typeof payload === "object" && payload.detail) msg = payload.detail;
    else if (typeof payload === "string" && payload) msg = payload;
    else msg = `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return payload;
}

/** ✅ Nouveau : récupérer le dernier EPC vu et remplir le champ */
async function useLastSeenEpc() {
  const infoEl = $("#lastEpcInfo");
  const errorEl = $("#epcFormError");
  const epcInput = $("#epcInput");

  if (errorEl) errorEl.style.display = "none";
  if (infoEl) infoEl.textContent = "Lecture en cours…";

  try {
    const data = await fetchJSON(`${API_BASE}/superuser/rfid/last-seen-epc`);

    if (!data || !data.epc) {
      if (infoEl) infoEl.textContent = "Aucun EPC détecté récemment.";
      return;
    }

    if (!epcInput) {
      if (infoEl) infoEl.textContent = "";
      if (errorEl) {
        errorEl.textContent = "Champ EPC introuvable (id epcInput).";
        errorEl.style.display = "block";
      }
      return;
    }

    epcInput.value = String(data.epc);
    if (infoEl) infoEl.textContent = `OK (${data.source || "scan"})`;
    console.log("[DISPLAY_PRODUCT_EPC] last-seen epc =", data.epc);
  } catch (err) {
    console.error("[DISPLAY_PRODUCT_EPC] useLastSeenEpc error", err);
    if (infoEl) infoEl.textContent = "";
    if (errorEl) {
      errorEl.textContent =
        err.message || "Impossible de récupérer l’EPC scanné (API last-seen-epc).";
      errorEl.style.display = "block";
    }
  }
}

async function loadUnassignedEpc() {
  const selectEl = $("#epcSelect");
  const infoEl = $("#epcFormInfo");
  const errorEl = $("#epcFormError");

  if (!selectEl) return;

  if (infoEl) infoEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  selectEl.innerHTML = `<option value="">Chargement...</option>`;

  try {
    const data = await fetchJSON(
      `${API_BASE}/superuser/display-products/unassigned-epc?limit=100`
    );

    if (!data || !data.length) {
      selectEl.innerHTML = `<option value="">Aucun EPC non assigné</option>`;
      return;
    }

    selectEl.innerHTML = `<option value="">Sélectionner un EPC non assigné</option>`;
    data.forEach((row) => {
      const lastSeen = row.last_seen_at
        ? new Date(row.last_seen_at).toLocaleString()
        : "";
      const opt = document.createElement("option");
      opt.value = row.epc;
      opt.textContent = `${row.epc}${lastSeen ? " (vu le " + lastSeen + ")" : ""}`;
      selectEl.appendChild(opt);
    });
  } catch (err) {
    console.error("[DISPLAY_PRODUCT_EPC] loadUnassignedEpc error", err);
    if (errorEl) {
      errorEl.textContent =
        err.message || "Erreur lors du chargement des EPC non assignés";
      errorEl.style.display = "block";
    }
    selectEl.innerHTML = `<option value="">Erreur de chargement</option>`;
  }
}

async function linkEpc() {
  const displayProductIdEl = $("#displayProductId");
  const epcInput = $("#epcInput");
  const epcSelect = $("#epcSelect");
  const infoEl = $("#epcFormInfo");
  const errorEl = $("#epcFormError");
  const tableBody = $("#epcLinkedTableBody");

  if (!displayProductIdEl) return;

  const displayProductId = parseInt(displayProductIdEl.value, 10);

  if (infoEl) infoEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  let epc = epcInput ? epcInput.value.trim() : "";
  if (!epc && epcSelect && epcSelect.value) {
    epc = epcSelect.value;
  }

  if (!epc) {
    if (errorEl) {
      errorEl.textContent = "Merci de saisir ou sélectionner un EPC.";
      errorEl.style.display = "block";
    }
    return;
  }

  try {
    const payload = { epc };
    const linked = await fetchJSON(
      `${API_BASE}/superuser/display-products/${displayProductId}/link-epc`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (infoEl) {
      infoEl.textContent = `EPC ${linked.epc} lié avec succès.`;
      infoEl.style.display = "block";
    }

    if (epcInput) epcInput.value = "";
    if (epcSelect && epcSelect.value === linked.epc) {
      epcSelect.value = "";
    }

    // Mettre à jour le tableau localement
    if (tableBody) {
      // Supprimer la ligne "Aucun EPC"
      if (
        tableBody.children.length === 1 &&
        tableBody.children[0].querySelector("td[colspan]")
      ) {
        tableBody.innerHTML = "";
      }

      const tr = document.createElement("tr");
      const tdEpc = document.createElement("td");
      const tdDate = document.createElement("td");

      tdEpc.textContent = linked.epc;
      tdDate.textContent = linked.linked_at
        ? new Date(linked.linked_at).toLocaleString()
        : "";

      tr.appendChild(tdEpc);
      tr.appendChild(tdDate);

      tableBody.prepend(tr);
    }

    // rafraîchir la liste des EPC non assignés
    loadUnassignedEpc();
  } catch (err) {
    console.error("[DISPLAY_PRODUCT_EPC] linkEpc error", err);
    if (errorEl) {
      errorEl.textContent = err.message || "Erreur lors de la liaison de l'EPC";
      errorEl.style.display = "block";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnRefreshEpc = $("#btnRefreshEpc");
  const btnUseLastEpc = $("#btnUseLastEpc");
  const form = $("#epcLinkForm");
  const epcSelect = $("#epcSelect");
  const epcInput = $("#epcInput");

  if (btnRefreshEpc) {
    btnRefreshEpc.addEventListener("click", (e) => {
      e.preventDefault();
      loadUnassignedEpc();
    });
  }

  // ✅ Nouveau : bouton “Utiliser l’EPC scanné”
  if (btnUseLastEpc) {
    btnUseLastEpc.addEventListener("click", (e) => {
      e.preventDefault();
      useLastSeenEpc();
    });
  }

  // Bonus UX : quand on sélectionne un EPC, on le met dans le champ
  if (epcSelect && epcInput) {
    epcSelect.addEventListener("change", () => {
      if (epcSelect.value) epcInput.value = epcSelect.value;
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      linkEpc();
    });
  }
});

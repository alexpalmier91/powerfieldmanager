// app/static/superuser/presentoir_clients.js

console.log("[PRESENTOIR_CLIENTS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

function $(sel, root = document) {
  return root.querySelector(sel);
}

async function fetchJSON(url, options = {}) {
  const headers = options.headers || {};
  headers.Accept = "application/json";
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[PRESENTOIR_CLIENTS] HTTP", res.status, txt);
    throw new Error("HTTP " + res.status);
  }
  return res.json();
}

/* ================= OWNERS ================= */

async function loadOwners() {
  const tbody = $("#ownersTableBody");
  const ownerSelect = $("#end_owner_id");
  if (!tbody) return;

  try {
    const data = await fetchJSON(`${API_BASE}/superuser/display-owners`);
    const items = data.items || [];

    // Tableau
    tbody.innerHTML = "";
    if (!items.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="4">Aucun client propriétaire pour le moment.</td>`;
      tbody.appendChild(tr);
    } else {
      items.forEach((o) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${o.id}</td>
          <td>${o.name}</td>
          <td>${o.contact_name || ""}</td>
          <td>${o.email || ""}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Select propriétaire dans le formulaire client final
    if (ownerSelect) {
      const currentVal = ownerSelect.value || "";
      ownerSelect.innerHTML =
        `<option value="">— Sélectionner un propriétaire —</option>`;
      items.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = String(o.id);
        opt.textContent = `${o.name} (ID ${o.id})`;
        ownerSelect.appendChild(opt);
      });
      // garde la valeur si possible
      if (currentVal) {
        ownerSelect.value = currentVal;
      }
    }
  } catch (err) {
    console.error("[PRESENTOIR_CLIENTS] loadOwners error", err);
    tbody.innerHTML =
      `<tr><td colspan="4">Erreur de chargement des propriétaires.</td></tr>`;
  }
}

function initOwnerForm() {
  const form = $("#formOwner");
  const statusEl = $("#ownerFormStatus");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (statusEl) statusEl.textContent = "Enregistrement…";

    const payload = {
      name: $("#owner_name")?.value?.trim() || "",
      contact_name: $("#owner_contact_name")?.value?.trim() || null,
      email: $("#owner_email")?.value?.trim() || null,
      phone: $("#owner_phone")?.value?.trim() || null,
      company_number: $("#owner_company_number")?.value?.trim() || null,
    };

    if (!payload.name) {
      if (statusEl) statusEl.textContent = "Le nom est obligatoire.";
      return;
    }

    try {
      await fetchJSON(`${API_BASE}/superuser/display-owners`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // reset form
      form.reset();
      if (statusEl) statusEl.textContent = "Client propriétaire créé.";
      // reload list + select
      await loadOwners();

      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 2000);
    } catch (err) {
      console.error("[PRESENTOIR_CLIENTS] create owner error", err);
      if (statusEl) statusEl.textContent = "Erreur lors de la création.";
    }
  });
}

/* ================= END CLIENTS ================= */

async function loadEndClients() {
  const tbody = $("#endClientsTableBody");
  if (!tbody) return;

  try {
    const data = await fetchJSON(`${API_BASE}/superuser/display-end-clients`);
    const items = data.items || [];

    tbody.innerHTML = "";
    if (!items.length) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td colspan="5">Aucun client final pour le moment.</td>`;
      tbody.appendChild(tr);
    } else {
      items.forEach((c) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${c.id}</td>
          <td>${c.name}</td>
          <td>${c.type || ""}</td>
          <td>${(c.postcode || "") + " " + (c.city || "")}</td>
          <td>${c.owner_client_name || ""}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error("[PRESENTOIR_CLIENTS] loadEndClients error", err);
    tbody.innerHTML =
      `<tr><td colspan="5">Erreur de chargement des clients finaux.</td></tr>`;
  }
}

function initEndClientForm() {
  const form = $("#formEndClient");
  const statusEl = $("#endFormStatus");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (statusEl) statusEl.textContent = "Enregistrement…";

    const ownerVal = $("#end_owner_id")?.value || "";

    const payload = {
      name: $("#end_name")?.value?.trim() || "",
      type: $("#end_type")?.value?.trim() || null,
      contact_name: $("#end_contact_name")?.value?.trim() || null,
      email: $("#end_email")?.value?.trim() || null,
      phone: $("#end_phone")?.value?.trim() || null,
      address1: $("#end_address1")?.value?.trim() || null,
      address2: $("#end_address2")?.value?.trim() || null,
      postcode: $("#end_postcode")?.value?.trim() || null,
      city: $("#end_city")?.value?.trim() || null,
      country: $("#end_country")?.value?.trim() || null,
      external_ref: $("#end_external_ref")?.value?.trim() || null,
      owner_client_id: ownerVal ? Number(ownerVal) : null,
    };

    if (!payload.name) {
      if (statusEl) statusEl.textContent = "Le nom est obligatoire.";
      return;
    }

    try {
      await fetchJSON(`${API_BASE}/superuser/display-end-clients`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      form.reset();
      if (statusEl) statusEl.textContent = "Client final créé.";
      // recharger la liste des clients finaux
      await loadEndClients();

      setTimeout(() => {
        if (statusEl) statusEl.textContent = "";
      }, 2000);
    } catch (err) {
      console.error("[PRESENTOIR_CLIENTS] create end-client error", err);
      if (statusEl) statusEl.textContent = "Erreur lors de la création.";
    }
  });
}

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async () => {
  initOwnerForm();
  initEndClientForm();
  await loadOwners();
  await loadEndClients();
});

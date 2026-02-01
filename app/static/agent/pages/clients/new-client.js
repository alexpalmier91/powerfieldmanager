// app/static/agent/pages/clients/new-client.js

const API_BASE = "/api-zenhub";

// --- helpers token / fetch -----------------------------------------
const TOKEN_KEYS = [
  "zenhub_token", "zen_token", "access_token", "auth_token", "token",
  "zentro_token", "jwt"
];

function readTokenFromStorage() {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (v) return v.replace(/^Bearer\s+/i, "");
  }
  return null;
}
function readTokenFromCookie() {
  const m1 = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/i);
  if (m1) return decodeURIComponent(m1[1]);
  const m2 = document.cookie.match(/(?:^|;\s*)Authorization=Bearer%20([^;]+)/i);
  if (m2) return decodeURIComponent(m2[1]);
  return null;
}
function getToken() {
  return readTokenFromStorage() || readTokenFromCookie();
}

async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return fetch(url, { ...options, headers, credentials: "include" });
}

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------
//  Modal + création client
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const btnOpen   = $("#btnAddClient");
  const modal     = $("#clientCreateModal");
  const form      = $("#clientCreateForm");
  const btnCancel = $("#btnCancelCreateClient");
  const errorBox  = $("#clientCreateError");

  if (!btnOpen || !modal || !form) return;

  // --- ouverture du popup ---
  btnOpen.addEventListener("click", () => {
    errorBox.textContent = "";
    form.reset();
    modal.style.display = "flex"; // important pour centrer (overlay en flex)
  });

  // --- fermeture du popup ---
  const closeModal = () => {
    modal.style.display = "none";
  };

  if (btnCancel) {
    btnCancel.addEventListener("click", closeModal);
  }

  // clic sur le fond sombre pour fermer
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) {
      closeModal();
    }
  });

  // --- submit création client ---
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorBox.textContent = "";

    const fd = new FormData(form);

    const payload = {
      company_name: (fd.get("company_name") || "").toString().trim(),
      contact:      (fd.get("contact") || "").toString().trim(),
      address:      (fd.get("address1") || fd.get("address") || "").toString().trim(),
      postcode:     (fd.get("postcode") || "").toString().trim(),
      city:         (fd.get("city") || "").toString().trim(),
      country:      (fd.get("country") || "").toString().trim(),
      email:        (fd.get("email") || "").toString().trim(),
      groupement:   (fd.get("groupement") || "").toString().trim(),
      phone:        (fd.get("phone") || "").toString().trim(),
      iban:         (fd.get("iban") || "").toString().trim(),
      bic:          (fd.get("bic") || "").toString().trim(),
      payment_terms:(fd.get("payment_terms") || "").toString().trim(),
      credit_limit: fd.get("credit_limit") || null,
    };

    if (!payload.company_name || !payload.email) {
      errorBox.textContent = "Nom de la société et email sont obligatoires.";
      return;
    }

    try {
      const res = await authFetch(`${API_BASE}/agent/clients/new`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}

      if (!res.ok) {
        if (data && data.detail === "CLIENT_EMAIL_ALREADY_EXISTS") {
          errorBox.textContent = "Un client avec cet email existe déjà.";
        } else {
          errorBox.textContent = "Erreur lors de la création du client.";
        }
        console.error("create client error", res.status, text);
        return;
      }

      // ✅ Succès
      closeModal();

      // On pose toujours un flag pour la page “Mes clients”
      sessionStorage.setItem("agentClientCreated", "1");

      if (window.reloadAgentClients) {
        // Si la liste est rechargée via JS, on affiche le bandeau tout de suite
        await window.reloadAgentClients();

        const successBox = document.querySelector("#clientCreateSuccess");
        if (successBox) {
          successBox.textContent = "Client créé avec succès.";
          successBox.style.display = "block";
          setTimeout(() => { successBox.style.opacity = "0"; }, 4000);
          setTimeout(() => {
            successBox.style.display = "none";
            successBox.style.opacity = "";
          }, 4500);
        }
      } else {
        // Fallback : rechargement complet
        window.location.reload();
      }

    } catch (e) {
      console.error(e);
      errorBox.textContent = "Erreur réseau.";
    }
  });
});

// app/static/superuser/superuser_presentoirs.js

console.log("[SUPERUSER_PRESENTOIRS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

// Sélecteurs
const btnOpen = document.getElementById("btn-open-presentoir-modal");
const modal = document.getElementById("presentoir-modal");
const overlay = document.getElementById("presentoir-modal-overlay");
const form = document.getElementById("presentoir-form");
const errorBox = document.getElementById("presentoir-form-error");
const btnCancel = document.getElementById("presentoir-btn-cancel");

function openModal() {
  if (!modal || !overlay) return;
  modal.classList.remove("hidden");
  overlay.classList.remove("hidden");
}

function closeModal() {
  if (!modal || !overlay) return;
  modal.classList.add("hidden");
  overlay.classList.add("hidden");
  if (errorBox) {
    errorBox.style.display = "none";
    errorBox.textContent = "";
  }
  if (form) {
    form.reset();
  }
}

// Événements UI
if (btnOpen) {
  btnOpen.addEventListener("click", () => {
    openModal();
  });
}

if (btnCancel) {
  btnCancel.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
}

if (overlay) {
  overlay.addEventListener("click", () => {
    closeModal();
  });
}

// Soumission du formulaire
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!errorBox) return;

    errorBox.style.display = "none";
    errorBox.textContent = "";

    const code = form.code.value.trim();
    const name = form.name.value.trim();
    const pharmacyIdRaw = form.pharmacy_id.value.trim();
    const location = form.location.value.trim();
    const tunnelUrl = form.tunnel_url.value.trim();

    if (!code) {
      errorBox.textContent = "Le code est obligatoire.";
      errorBox.style.display = "block";
      return;
    }

    const payload = {
      code,
      name: name || null,
      pharmacy_id: pharmacyIdRaw ? parseInt(pharmacyIdRaw, 10) : null,
      location: location || null,
      tunnel_url: tunnelUrl || null,
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (TOKEN) {
      headers.Authorization = `Bearer ${TOKEN}`;
    }

    try {
      const res = await fetch(`${API_BASE}/superuser/presentoirs`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (data && data.detail) {
            detail = data.detail;
          }
        } catch (err) {
          // ignore
        }
        errorBox.textContent = detail;
        errorBox.style.display = "block";
        return;
      }

      // Succès -> on recharge la page pour voir le présentoir créé
      window.location.reload();
    } catch (err) {
      console.error("[SUPERUSER_PRESENTOIRS] Erreur réseau", err);
      errorBox.textContent = "Erreur réseau lors de la création du présentoir.";
      errorBox.style.display = "block";
    }
  });
}

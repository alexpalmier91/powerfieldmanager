// app/static/labo/pages/sales_import.js

// ========== Auth helper (copié de orders.js) ==========

function getToken() {
  return localStorage.getItem("token");
}

async function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    console.error("Token JWT manquant dans localStorage");
    throw new Error("Missing token");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);

  // Ne pas forcer Content-Type si body = FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

// ========== Logique d'import ==========

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("sales-import-form");
  if (!form) return;

  const btn = document.getElementById("btn-import");
  const loader = document.getElementById("sales-import-loader");
  const resultBlock = document.getElementById("sales-import-result");
  const resultJson = document.getElementById("sales-import-json");
  const warningsBlock = document.getElementById("sales-import-warnings");
  const warningsList = document.getElementById("sales-import-warnings-list");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById("file");
    if (!fileInput.files.length) {
      alert("Merci de sélectionner un fichier.");
      return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    btn.disabled = true;
    loader.style.display = "inline-block";
    resultBlock.style.display = "none";
    warningsBlock.style.display = "none";
    warningsList.innerHTML = "";

    try {
      const resp = await authFetch("/api-zenhub/labo/import/sales", {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("Erreur import ventes:", resp.status, txt);
        let detail = "Erreur lors de l'import.";
        try {
          const j = JSON.parse(txt);
          if (j.detail) detail = j.detail;
        } catch (_) {}
        throw new Error(detail);
      }

      const data = await resp.json();
      console.log("Résultat import ventes:", data);

      resultJson.textContent = JSON.stringify(data, null, 2);
      resultBlock.style.display = "block";

      if (data.warnings && data.warnings.length) {
        data.warnings.forEach((w) => {
          const li = document.createElement("li");
          li.textContent = w;
          warningsList.appendChild(li);
        });
        warningsBlock.style.display = "block";
      }

      alert("Import terminé avec succès.");

    } catch (err) {
      console.error(err);
      alert(err.message || "Erreur inconnue lors de l'import.");
    } finally {
      btn.disabled = false;
      loader.style.display = "none";
    }
  });
});

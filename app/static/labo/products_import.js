// app/static/labo/products_import.js

(function () {
  const form = document.getElementById("import-form");
  const fileInput = document.getElementById("file");
  const resultCard = document.getElementById("import-result");
  const spanCreated = document.getElementById("res-created");
  const spanUpdated = document.getElementById("res-updated");
  const tbodyErrors = document.getElementById("errors-tbody");

  if (!form) return;

  function resetErrors() {
    if (!tbodyErrors) return;
    tbodyErrors.innerHTML = "";
    const tr = document.createElement("tr");
    tr.id = "errors-empty";
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "Aucune erreur.";
    tr.appendChild(td);
    tbodyErrors.appendChild(tr);
  }

  function renderErrors(errors) {
    if (!tbodyErrors) return;
    tbodyErrors.innerHTML = "";

    if (!errors || errors.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Aucune erreur.";
      tr.appendChild(td);
      tbodyErrors.appendChild(tr);
      return;
    }

    errors.forEach((err) => {
      const tr = document.createElement("tr");
      const tdRow = document.createElement("td");
      const tdSku = document.createElement("td");
      const tdMsg = document.createElement("td");

      tdRow.textContent = err.row ?? "";
      tdSku.textContent = err.sku ?? "";
      tdMsg.textContent = err.message ?? "";

      tr.appendChild(tdRow);
      tr.appendChild(tdSku);
      tr.appendChild(tdMsg);
      tbodyErrors.appendChild(tr);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
      alert("Merci de sélectionner un fichier .xlsx");
      return;
    }

    const file = fileInput.files[0];
    const btn = form.querySelector("button[type='submit']");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Import en cours...";
    }

    resetErrors();

    const formData = new FormData();
    formData.append("file", file);

    try {
      // 🔐 utilise exactement le même helper que products.js
      const resp = await authFetch("/api-zenhub/labo/products/import", {
        method: "POST",
        body: formData, // ne pas définir Content-Type, c'est géré par le navigateur
      });

      if (resp.status === 401) {
        console.error("401 Unauthorized sur /import");
        alert("Non autorisé (401). Vérifie que tu es bien connecté.");
        return;
      }

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("Erreur import produits:", resp.status, txt);
        alert("Erreur lors de l'import : " + resp.status);
        return;
      }

      const data = await resp.json();
      spanCreated.textContent = data.created ?? 0;
      spanUpdated.textContent = data.updated ?? 0;
      renderErrors(data.errors || []);

      resultCard.classList.remove("hidden");
    } catch (err) {
      console.error("Erreur inattendue import:", err);
      alert("Erreur inattendue lors de l'import.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Importer";
      }
    }
  });
})();

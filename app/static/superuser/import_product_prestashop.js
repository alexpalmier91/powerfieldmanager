console.log("[IMPORT_PRODUCT_PRESTASHOP] JS loaded");

const laboSelect = document.getElementById("laboSelect");
const btnImport = document.getElementById("btnImport");
const statusBox = document.getElementById("importStatus");

// --------------------------------------------------
// Chargement des labos injectés par le template
// --------------------------------------------------
function loadLabos() {
  let labos = window.__LABOS__;

  console.log("[IMPORT_PRODUCT_PRESTASHOP] LABOS raw:", labos);

  // 🔒 Normalisation (sécurité maximale)
  if (!Array.isArray(labos)) {
    labos = Object.values(labos || {});
  }

  console.log("[IMPORT_PRODUCT_PRESTASHOP] LABOS normalized:", labos);

  laboSelect.innerHTML = "";

  if (!Array.isArray(labos) || labos.length === 0) {
    console.error("Aucun labo disponible");
    return;
  }

  for (const labo of labos) {
    if (!labo || labo.id == null) continue;

    const opt = document.createElement("option");
    opt.value = labo.id;
    opt.textContent = labo.name || `Labo #${labo.id}`;
    laboSelect.appendChild(opt);
  }
}

// --------------------------------------------------
// Lancer l'import PrestaShop
// --------------------------------------------------
async function runImport() {
  const laboId = laboSelect.value;
  if (!laboId) return;

  // ✅ paramètres import images
  const images_mode = "all_images";
  const images_limit = 6;
  const limit = 500;

  // si tu veux réactiver "since" plus tard, laisse null
  const since = null;

  const qs = new URLSearchParams({
    images_mode,
    images_limit: String(images_limit),
    limit: String(limit),
  });
  if (since) qs.set("since", since);

  btnImport.disabled = true;
  statusBox.innerHTML = "<p>⏳ Import en cours…</p>";

  try {
    const url = `/api-zenhub/superuser/labos/${laboId}/product-prestashop-import/run-now?${qs.toString()}`;
    console.log("[IMPORT_PRODUCT_PRESTASHOP] POST", url);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || "Erreur lors de l'import");
    }

    const data = await res.json();
    const summary = data.summary || {};

    statusBox.innerHTML = `
      <div class="card" style="border-left:4px solid #22c55e; padding:12px;">
        <h3 style="margin-top:0;">Import terminé</h3>

        <div style="margin:8px 0 12px 0; font-size: 13px; opacity:.9;">
          <div><strong>images_mode :</strong> ${summary.images_mode ?? "?"}</div>
          <div><strong>images_limit :</strong> ${summary.images_limit ?? "?"}</div>
          <div><strong>images_ok :</strong> ${summary.images_ok ?? 0}</div>
          <div><strong>images_failed :</strong> ${summary.images_failed ?? 0}</div>
          <div><strong>images_skipped_cache :</strong> ${summary.images_skipped_cache ?? 0}</div>
        </div>

        <ul style="margin:0; padding-left:16px;">
          <li><strong>Total reçus :</strong> ${summary.total_received ?? 0}</li>
          <li><strong>Produits créés :</strong> ${summary.created ?? 0}</li>
          <li><strong>Produits mis à jour :</strong> ${summary.updated ?? 0}</li>
          <li><strong>Produits ignorés :</strong> ${summary.ignored ?? 0}</li>
        </ul>
      </div>
    `;
  } catch (e) {
    console.error(e);
    statusBox.innerHTML = `
      <div class="card" style="border-left:4px solid #ef4444; padding:12px;">
        <h3 style="margin-top:0;">Erreur</h3>
        <pre style="white-space:pre-wrap;">${e.message}</pre>
      </div>
    `;
  } finally {
    btnImport.disabled = false;
  }
}

// --------------------------------------------------
// Init
// --------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadLabos();
  btnImport.addEventListener("click", runImport);
});

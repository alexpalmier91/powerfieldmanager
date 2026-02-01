// app/static/superuser/presentoir_detail_live.js

console.log("[PRESENTOIR_LIVE] JS chargé");

const PFM_API_BASE = "/api-zenhub";

function pfmFormatDate(isoStr) {
  if (!isoStr) return "-";
  const d = new Date(isoStr);
  return d.toLocaleString();
}

async function pfmRefreshPresentoir() {
  const root = document.getElementById("presentoir-detail");
  if (!root) return;

  const presentoirId = root.dataset.presentoirId;
  if (!presentoirId) return;

  try {
    const res = await fetch(
      `${PFM_API_BASE}/superuser/presentoirs/${presentoirId}/live`
    );
    if (!res.ok) {
      console.error("[PRESENTOIR_LIVE] HTTP error", res.status);
      return;
    }

    const data = await res.json();
    const p = data.presentoir;

    // ----- Heartbeat -----
    const hbEl = document.getElementById("presentoir-last-heartbeat");
    if (hbEl && p.last_seen_at) {
      hbEl.textContent = pfmFormatDate(p.last_seen_at);
    }

    const nbEl = document.getElementById("presentoir-current-count");
    if (nbEl) {
      nbEl.textContent = p.current_num_products ?? 0;
    }

    // ----- Tableau "Produits présents" -----
    const tbodySku = document.getElementById("presentoir-sku-summary-body");
    if (tbodySku) {
      tbodySku.innerHTML = "";
      if (data.current_items_by_sku.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td colspan="3">Aucun produit présent sur le présentoir.</td>';
        tbodySku.appendChild(tr);
      } else {
        data.current_items_by_sku.forEach((row) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${row.sku}</td>
            <td>${row.count}</td>
            <td>${pfmFormatDate(row.last_movement)}</td>
          `;
          tbodySku.appendChild(tr);
        });
      }
    }

    // ----- Historique des événements -----
    const tbodyEv = document.getElementById("presentoir-events-body");
    if (tbodyEv) {
      tbodyEv.innerHTML = "";
      if (data.events.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td colspan="4">Aucun événement pour ce présentoir.</td>';
        tbodyEv.appendChild(tr);
      } else {
        data.events.forEach((ev) => {
          const typeLabel =
            ev.event_type === "removal" ? "Retrait" : "Retour";
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${pfmFormatDate(ev.occurred_at)}</td>
            <td>${typeLabel}</td>
            <td>${ev.sku || "-"}</td>
            <td>${ev.epc}</td>
          `;
          tbodyEv.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.error("[PRESENTOIR_LIVE] fetch error", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  pfmRefreshPresentoir();
  // refresh toutes les 3 secondes
  setInterval(pfmRefreshPresentoir, 3000);
});

// app/static/agent/agent_stats_sales.js

console.log("[AGENT_STATS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");

// DOM helpers
const $ = (sel, root = document) => root.querySelector(sel);

let chartInstance = null;

async function fetchJSON(url) {
  console.log("[AGENT_STATS] fetch", url);
  const headers = {
    Accept: "application/json",
  };
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[AGENT_STATS] HTTP error", res.status, txt);
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function loadLabos() {
  const select = $("#labo-select");
  if (!select) return;

  try {
    const data = await fetchJSON(`${API_BASE}/agent/labos`);
    console.log("[AGENT_STATS] labos =", data);
    data.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = String(l.id);
      opt.textContent = l.name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Erreur chargement labos", err);
  }
}

function buildStatsUrl() {
  const periodSel = $("#period-select");
  const laboSel = $("#labo-select");
  const fromInput = $("#date-from");
  const toInput = $("#date-to");

  const params = new URLSearchParams();

  // Labo : si vide => tous les labos
  if (laboSel && laboSel.value) {
    params.set("labo_id", laboSel.value);
  }

  const from = fromInput?.value;
  const to = toInput?.value;

  if (from && to) {
    params.set("date_from", from);
    params.set("date_to", to);
  } else {
    const period = periodSel?.value || "last_12_months";
    params.set("period", period);
  }

  return `${API_BASE}/agent/stats/sales-monthly?${params.toString()}`;
}

function renderChart(labels, caFacture, bcCa) {
  const canvas = document.getElementById("sales-chart");
  if (!canvas) return;

  // Taille fixe pour casser tout effet d’accordéon
  const parentWidth = canvas.parentElement
    ? canvas.parentElement.clientWidth
    : 900;

  canvas.width = parentWidth;
  canvas.height = 320; // hauteur fixe

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const data = {
    labels,
    datasets: [
      {
        type: "bar",
        label: "CA facturé (FA)",
        data: caFacture,
        yAxisID: "y",
        borderWidth: 1,
        backgroundColor: "rgba(37, 99, 235, 0.6)",
        borderColor: "rgba(37, 99, 235, 1)",
      },
      {
        type: "line",
        label: "CA potentiel (BC)",
        data: bcCa,
        yAxisID: "y",
        borderWidth: 2,
        tension: 0.2,
        fill: false,
        borderColor: "rgba(16, 185, 129, 1)",
        pointBackgroundColor: "rgba(16, 185, 129, 1)",
      },
    ],
  };

  chartInstance = new Chart(canvas, {
    type: "bar",
    data,
    options: {
      responsive: false,           // <<< clé pour empêcher le resize infini
      maintainAspectRatio: false, // on respecte width/height du canvas
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (val) => `${val} €`,
          },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y || 0;
              return `${ctx.dataset.label}: ${v.toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} €`;
            },
          },
        },
        legend: {
          position: "top",
        },
      },
    },
  });
}

async function loadStats() {
  const loadingEl = $("#chart-loading");
  const periodLabel = $("#period-label");

  if (loadingEl) loadingEl.textContent = "Chargement du graphique...";
  if (periodLabel) periodLabel.textContent = "Chargement de la période...";

  try {
    const url = buildStatsUrl();
    const data = await fetchJSON(url);

    console.log("[AGENT_STATS] data =", data);

    const labels = data.labels || [];
    const caFacture = data.ca_facture || [];
    const bcCa = data.ca_potentiel || []; // <-- CA potentiel

    if (periodLabel && data.period_label) {
      periodLabel.textContent = data.period_label;
    }

    if (loadingEl) {
      loadingEl.textContent = labels.length
        ? ""
        : "Aucune donnée pour les filtres sélectionnés.";
    }

    renderChart(labels, caFacture, bcCa);
  } catch (err) {
    console.error("Erreur chargement stats ventes", err);
    if (loadingEl) {
      loadingEl.textContent = "Erreur lors du chargement des statistiques.";
    }
  }
}

function initEvents() {
  const periodSel = $("#period-select");
  const laboSel = $("#labo-select");
  const applyBtn = $("#apply-filters");

  if (periodSel) {
    periodSel.addEventListener("change", () => {
      const fromInput = $("#date-from");
      const toInput = $("#date-to");
      if (fromInput) fromInput.value = "";
      if (toInput) toInput.value = "";
      loadStats();
    });
  }

  if (laboSel) {
    laboSel.addEventListener("change", () => {
      loadStats();
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      loadStats();
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[AGENT_STATS] DOMContentLoaded");
  if (!TOKEN) {
    console.warn("[AGENT_STATS] Aucun token dans localStorage('token')");
  }

  await loadLabos();
  initEvents();

  // Par défaut : tous labos + 12 derniers mois
  loadStats();
});

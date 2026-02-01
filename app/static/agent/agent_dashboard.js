// app/static/agent/agent_dashboard.js
(() => {
  "use strict";

  const TOKEN_KEY = "zentro_token";
  const DASHBOARD_API = "/api-zenhub/agent/dashboard/stats";
  const ME_API = "/api-zenhub/agent/me";

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = "/login";
    return;
  }
  const headers = { Authorization: "Bearer " + token };

  const $ = (id) => document.getElementById(id);

  const formatCurrency = (value) => {
    const v = typeof value === "number" ? value : Number(value || 0);
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v);
  };

  const formatInt = (value) => {
    const v = typeof value === "number" ? value : Number(value || 0);
    return v.toLocaleString("fr-FR");
  };

  const buildDailyLabels = (daily) =>
    (daily || []).map((item) => {
      // item.date attendu format "YYYY-MM-DD"
      const d = new Date(item.date);
      if (isNaN(d.getTime())) {
        return item.date;
      }
      return d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      });
    });

  // --- Optionnel : affiche l’agent connecté dans un span#whoami si présent ---
  async function loadMe() {
    const whoamiEl = $("whoami");
    if (!whoamiEl) return;

    try {
      const res = await fetch(ME_API, { headers });
      if (!res.ok) return;
      const me = await res.json();
      whoamiEl.textContent = me.email || "Agent connecté";
    } catch (e) {
      console.error("Erreur /agent/me :", e);
    }
  }

  // --- Charge les stats du dashboard (KPI + CA par labo + graphique) ---
  async function loadDashboardStats() {
    const caMonthEl = $("kpi-ca-month");
    const caYearEl = $("kpi-ca-year");
	const comMonthEl = $("kpi-commission-month");
    const comYearEl = $("kpi-commission-year");
    const clientsActiveEl = $("kpi-clients-active");
    const labosEl = $("kpi-labos");
    const caLaboBody = $("table-ca-labo-body");
    const chartCanvas = $("chart-ca-daily");
    const chartLoader = $("chart-loader");

    if (caLaboBody) {
      caLaboBody.innerHTML = `
        <tr>
          <td colspan="2" style="padding:8px; text-align:center; color:#9ca3af;">
            Chargement...
          </td>
        </tr>`;
    }
    if (chartLoader) {
      chartLoader.textContent = "Chargement du graphique...";
      chartLoader.style.display = "block";
    }

    try {
      const res = await fetch(DASHBOARD_API, { headers });
      if (res.status === 401 || res.status === 403) {
        // Token invalide ou agent non autorisé => retour login
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error("Erreur API dashboard: " + res.status);
      }

      const data = await res.json();

      // ---------- KPI ----------
      if (caMonthEl) {
        caMonthEl.textContent = formatCurrency(data.ca_month || 0);
      }
      if (caYearEl) {
        caYearEl.textContent = formatCurrency(data.ca_year || 0);
      }
	  if (comMonthEl) {
        comMonthEl.textContent = formatCurrency(data.commission_month || 0);
      }
      if (comYearEl) {
        comYearEl.textContent = formatCurrency(data.commission_year || 0);
      }
      if (clientsActiveEl) {
        clientsActiveEl.textContent = formatInt(data.active_clients_12m || 0);
      }
      if (labosEl) {
        labosEl.textContent = formatInt(data.labo_count || 0);
      }

      // ---------- Tableau CA par labo ----------
      if (caLaboBody) {
        const list = Array.isArray(data.ca_by_labo) ? data.ca_by_labo : [];
        if (!list.length) {
          caLaboBody.innerHTML = `
            <tr>
              <td colspan="2" style="padding:8px; text-align:center; color:#9ca3af;">
                Aucun CA sur les 12 derniers mois.
              </td>
            </tr>`;
        } else {
          caLaboBody.innerHTML = list
            .map((row) => {
              const name = row.labo_name || "-";
              const ca = formatCurrency(row.ca_total || 0);
              return `
                <tr>
                  <td style="padding:6px 8px; border-bottom:1px solid #e5e7eb;">
                    ${name}
                  </td>
                  <td style="padding:6px 8px; border-bottom:1px solid #e5e7eb; text-align:right; font-weight:600;">
                    ${ca}
                  </td>
                </tr>`;
            })
            .join("");
        }
      }

      // ---------- Graphique CA par jour (Chart.js) ----------
      if (chartCanvas && window.Chart) {
        const ctx = chartCanvas.getContext("2d");
        const daily = Array.isArray(data.daily_ca) ? data.daily_ca : [];
        const labels = buildDailyLabels(daily);
        const values = daily.map((d) => d.total_ht || 0);

        if (chartLoader) {
          chartLoader.style.display = "none";
        }

        // eslint-disable-next-line no-undef
        new Chart(ctx, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "CA HT par jour",
                data: values,
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                ticks: {
                  maxRotation: 0,
                  minRotation: 0,
                },
              },
              y: {
                beginAtZero: true,
              },
            },
            plugins: {
              legend: {
                display: true,
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => formatCurrency(ctx.parsed.y || 0),
                },
              },
            },
          },
        });
      } else if (chartLoader) {
        chartLoader.textContent = "Erreur : Chart.js non chargé.";
      }
    } catch (err) {
      console.error("Erreur Dashboard Agent :", err);
      if (caLaboBody) {
        caLaboBody.innerHTML = `
          <tr>
            <td colspan="2" style="padding:8px; text-align:center; color:#dc2626;">
              Erreur de chargement des données.
            </td>
          </tr>`;
      }
      if (chartLoader) {
        chartLoader.textContent = "Erreur de chargement du graphique.";
      }
    }
  }

  async function init() {
    await loadMe();              // optionnel, ne casse rien si #whoami n’existe pas
    await loadDashboardStats();  // charge KPI + tableau + graph
  }

  // Logout éventuel (si un bouton #logoutBtn existe dans ton layout)
  const logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = "/login";
    });
  }

  // Si tu veux plus tard filtrer le dashboard par labo, tu peux écouter :
  // window.addEventListener("quick-labo-change", (e) => { e.detail.labo_id ... })

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// app/static/labo/labo_dashboard.js
(() => {
  "use strict";

  const TOKEN_KEY = "zentro_token";
  const SUMMARY_API = "/api-zenhub/labo/dashboard/summary";
  const DAILY_API = "/api-zenhub/labo/dashboard/daily-sales";
  const MONTHLY_API = "/api-zenhub/labo/dashboard/monthly-sales";

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

  const buildDailyLabel = (isoDate) => {
    // "YYYY-MM-DD" -> "JJ/MM"
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) {
      return isoDate;
    }
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    });
  };

  const buildMonthlyLabel = (isoDate) => {
    // "YYYY-MM-01" -> "MM/AAAA"
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) {
      return isoDate;
    }
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const y = d.getFullYear();
    return `${m}/${y}`;
  };

  let dailyChart = null;
  let monthlyChart = null;

  // ------------------ SUMMARY KPI ------------------

  async function loadSummary() {
    const caMonthEl = $("kpi-ca-month");
    const caYearEl = $("kpi-ca-year");
    const ordersTodayEl = $("kpi-orders-today");
    const activeClientsEl = $("kpi-active-clients");
    const activeAgentsEl = $("kpi-active-agents");
    const outOfStockEl = $("kpi-out-of-stock");

    try {
      const res = await fetch(SUMMARY_API, { headers });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error("Erreur API summary: " + res.status);
      }

      const data = await res.json();

      if (caMonthEl) caMonthEl.textContent = formatCurrency(data.ca_month_ht || 0);
      if (caYearEl) caYearEl.textContent = formatCurrency(data.ca_year_ht || 0);
      if (ordersTodayEl) ordersTodayEl.textContent = formatInt(data.orders_today || 0);
      if (activeClientsEl) activeClientsEl.textContent = formatInt(data.active_clients_12m || 0);
      if (activeAgentsEl) activeAgentsEl.textContent = formatInt(data.active_agents_12m || 0);
      if (outOfStockEl) outOfStockEl.textContent = formatInt(data.out_of_stock_products || 0);
    } catch (err) {
      console.error("Erreur Dashboard Labo (summary) :", err);
    }
  }

  // ------------------ DAILY SALES ------------------

  async function loadDailySales() {
    const canvas = $("chart-daily");
    const loader = $("daily-loader");
    const empty = $("daily-empty");
    const periodLabel = $("daily-period-label");

    if (loader) {
      loader.style.display = "block";
      loader.textContent = "Chargement...";
    }
    if (empty) empty.style.display = "none";

    try {
      const res = await fetch(DAILY_API, { headers });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error("Erreur API daily-sales: " + res.status);
      }

      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      if (loader) loader.style.display = "none";

      if (!list.length) {
        if (empty) empty.style.display = "block";
        if (dailyChart) {
          dailyChart.destroy();
          dailyChart = null;
        }
        return;
      }

      const labels = list.map((item) => buildDailyLabel(item.date));
      const values = list.map((item) => item.ca_ht || 0);

      if (canvas && window.Chart) {
        const ctx = canvas.getContext("2d");
        if (dailyChart) dailyChart.destroy();

        // eslint-disable-next-line no-undef
        dailyChart = new Chart(ctx, {
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

        if (periodLabel && list.length > 0) {
          const first = list[0].date;
          const last = list[list.length - 1].date;
          periodLabel.textContent = `Du ${buildDailyLabel(first)} au ${buildDailyLabel(
            last
          )}`;
        }
      } else if (loader) {
        loader.style.display = "block";
        loader.textContent = "Erreur : Chart.js non chargé.";
      }
    } catch (err) {
      console.error("Erreur Dashboard Labo (daily-sales) :", err);
      if (loader) {
        loader.style.display = "block";
        loader.textContent = "Erreur lors du chargement des ventes journalières.";
      }
    }
  }

  // ------------------ MONTHLY SALES ------------------

  async function loadMonthlySales() {
    const canvas = $("chart-monthly");
    const loader = $("monthly-loader");
    const empty = $("monthly-empty");
    const periodLabel = $("monthly-period-label");

    if (loader) {
      loader.style.display = "block";
      loader.textContent = "Chargement...";
    }
    if (empty) empty.style.display = "none";

    try {
      const res = await fetch(MONTHLY_API, { headers });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error("Erreur API monthly-sales: " + res.status);
      }

      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      if (loader) loader.style.display = "none";

      if (!list.length) {
        if (empty) empty.style.display = "block";
        if (monthlyChart) {
          monthlyChart.destroy();
          monthlyChart = null;
        }
        return;
      }

      const labels = list.map((item) => buildMonthlyLabel(item.month));
      const values = list.map((item) => item.ca_ht || 0);

      if (canvas && window.Chart) {
        const ctx = canvas.getContext("2d");
        if (monthlyChart) monthlyChart.destroy();

        // eslint-disable-next-line no-undef
        monthlyChart = new Chart(ctx, {
          type: "bar", // tu peux passer à "line" si tu veux
          data: {
            labels,
            datasets: [
              {
                label: "CA HT par mois",
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

        if (periodLabel && list.length > 0) {
          const first = list[0].month;
          const last = list[list.length - 1].month;
          periodLabel.textContent = `De ${buildMonthlyLabel(first)} à ${buildMonthlyLabel(
            last
          )}`;
        }
      } else if (loader) {
        loader.style.display = "block";
        loader.textContent = "Erreur : Chart.js non chargé.";
      }
    } catch (err) {
      console.error("Erreur Dashboard Labo (monthly-sales) :", err);
      if (loader) {
        loader.style.display = "block";
        loader.textContent = "Erreur lors du chargement des ventes mensuelles.";
      }
    }
  }

  async function init() {
    await loadSummary();
    await loadDailySales();
    await loadMonthlySales();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

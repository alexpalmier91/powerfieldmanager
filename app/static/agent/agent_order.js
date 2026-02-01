// app/static/agent/agent_dashboard.js
(() => {
  const API = "/api-zenhub/agent";
  const TOKEN_KEY = "zentro_token";

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = "/login";
    return;
  }
  const headers = { Authorization: "Bearer " + token };

  const $ = (id) => document.getElementById(id);

  const showError = (msg) => alert("❌ " + msg);
  const showInfo = (msg) => console.log("[INFO]", msg);

  // === Affichage des labos ===
  async function loadLabos() {
    const box = $("labosList");
    if (!box) return;
    box.innerHTML = "<p>Chargement...</p>";

    try {
      const res = await fetch(`${API}/labos`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      if (!data || !data.length) {
        box.innerHTML = "<p>Aucun laboratoire associé.</p>";
        return;
      }

      box.innerHTML = data
        .map(
          (l) => `
          <div class="col-md-4">
            <div class="card h-100">
              <div class="card-body">
                <h5 class="card-title">${l.name}</h5>
                <p class="card-text">ID: ${l.id}</p>
              </div>
            </div>
          </div>`
        )
        .join("");
    } catch (err) {
      console.error(err);
      box.innerHTML = "<p>Erreur de chargement des labos.</p>";
    }
  }

  // === Affichage des clients ===
  async function loadClients(search = "") {
    const box = $("clientsList");
    if (!box) return;
    box.innerHTML = "<p>Chargement...</p>";

    const params = new URLSearchParams({ limit: 50 });
    if (search) params.append("search", search);

    try {
      const res = await fetch(`${API}/clients?${params.toString()}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const items = data.items || data || [];
      if (!items.length) {
        box.innerHTML = "<p>Aucun client trouvé.</p>";
        return;
      }

      box.innerHTML = items
        .map(
          (c) => `
          <div class="card">
            <div class="card-body">
              <h5 class="card-title">${c.company_name || c.company || "(Sans nom)"}</h5>
              <p class="card-text">${c.postcode || ""} ${c.city || ""} – <b>${c.email || "—"}</b> – ${c.phone || ""}</p>
            </div>
          </div>`
        )
        .join("");
    } catch (err) {
      console.error(err);
      box.innerHTML = "<p>Erreur de chargement des clients.</p>";
    }
  }

  // === Affichage des commandes de l'agent ===
  async function loadOrders(offset = 0, limit = 50) {
    const box = $("ordersList");
    const empty = $("ordersEmpty");
    if (!box) return;

    box.innerHTML = "<p>Chargement…</p>";
    if (empty) empty.style.display = "none";

    try {
      const res = await fetch(`${API}/my-orders?offset=${offset}&limit=${limit}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      if (!data.items || !data.items.length) {
        box.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
      }

      box.innerHTML = data.items.map(it => {
        const c = it.customer || {};
        const when = it.created_at ? new Date(it.created_at).toLocaleString('fr-FR') : '';
        const total = Number(it.total_ht || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        return `
          <div class="col-md-6">
            <div class="card h-100">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                  <h5 class="card-title mb-1">Commande #${it.id}</h5>
                  <span class="badge bg-secondary">${it.status}</span>
                </div>
                <div class="text-muted mb-2">${when}</div>
                <div><strong>${c.company || "(Sans nom)"}</strong></div>
                <div class="text-muted">${c.postcode || ""} ${c.city || ""}</div>
                <div class="mt-2"><b>Total HT:</b> ${total} €</div>
              </div>
              <div class="card-footer d-flex gap-2">
                <a class="btn btn-sm btn-outline-primary disabled" href="#" tabindex="-1" aria-disabled="true">Détail (à venir)</a>
              </div>
            </div>
          </div>
        `;
      }).join("");

    } catch (err) {
      console.error(err);
      box.innerHTML = "<p>Erreur de chargement des commandes.</p>";
    }
  }

  // === Init + événements ===
  async function init() {
    try {
      const res = await fetch(`${API}/me`, { headers });
      if (!res.ok) throw new Error("Non authentifié");
      const me = await res.json();
      const whoamiEl = $("whoami");
      if (whoamiEl) whoamiEl.textContent = me.email || "Agent connecté";

      await loadLabos();
      await loadClients();
      await loadOrders();   // <-- nouveau listing des commandes
    } catch (err) {
      console.error(err);
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login";
    }
  }

  const logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login";
    });
  }

  const searchClient = $("searchClient");
  if (searchClient) {
    searchClient.addEventListener("input", (e) => {
      loadClients(e.target.value.trim());
    });
  }

  // Lien "Créer une commande" : mets un <a href="/agent/order.html"> dans le HTML
  // (aucun JS spécial nécessaire)

  init();
})();

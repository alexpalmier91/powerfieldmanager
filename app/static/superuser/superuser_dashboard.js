// app/static/superuser/superuser_dashboard.js
(() => {
  const API = "/api-zenhub";
  const $ = (s) => document.querySelector(s);
  const box = () => $("#agentsList");
  const err = () => $("#agentsErr");

  function getToken() {
    return localStorage.getItem("zentro_token") || localStorage.getItem("token");
  }
  function setToken(t) {
    localStorage.setItem("zentro_token", t);
    localStorage.setItem("token", t);
  }

  async function loadAgents() {
    const token = getToken();
    if (!token) { location.href = "/login"; return; }

    if (box()) box().innerHTML = `<p>Chargement des agents…</p>`;
    if (err()) err().textContent = "";

    try {
      const res = await fetch(`${API}/superuser/agents`, {
        headers: { Authorization: "Bearer " + token }
      });
      if (res.status === 401) { location.href = "/login"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      if (!items.length) {
        if (box()) box().innerHTML = `<p>Aucun agent trouvé.</p>`;
        return;
      }

      const rows = items.map(a => `
        <tr>
          <td>${a.id ?? ""}</td>
          <td>${(a.firstname||"") + " " + (a.lastname||"")}</td>
          <td>${a.email || ""}</td>
          <td>${a.phone || ""}</td>
          <td style="text-align:right">
            <button class="impBtn"
                    data-id="${a.id ?? ""}"
                    data-email="${a.email || ""}"
                    onclick="__imp(this)"
                    style="padding:6px 10px;border:0;border-radius:8px;background:#111827;color:#fff;cursor:pointer">
              👤 Se connecter en tant que
            </button>
          </td>
        </tr>
      `).join("");

      if (box()) {
        box().innerHTML = `
          <table class="table" style="width:100%; border-collapse:collapse">
            <thead>
              <tr>
                <th style="text-align:left">ID</th>
                <th style="text-align:left">Nom</th>
                <th style="text-align:left">Email</th>
                <th style="text-align:left">Téléphone</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="agentsTBody">
              ${rows}
            </tbody>
          </table>
        `;
      }
      console.log("[SU] agents chargés:", items.length);
    } catch (e) {
      if (box()) box().innerHTML = "";
      if (err()) err().textContent = "Erreur lors du chargement: " + (e?.message || e);
      console.error("[SU] loadAgents error:", e);
    }
  }

  async function impersonateById(agentId, label, btn) {
	  const token =
		localStorage.getItem("zentro_token") || localStorage.getItem("token");

	  console.log("[SU] impersonate start", { agentId, label, hasToken: !!token });

	  if (!token) {
		console.warn("[SU] pas de token → /login");
		location.href = "/login";
		return;
	  }
	  if (!agentId) {
		console.error("[SU] agentId manquant");
		alert("Agent ID manquant");
		return;
	  }

	  try {
		if (btn) {
		  btn.disabled = true;
		  btn.textContent = "Connexion…";
		}

		const url = `/api-zenhub/auth/impersonate?agent_id=${agentId}`;
		console.log("[SU] FETCh POST", url);

		const res = await fetch(url, {
		  method: "POST",
		  headers: { Authorization: "Bearer " + token },
		});

		console.log("[SU] response status:", res.status);
		if (res.status === 401 || res.status === 403) {
		  alert("Non autorisé.");
		  return;
		}
		if (!res.ok) {
		  const t = await res.text().catch(() => res.statusText);
		  throw new Error(`HTTP ${res.status} ${t}`);
		}

		const data = await res.json();
		if (!data?.access_token) throw new Error("Réponse sans access_token");

		localStorage.setItem("prev_token", token);
		localStorage.setItem("impersonated", "1");
		localStorage.setItem("zentro_token", data.access_token);
		localStorage.setItem("token", data.access_token);

		console.log("[SU] impersonation OK → /agent/dashboard");
		location.href = "/agent/dashboard";
	  } catch (e) {
		console.error("[SU] impersonate error:", e);
		alert("Impersonation échouée: " + (e?.message || e));
	  } finally {
		if (btn) {
		  btn.disabled = false;
		  btn.textContent = "👤 Se connecter en tant que";
		}
	  }
	}


  // 👇 expose un handler global utilisé par onclick=""
  window.__imp = function(el){
    try {
      const id = parseInt(el.dataset.id || "0", 10);
      const email = el.dataset.email || "";
      impersonateById(id, email, el);
    } catch (e) {
      console.error("[SU] __imp fail:", e);
    }
  };

  document.addEventListener("DOMContentLoaded", loadAgents);
})();

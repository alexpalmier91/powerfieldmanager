// app/static/labo/agents.js

const AGENTS_API_URL = "/api-zenhub/labo/agents";

const agentsTbody = document.getElementById("agents-tbody");
const rowLoading = document.getElementById("agents-row-loading");
const rowEmpty = document.getElementById("agents-row-empty");

// ============================
//   Auth helper (copié de orders.js)
// ============================

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

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

// ============================
//   Chargement & rendu
// ============================

async function loadAgentsTable() {
  if (!agentsTbody) return;

  // état "chargement"
  if (rowLoading) rowLoading.style.display = "table-row";
  if (rowEmpty) rowEmpty.style.display = "none";

  // supprimer toutes les lignes sauf les 2 "templates"
  [...agentsTbody.querySelectorAll("tr")].forEach((tr) => {
    if (tr.id !== "agents-row-loading" && tr.id !== "agents-row-empty") {
      tr.remove();
    }
  });

  try {
    const res = await authFetch(AGENTS_API_URL);
    if (!res.ok) {
      const txt = await res.text();
      console.error("Erreur chargement agents:", res.status, txt);
      if (rowLoading) rowLoading.style.display = "none";
      return;
    }

    const agents = await res.json(); // List[AgentOption] => [{id, name}, ...]
    console.log("Agents labo:", agents);

    if (!agents || agents.length === 0) {
      // aucun agent
      if (rowLoading) rowLoading.style.display = "none";
      if (rowEmpty) rowEmpty.style.display = "table-row";
      return;
    }

    // on a des agents : cacher les 2 lignes "système"
    if (rowLoading) rowLoading.style.display = "none";
    if (rowEmpty) rowEmpty.style.display = "none";

    agents.forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${a.id}</td>
        <td>${a.name || ""}</td>
      `;
      agentsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Erreur loadAgentsTable:", err);
    if (rowLoading) rowLoading.style.display = "none";
  }
}

// ============================
//   Init
// ============================

document.addEventListener("DOMContentLoaded", () => {
  if (agentsTbody) {
    loadAgentsTable();
  }
});

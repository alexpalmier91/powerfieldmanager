// /static/agent/pages/orders/new/api.js
// Gestion des appels API pour la création de commande agent

const API_BASE = "/api-zenhub/agent";

/* ============================================================
   Helpers AUTH
   ============================================================ */

/**
 * Récupère le token JWT depuis localStorage (clé zentro_token) ou autres emplacements.
 */
function readToken() {
  // 1) clé utilisée par ton dashboard (localStorage.zentro_token)
  try {
    if (typeof localStorage !== "undefined") {
      if (localStorage.zentro_token) {
        return localStorage.zentro_token;
      }
      const zt = localStorage.getItem("zentro_token");
      if (zt) return zt;
    }
  } catch (e) {
    console.warn("[Agent API] Impossible de lire localStorage", e);
  }

  // 2) autres clés possibles (fallback)
  let fromLS = null;
  try {
    if (typeof localStorage !== "undefined") {
      fromLS =
        localStorage.getItem("jwt") ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("token");
    }
    if (!fromLS && typeof sessionStorage !== "undefined") {
      fromLS = sessionStorage.getItem("jwt");
    }
  } catch (e) {
    // on ignore
  }
  if (fromLS) return fromLS;

  // 3) Fallback cookie (si jamais tu poses le token en cookie non HttpOnly)
  const m =
    document.cookie.match(/(?:^|;\s*)zentro_token=([^;]+)/) ||
    document.cookie.match(/(?:^|;\s*)jwt=([^;]+)/) ||
    document.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/) ||
    document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);

  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Retourne les headers d’authentification.
 */
function authHeaders() {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Wrapper fetch : inclut les cookies et le header Authorization.
 */
async function zfetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });
  return res;
}

/* ============================================================
   ENDPOINTS API
   ============================================================ */

/**
 * Recherche des clients liés à l’agent.
 */
export async function fetchClients({ search = "", page = 1, page_size = 50 }) {
  const url = new URL(`${API_BASE}/clients`, location.origin);
  if (search) url.searchParams.set("search", search);
  url.searchParams.set("page", page);
  url.searchParams.set("page_size", page_size);
  const res = await zfetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Liste des labos rattachés à l’agent.
 */
export async function fetchLabos() {
  const res = await zfetch(`${API_BASE}/labos`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Catalogue produits d’un labo donné (avec pagination).
 */
/**
 * Catalogue produits d’un labo donné (nouvelle API enrichie commission + tiers).
 */


export async function fetchProducts({
  labo_id,
  search = "",
  offset = 0,
  limit = 50,
  sort = "name",
  dir = "asc",
}) {
  if (!labo_id) return { total: 0, items: [] };

  const url = new URL("/api-zenhub/agent/products", location.origin);

  url.searchParams.set("labo_id", labo_id);
  url.searchParams.set("offset", offset);
  url.searchParams.set("limit", limit);
  url.searchParams.set("sort", sort);
  url.searchParams.set("dir", dir);

  if (search && search.trim()) {
    url.searchParams.set("search", search.trim());
  }

  const res = await zfetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);

  return res.json();
}




/**
 * Création d’une commande agent.
 */
// /static/agent/pages/orders/new/api.js

// ...

/**
 * Création d’une commande agent.
 */
export async function createOrder({
  client_id,
  labo_id,
  items,
  delivery_date,
  payment_method,
  comment,
}) {
  const payload = {
    client_id,
    labo_id,
    items,
    delivery_date: delivery_date || null,
    payment_method: payment_method || null,
    comment: comment || null,
  };

  const res = await zfetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || res.statusText || "Erreur API";
    throw new Error(msg);
  }
  return data;
}


/* ============================================================
   UTILITAIRE DEBUG (optionnel)
   ============================================================ */

export function debugAuthToken() {
  const token = readToken();
  if (token) {
    console.log("%c[Agent API] JWT détecté", "color:#16a34a;font-weight:600;");
  } else {
    console.warn(
      "%c[Agent API] Aucun JWT détecté (401 probable)",
      "color:#dc2626;"
    );
  }
}

// Appelé au chargement pour voir si on a un token
debugAuthToken();

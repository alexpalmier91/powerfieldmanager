// app/static/agent/pages/labos/api.js
const API = "/api-zenhub";

// --- Auth helpers ------------------------------------------------------------
const TOKEN_KEYS = [
  "zenhub_token", "zen_token", "access_token", "auth_token", "token",
  "zentro_token", "jwt"
];

function readTokenFromStorage() {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (v) return v.replace(/^Bearer\s+/i, "");
  }
  return null;
}
function readTokenFromCookie() {
  // ex: access_token=eyJ... ou Authorization=Bearer eyJ...
  const m1 = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/i);
  if (m1) return decodeURIComponent(m1[1]);
  const m2 = document.cookie.match(/(?:^|;\s*)Authorization=Bearer%20([^;]+)/i);
  if (m2) return decodeURIComponent(m2[1]);
  return null;
}
function getToken() {
  return readTokenFromStorage() || readTokenFromCookie();
}

async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers, credentials: "include" });
}

async function jsonOrThrow(res) {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

// --- API calls ---------------------------------------------------------------
export async function fetchLabos() {
  const r = await authFetch(`${API}/agent/labos`);
  const j = await jsonOrThrow(r);
  // ← supporte {items:[...]} OU [...] en sortie d'API
  return Array.isArray(j) ? { items: j } : j;
}


export async function fetchCatalogue(params) {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.sku) sp.set("sku", params.sku);
  if (params.ean) sp.set("ean", params.ean);
  if (params.in_stock === "true") sp.set("in_stock", "true");
  if (params.min_price) sp.set("min_price", params.min_price);
  if (params.max_price) sp.set("max_price", params.max_price);
  sp.set("page", params.page || "1");
  sp.set("page_size", params.page_size || "25");
  sp.set("sort", params.sort || "name");
  sp.set("dir", params.dir || "asc");

  const url = `${API}/agent/labos/${encodeURIComponent(params.labo_id)}/products?` + sp.toString();
  const r = await authFetch(url);
  return jsonOrThrow(r);
}

export function exportCsv(params) {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.sku) sp.set("sku", params.sku);
  if (params.ean) sp.set("ean", params.ean);
  if (params.in_stock === "true") sp.set("in_stock", "true");
  if (params.min_price) sp.set("min_price", params.min_price);
  if (params.max_price) sp.set("max_price", params.max_price);
  sp.set("sort", params.sort || "name");
  sp.set("dir", params.dir || "asc");
  sp.set("export", "csv");

  const token = getToken();
  const url = `${API}/agent/labos/${encodeURIComponent(params.labo_id)}/products?` + sp.toString();

  // Ouvre dans un nouvel onglet avec le token si nécessaire
  if (token) {
    const w = window.open(); // évite le blocage popup
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include"
    }).then(resp => resp.blob())
      .then(blob => {
        const dl = URL.createObjectURL(blob);
        w.location = dl;
      }).catch(() => { w.close(); alert("Export CSV échoué."); });
  } else {
    // si le serveur accepte via cookie
    window.open(url, "_blank");
  }
}

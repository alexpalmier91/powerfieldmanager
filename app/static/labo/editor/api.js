// app/static/labo/editor/api.js
export const API_BASE = "/api-zenhub";
export const TOKEN = localStorage.getItem("token");

export function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
    ...extra,
  };
}

export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  const text = !data ? await res.text().catch(() => "") : "";

  if (!res.ok) {
    if (res.status === 401) throw new Error("401 Unauthorized (token manquant/expiré).");
    throw new Error((data && (data.detail || data.message)) || text || "Erreur API");
  }
  return data ?? { ok: true };
}

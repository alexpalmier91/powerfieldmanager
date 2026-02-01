// /static/superuser/shared/impersonate/api.js
export const JWT_STORAGE_KEY = "jwt";
export const SU_BACKUP_KEY  = "jwt_superuser_backup";

/* ---------- Helpers ---------- */
async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

/* ---------- TOKEN HANDLING ---------- */
function resolveToken() {
  // Lecture compatible avec le code déjà existant (superuser_dashboard.js)
  return (
    localStorage.getItem("zentro_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    null
  );
}

/* ---------- HTTP helpers ---------- */
async function http(method, url, body = null) {
  const token = resolveToken();

  const opts = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (token) {
    opts.headers["Authorization"] = `Bearer ${token}`;
  }

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await safeJson(res);

  if (!res.ok) {
    const msg = data.detail || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ---------- Token helpers ---------- */
export function getToken() {
  return resolveToken();
}

export function setToken(t) {
  if (t) {
    // On enregistre dans tous les emplacements connus
    localStorage.setItem("zentro_token", t);
    localStorage.setItem("token", t);
    localStorage.setItem("jwt", t);
  } else {
    localStorage.removeItem("zentro_token");
    localStorage.removeItem("token");
    localStorage.removeItem("jwt");
  }
}

export function backupSuperuserToken() {
  const current = getToken();
  if (current) {
    sessionStorage.setItem(SU_BACKUP_KEY, current);
  }
}

export function hasBackup() {
  return !!sessionStorage.getItem(SU_BACKUP_KEY);
}

export function restoreSuperuserToken() {
  const backup = sessionStorage.getItem(SU_BACKUP_KEY);
  if (backup) {
    setToken(backup);
    sessionStorage.removeItem(SU_BACKUP_KEY);
  } else {
    setToken(null);
  }
}

/* ---------- API calls ---------- */
export async function fetchLabos() {
  return http("GET", "/api-zenhub/superuser/labos");
}

export async function impersonateLabo(laboId) {
  return http("POST", `/api-zenhub/superuser/impersonate-labo/${laboId}`);
}

export async function stopImpersonation() {
  return http("POST", `/api-zenhub/superuser/stop-impersonation`);
}

/* ---------- Export HTTP for reuse ---------- */
export { http };

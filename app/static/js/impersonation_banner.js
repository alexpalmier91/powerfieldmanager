// app/static/js/impersonation_banner.js
(() => {
  const b64pad = (s) => s + "=".repeat((4 - (s.length % 4)) % 4);
  function decodePayload(t){ try{ return JSON.parse(atob(b64pad(t.split(".")[1])));}catch{ return {}; } }

  const banner = document.getElementById("impersonationBanner");
  const stopBtn = document.getElementById("stopImpersonation");

  function isImpersonated() {
    const tok = localStorage.getItem("zentro_token") || localStorage.getItem("token");
    if (!tok) return false;
    const p = decodePayload(tok);
    return p.impersonated === true || localStorage.getItem("impersonated")==="1" || !!localStorage.getItem("prev_token");
  }

  async function stop() {
    const prev = localStorage.getItem("prev_token");
    if (prev) {
      localStorage.setItem("zentro_token", prev);
      localStorage.setItem("token", prev);
    }
    localStorage.removeItem("prev_token");
    localStorage.removeItem("impersonated");
    try { await fetch("/api-zenhub/auth/stop-impersonation", { method:"POST" }); } catch {}
    // retour superuser
    location.href = "/superuser/dashboard";
  }

  if (banner && isImpersonated()) {
    banner.style.display = "";
    stopBtn?.addEventListener("click", stop);
  }
})();

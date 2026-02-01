// app/static/js/login.js

(() => {
  const API = "/api-zenhub";

  const $  = (id) => document.getElementById(id);
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  const b64pad = (s) => s + "=".repeat((4 - (s.length % 4)) % 4);
  function decodePayload(token){ try{ const b=token.split(".")[1]; return JSON.parse(atob(b64pad(b))); }catch{ return {}; } }
  function isTokenValid(token){ if(!token) return false; const p=decodePayload(token); const now=Math.floor(Date.now()/1000); return !!p.exp && p.exp>(now+30); }
  function roleOf(token){ const p=decodePayload(token); return (p.role || p.Role || (Array.isArray(p.roles)?p.roles[0]:p.roles) || "").toString().toUpperCase(); }
  function isDebug(){
    if (window.__DEBUG_LOGIN__ === true) return true;
    try { return new URLSearchParams(location.search).get("debug")==="1"; } catch { return false; }
  }

  async function redirectByRole(token){
    if (isDebug()) return; // 🚫 jamais de redirection en debug
    if (isTokenValid(token)){
      try{
        const r = await fetch(`${API}/auth/whoami`, { headers:{Authorization:"Bearer "+token} });
        if (r.ok){
          const me = await r.json();
          const role = String(me.role||"").toUpperCase();
          if (role==="SUPERUSER" || role==="SUPERADMIN") { location.href="/superuser/dashboard"; return; }
          if (role==="LABO" || role==="LABORATORY")       { location.href="/dashboard";          return; }
          if (role==="AGENT")                              { location.href="/agent/dashboard";    return; }
          return;
        }
      }catch(e){ console.warn("[login] whoami KO:", e); }
    }
    if (isTokenValid(token)){
      const r = roleOf(token);
      if (r==="SUPERUSER" || r==="SUPERADMIN") { location.href="/superuser/dashboard"; return; }
      if (r==="LABO" || r==="LABORATORY")       { location.href="/dashboard";          return; }
      if (r==="AGENT")                          { location.href="/agent/dashboard";    return; }
    }
  }

  function ensureDebugPanel(){
    let el = $("debugPanel");
    if (!el){
      el = document.createElement("div");
      el.id="debugPanel";
      el.style.cssText="margin-top:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff";
      (document.querySelector(".center")||document.body).appendChild(el);
    }
    return el;
  }
  async function showDebug(token){
    const box = ensureDebugPanel();
    let html = `<h3 style="margin:0 0 8px">🔎 Debug JWT</h3>`;
    try{ html += `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #eee;padding:8px;border-radius:6px">${JSON.stringify(decodePayload(token),null,2)}</pre>`; }
    catch(e){ html += `<div style="color:#b91c1c">Erreur parse JWT: ${e}</div>`; }
    try{
      const r = await fetch(`${API}/auth/whoami`, { headers:{Authorization:"Bearer "+token} });
      const j = r.ok ? await r.json() : {error:`HTTP ${r.status}`};
      html += `<h4 style="margin:12px 0 6px">/whoami</h4>
               <pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #eee;padding:8px;border-radius:6px">${JSON.stringify(j,null,2)}</pre>`;
    }catch(e){ html += `<div style="color:#b91c1c">whoami error: ${e}</div>`; }
    html += `<div class="muted" style="margin-top:8px">Aucune redirection en mode debug. Vous pouvez copier le token :</div>
             <textarea style="width:100%;height:80px;margin-top:6px">${token}</textarea>`;
    box.innerHTML = html;
  }

  async function requestCode(){
    const email = $("email")?.value.trim().toLowerCase();
    if (!email){ $("e1") && ($("e1").textContent="Merci de saisir un email."); return; }
    $("e1") && ($("e1").textContent=""); $("m1") && ($("m1").textContent="Envoi du code...");
    try{
      const res = await fetch(`${API}/auth/request-code`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email}) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      $("m1") && ($("m1").textContent="Code envoyé. Vérifie ta boîte mail."); $("step2") && ( $("step2").style.display = "" );
    }catch(e){ $("m1") && ($("m1").textContent=""); $("e1") && ($("e1").textContent="Erreur: "+(e?.message||e)); }
  }

  function setTokenStores(token){
    localStorage.setItem("zentro_token", token);
    localStorage.setItem("token", token);
    localStorage.removeItem("prev_token");
    localStorage.removeItem("impersonated");
  }

  async function verifyCode(ev){
    if (ev) ev.preventDefault();
    const email = $("email")?.value.trim().toLowerCase();
    const code  = $("code")?.value.trim();
    if (!email || !code){ $("e2") && ($("e2").textContent="Email et code sont requis."); return; }
    $("e2") && ($("e2").textContent=""); $("m2") && ($("m2").textContent="Vérification...");

    try{
      const res = await fetch(`${API}/auth/verify-code`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, code }) });
      if (!res.ok){ const t = await res.text().catch(()=>res.statusText); throw new Error(`HTTP ${res.status} ${t}`); }
      const data = await res.json();
      if (!data || !data.access_token) throw new Error("Réponse sans access_token");

      setTokenStores(data.access_token);

      if (isDebug()){
        try { history.replaceState(null, "", "/login?debug=1"); } catch {}
        await showDebug(data.access_token);
        return; // ⛔ pas de redirection
      }

      await redirectByRole(data.access_token);
    }catch(e){
      $("m2") && ($("m2").textContent="");
      $("e2") && ($("e2").textContent="Erreur: "+(e?.message||e));
    }
  }

  on($("btn-request"), "click", requestCode);
  on($("btn-verify"),  "click", verifyCode);

  // Au chargement
if (isDebug()){
  try{ history.replaceState(null, "", "/login?debug=1"); }catch{}
}
})();

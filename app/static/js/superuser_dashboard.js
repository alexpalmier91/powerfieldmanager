// app/static/js/superuser_dashboard.js
(() => {
  const API = "/api-zenhub";
  const TOKEN_KEY = "zentro_token";
  const EXT_ALLOWED = [".xlsx", ".csv"];

  const $ = (id) => document.getElementById(id);

  // Elements
  const whoEl = $("who");
  const pendingErrEl = $("pending-err");
  const pendingEl = $("pending");
  const btnRefresh = $("btn-refresh");

  const fileEl = $("file-clients");
  const btnImport = $("btn-import");
  const importMsg = $("import-msg");
  const dropArea = $("import-drop"); // optionnel: <div id="import-drop">Glisser-déposer</div>

  const clientsErr = $("clients-err");
  const clientsTbl = $("clients-table");
  const clientsTbody = $("clients-tbody");
  const clientsEmpty = $("clients-empty");
  const clientsCount = $("clients-count");
  const searchInput = $("clients-search");
  const clientsLoading = $("clients-loading");
  const clientsSentinel = $("clients-sentinel");

  // --- Helpers ---
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  // 🔒 Redirection silencieuse vers /login (plus de popup)
  function goLogin() {
    if (sessionStorage.getItem("zentro_redir_login") === "1") return;
    sessionStorage.setItem("zentro_redir_login", "1");
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    if (!location.pathname.startsWith("/login")) location.replace("/login");
  }

  async function whoami(token) {
    const r = await fetch(`${API}/auth/whoami`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error("whoami " + r.status);
    return r.json();
  }

  // little utils
  const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
  const plural = (n, one, many) => `${n} ${n>1?many:one}`;
  const extOf = (name="") => name.slice(name.lastIndexOf(".")).toLowerCase();

  // --- Pending requests ---
  async function loadPending(token) {
    if (!pendingErrEl || !pendingEl) return;
    pendingErrEl.textContent = "";
    pendingEl.innerHTML = `<span class="muted">Chargement…</span>`;

    try {
      const r = await fetch(`${API}/superuser/pending`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (r.status === 401) { goLogin(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();

      const rowsL = (data.labos || []).map(
        (x) => `<tr><td>${x.id}</td><td>${x.name ?? "-"}</td><td>${x.email ?? "-"}</td></tr>`
      ).join("");
      const rowsA = (data.agents || []).map(
        (x) => `<tr><td>${x.id}</td><td>${x.name ?? "-"}</td><td>${x.email ?? "-"}</td></tr>`
      ).join("");

      pendingEl.innerHTML = `
        <h3>Labos</h3>
        <table>
          <thead><tr><th>ID</th><th>Nom</th><th>Email</th></tr></thead>
          <tbody>${rowsL || `<tr><td colspan="3"><em class="muted">Aucun</em></td></tr>`}</tbody>
        </table>

        <h3 style="margin-top:16px;">Agents</h3>
        <table>
          <thead><tr><th>ID</th><th>Nom</th><th>Email</th></tr></thead>
          <tbody>${rowsA || `<tr><td colspan="3"><em class="muted">Aucun</em></td></tr>`}</tbody>
        </table>
      `;
    } catch (e) {
      pendingErrEl.textContent = "Erreur chargement pending: " + e.message;
      pendingEl.innerHTML = "";
    }
  }

  // --- Import clients ---
  function setImportMsg(text, cls = "") {
    if (!importMsg) return;
    importMsg.innerHTML = text || "";
    importMsg.className = cls || "";
  }

  function prettyImportResult(payload) {
    if (!payload || typeof payload !== "object") return `<span class="muted">Import terminé.</span>`;
    const { inserted=0, updated=0, errors=0, warnings=[], missing_columns=[] } = payload;
    let html = `<strong>${inserted}</strong> ${inserted>1?'lignes insérées':'ligne insérée'}, `
             + `<strong>${updated}</strong> ${updated>1?'mises à jour':'mise à jour'}, `
             + `<strong>${errors}</strong> ${errors>1?'erreurs':'erreur'}.`;
    if (missing_columns?.length) {
      html += `<br><span class="warn">Colonnes manquantes : ${missing_columns.join(", ")}</span>`;
    }
    if (warnings?.length) {
      html += `<br><small class="muted">${warnings.map(w=>`• ${w}`).join("<br>")}</small>`;
    }
    return html;
  }

  function invalidFileMessage(file) {
    if (!file) return "Veuillez sélectionner un fichier .xlsx ou .csv";
    const ext = extOf(file.name);
    if (!EXT_ALLOWED.includes(ext)) {
      return `Format non supporté (${ext}). Formats acceptés : ${EXT_ALLOWED.join(", ")}`;
    }
    return null;
  }

  async function importClients(token, file) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API}/superuser/import-clients`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd,
    });

    // Gestion 413 (payload trop grand) ou autres erreurs texte/JSON
    let payload = null;
    try { payload = await r.json(); }
    catch { try { payload = await r.text(); } catch { payload = null; } }

    if (!r.ok) {
      let msg = "Erreur import";
      if (payload && typeof payload === "object" && payload.detail) msg = payload.detail;
      else if (typeof payload === "string" && payload.trim()) msg = payload;
      if (r.status === 413) msg = "Fichier trop volumineux (413). Réduis la taille ou convertis en CSV.";
      throw new Error(msg);
    }
    return payload;
  }

  // --- Clients table (infinite scroll) ---
  const state = {
    token: null,
    limit: 200,
    offset: 0,
    total: null,
    loading: false,
    done: false,
  };

  let rawClients = [];
  let viewClients = [];

  function renderClients(items) {
    if (!clientsTbody || !clientsTbl || !clientsEmpty || !clientsCount) return;

    clientsTbody.innerHTML = "";
    if (!items || !items.length) {
      clientsTbl.style.display = "none";
      clientsEmpty.style.display = "";
      clientsCount.textContent = "0 client";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const tr = document.createElement("tr");
      const td = (v) => { const x = document.createElement("td"); x.textContent = v ?? ""; return x; };
      tr.appendChild(td(it.id));
      tr.appendChild(td(it.company || ""));
      tr.appendChild(td(it.city || ""));
      tr.appendChild(td(it.email || ""));
      tr.appendChild(td(it.phone || ""));
      frag.appendChild(tr);
    }
    clientsTbody.appendChild(frag);
    clientsEmpty.style.display = "none";
    clientsTbl.style.display = "";
    clientsCount.textContent = `${items.length} / ${rawClients.length}${state.total ? " / " + state.total : ""}`;
  }

  const applyClientFilter = debounce(() => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    if (!q) {
      viewClients = rawClients.slice();
      renderClients(viewClients);
      return;
    }
    viewClients = rawClients.filter((it) => {
      const company = (it.company || "").toLowerCase();
      const email = (it.email || "").toLowerCase();
      const city = (it.city || "").toLowerCase();
      return company.includes(q) || email.includes(q) || city.includes(q);
    });
    renderClients(viewClients);
  }, 200);

  function setLoading(v) {
    state.loading = v;
    if (clientsLoading) clientsLoading.style.display = v ? "" : "none";
  }

  async function loadClientsPage() {
    if (state.loading || state.done) return;
    setLoading(true);
    if (clientsErr) clientsErr.textContent = "";

    try {
      const url = new URL(`${location.origin}${API}/superuser/clients`);
      url.searchParams.set("limit", String(state.limit));
      url.searchParams.set("offset", String(state.offset));

      const r = await fetch(url, { headers: { Authorization: "Bearer " + state.token } });
      if (r.status === 401) { goLogin(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();

      const items = data.items || [];
      if (state.total == null && typeof data.total === "number") state.total = data.total;

      rawClients.push(...items);
      state.offset += items.length;
      if (items.length === 0 || (state.total && rawClients.length >= state.total)) state.done = true;

      applyClientFilter();
    } catch (e) {
      if (clientsErr) clientsErr.textContent = "Erreur chargement clients: " + e.message;
    } finally {
      setLoading(false);
    }
  }

  function resetClientsState() {
    state.offset = 0;
    state.total = null;
    state.loading = false;
    state.done = false;
    rawClients = [];
    viewClients = [];
    if (clientsTbody) clientsTbody.innerHTML = "";
    if (clientsTbl) clientsTbl.style.display = "none";
    if (clientsEmpty) clientsEmpty.style.display = "none";
    if (clientsCount) clientsCount.textContent = "—";
  }

  let io = null;
  function attachObserver() {
    if (io) { io.disconnect(); io = null; }
    if (!clientsSentinel) return;
    io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) loadClientsPage(); }),
      { root: null, rootMargin: "600px 0px", threshold: 0 }
    );
    io.observe(clientsSentinel);
  }

  // --- Drag & Drop (optionnel) ---
  function attachDropArea() {
    if (!dropArea || !fileEl) return;
    const stop = (e)=>{ e.preventDefault(); e.stopPropagation(); };
    ["dragenter","dragover","dragleave","drop"].forEach(ev => dropArea.addEventListener(ev, stop, false));
    ["dragenter","dragover"].forEach(ev => dropArea.addEventListener(ev, ()=> dropArea.classList.add("dragging")));
    ["dragleave","drop"].forEach(ev => dropArea.addEventListener(ev, ()=> dropArea.classList.remove("dragging")));
    dropArea.addEventListener("drop", (e)=>{
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      fileEl.files = e.dataTransfer.files;
      // feedback
      setImportMsg(`Fichier sélectionné : <strong>${f.name}</strong>`, "muted");
    });
  }

  // --- Boot ---
  async function boot() {
    const token = getToken();
    if (!token) { goLogin(); return; }

    try {
      const me = await whoami(token);
      if (whoEl) whoEl.textContent = `Connecté: ${me.email || me.sub} – rôle: ${me.role}`;
      const role = String(me.role || "").toUpperCase();
      if (role !== "SUPERUSER" && role !== "SUPERADMIN") { location.replace("/dashboard"); return; }

      state.token = token;
      await loadPending(token);
      attachObserver();
      attachDropArea();
      resetClientsState();
      await loadClientsPage();

      btnRefresh?.addEventListener("click", () => loadPending(token));
      searchInput?.addEventListener("input", () => applyClientFilter());

      btnImport?.addEventListener("click", async () => {
        const file = fileEl?.files?.[0];
        const err = invalidFileMessage(file);
        if (err) { setImportMsg(err, "warn"); return; }

        btnImport.disabled = true;
        setImportMsg("Import en cours…", "muted");
        try {
          const res = await importClients(token, file);
          setImportMsg(prettyImportResult(res), "ok");
          // rafraîchir la table
          resetClientsState();
          await loadClientsPage();
        } catch (e) {
          setImportMsg("❌ " + (e?.message || "Erreur inconnue"), "err");
        } finally {
          btnImport.disabled = false;
          if (fileEl) fileEl.value = "";
        }
      });
    } catch {
      goLogin();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

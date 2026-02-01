console.log("[SUPERUSER_LABOS] JS chargé");

const API_BASE = "/api-zenhub";
const TOKEN = localStorage.getItem("token");
const $ = (sel, root = document) => root.querySelector(sel);

async function fetchJSON(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let msg = "Erreur API";
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch (_) {
      const t = await res.text().catch(() => "");
      if (t) msg = t;
    }
    throw new Error(msg);
  }
  return res.json();
}

function setVisible(el, show) {
  if (!el) return;
  el.style.display = show ? "" : "none";
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

async function initList() {
  const tbody = $("#labosTbody");
  const loading = $("#labosLoading");
  const error = $("#labosError");
  const q = $("#q");

  async function load() {
    setVisible(error, false);
    loading.textContent = "Chargement…";
    setVisible(loading, true);
    tbody.innerHTML = "";

    try {
      const qs = q.value ? `?q=${encodeURIComponent(q.value)}` : "";
      const data = await fetchJSON(`${API_BASE}/superuser/labos${qs}`);
      setVisible(loading, false);

      for (const labo of data.items) {
        const tr = document.createElement("tr");
       const hasLogo = !!labo.logo_path;
		const logoHtml = hasLogo
		  ? `<a href="/static/${labo.logo_path}" target="_blank" rel="noopener">
			   <img class="labo-logo" src="/static/${labo.logo_path}" alt="Logo ${escapeHtml(labo.name)}">
			 </a>`
		  : "—";

		tr.innerHTML = `
		  <td>${labo.id}</td>
		  <td title="${escapeHtml(labo.name)}">${escapeHtml(labo.name)}</td>
		  <td title="${escapeHtml(labo.city || "")}">${escapeHtml(labo.city || "")}</td>
		  <td title="${escapeHtml(labo.email || "")}">${escapeHtml(labo.email || "")}</td>
		  <td class="col-center">${labo.is_active ? "✅" : "❌"}</td>
		  <td class="col-center">${logoHtml}</td>
		  <td style="text-align:right;">
			<a class="btn" href="/superuser/labos/${labo.id}">Éditer</a>
		  </td>
		`;

        tbody.appendChild(tr);
      }

      if (!data.items.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="7" style="color:#6b7280; padding:14px;">Aucun labo</td>`;
        tbody.appendChild(tr);
      }
    } catch (e) {
      setVisible(loading, false);
      error.textContent = e.message || "Erreur";
      setVisible(error, true);
    }
  }

  $("#btnSearch")?.addEventListener("click", load);
  q?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") load(); });

  await load();
}

function fillForm(labo) {
  $("#name").value = labo.name || "";
  $("#legal_name").value = labo.legal_name || "";
  $("#siret").value = labo.siret || "";
  $("#vat_number").value = labo.vat_number || "";
  $("#email").value = labo.email || "";
  $("#phone").value = labo.phone || "";
  $("#address1").value = labo.address1 || "";
  $("#address2").value = labo.address2 || "";
  $("#zip").value = labo.zip || "";
  $("#city").value = labo.city || "";
  $("#country").value = labo.country || "";
  $("#invoice_footer").value = labo.invoice_footer || "";
  $("#is_active").checked = !!labo.is_active;

  const img = $("#logoPreview");
  const empty = $("#logoEmpty");
  const btnDel = $("#btnDeleteLogo");

  if (labo.logo_path) {
    img.src = `/static/${labo.logo_path}`;
    img.style.display = "";
    empty.style.display = "none";
    btnDel.style.display = "";
  } else {
    img.src = "";
    img.style.display = "none";
    empty.style.display = "";
    btnDel.style.display = "none";
  }
}

function collectPayload() {
  return {
    name: $("#name").value.trim(),
    legal_name: $("#legal_name").value.trim() || null,
    siret: $("#siret").value.trim() || null,
    vat_number: $("#vat_number").value.trim() || null,
    email: $("#email").value.trim() || null,
    phone: $("#phone").value.trim() || null,
    address1: $("#address1").value.trim() || null,
    address2: $("#address2").value.trim() || null,
    zip: $("#zip").value.trim() || null,
    city: $("#city").value.trim() || null,
    country: $("#country").value.trim() || null,
    invoice_footer: $("#invoice_footer").value || null,
    is_active: $("#is_active").checked,
  };
}

async function initForm(laboId) {
  const err = $("#formError");
  const msg = $("#logoMsg");

  async function load() {
    setVisible(err, false);
    if (!laboId) return;
    const labo = await fetchJSON(`${API_BASE}/superuser/labos/${laboId}`);
    fillForm(labo);
  }

  async function save() {
    setVisible(err, false);
    try {
      const payload = collectPayload();
      let labo;
      if (laboId) {
        labo = await fetchJSON(`${API_BASE}/superuser/labos/${laboId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        labo = await fetchJSON(`${API_BASE}/superuser/labos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        // redirection vers edit
        window.location.href = `/superuser/labos/${labo.id}`;
        return;
      }
      fillForm(labo);
    } catch (e) {
      err.textContent = e.message || "Erreur";
      setVisible(err, true);
    }
  }

  async function uploadLogo() {
    if (!laboId) {
      msg.textContent = "Crée d’abord le labo avant d’uploader un logo.";
      return;
    }
    const input = $("#logoFile");
    const file = input.files && input.files[0];
    if (!file) return;

    msg.textContent = "Upload…";

    const fd = new FormData();
    fd.append("file", file);

    const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
    const res = await fetch(`${API_BASE}/superuser/labos/${laboId}/logo`, {
      method: "POST",
      headers,
      body: fd,
    });
    if (!res.ok) {
      let m = "Erreur upload";
      try {
        const j = await res.json();
        m = j.detail || m;
      } catch (_) {}
      msg.textContent = m;
      return;
    }
    const labo = await res.json();
    fillForm(labo);
    msg.textContent = "Logo mis à jour ✅";
    input.value = "";
  }

  async function deleteLogo() {
    if (!laboId) return;
    msg.textContent = "Suppression…";
    try {
      const labo = await fetchJSON(`${API_BASE}/superuser/labos/${laboId}/logo`, { method: "DELETE" });
      fillForm(labo);
      msg.textContent = "Logo supprimé ✅";
    } catch (e) {
      msg.textContent = e.message || "Erreur suppression";
    }
  }

  $("#btnSave")?.addEventListener("click", save);
  $("#btnUploadLogo")?.addEventListener("click", uploadLogo);
  $("#btnDeleteLogo")?.addEventListener("click", deleteLogo);

  await load();
}

(function boot() {
  const cfg = window.SUPERUSER_LABOS_PAGE;
  if (!cfg) return;
  if (cfg.mode === "list") initList();
  if (cfg.mode === "form") initForm(cfg.labo_id);
})();

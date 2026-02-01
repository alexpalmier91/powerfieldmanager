// /static/shared/impersonate/ui.js

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function showError(el, msg) {
  if (!el) return;
  el.textContent = msg || "Une erreur est survenue.";
  el.style.color = "#b91c1c";
}

export function renderLabosTable(target, labos = []) {
  if (!target) return;
  if (!labos.length) {
    target.innerHTML = `<p style="color:#6b7280">Aucun labo trouvé.</p>`;
    return;
  }
  const rows = labos.map(l => `
    <tr>
      <td>${l.id}</td>
      <td>${escapeHtml(l.name || "")}</td>
      <td>
        <button class="btn btn-primary btn-impersonate"
                data-id="${l.id}" data-name="${escapeHtml(l.name || "")}">
          Se connecter en tant que ce Labo
        </button>
      </td>
    </tr>
  `).join("");

  target.innerHTML = `
    <div class="table-responsive" style="margin-top:10px">
      <table class="table">
        <thead>
          <tr>
            <th style="width:90px">ID</th>
            <th>Nom</th>
            <th style="width:220px">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function bindImpersonateButtons(root, handler) {
  qsa(".btn-impersonate", root).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      handler?.(id);
    });
  });
}

export function toggleStopButton(btn, visible) {
  if (!btn) return;
  btn.style.display = visible ? "" : "none";
}

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

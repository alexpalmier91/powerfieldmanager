import { fetchJSON } from "./api.js";

const API_BASE = "/api-zenhub";

function sanitizeFontFamily(name) {
  // simple, évite les guillemets qui cassent CSS
  return String(name || "").replace(/["']/g, "").trim() || "Sans";
}

export async function loadAndInjectFonts() {
  const fonts = await fetchJSON(`${API_BASE}/labo/marketing-fonts`, { method: "GET" });

  // supprime l'ancien style si rechargé
  const old = document.getElementById("marketing-fonts-style");
  if (old) old.remove();

  const style = document.createElement("style");
  style.id = "marketing-fonts-style";

  const rules = [];
  for (const f of fonts || []) {
    const family = sanitizeFontFamily(f.display_name);
    const url = f.woff2_url;

    if (!url) continue;

    rules.push(`
@font-face{
  font-family:"${family}";
  src:url("${url}") format("woff2");
  font-display: swap;
  font-weight: 100 900;
  font-style: normal;
}
    `.trim());
  }

  style.textContent = rules.join("\n\n");
  document.head.appendChild(style);

  return (fonts || []).map((f) => ({
    id: f.id,
    display_name: sanitizeFontFamily(f.display_name),
    woff2_url: f.woff2_url,
  }));
}

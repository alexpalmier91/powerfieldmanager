// app/static/labo/editor/fonts_ui.js
import { state } from "./state.js?v=12";

// ---------- helpers ----------
function getToken() {
  const raw = (localStorage.getItem("token") || "").trim();
  if (!raw) return null;
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
}

function authHeaders(extra = {}) {
  const token = getToken();
  console.log("[FONTS_UI] token present?", !!token, token ? token.slice(0, 12) + "…" : "(none)");
  return {
    Accept: "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...extra,
  };
}

async function fetchJSON(url, options = {}) {
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

// ---------- DOM ----------
const $ = (sel, root = document) => root.querySelector(sel);

function setStatus(msg) {
  const el = $("#fontUploadStatus");
  if (el) el.textContent = msg || "";
}

function ensureFontsStyleTag() {
  let tag = document.getElementById("laboFontsStyle");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "laboFontsStyle";
    document.head.appendChild(tag);
  }
  return tag;
}

/**
 * ✅ Même format que celui stocké dans le draft (obj.fontFamily)
 * => on garde une forme stable : LABO_FONT_<id>
 */
function safeFamilyName(fontId) {
  return `LABO_FONT_${fontId}`;
}

function safeGlobalFamilyKey(familyKey) {
  // family_key déjà au bon format : GLOBAL_FONT_xxx
  return String(familyKey || "").replace(/["']/g, "").trim();
}

function isGlobalFamily(fam) {
  return /^GLOBAL_FONT_[a-zA-Z0-9]+$/.test(fam || "");
}

function isLaboFamily(fam) {
  return /^LABO_FONT_\d+$/.test(fam || "");
}


/**
 * ⚠️ IMPORTANT:
 * - On définit un @font-face qui pointe vers le WOFF2
 * - Et on expose une "pile" fallback propre
 */
function buildFontFaceCss(font) {
  const family = safeFamilyName(font.id);
  const url = font.woff2_url || font.url || font.file_url || "";

  
  
  const u = String(url || "").trim();
 if (!u || !(u.startsWith("/") || u.startsWith("http://") || u.startsWith("https://"))) return "";


  return `
@font-face {
  font-family: "${family}";
  src: url("${u}") format("woff2");
  font-display: swap;
  font-weight: 100 900;
  font-style: normal;
}
`;
}

function applyFontsToCss(fonts) {
  const tag = ensureFontsStyleTag();
  tag.textContent = (fonts || []).map(buildFontFaceCss).filter(Boolean).join("\n");
}

/**
 * Label humain
 */
function fontLabel(f) {
  return (
    f.display_name ||
    f.name ||
    f.original_name ||
    f.originalName ||
    f.filename ||
    `Font #${f.id}`
  );
}
const DEFAULT_FONT_FAMILY = "helv";
/**
 * ✅ Normalise une fontFamily (qui peut être "LABO_FONT_12", "\"LABO_FONT_12\"", etc.)
 * Retourne "" si vide / défaut.
 */
function normalizeFamilyValue(v) {
  const s = String(v || "").replace(/["']/g, "").trim();
  // ✅ vide = "par défaut"
  if (!s) return "";
  return s;
}


function buildGlobalFontFaceCss(f) {
  const family = safeGlobalFamilyKey(f.family_key);
  const url = f.file_url || "";
  if (!family || !url) return "";

  // ttf / otf -> format CSS
  const lower = url.toLowerCase();
  const fmt = lower.includes(".otf") ? "opentype" : "truetype";

  const weight = Number.isFinite(+f.weight) ? +f.weight : 400;
  const style = (f.style === "italic") ? "italic" : "normal";

  return `
@font-face{
  font-family:"${family}";
  src:url("${url}") format("${fmt}");
  font-display:swap;
  font-weight:${weight};
  font-style:${style};
}
`;
}

function applyAllFontsToCss({ globalFonts = [], laboFonts = [] }) {
  const tag = ensureFontsStyleTag();

  const laboCss = (laboFonts || []).map(buildFontFaceCss).filter(Boolean).join("\n");
  const globalCss = (globalFonts || []).map(buildGlobalFontFaceCss).filter(Boolean).join("\n");

  tag.textContent = [globalCss, laboCss].filter(Boolean).join("\n\n");
}




function normalizeFontFamilyForObj(obj, familyValue) {
  const v = normalizeFamilyValue(familyValue);
  const kind = obj?.dynamic?.kind;
  if (kind === "product_price" || kind === "product_stock_badge") {
    return v || DEFAULT_FONT_FAMILY; // ✅ dyn: jamais vide
  }
  return v; // statique: peut rester vide (défaut)
}


function getDraftPages() {
  return state?.currentDraft?.data_json?.pages || [];
}

function resolveSelectedObject() {
  const sel = state?.selected;
  if (!sel || typeof sel !== "object") return null;

  const pageIndex = Number(sel.pageIndex);
  const objectId = String(sel.objectId || "");

  if (!Number.isFinite(pageIndex) || !objectId) return null;

  const pages = getDraftPages();
  const page = pages[pageIndex];
  if (!page) return null;

  const objs = page.objects || [];
  if (!Array.isArray(objs)) return null;

  return objs.find((o) => String(o?.id || "") === objectId) || null;
}




/**
 * ✅ Applique la police sélectionnée à l'objet courant dans l’éditeur
 * (texte statique ou dynamique).
 */
function applySelectedFontToActiveObject(familyValue) {
  const fam = normalizeFamilyValue(familyValue) || DEFAULT_FONT_FAMILY;

  // ✅ on modifie l'objet réel du draft (celui qui sera POST/PUT)
  const obj = resolveSelectedObject();
  if (obj && typeof obj === "object") {
    obj.fontFamily = normalizeFontFamilyForObj(obj, fam);
  } else {
    console.warn("[FONTS_UI] No selected object resolved from draft.");
  }

  // tool state (optionnel)
  if (state?.toolState && typeof state.toolState === "object") {
    state.toolState.fontFamily = fam;
  }

  // persist + rerender
  try {
    if (typeof state?.markDirty === "function") state.markDirty();
    if (typeof state?.requestRender === "function") state.requestRender();
  } catch {}
}




/**
 * ✅ Remplit un <select> avec les polices du labo.
 * - value = "LABO_FONT_<id>" (ce qui sera stocké dans le draft)
 * - conserve la valeur sélectionnée si possible
 */
function fillFontSelect(selectEl, globalFonts, laboFonts) {
  if (!selectEl) return;

  const current = normalizeFamilyValue(selectEl.value || "");


  selectEl.innerHTML = "";

  // ✅ Default
  const optDefault = document.createElement("option");
	optDefault.value = "";
	optDefault.textContent = "Police par défaut (Helvetica)";

  selectEl.appendChild(optDefault);

  // ✅ Global group
  if (globalFonts && globalFonts.length) {
    const g = document.createElement("optgroup");
    g.label = "Polices globales";

    for (const f of globalFonts) {
      const key = safeGlobalFamilyKey(f.family_key);
      if (!key) continue;

      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = f.display_name || key;
      g.appendChild(opt);
    }

    selectEl.appendChild(g);
  }

  // ✅ Labo group
  if (laboFonts && laboFonts.length) {
    const g = document.createElement("optgroup");
    g.label = "Mes polices (upload)";

    for (const f of laboFonts) {
      const opt = document.createElement("option");
      opt.value = safeFamilyName(f.id); // LABO_FONT_<id>
      opt.textContent = fontLabel(f);
      g.appendChild(opt);
    }

    selectEl.appendChild(g);
  }

  // restore
  selectEl.value = current;
}


/**
 * ✅ Alimente les 2 dropdowns:
 * - #textToolFont (texte)
 * - #dynFontFamily (prix/rupture)
 */
function populateFontSelects(globalFonts, laboFonts) {
  fillFontSelect($("#textToolFont"), globalFonts, laboFonts);
  fillFontSelect($("#dynFontFamily"), globalFonts, laboFonts);

  const textSel = $("#textToolFont");
  const dynSel = $("#dynFontFamily");

  if (textSel && !textSel.__boundFontsUI) {
    textSel.__boundFontsUI = true;
    textSel.addEventListener("change", () => {
      applySelectedFontToActiveObject(textSel.value);
    });
  }

  if (dynSel && !dynSel.__boundFontsUI) {
    dynSel.__boundFontsUI = true;
    dynSel.addEventListener("change", () => {
      applySelectedFontToActiveObject(dynSel.value);
    });
  }
}


function renderFontsList(fonts) {
  const wrap = $("#fontsList");
  if (!wrap) return;

  if (!fonts || fonts.length === 0) {
    wrap.innerHTML = `<div class="mdoc-muted" style="font-size:13px;">Aucune police importée.</div>`;
    return;
  }

  wrap.innerHTML = "";
  for (const f of fonts) {
    const row = document.createElement("div");
    row.className = "mdoc-font-row";

    const left = document.createElement("div");
    left.className = "mdoc-font-left";

    const name = document.createElement("div");
    name.className = "mdoc-font-name";
    name.textContent = fontLabel(f);

    // ✅ preview avec la vraie font chargée
    name.style.fontFamily = `"${safeFamilyName(f.id)}", system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    const meta = document.createElement("div");
    meta.className = "mdoc-font-meta";
    meta.textContent = f.original_name ? `Fichier: ${f.original_name}` : "";

    left.appendChild(name);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "mdoc-font-actions";

    const btnUse = document.createElement("button");
    btnUse.type = "button";
    btnUse.className = "btn";
    btnUse.textContent = "Utiliser";
    btnUse.addEventListener("click", () => {
      // applique sur l'objet sélectionné et synchronise les selects
      const fam = safeFamilyName(f.id);
      const textSel = $("#textToolFont");
      const dynSel = $("#dynFontFamily");
      if (textSel) textSel.value = fam;
      if (dynSel) dynSel.value = fam;
      applySelectedFontToActiveObject(fam);
      setStatus(`Police sélectionnée: ${fontLabel(f)}`);
    });

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn btn-danger";
    btnDel.textContent = "Supprimer";
    btnDel.addEventListener("click", async () => {
      if (!confirm(`Supprimer la police "${name.textContent}" ?`)) return;
      try {
        setStatus("Suppression…");
        await fetchJSON(`/api-zenhub/labo/marketing-fonts/${f.id}`, { method: "DELETE" });

        // si la police supprimée était sélectionnée, on repasse en "Par défaut"
        const fam = safeFamilyName(f.id);
        const textSel = $("#textToolFont");
        const dynSel = $("#dynFontFamily");
        if (textSel && normalizeFamilyValue(textSel.value) === fam) textSel.value = "";
        if (dynSel && normalizeFamilyValue(dynSel.value) === fam) dynSel.value = "";

        await refreshFonts();
        setStatus("Police supprimée.");
      } catch (e) {
        console.error(e);
        setStatus(e.message || "Erreur suppression");
      }
    });

    actions.appendChild(btnUse);
    actions.appendChild(btnDel);

    row.appendChild(left);
    row.appendChild(actions);
    wrap.appendChild(row);
  }
}

async function fetchGlobalFonts() {
  // endpoint public, pas besoin du token (mais il peut être présent)
  const fonts = await fetchJSON("/api-zenhub/fonts/global", { method: "GET" });
  return Array.isArray(fonts) ? fonts : [];
}

function buildFontsMap({ globalFonts = [], laboFonts = [] }) {
  const map = {};

  // global
  for (const f of globalFonts) {
    const key = safeGlobalFamilyKey(f.family_key);
    if (!key) continue;
    map[key] = {
      type: "global",
      id: f.id,
      display_name: f.display_name || key,
      weight: f.weight ?? null,
      style: f.style ?? null,
      // ⚠️ on n’expose pas file_path au client
    };
  }

  // labo
  for (const f of laboFonts) {
    const key = safeFamilyName(f.id); // LABO_FONT_<id>
    map[key] = {
      type: "labo",
      id: f.id,
      display_name: fontLabel(f),
      woff2_url: f.woff2_url || f.url || f.file_url || null,
    };
  }

  return map;
}


// ---------- API ----------
export async function refreshFonts() {
  // 1) Labo fonts (woff2)
  const laboFonts = await fetchJSON(
    "/api-zenhub/labo/marketing-fonts",
    { method: "GET" }
  );

  // 2) Global fonts (ttf/otf)
  let globalFonts = [];
  try {
    globalFonts = await fetchGlobalFonts();
  } catch (e) {
    console.warn("[FONTS_UI] global fonts load failed:", e);
    globalFonts = [];
  }

  // ✅ IMPORTANT : on injecte les @font-face APRÈS avoir tout chargé
  applyAllFontsToCss({ globalFonts, laboFonts });

  // 3) UI
  populateFontSelects(globalFonts, laboFonts);
  renderFontsList(laboFonts);

  // 4) Sync state global
  try {
    state.laboFonts = Array.isArray(laboFonts) ? laboFonts : [];
    state.globalFonts = Array.isArray(globalFonts) ? globalFonts : [];

    state.fonts = state.laboFonts; // compat legacy

    state.fonts_map = buildFontsMap({
      globalFonts: state.globalFonts,
      laboFonts: state.laboFonts,
    });

    state.fontsByFamily = new Map(
      (state.laboFonts || []).map(f => [safeFamilyName(f.id), f])
    );

    state.globalFontsByFamily = new Map(
      (state.globalFonts || []).map(f => [safeGlobalFamilyKey(f.family_key), f])
    );
  } catch (e) {
    console.warn("[FONTS_UI] state sync failed", e);
  }

  return { globalFonts, laboFonts };
}




export function bindFontUploadForm() {
  const form = $("#fontUploadForm");
  const displayName = $("#fontDisplayName");
  const fileInput = $("#fontFileInput");
  const btn = $("#btnUploadFont");

  if (!form || !displayName || !fileInput) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("");

    const name = (displayName.value || "").trim();
    const file = fileInput.files?.[0];

    if (!name) {
      setStatus("Nom affiché obligatoire.");
      return;
    }
    if (!file) {
      setStatus("Choisis un fichier .woff2.");
      return;
    }

    const lower = (file.name || "").toLowerCase();
    if (!lower.endsWith(".woff2")) {
      setStatus("Format invalide. WOFF2 uniquement.");
      return;
    }

    const max = 2 * 1024 * 1024;
    if (file.size > max) {
      setStatus("Police trop volumineuse (2 Mo max).");
      return;
    }

    const fd = new FormData();
    fd.append("display_name", name);
    fd.append("file", file);

    try {
      if (btn) btn.disabled = true;
      setStatus("Import…");

      await fetchJSON("/api-zenhub/labo/marketing-fonts", {
        method: "POST",
        body: fd,
        headers: {}, // ne pas forcer Content-Type avec FormData
      });

      fileInput.value = "";
      await refreshFonts();
      setStatus("Police importée ✅");

      // ✅ sélectionne automatiquement la dernière police importée si l’API la renvoie en fin de liste
      try {
        const fonts = state?.fonts || [];
        const last = fonts[fonts.length - 1];
        if (last?.id) {
          const fam = safeFamilyName(last.id);
          const textSel = $("#textToolFont");
          const dynSel = $("#dynFontFamily");
          if (textSel) textSel.value = fam;
          if (dynSel) dynSel.value = fam;
          applySelectedFontToActiveObject(fam);
        }
      } catch {}
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Erreur import");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

window.__LABO_STATE__ = state;
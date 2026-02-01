// app/static/labo/editor/font_picker_tools.js
// ------------------------------------------------------------
// Font Picker (Google-like) — sans dépendances externes
// ✅ inject @font-face (url) + inject <link rel="stylesheet"> (css/href)
// ✅ popover avec preview réelle de la police
// ✅ sections (default/labo/global)
// ✅ SANS barre de recherche (requested)
// ✅ Helpers rich-text: save/restore range, highlight, apply font selection/all, detect current font
// ✅ Safe à importer dans n'importe quel tool (texte / paragraphe / texte cercle / texte path)
// ------------------------------------------------------------

function cssEscapeIdent(v) {
  const s = String(v || "");
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
  // fallback simple
  return s.replace(/["\\]/g, "\\$&");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// ------------------------------------------------------------
// Normalisation fonts
// ------------------------------------------------------------
function getFontKey(f) {
  if (!f) return "";
  if (typeof f === "string") return String(f).trim();
  return String(f.name || f.value || f.family || "").trim();
}
function getFontLabel(f) {
  if (!f) return "";
  if (typeof f === "string") return String(f).trim();
  return String(f.label || f.name || f.value || f.family || "").trim();
}

function inferFormat(url) {
  const u = String(url || "").toLowerCase().split("?")[0].split("#")[0];
  if (u.endsWith(".woff2")) return "woff2";
  if (u.endsWith(".woff")) return "woff";
  if (u.endsWith(".ttf")) return "truetype";
  if (u.endsWith(".otf")) return "opentype";
  return null;
}

function fontFamilyCss(name) {
  const n = String(name || "").trim();
  if (!n) return "Helvetica, Arial, sans-serif";
  if (n.includes(",")) return n; // already stack
  if (/[^\w-]/.test(n)) return `"${cssEscapeIdent(n)}"`;
  return n;
}

// valeur logique -> stack CSS réelle (fallback helv)
function resolveFontFamily(fontKey) {
  const k = String(fontKey || "").trim();
  if (!k || k === "helv" || k === "Helvetica" || k === "Helvetica (défaut)") {
    return "Helvetica, Arial, sans-serif";
  }
  return `${fontFamilyCss(k)}, Helvetica, Arial, sans-serif`;
}

function normalizeFonts(fonts) {
  return (Array.isArray(fonts) ? fonts : [])
    .map((f) => {
      if (typeof f === "string") {
        return {
          name: f.trim(),
          label: f.trim(),
          scope: "global",
          isDefault: false,
          href: null,
          url: null,
          format: null,
          weight: null,
          style: null,
        };
      }

      const name = getFontKey(f);
      const label = getFontLabel(f) || name;

      return {
        name,
        label,
        scope: String(f.scope || f.origin || "global").toLowerCase(), // "default"|"labo"|"global"
        isDefault: !!f.isDefault,

        // load resources
        href: f.href || f.css || f.cssUrl || null, // CSS url
        url: f.url || null,                        // font file
        format: f.format || inferFormat(f.url) || null,
        weight: f.weight || "400",
        style: f.style || "normal",
      };
    })
    .filter((x) => x && x.name);
}

// ------------------------------------------------------------
// Injection ressources (once)
// ------------------------------------------------------------
function injectFontLinksOnce(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  for (const href of urls) {
    if (!href) continue;
    const id = `zh-fontlink:${href}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

function ensureFontFaceLoadedOnce(fontObj) {
  if (!fontObj || !fontObj.url || !fontObj.name) return;

  const id = `zh-fontface:${fontObj.name}`;
  if (document.getElementById(id)) return;

  const fmt = fontObj.format || inferFormat(fontObj.url) || "woff2";
  const weight = fontObj.weight || "400";
  const style = fontObj.style || "normal";

  const s = document.createElement("style");
  s.id = id;
  s.textContent = `
@font-face{
  font-family:${fontFamilyCss(fontObj.name)};
  src:url("${String(fontObj.url).replace(/"/g, '\\"')}") format("${fmt}");
  font-weight:${weight};
  font-style:${style};
  font-display:swap;
}`;
  document.head.appendChild(s);
}

function ensureFontLoaded(fontObj) {
  if (!fontObj) return;
  if (fontObj.href) injectFontLinksOnce([fontObj.href]);
  if (fontObj.url) ensureFontFaceLoadedOnce(fontObj);
}

function ensureFontsLoaded(fonts) {
  const list = normalizeFonts(fonts);
  const cssUrls = [];
  for (const f of list) if (f.href) cssUrls.push(f.href);
  if (cssUrls.length) injectFontLinksOnce(cssUrls);
  for (const f of list) ensureFontFaceLoadedOnce(f);
  return list;
}

async function preloadFonts(fonts, sizePx = 18) {
  const list = normalizeFonts(fonts);
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all(
      list.slice(0, 24).map((f) => document.fonts.load(`${sizePx}px ${fontFamilyCss(f.name)}`))
    );
  } catch {}
}

// ------------------------------------------------------------
// Rich-text helpers (Selection / Range) — generic
// ------------------------------------------------------------
function getSelectionSafe() {
  try { return window.getSelection(); } catch (_) { return null; }
}

function selectionIsInside(rootEl) {
  const sel = getSelectionSafe();
  if (!sel || sel.rangeCount === 0) return false;
  const a = sel.anchorNode;
  const f = sel.focusNode;
  if (!a || !f) return false;
  return rootEl.contains(a) && rootEl.contains(f);
}

function saveSelectionRange(editEl) {
  const sel = getSelectionSafe();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  if (!editEl || !editEl.contains(r.startContainer)) return;
  editEl._savedRange = r.cloneRange();
}

function restoreSelectionRange(editEl) {
  const sel = getSelectionSafe();
  if (!sel || !editEl || !editEl._savedRange) return;
  try {
    editEl.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(editEl._savedRange);
  } catch (_) {}
}

function clearSelectionHighlight(editEl) {
  if (!editEl) return;
  const hs = editEl.querySelectorAll('span[data-zh-sel="1"]');
  hs.forEach((sp) => {
    const frag = document.createDocumentFragment();
    while (sp.firstChild) frag.appendChild(sp.firstChild);
    sp.replaceWith(frag);
  });
}

function highlightSavedSelection(editEl) {
  if (!editEl || !editEl._savedRange) return;

  clearSelectionHighlight(editEl);

  const r = editEl._savedRange.cloneRange();
  if (r.collapsed) return;

  try {
    const span = document.createElement("span");
    span.setAttribute("data-zh-sel", "1");
    span.style.background = "rgba(37,99,235,.22)";
    span.style.boxShadow = "0 0 0 1px rgba(37,99,235,.35) inset";
    span.style.borderRadius = "4px";
    span.style.padding = "0 1px";

    const frag = r.extractContents();
    span.appendChild(frag);
    r.insertNode(span);
  } catch (_) {}
}

function getFontKeyFromNodeUp(node, rootEl, fallbackKey = "helv") {
  let n = node;
  if (!n) return fallbackKey;

  if (n.nodeType === 3) n = n.parentElement; // text node -> element
  if (!n || !rootEl || !rootEl.contains(n)) return fallbackKey;

  const el = n.closest ? n.closest("[data-zh-font-key]") : null;
  const k = el && el.dataset ? (el.dataset.zhFontKey || "") : "";
  return (k && String(k).trim()) ? String(k).trim() : fallbackKey;
}

function getFontKeyFromSavedOrCurrentSelection(editEl, fallbackKey = "helv") {
  if (editEl && editEl._savedRange) {
    try {
      const r = editEl._savedRange;
      return getFontKeyFromNodeUp(r.startContainer, editEl, fallbackKey);
    } catch (_) {}
  }
  const sel = getSelectionSafe();
  if (!sel || sel.rangeCount === 0) return fallbackKey;
  const r = sel.getRangeAt(0);
  return getFontKeyFromNodeUp(r.startContainer, editEl, fallbackKey);
}

// retire font-family + data-zh-font-key sur tous les spans, garde le reste
function stripInlineFontFamily(rootEl, { unwrapEmptySpans = true } = {}) {
  if (!rootEl) return;
  const spans = rootEl.querySelectorAll("span");
  spans.forEach((sp) => {
    if (sp.style && sp.style.fontFamily) sp.style.fontFamily = "";
    if (sp.dataset && sp.dataset.zhFontKey) delete sp.dataset.zhFontKey;

    if (unwrapEmptySpans) {
      const styleAttr = sp.getAttribute("style");
      const hasStyle = !!(styleAttr && styleAttr.trim());
      const hasData = sp.getAttributeNames().some((n) => n.startsWith("data-"));
      if (!hasStyle && !hasData) {
        const frag = document.createDocumentFragment();
        while (sp.firstChild) frag.appendChild(sp.firstChild);
        sp.replaceWith(frag);
      }
    }
  });
}

function applyFontToAll(editEl, fontKey) {
  if (!editEl) return;
  editEl.style.fontFamily = resolveFontFamily(fontKey || "helv");
  stripInlineFontFamily(editEl);
}

// Wrap sélection (ou typing span si collapsed) avec font-family + data-zh-font-key
function applyFontToSelection(editEl, fontKey) {
  if (!editEl) return;

  const sel = getSelectionSafe();
  if (!sel || sel.rangeCount === 0) return;

  // si focus volé par le popover, on tente restore
  if (!selectionIsInside(editEl)) restoreSelectionRange(editEl);
  if (!selectionIsInside(editEl)) return;

  const fam = resolveFontFamily(fontKey || "helv");
  const range = sel.getRangeAt(0);

  // collapsed => span “typing”
  if (range.collapsed) {
    const span = document.createElement("span");
    span.style.fontFamily = fam;
    span.dataset.zhFontKey = String(fontKey || "helv");
    span.appendChild(document.createTextNode("\u200B"));
    range.insertNode(span);

    const r2 = document.createRange();
    r2.setStart(span.firstChild, 1);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    return;
  }

  // selection => wrap
  const frag = range.extractContents();
  const span = document.createElement("span");
  span.style.fontFamily = fam;
  span.dataset.zhFontKey = String(fontKey || "helv");
  span.appendChild(frag);
  range.insertNode(span);

  // reselection span
  sel.removeAllRanges();
  const r2 = document.createRange();
  r2.selectNodeContents(span);
  sel.addRange(r2);
}

// ------------------------------------------------------------
// CSS UI (once)
// ------------------------------------------------------------
function injectPickerCssOnce() {
  if (document.getElementById("zh-fontpicker-css")) return;
  const s = document.createElement("style");
  s.id = "zh-fontpicker-css";
  s.textContent = `
.zh-font-pop{
  position:fixed;
  width:360px;
  background:#fff;
  border:1px solid rgba(17,24,39,.12);
  border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.12);
  padding:10px;
  z-index: 999999;
}
/* IMPORTANT: class "color-pop" pour être whitelisted par tes scripts de deselect */
.zh-font-pop.color-pop{ }

.zh-font-title{
  font-size:12px;
  opacity:.75;
  margin:10px 4px 6px;
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.zh-font-title .tag{
  font-size:11px;
  padding:2px 8px;
  border-radius:999px;
  background:rgba(17,24,39,.06);
}

.zh-font-list{
  display:flex;
  flex-direction:column;
  gap:6px;
  max-height:260px;
  overflow:auto;
  padding-right:2px;
}

.zh-font-item{
  border:0;
  border-radius:12px;
  cursor:pointer;
  background:#fff;
  box-shadow:0 0 0 1px rgba(17,24,39,.10) inset;
  padding:10px 12px;
  text-align:left;
}
.zh-font-item:hover{ background:rgba(17,24,39,.04); }

.zh-font-item.is-selected{
  box-shadow:0 0 0 2px rgba(59,130,246,.28) inset;
  background:rgba(59,130,246,.06);
}

.zh-font-item .name{
  display:flex;
  justify-content:space-between;
  font-weight:800;
  margin-bottom:4px;
}
.zh-font-item .scope{
  font-size:12px;
  opacity:.6;
}
.zh-font-item .preview{
  font-size:18px;
  line-height:1.1;
  opacity:.95;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
`;
  document.head.appendChild(s);
}

// ------------------------------------------------------------
// Popover builder
// ------------------------------------------------------------
function computePopPos(anchorEl, popEl) {
  const r = anchorEl.getBoundingClientRect();
  const w = popEl.offsetWidth || 360;
  const h = popEl.offsetHeight || 360;

  const gap = 8;
  let left = r.left;
  let top = r.bottom + gap;

  left = clamp(left, 8, window.innerWidth - w - 8);

  // si ça sort en bas, on tente au-dessus
  if (top + h > window.innerHeight - 8) {
    const above = r.top - h - gap;
    if (above >= 8) top = above;
    else top = clamp(top, 8, window.innerHeight - h - 8);
  }

  popEl.style.left = `${left}px`;
  popEl.style.top = `${top}px`;
}

function renderSection(title, tag, fonts, selectedKey) {
  if (!fonts || !fonts.length) return "";
  const previewText = "BBH... 0123 AaBb";

  return `
    <div class="zh-font-title">
      <span>${escapeHtml(title)}</span>
      ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ``}
    </div>
    <div class="zh-font-list">
      ${fonts.map((f) => {
        const isSel = selectedKey && String(f.name) === String(selectedKey);
        return `
          <button type="button"
                  class="zh-font-item ${isSel ? "is-selected" : ""}"
                  data-font="${escapeHtml(f.name)}"
                  data-label="${escapeHtml(f.label)}">
            <div class="name">
              <span>${escapeHtml(f.label)}</span>
              <span class="scope">${escapeHtml(f.scope)}</span>
            </div>
            <div class="preview" style="font-family:${escapeHtml(resolveFontFamily(f.name))};">
              ${escapeHtml(previewText)}
            </div>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

/**
 * createFontPickerPopover
 * @param {Object} cfg
 * @param {Array}    cfg.fonts     fonts list (strings or objects)
 * @param {Function} cfg.onPick    (fontKey, fontObj) => void
 * @param {String}   cfg.selected  optional current key
 * @returns {Object} { open(anchorEl), close(), destroy(), isOpen(), setFonts(nextFonts), setSelected(key), getSelected() }
 */
function createFontPickerPopover(cfg = {}) {
  injectPickerCssOnce();

  let fonts = ensureFontsLoaded(cfg.fonts || []);
  let selected = String(cfg.selected || "").trim();

  const onPick = typeof cfg.onPick === "function" ? cfg.onPick : () => {};

  const pop = document.createElement("div");
  pop.className = "zh-font-pop color-pop"; // ✅ important pour whitelist
  pop.setAttribute("data-zh-popover", "1");   // ✅ nouveau marqueur universel
pop.setAttribute("data-no-deselect", "1"); // ✅ pour tes scripts existants (tu utilises déjà ça côté color picker)

  pop.hidden = true;
  pop.innerHTML = `<div data-role="content"></div>`;
  document.body.appendChild(pop);

  const content = pop.querySelector('[data-role="content"]');

  function render() {
    // charge vite fait quelques fonts
    try {
      if (document.fonts && document.fonts.load) {
        fonts.slice(0, 16).forEach((f) => {
          document.fonts.load(`18px ${fontFamilyCss(f.name)}`);
        });
      }
    } catch {}

    const def = fonts.filter((f) => f.isDefault || f.scope === "default");
    const labo = fonts.filter((f) => f.scope === "labo" && !f.isDefault);
    const glob = fonts.filter((f) => f.scope === "global" && !f.isDefault);

    content.innerHTML = `
      ${renderSection("Police", "", def.length ? def : fonts.slice(0, 1), selected)}
      ${renderSection("Polices", "Labo", labo, selected)}
      ${renderSection("Polices", "Global", glob, selected)}
    `;
  }

  // interactions
  pop.addEventListener("pointerdown", (e) => {
  // ne pas voler le focus en cliquant sur un bouton (mais garder les inputs si tu en ajoutes un jour)
  const tag = (e.target?.tagName || "").toLowerCase();
  const allow = (tag === "input" || tag === "textarea" || tag === "select");
  if (!allow) { try { e.preventDefault(); } catch(_) {} }
  e.stopPropagation();
}, true);


  pop.addEventListener("click", (e) => {
    const item = e.target.closest(".zh-font-item[data-font]");
    if (!item) return;
    const key = String(item.dataset.font || "").trim();
    const obj = fonts.find((x) => x.name === key) || { name: key, label: key };
    ensureFontLoaded(obj);
    selected = key;

    // update UI selection immediately
    try {
      content.querySelectorAll(".zh-font-item.is-selected").forEach((b) => b.classList.remove("is-selected"));
      item.classList.add("is-selected");
    } catch {}

    onPick(key, obj);
    close();
  });

  function open(anchorEl) {
    if (!anchorEl) return;
    pop.hidden = false;
    render();
    requestAnimationFrame(() => computePopPos(anchorEl, pop));
  }

  function close() {
    pop.hidden = true;
  }

  function destroy() {
    try { pop.remove(); } catch {}
  }

  function isOpen() {
    return !pop.hidden;
  }

  function setFonts(nextFonts) {
    fonts = ensureFontsLoaded(nextFonts || []);
    if (!pop.hidden) render();
  }

  function setSelected(key) {
    selected = String(key || "").trim();
    if (!pop.hidden) render();
  }

  function getSelected() {
    return selected;
  }

  // outside click close (capture)
  const onDocDown = (e) => {
    if (pop.hidden) return;
    if (e.target && e.target.closest && e.target.closest(".zh-font-pop")) return;
    close();
  };
  document.addEventListener("pointerdown", onDocDown, true);

  return {
    open,
    close,
    destroy: () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      destroy();
    },
    isOpen,
    setFonts,
    setSelected,
    getSelected,
  };
}

// --- Option B bridge (global) ----------------------------------------------
try {
  window.FontPickerTools = window.FontPickerTools || {};

  // picker + font resolution
  window.FontPickerTools.createFontPickerPopover = createFontPickerPopover;
  window.FontPickerTools.resolveFontFamily = resolveFontFamily;
  window.FontPickerTools.ensureFontsLoaded = ensureFontsLoaded;
  window.FontPickerTools.ensureFontLoaded = ensureFontLoaded;

  // helpers selection/richtext
  window.FontPickerTools.getSelectionSafe = getSelectionSafe;
  window.FontPickerTools.selectionIsInside = selectionIsInside;
  window.FontPickerTools.saveSelectionRange = saveSelectionRange;
  window.FontPickerTools.restoreSelectionRange = restoreSelectionRange;
  window.FontPickerTools.clearSelectionHighlight = clearSelectionHighlight;
  window.FontPickerTools.highlightSavedSelection = highlightSavedSelection;
  window.FontPickerTools.getFontKeyFromSavedOrCurrentSelection = getFontKeyFromSavedOrCurrentSelection;
  window.FontPickerTools.applyFontToSelection = applyFontToSelection;
  window.FontPickerTools.applyFontToAll = applyFontToAll;
  window.FontPickerTools.stripInlineFontFamily = stripInlineFontFamily;
} catch (_) {}

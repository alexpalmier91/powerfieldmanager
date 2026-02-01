// app/static/labo/editor/paragraph_toolbar.js
// -------------------------------------------------------------
// Paragraph WYSIWYG – Toolbar compacte
// ✅ Couleur / font / size appliqués sur sélection OU en "pending style" si caret
// ✅ Pending style appliqué au prochain input (typing) via insertText wrapper
// ✅ Line-height (interligne) au niveau bloc + persist obj.style.lineHeight
// ✅ Sauvegarde/restaure la sélection
//
// ✅ Taille police = menu déroulant style "Autre quantité…":
//   - menu avec presets: 9/10/12/14/18/25/30
//   - item "Autre taille…" => affiche input pour saisir la taille
//   - applique sans perdre la sélection
// -------------------------------------------------------------

const CFG = {
  getObject: null,
  sanitize: (html) => html,
  onDirty: null,
  setEditingState: null,
  getOverlayFromEl: null,

  fonts: [
    { name: "Inter", label: "Inter" },
    { name: "Arial", label: "Arial" },
    { name: "Helvetica", label: "Helvetica" },
    { name: "Times New Roman", label: "Times" },
  ],

  injectFontCss: [],

  swatches: [
    "#111827",
    "#6B7280",
    "#EF4444",
    "#F59E0B",
    "#10B981",
    "#3B82F6",
    "#8B5CF6",
    "#EC4899",
    "#000000",
  ],

  // ✅ presets du menu taille
  sizePresets: [9, 10, 12, 14, 18, 25, 30],
};


function closestSafe(el, sel) {
  return (el && el.closest) ? el.closest(sel) : null;
}
function qsSafe(el, sel) {
  return (el && el.querySelector) ? el.querySelector(sel) : null;
}


function rafThrottle(fn) {
  let pending = false;
  return (...args) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...args);
    });
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscapeIdent(v) {
  const s = String(v || "");
  // CSS.escape() est parfait si dispo
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
  // fallback simple
  return s.replace(/["\\]/g, "\\$&");
}

function getFontKey(f) {
  if (!f) return "";
  if (typeof f === "string") return f;
  return String(f.name || f.value || "").trim();
}

function getFontLabel(f) {
  if (!f) return "";
  if (typeof f === "string") return f;
  return String(f.label || f.name || f.value || "").trim();
}

// valeur logique -> font-family CSS réel
function resolveFontFamily(fontKey) {
  const k = String(fontKey || "").trim();
  if (!k || k === "helv" || k === "Helvetica" || k === "Helvetica (défaut)") {
    return "Helvetica, Arial, sans-serif";
  }
  return `${fontFamilyCss(k)}, Helvetica, Arial, sans-serif`;
}


function fontFamilyCss(name) {
  const n = String(name || "").trim();
  if (!n) return "Helvetica, Arial, sans-serif";
  // si déjà une stack avec virgules, on respecte
  if (n.includes(",")) return n;
  // quote si espaces / caractères spéciaux
  if (/[^\w-]/.test(n)) return `"${cssEscapeIdent(n)}"`;
  return n;
}
function fontFamilyCssAttr(name) {
  return fontFamilyCss(name).replaceAll('"', "&quot;");
}


function cssFontFamily(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  // si espaces ou caractères spéciaux => on quote
  const needsQuote = /[^a-zA-Z0-9_-]/.test(n);
  const safe = n.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return needsQuote ? `"${safe}"` : safe;
}

// pour injection dans un attribut HTML style=""
function cssFontFamilyAttr(name) {
  return cssFontFamily(name).replaceAll('"', "&quot;");
}

// ✅ permet de charger des fonts si tu fournis f.href ou f.css (Google Fonts / CSS)
function ensureFontCssLoadedOnce(fontObj) {
  const href = fontObj && (fontObj.href || fontObj.css);
  if (!href) return;
  injectFontLinksOnce([href]);
}

// ✅ permet de charger des fonts locales si tu fournis f.url (woff/woff2/ttf)
function inferFontFormatFromUrl(url) {
  const u = String(url || "").toLowerCase().split("?")[0].split("#")[0];
  if (u.endsWith(".woff2")) return "woff2";
  if (u.endsWith(".woff")) return "woff";
  if (u.endsWith(".ttf")) return "truetype";
  if (u.endsWith(".otf")) return "opentype";
  return null;
}

function ensureFontFaceLoadedOnce(fontObj) {
  if (!fontObj || !fontObj.url || !fontObj.name) return;

  const id = `zh-fontface:${fontObj.name}`;
  if (document.getElementById(id)) return;

  const inferred = inferFontFormatFromUrl(fontObj.url);
  const fmt = fontObj.format || inferred || "woff2"; // ✅ plus de "woff2" forcé pour TTF
  const weight = fontObj.weight || "400";
  const style = fontObj.style || "normal";

  const s = document.createElement("style");
  s.id = id;
  s.textContent = `
@font-face{
  font-family:${cssFontFamily(fontObj.name)};
  src:url("${String(fontObj.url).replace(/"/g, '\\"')}") format("${fmt}");
  font-weight:${weight};
  font-style:${style};
  font-display:swap;
}`;
  document.head.appendChild(s);
}


function ensureFontLoaded(fontObj) {
  ensureFontCssLoadedOnce(fontObj);
  ensureFontFaceLoadedOnce(fontObj);
}



function getContentEl(blockEl) {
  if (!blockEl || !blockEl.querySelector) return null;
  return blockEl.querySelector('[data-role="richtext"]');
}


function getOverlayFallback(blockEl) {
  if (!blockEl) return document.body;

  if (blockEl.closest) {
    const a = blockEl.closest(".page-overlay");
    if (a) return a;
    const b = blockEl.closest(".pdf-page-overlay");
    if (b) return b;
  }

  return blockEl.parentElement || document.body;
}


function placeCaret(el, atEnd = true) {
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

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

// -------- Selection helpers
function getLiveRange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0);
}

function isRangeInside(range, rootEl) {
  if (!range || !rootEl) return false;
  return rootEl.contains(range.commonAncestorContainer);
}

function restoreRange(range) {
  if (!range) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

// -------- Styling helpers
function wrapRangeWithSpan(range, styleObj) {
  if (!range || range.collapsed) return false;

  const span = document.createElement("span");

  const frag = range.extractContents();

  // ✅ si on applique une taille, on vire les font-size inline descendants
  if (styleObj && styleObj.fontSize) {
    clearDescendantInlineFontSize(frag);
  }

  for (const [k, v] of Object.entries(styleObj || {})) {
    if (v == null || v === "") continue;
    span.style[k] = String(v);
  }

  span.appendChild(frag);
  range.insertNode(span);

  // reselect span content
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(span);
    sel.addRange(r);
  }
  return true;
}


function unwrapSpan(span) {
  if (!span || !span.parentNode) return;
  const p = span.parentNode;
  while (span.firstChild) p.insertBefore(span.firstChild, span);
  p.removeChild(span);
}

function clearDescendantInlineFontSize(root) {
  if (!root) return;

  const walk = (node) => {
    if (!node) return;

    // Element
    if (node.nodeType === 1) {
      const el = node;

      // supprime uniquement la propriété font-size inline
      if (el.style && el.style.fontSize) {
        el.style.fontSize = "";
        // si style="" devient vide, on nettoie l'attribut
        if (el.getAttribute && el.getAttribute("style") === "") {
          el.removeAttribute("style");
        }
      }

      // recurse
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      return;
    }

    // DocumentFragment
    if (node.nodeType === 11) {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
  };

  walk(root);
}


function applyInlineStyle(contentEl, savedRange, styleObj) {
  const live = getLiveRange();
  if (live && isRangeInside(live, contentEl)) {
    // ok
  } else if (savedRange && isRangeInside(savedRange, contentEl)) {
    restoreRange(savedRange);
  } else {
    return { applied: false, mode: "none" };
  }

  const r2 = getLiveRange();
  if (!r2 || !isRangeInside(r2, contentEl)) return { applied: false, mode: "none" };

  if (r2.collapsed) return { applied: false, mode: "caret" };

  const ok = wrapRangeWithSpan(r2, styleObj);
  return { applied: ok, mode: "range" };
}

function setBlockLineHeight(contentEl, lineHeight) {
  if (!contentEl) return;
  contentEl.style.lineHeight = String(lineHeight || "1.3");
}

// -------- Insert with pending style (caret mode)
function insertStyledTextAtCaret(contentEl, text, styleObj) {
  const r = getLiveRange();
  if (!r || !contentEl || !isRangeInside(r, contentEl)) return false;

  const span = document.createElement("span");
  for (const [k, v] of Object.entries(styleObj || {})) {
    if (v == null || v === "") continue;
    span.style[k] = String(v);
  }
  span.textContent = text;

  r.insertNode(span);

  // move caret after span
  const sel = window.getSelection();
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.setStartAfter(span);
  nr.collapse(true);
  sel.addRange(nr);
  return true;
}

// -------- Toolbar position
function computeToolbarPos(toolbarEl, blockEl, overlayEl) {
  const tb = toolbarEl.getBoundingClientRect();
  const br = blockEl.getBoundingClientRect();

  let or = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (overlayEl && overlayEl.getBoundingClientRect) {
    or = overlayEl.getBoundingClientRect();
  }

  const gap = 8;
  const below = br.bottom + gap;
  const above = br.top - tb.height - gap;

  let top = below + tb.height > or.bottom && above >= or.top ? above : below;
  let left = br.left + (br.width - tb.width) / 2;

  left = clamp(left, or.left + 8, or.right - tb.width - 8);
  top = clamp(top, or.top + 8, or.bottom - tb.height - 8);

  toolbarEl.style.left = `${left}px`;
  toolbarEl.style.top = `${top}px`;
}


// -------- CSS
function injectStylesOnce() {
  if (document.getElementById("zh-rtb-style")) return;
  const s = document.createElement("style");
  s.id = "zh-rtb-style";
  s.textContent = `
.zh-rtb{ font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
.zh-rtb-inner{
  display:flex; align-items:center; gap:6px;
  padding:8px 10px; background:#fff;
  border:1px solid rgba(17,24,39,.12);
  border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.12);
}
.zh-rtb-btn{
  height:32px; min-width:32px; padding:0 10px;
  display:flex; align-items:center; justify-content:center;
  border:0; background:transparent; border-radius:10px;
  cursor:pointer; color:#111827;
}
.zh-rtb-btn:hover{ background:rgba(17,24,39,.06); }
.zh-rtb-sep{ width:1px; height:20px; background:rgba(17,24,39,.12); margin:0 2px; }

.zh-rtb-select{
  position:relative; height:32px; display:flex; align-items:center;
  padding:0 22px 0 10px; border-radius:10px;
  background:rgba(17,24,39,.04);
}
.zh-rtb-select select{
  appearance:none; border:0; outline:0; background:transparent;
  font:inherit; color:#111827; height:32px; padding:0;
  cursor:pointer; max-width:100%;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.zh-rtb-caret{ position:absolute; right:8px; font-size:12px; opacity:.65; pointer-events:none; }
.zh-rtb-select.font{ width:150px; }

/* ✅ Taille police: bouton + popover type "Autre quantité..." */
.zh-rtb-size{
  display:flex; align-items:center;
  height:32px; padding:0 8px;
  background:rgba(17,24,39,.04);
  border-radius:10px;
}
.zh-rtb-size-btn{
  height:28px;
  min-width:56px;
  padding:0 10px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  background:transparent;
  color:#111827;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  font:inherit;
}
.zh-rtb-size-btn:hover{ background:rgba(17,24,39,.06); }
.zh-rtb-size-btn .val{ min-width:18px; text-align:center; }
.zh-rtb-size-btn .caret{ font-size:12px; opacity:.7; }

.zh-rtb-pop{
  position:fixed;
  padding:8px;
  background:#fff;
  border:1px solid rgba(17,24,39,.12);
  border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.12);
  min-width:220px;
}
.zh-rtb-size-menu{
  display:flex;
  flex-direction:column;
  gap:6px;
}
.zh-rtb-size-item{
  height:32px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  background:transparent;
  color:#111827;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 10px;
}
.zh-rtb-size-item:hover{ background:rgba(17,24,39,.06); }
.zh-rtb-size-item.is-other{
  opacity:.9;
}
.zh-rtb-size-other{
  display:flex;
  align-items:center;
  gap:8px;
  padding:6px;
  border-radius:12px;
  background:rgba(17,24,39,.04);
}
.zh-rtb-size-other input{
  flex:1;
  height:32px;
  border:1px solid rgba(17,24,39,.12);
  border-radius:10px;
  padding:0 10px;
  font:inherit;
  outline:none;
  background:#fff;
}
.zh-rtb-size-other input:focus{
  box-shadow:0 0 0 2px rgba(59,130,246,.18);
  border-color: rgba(59,130,246,.35);
}
.zh-rtb-size-other button{
  height:32px;
  padding:0 12px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  background:#fff;
  box-shadow:0 0 0 1px rgba(17,24,39,.10) inset;
}
.zh-rtb-size-other button:hover{ background:rgba(17,24,39,.06); }

.zh-rtb-num{
  display:flex; align-items:center; gap:6px;
  height:32px; padding:0 8px;
  background:rgba(17,24,39,.04); border-radius:10px;
}
.zh-rtb-num input{
  width:60px; height:28px; border:0; outline:0; background:transparent;
  font:inherit; color:#111827; text-align:center;
}

.zh-rtb-color{
  display:flex; align-items:center; gap:8px;
  height:32px; padding:0 10px;
  background:rgba(17,24,39,.04); border-radius:10px;
}
.zh-rtb-swatch{
  width:18px; height:18px; border-radius:6px;
  background:#111827; box-shadow:0 0 0 1px rgba(17,24,39,.16) inset;
}
.zh-rtb-color button{
  height:28px; padding:0 10px;
  border:0; border-radius:10px; cursor:pointer;
  background:#fff; box-shadow:0 0 0 1px rgba(17,24,39,.10) inset;
}
.zh-rtb-color button:hover{ background:rgba(17,24,39,.06); }
.zh-rtb-color input[type="color"]{ width:28px; height:28px; padding:0; border:0; background:transparent; cursor:pointer; }

.zh-rtb-grid{
  display:grid; grid-template-columns: repeat(8, 1fr); gap:8px;
}
.zh-rtb-chip{
  width:22px; height:22px; border-radius:8px;
  border:0; cursor:pointer;
  box-shadow:0 0 0 1px rgba(17,24,39,.14) inset;
}
/* ✅ sélection gelée (visible même si focus toolbar) */
.zh-rtb-temp-sel{
  background: rgba(59,130,246,.18);
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(59,130,246,.25) inset;
}
.zh-rtb-align{
  display:flex;
  align-items:center;
  gap:2px;
  padding:0 4px;
  background:rgba(17,24,39,.04);
  border-radius:10px;
  height:32px;
}
.zh-rtb-btn.is-active{
  background: rgba(17,24,39,.10);
}
.zh-rtb-btn svg{ display:block; }

.zh-rtb-color{
  display:flex; align-items:center; gap:8px;
  height:32px; padding:0 8px;
  background:rgba(17,24,39,.04); border-radius:10px;
}
.zh-rtb-color-btn{
  width:30px; height:30px; border:0; padding:0;
  border-radius:10px; cursor:pointer; background:transparent;
  display:flex; align-items:center; justify-content:center;
}
.zh-rtb-color-btn:hover{ background:rgba(17,24,39,.06); }

.zh-rtb-swatch{
  width:18px; height:18px; border-radius:999px;
  background:#111827;
  box-shadow: 0 0 0 1px rgba(17,24,39,.18) inset, 0 1px 2px rgba(0,0,0,.10);
}

.zh-rtb-hex{
  width:84px; height:28px;
  border:0; outline:0; background:transparent;
  font:inherit; color:#111827;
  padding:0 6px; border-radius:8px;
}
.zh-rtb-hex:focus{
  background:rgba(255,255,255,.9);
  box-shadow:0 0 0 2px rgba(59,130,246,.18);
}

.zh-rtb-color-more{
  height:28px; width:30px;
  border:0; border-radius:10px;
  cursor:pointer; background:transparent;
  color:#111827; opacity:.75;
}
.zh-rtb-color-more:hover{ background:rgba(17,24,39,.06); opacity:1; }

/* input natif caché mais cliquable via .click() */
.zh-rtb-native-color{
  position:absolute;
  width:1px; height:1px;
  opacity:0;
  pointer-events:none;
}

/* ===== Modern color picker UI ===== */
.zh-rtb-color{
  display:flex;
  align-items:center;
  gap:8px;
  height:32px;
  padding:0 8px;
  background:rgba(17,24,39,.04);
  border-radius:10px;
}

/* ✅ Color button carré (toolbar) */
.zh-rtb-color-btn{
  width:32px !important;
  height:32px !important;
  border-radius:8px !important;   /* carré arrondi, pas rond */
  padding:0 !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
}

/* ✅ pastille de couleur carrée */
.zh-rtb-swatch{
  width:18px !important;
  height:18px !important;
  border-radius:4px !important;   /* carré arrondi léger */
}


.zh-rtb-hex{
  height:28px;
  width:92px;
  border:0;
  outline:none;
  border-radius:10px;
  padding:0 10px;
  font:inherit;
  color:#111827;
  background:#fff;
  box-shadow:0 0 0 1px rgba(17,24,39,.12) inset;
  letter-spacing:.2px;
}
.zh-rtb-hex:focus{
  box-shadow:0 0 0 2px rgba(59,130,246,.18);
}

.zh-rtb-color-more{
  width:28px;
  height:28px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  background:#fff;
  box-shadow:0 0 0 1px rgba(17,24,39,.12) inset;
}
.zh-rtb-color-more:hover{ background:rgba(17,24,39,.06); }

/* input natif caché (mais cliquable via .click()) */
.zh-rtb-native-color{
  position:absolute;
  width:1px;
  height:1px;
  padding:0;
  margin:-1px;
  border:0;
  overflow:hidden;
  clip:rect(0 0 0 0);
  white-space:nowrap;
}

.zh-rtb-pop-color{ width:320px; }

.zh-rtb-color-head{
  display:flex; align-items:center; gap:10px;
  margin-bottom:10px;
}

.zh-rtb-color-pill{
  width:34px; height:34px;
  border:0; cursor:pointer;
  border-radius:10px;
  background:rgba(17,24,39,.04);
  display:flex; align-items:center; justify-content:center;
}
.zh-rtb-swatch{
  width:18px; height:18px; border-radius:6px;
  box-shadow:0 0 0 1px rgba(17,24,39,.18) inset;
}

.zh-rtb-hex-wrap{
  flex:1;
  height:34px;
  display:flex; align-items:center; gap:6px;
  padding:0 10px;
  border-radius:10px;
  background:rgba(17,24,39,.04);
}
.zh-rtb-hex-prefix{ opacity:.6; font-size:12px; }
.zh-rtb-hex{
  border:0; outline:0; background:transparent;
  font:inherit; width:100%;
  text-transform:uppercase;
}

.zh-rtb-color-more{
  height:34px; padding:0 10px;
  border:0; border-radius:10px;
  cursor:pointer;
  background:rgba(17,24,39,.04);
}
.zh-rtb-color-more:hover{ background:rgba(17,24,39,.07); }

.zh-rtb-native-color{
  position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;
}

.zh-rtb-picker{ display:grid; grid-template-columns: 1fr; gap:10px; margin-bottom:10px; }

.zh-rtb-sv{
  position:relative;
  height:170px;
  border-radius:12px;
  overflow:hidden;
  box-shadow:0 0 0 1px rgba(17,24,39,.12) inset;
  touch-action:none;
  background:red; /* JS le remplace */
}
.zh-rtb-sv::before{
  content:""; position:absolute; inset:0;
  background: linear-gradient(to right, #fff, rgba(255,255,255,0));
}
.zh-rtb-sv::after{
  content:""; position:absolute; inset:0;
  background: linear-gradient(to top, #000, rgba(0,0,0,0));
}
.zh-rtb-sv-cursor{
  position:absolute;
  width:14px; height:14px;
  border-radius:999px;
  box-shadow:0 0 0 2px #fff, 0 0 0 3px rgba(17,24,39,.25);
  transform: translate(-7px,-7px);
}

.zh-rtb-sliders{ display:flex; flex-direction:column; gap:10px; }
.zh-rtb-slider-label{ font-size:12px; opacity:.7; margin-bottom:4px; }

.zh-rtb-section{ margin-top:10px; }
.zh-rtb-section-title{
  font-size:12px; color:rgba(17,24,39,.72);
  margin:4px 2px 8px;
}

.zh-rtb-grid-std, .zh-rtb-grid-recent{
  grid-template-columns: repeat(8, 1fr);
}
.zh-rtb-font{
  display:flex; align-items:center;
  height:32px; padding:0 8px;
  background:rgba(17,24,39,.04);
  border-radius:10px;
}
.zh-rtb-font-btn{
  height:28px;
  min-width:170px;
  padding:0 10px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  background:transparent;
  color:#111827;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  font:inherit;
}
.zh-rtb-font-btn:hover{ background:rgba(17,24,39,.06); }
.zh-rtb-pop-font{ width:320px; }

.zh-rtb-font-search{
  padding:6px;
  background:rgba(17,24,39,.04);
  border-radius:12px;
  margin-bottom:8px;
}
.zh-rtb-font-search input{
  width:100%;
  height:34px;
  border:1px solid rgba(17,24,39,.12);
  border-radius:10px;
  padding:0 10px;
  font:inherit;
  outline:none;
  background:#fff;
}
.zh-rtb-font-search input:focus{
  box-shadow:0 0 0 2px rgba(59,130,246,.18);
  border-color: rgba(59,130,246,.35);
}

.zh-rtb-font-title{
  font-size:12px;
  opacity:.75;
  margin:10px 4px 6px;
  display:flex; justify-content:space-between; align-items:center;
}
.zh-rtb-font-title .tag{
  font-size:11px;
  padding:2px 8px;
  border-radius:999px;
  background:rgba(17,24,39,.06);
}

.zh-rtb-font-list{
  display:flex;
  flex-direction:column;
  gap:6px;
  max-height:260px;
  overflow:auto;
  padding-right:2px;
}
.zh-rtb-font-item{
  border:0;
  border-radius:12px;
  cursor:pointer;
  background:#fff;
  box-shadow:0 0 0 1px rgba(17,24,39,.10) inset;
  padding:10px 12px;
  text-align:left;
}
.zh-rtb-font-item:hover{ background:rgba(17,24,39,.04); }
.zh-rtb-font-item .name{
  display:flex;
  justify-content:space-between;
  font-weight:700;
  margin-bottom:4px;
}
.zh-rtb-font-item .scope{
  font-size:12px;
  opacity:.6;
}
.zh-rtb-font-item .preview{
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

// -------- Toolbar DOM
function makeToolbar(fonts) {
  injectStylesOnce();

  const fontOptions = (fonts || [])
    .map((f) => {
      const name = typeof f === "string" ? f : f.name;
      const label = typeof f === "string" ? f : f.label || f.name;
      return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const el = document.createElement("div");
  el.className = "zh-rtb";
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.display = "none";

  el.innerHTML = `
    <div class="zh-rtb-inner" role="toolbar" aria-label="Texte">
      <div class="zh-rtb-font" title="Police">
	  <button type="button" class="zh-rtb-font-btn" data-action="openFont" aria-label="Police">
		<span class="val" data-role="fontVal">Helvetica (défaut)</span>
		<span class="caret">▾</span>
	  </button>
	</div>


      <!-- ✅ Taille police : menu déroulant + autre taille -->
      <div class="zh-rtb-size" title="Taille">
        <button type="button" class="zh-rtb-size-btn" data-action="openSize" aria-label="Taille">
          <span class="val" data-role="sizeVal">14</span>
          <span class="caret">▾</span>
        </button>
      </div>

      <div class="zh-rtb-num" title="Interligne">
        <input type="number" min="0.8" max="4" step="0.05" value="1.3" data-action="lineHeightInput" />
      </div>

    <div class="zh-rtb-color" title="Couleur">
	  <button type="button" class="zh-rtb-color-btn" data-action="openColor" aria-label="Choisir une couleur">
		<span class="zh-rtb-swatch" data-role="swatch"></span>
	  </button>

	  <!-- input natif caché (sert au picker OS via .click()) -->
	  <input type="color" data-action="color" value="#111827" class="zh-rtb-native-color" />
	</div>



      <div class="zh-rtb-sep"></div>
	  
	  <div class="zh-rtb-align" title="Alignement">
	  <button class="zh-rtb-btn" type="button" data-action="align" data-align="left" title="Aligner à gauche" aria-label="Aligner à gauche">
		  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path d="M4 6h14M4 10h10M4 14h14M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		  </svg>
		</button>

		<button class="zh-rtb-btn" type="button" data-action="align" data-align="center" title="Centrer" aria-label="Centrer">
		  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path d="M4 6h16M7 10h10M4 14h16M7 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		  </svg>
		</button>

		<button class="zh-rtb-btn" type="button" data-action="align" data-align="right" title="Aligner à droite" aria-label="Aligner à droite">
		  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path d="M6 6h14M10 10h10M6 14h14M10 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		  </svg>
		</button>

	</div>

      <button class="zh-rtb-btn" type="button" data-cmd="bold" title="Gras"><b>B</b></button>
      <button class="zh-rtb-btn" type="button" data-cmd="italic" title="Italique"><i>I</i></button>
      <button class="zh-rtb-btn" type="button" data-cmd="underline" title="Souligné"><u>U</u></button>
    </div>

    <div class="zh-rtb-pop" data-pop="size" hidden>
      <div class="zh-rtb-size-menu" data-role="sizeMenu"></div>
      <div class="zh-rtb-size-other" data-role="sizeOther" hidden>
        <input type="number" min="6" max="200" step="1" value="14" data-action="sizeOtherInput" />
        <button type="button" data-action="sizeOtherApply">OK</button>
      </div>
    </div>
	<div class="zh-rtb-pop zh-rtb-pop-font" data-pop="font" hidden>
	  <div class="zh-rtb-font-search">
		<input type="text" data-action="fontSearch" placeholder="Rechercher une police…" />
	  </div>

	  <div class="zh-rtb-font-section" data-role="fontSectionDefault"></div>
	  <div class="zh-rtb-font-section" data-role="fontSectionLabo"></div>
	  <div class="zh-rtb-font-section" data-role="fontSectionGlobal"></div>
	</div>


			<div class="zh-rtb-pop zh-rtb-pop-color" data-pop="color" hidden>
				  <div class="zh-rtb-color-head">
					<button type="button" class="zh-rtb-color-pill" data-action="openColorNative" aria-label="Sélecteur système">
					  <span class="zh-rtb-swatch" data-role="swatch"></span>
					</button>

					<div class="zh-rtb-hex-wrap" title="HEX">
					  <span class="zh-rtb-hex-prefix">#</span>
					  <input class="zh-rtb-hex" type="text" inputmode="text" spellcheck="false"
							 value="111827" data-action="hex" aria-label="Couleur HEX" />
					</div>

					<button type="button" class="zh-rtb-color-more" data-action="openColorNative" aria-label="Ouvrir le picker OS">🎨</button>

					<!-- input natif caché (sert juste à ouvrir le picker OS) -->
					<input type="color" data-action="color" value="#111827" class="zh-rtb-native-color" />
				  </div>

				  <div class="zh-rtb-picker">
					<div class="zh-rtb-sv" data-role="sv">
					  <div class="zh-rtb-sv-cursor" data-role="svCursor"></div>
					</div>

					<div class="zh-rtb-sliders">
					  <div class="zh-rtb-slider">
						<div class="zh-rtb-slider-label">Teinte</div>
						<input type="range" min="0" max="360" value="210" data-action="hue" />
					  </div>
					</div>
				  </div>

				  <div class="zh-rtb-section">
					<div class="zh-rtb-section-title">Couleurs du thème</div>
					<div class="zh-rtb-grid" data-role="swatches"></div>
				  </div>

				  <div class="zh-rtb-section">
					<div class="zh-rtb-section-title">Couleurs standard</div>
					<div class="zh-rtb-grid zh-rtb-grid-std" data-role="stdSwatches"></div>
				  </div>

				  <div class="zh-rtb-section">
					<div class="zh-rtb-section-title">Récemment utilisé</div>
					<div class="zh-rtb-grid zh-rtb-grid-recent" data-role="recentSwatches"></div>
				  </div>
				</div>

  `;

  // ✅ ne pas casser les inputs/select natifs
  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target && e.target.closest && e.target.closest(".zh-rtb-pop")) return;

      const isTextField = !!(e.target && e.target.closest && e.target.closest("input, select, textarea"));
      if (isTextField) return;

      const inToolbarBar = !!(e.target && e.target.closest && e.target.closest(".zh-rtb-inner"));
      if (!inToolbarBar) return;

      const isBtn =
        !!(e.target.closest && e.target.closest(".zh-rtb-btn")) ||
        !!(e.target.closest && e.target.closest('button[data-action]'));

      if (isBtn) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  return el;
}



function togglePop(toolbarEl, name, anchorEl) {
  const pop = toolbarEl.querySelector(`.zh-rtb-pop[data-pop="${name}"]`);
  if (!pop) return;

  if (!pop.hidden) {
    pop.hidden = true;
    return;
  }

  const r = anchorEl.getBoundingClientRect();
  pop.hidden = false;

	const maxW = name === "size" ? 280 : (name === "font" ? 360 : 340);
	const maxH = name === "font" ? 420 : 260;
	pop.style.left = `${clamp(r.left, 8, window.innerWidth - maxW)}px`;
	pop.style.top  = `${clamp(r.bottom + 8, 8, window.innerHeight - maxH)}px`;
}

/* ============================================================
 * ParagraphEditor
 * ========================================================== */
class ParagraphEditorClass {
  constructor() {
    this.toolbar = null;
    this.active = null;
    this._savedRange = null;
	this._tempSelSpan = null;
this._tempSelApplied = false;


    // ✅ style appliqué au prochain typing si caret
    this._pending = { fontFamily: null, fontSizePx: null, color: null };

    this._reposition = rafThrottle(this._reposition.bind(this));
    this._onOutsideClick = this._onOutsideClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onSelectionChange = this._onSelectionChange.bind(this);
    this._onContentKeyDown = this._onContentKeyDown.bind(this);

    this._setSwatch = null;
    this._closePops = null;
  }

  configure(cfg = {}) {
    Object.assign(CFG, cfg || {});
    injectFontLinksOnce(CFG.injectFontCss || []);
    if (this.toolbar) {
      try { this.toolbar.remove(); } catch {}
      this.toolbar = null;
    }
  }

ensureToolbar() {
  if (this.toolbar) return;

  this.toolbar = makeToolbar(CFG.fonts || []);
  document.body.appendChild(this.toolbar);

  // ✅ Très important : sauver la sélection AVANT que le focus parte vers la toolbar
  this.toolbar.addEventListener(
    "pointerdown",
    (e) => {
      if (!this.active) return;
      const ctrl = e.target.closest("input, select, button");
      if (!ctrl) return;
      this._saveSelectionIfInside();
    },
    true
  );






  // ------------------------------------------------------------
  // Elements
  // ------------------------------------------------------------
	const swatches = Array.from(this.toolbar.querySelectorAll('[data-role="swatch"]'));
	const nativeColors = Array.from(this.toolbar.querySelectorAll('input[data-action="color"]'));
	const nativeColor = nativeColors[0] || null; // "master" (toolbar bar)


  const popColor = this.toolbar.querySelector('.zh-rtb-pop[data-pop="color"]');
  const swatchesWrap = this.toolbar.querySelector('[data-role="swatches"]');

  // ⚠️ on prend le HEX du popover (pas celui du bandeau)
  const hexInput = popColor ? popColor.querySelector('input[data-action="hex"]') : null;

  const stdWrap = this.toolbar.querySelector('[data-role="stdSwatches"]');
  const recentWrap = this.toolbar.querySelector('[data-role="recentSwatches"]');

  const sv = this.toolbar.querySelector('[data-role="sv"]');
  const svCursor = this.toolbar.querySelector('[data-role="svCursor"]');
  const hueRange = this.toolbar.querySelector('input[data-action="hue"]');

  const popSize = this.toolbar.querySelector('.zh-rtb-pop[data-pop="size"]');
  const popFont = this.toolbar.querySelector('.zh-rtb-pop[data-pop="font"]');
const fontBtnVal = this.toolbar.querySelector('[data-role="fontVal"]');
const fontSearch = popFont ? popFont.querySelector('input[data-action="fontSearch"]') : null;

const secDefault = this.toolbar.querySelector('[data-role="fontSectionDefault"]');
const secLabo = this.toolbar.querySelector('[data-role="fontSectionLabo"]');
const secGlobal = this.toolbar.querySelector('[data-role="fontSectionGlobal"]');

  const sizeMenu = this.toolbar.querySelector('[data-role="sizeMenu"]');
  const sizeOtherBox = this.toolbar.querySelector('[data-role="sizeOther"]');
  const sizeOtherInput = this.toolbar.querySelector('input[data-action="sizeOtherInput"]');
  const sizeVal = this.toolbar.querySelector('[data-role="sizeVal"]');
  
const normalizeFonts = (arr) => (Array.isArray(arr) ? arr : []).map((f) => {
  if (typeof f === "string") {
    return { name: f, label: f, scope: "global", isDefault: false };
  }

  const name = getFontKey(f);
  const label = getFontLabel(f);

  return {
    name,
    label: label || name,
    scope: (f.scope || f.origin || "global").toLowerCase(), // "labo" / "global" / "default"
    isDefault: !!f.isDefault,

    // charge font (optionnel)
    href: f.href || f.css || null,
    url: f.url || null,
    format: f.format || null,
    weight: f.weight || null,
    style: f.style || null,
  };
}).filter(x => x.name); // ✅ évite les entrées vides



const allFonts = normalizeFonts(CFG.fonts || []);

const fontCss = [];
allFonts.forEach((f) => {
  if (f.cssUrl) fontCss.push(f.cssUrl);
  if (Array.isArray(f.cssUrls)) fontCss.push(...f.cssUrls);
});
injectFontLinksOnce(fontCss);


const previewText = "BBH... 0123 AaBb"; // ou ce que tu veux

const renderFontSection = (host, title, tag, fonts, q) => {
  if (!host) return;
  const query = String(q || "").trim().toLowerCase();

  const filtered = fonts.filter((f) => {
    if (!query) return true;
    return (f.label || "").toLowerCase().includes(query) || (f.name || "").toLowerCase().includes(query);
  });

  if (!filtered.length) {
    host.innerHTML = "";
    return;
  }

  host.innerHTML = `
    <div class="zh-rtb-font-title">
      <span>${escapeHtml(title)}</span>
      ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ``}
    </div>
    <div class="zh-rtb-font-list">
	   ${filtered.map((f) => `
	  ${ensureFontLoaded(f), ""} 
	  <button type="button" class="zh-rtb-font-item" data-font="${escapeHtml(f.name)}" data-label="${escapeHtml(f.label)}">
		<div class="name">
		  <span>${escapeHtml(f.label)}</span>
		  <span class="scope">${escapeHtml(f.scope)}</span>
		</div>
		<div class="preview" style="font-family:${escapeHtml(resolveFontFamily(f.name))};">


		  ${escapeHtml(previewText)}
		</div>
	  </button>
	`).join("")}

    </div>
  `;
};

const renderFonts = (q) => {
  const def = allFonts.filter((f) => f.isDefault || f.scope === "default");
  const labo = allFonts.filter((f) => f.scope === "labo" && !f.isDefault);
  const glob = allFonts.filter((f) => f.scope === "global" && !f.isDefault);

  renderFontSection(secDefault, "Police", "", def.length ? def : allFonts.slice(0,1), q);
  renderFontSection(secLabo, "Polices", "Labo", labo, q);
  renderFontSection(secGlobal, "Polices", "Global", glob, q);
};  
  
  

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const closePops = () => {
    if (popColor) popColor.hidden = true;
    if (popSize) popSize.hidden = true;
    if (sizeOtherBox) sizeOtherBox.hidden = true;
	if (popFont) popFont.hidden = true;
	if (fontSearch) fontSearch.value = "";

    // ✅ si on avait gelé une sélection mais qu'on n'a pas appliqué => on annule
    if (this._tempSelSpan) this._unfreezeSelectionVisual({ applyStyle: false });
  };

	const setSwatch = (c) => {
	  swatches.forEach((el) => { el.style.background = c; });
	};


  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  const hexNoHash = (hex) => String(hex || "").replace("#", "").toUpperCase();

  const normHex = (v) => {
    const s = String(v || "").trim();
    if (!s) return null;
    const x = s.startsWith("#") ? s : `#${s}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(x)) return null;
    return x.toLowerCase();
  };

  const rgbToHex = (r, g, b) => {
    const to = (x) => x.toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`.toLowerCase();
  };

  const hsvToRgb = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60) { rp = c; gp = x; bp = 0; }
    else if (h < 120) { rp = x; gp = c; bp = 0; }
    else if (h < 180) { rp = 0; gp = c; bp = x; }
    else if (h < 240) { rp = 0; gp = x; bp = c; }
    else if (h < 300) { rp = x; gp = 0; bp = c; }
    else { rp = c; gp = 0; bp = x; }
    return {
      r: Math.round((rp + m) * 255),
      g: Math.round((gp + m) * 255),
      b: Math.round((bp + m) * 255),
    };
  };

  const RECENT_KEY = "zh_rtb_recent_colors";
  const loadRecent = () => {
    try {
      const a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(a) ? a.filter(Boolean) : [];
    } catch {
      return [];
    }
  };
  const saveRecent = (arr) => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, 16))); } catch {}
  };

  let picker = { h: 210, s: 0.7, v: 0.5 };

  const renderSVBg = () => {
    if (!sv) return;
    const { r, g, b } = hsvToRgb(picker.h, 1, 1);
    sv.style.background = `rgb(${r},${g},${b})`;
  };

  const renderCursor = () => {
    if (!sv || !svCursor) return;
    const r = sv.getBoundingClientRect();
    svCursor.style.left = `${picker.s * r.width}px`;
    svCursor.style.top = `${(1 - picker.v) * r.height}px`;
  };

  const renderRecent = () => {
    if (!recentWrap) return;
    const items = loadRecent();
    recentWrap.innerHTML =
      items
        .map((c) => {
          const cc = escapeHtml(c);
          return `<button class="zh-rtb-chip" type="button" data-color="${cc}" style="background:${cc}"></button>`;
        })
        .join("") || `<div style="opacity:.55;font-size:12px;padding:4px 2px;">—</div>`;
  };

  const pushRecent = (hex) => {
    const h = String(hex || "").toLowerCase();
    const cur = loadRecent().map((x) => String(x).toLowerCase());
    const next = [h, ...cur.filter((x) => x !== h)];
    saveRecent(next);
    renderRecent();
  };

  const applyColorFromPicker = () => {
    const { r, g, b } = hsvToRgb(picker.h, picker.s, picker.v);
    const hex = rgbToHex(r, g, b);

    this._applyColor(hex);
    setSwatch(hex);

    if (nativeColor) nativeColor.value = hex;
    if (hexInput) hexInput.value = hexNoHash(hex);

    pushRecent(hex);
    this.syncFromDom(false);
  };

  // ------------------------------------------------------------
  // Size menu wiring (inchangé)
  // ------------------------------------------------------------
  const setSizeUi = (v) => {
    const n = clamp(Number(v || 14), 6, 200);
    if (sizeVal) sizeVal.textContent = String(n);
    if (sizeOtherInput) sizeOtherInput.value = String(n);
  };

  const applySize = (v) => {
    const n = clamp(Number(v || 14), 6, 200);
    setSizeUi(n);

    if (this._tempSelSpan) {
      if (typeof clearDescendantInlineFontSize === "function") {
        clearDescendantInlineFontSize(this._tempSelSpan);
      }
      this._tempSelSpan.style.fontSize = `${n}px`;
      this._unfreezeSelectionVisual({ applyStyle: true });
      this.syncFromDom(false);
      return;
    }

    this._restoreSelectionAndFocus();
    this._applyFontSize(n);
  };

  // ------------------------------------------------------------
  // Swatches init
  // ------------------------------------------------------------
  if (swatchesWrap) {
    swatchesWrap.innerHTML = (CFG.swatches || [])
      .map((c) => {
        const cc = escapeHtml(c);
        return `<button class="zh-rtb-chip" type="button" data-color="${cc}" style="background:${cc}"></button>`;
      })
      .join("");
  }

  if (stdWrap) {
    const std = ["#000000", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7"];
    stdWrap.innerHTML = std
      .map((c) => {
        const cc = escapeHtml(c);
        return `<button class="zh-rtb-chip" type="button" data-color="${cc}" style="background:${cc}"></button>`;
      })
      .join("");
  }

  renderSVBg();
  renderCursor();
  renderRecent();

  if (nativeColor && hexInput) {
    hexInput.value = hexNoHash(nativeColor.value || "#111827");
    setSwatch((nativeColor.value || "#111827").toLowerCase());
  }

  // ------------------------------------------------------------
  // Size presets init
  // ------------------------------------------------------------
  const presets =
    Array.isArray(CFG.sizePresets) && CFG.sizePresets.length
      ? CFG.sizePresets
      : [9, 10, 12, 14, 18, 25, 30];

  if (sizeMenu) {
    sizeMenu.innerHTML = `
      ${presets
        .map(
          (n) => `
        <button class="zh-rtb-size-item" type="button" data-size="${n}">
          <span>${n}px</span><span style="opacity:.55"> </span>
        </button>
      `
        )
        .join("")}
      <button class="zh-rtb-size-item is-other" type="button" data-action="sizeOther">
        Autre taille…
      </button>
    `;
  }

  // ------------------------------------------------------------
  // Clicks
  // ------------------------------------------------------------
  this.toolbar.addEventListener("click", (e) => {
    if (!this.active) return;

    // B/I/U
    const biu = e.target.closest(".zh-rtb-btn[data-cmd]");
    if (biu) {
      const cmd = biu.dataset.cmd;
      this._restoreSelectionAndFocus();
      try { document.execCommand(cmd); } catch {}
      this._saveSelectionIfInside();
      this.syncFromDom(false);
      return;
    }
	
	
	const openFontBtn = e.target.closest('[data-action="openFont"]');
	if (openFontBtn) {
	  if (popColor) popColor.hidden = true;
	  if (popSize) popSize.hidden = true;
	  if (sizeOtherBox) sizeOtherBox.hidden = true;
	  
	        this._restoreSelectionAndFocus();
		this._saveSelectionIfInside();


	  // ✅ IMPORTANT
	  this._freezeSelectionVisual();


	  renderFonts(fontSearch ? fontSearch.value : "");
	  
	  try {
		  if (document.fonts && document.fonts.load) {
			// charge quelques fonts visibles si tu veux (ou toutes)
			const list = (CFG.fonts || []).slice(0, 12);
			list.forEach(f => {
			  const n = typeof f === "string" ? f : f.name;
			  document.fonts.load(`18px ${fontFamilyCss(n)}`);
			});
		  }
		} catch {}

	  
	  togglePop(this.toolbar, "font", openFontBtn);

	  requestAnimationFrame(() => {
		if (fontSearch) fontSearch.focus({ preventScroll: true });
	  });
	  return;
	}

	const fontItem = e.target.closest(".zh-rtb-font-item[data-font]");
	if (fontItem) {
	  const fontKey = (fontItem.dataset.font || "").trim();
	  const label = fontItem.dataset.label || fontKey;

	  const cssFamily = resolveFontFamily(fontKey);

	  // ✅ si sélection gelée: on applique DIRECTEMENT sur le span gelé
	  if (this._tempSelSpan) {
		this._tempSelSpan.style.fontFamily = cssFamily;
		this._unfreezeSelectionVisual({ applyStyle: true });
		if (fontBtnVal) fontBtnVal.textContent = label;
		if (popFont) popFont.hidden = true;
		this.syncFromDom(false);
		return;
	  }

	  // ✅ sinon, on restaure la sélection normale et on applique
	  this._restoreSelectionAndFocus();
	  this._applyFontFamily(cssFamily);

	  if (fontBtnVal) fontBtnVal.textContent = label;
	  if (popFont) popFont.hidden = true;

	  this.syncFromDom(false);
	  return;
	}




	

    // open size menu
    const openSizeBtn = e.target.closest('[data-action="openSize"]');
    if (openSizeBtn) {
      if (popColor) popColor.hidden = true;
      togglePop(this.toolbar, "size", openSizeBtn);
      if (sizeOtherBox) sizeOtherBox.hidden = true;
      if (this._tempSelSpan) this._unfreezeSelectionVisual({ applyStyle: false });
      return;
    }

    // click preset size
    const sizeItem = e.target.closest(".zh-rtb-size-item[data-size]");
    if (sizeItem) {
      applySize(sizeItem.dataset.size || 14);
      if (popSize) popSize.hidden = true;
      if (sizeOtherBox) sizeOtherBox.hidden = true;
      return;
    }

    // autre taille… => affiche input
    const otherBtn = e.target.closest('[data-action="sizeOther"]');
    if (otherBtn) {
      if (sizeOtherBox) sizeOtherBox.hidden = false;
      this._freezeSelectionVisual();
      requestAnimationFrame(() => {
        if (!sizeOtherInput) return;
        sizeOtherInput.focus({ preventScroll: true });
        try { sizeOtherInput.select(); } catch {}
      });
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // apply autre taille (bouton OK)
	const otherApply = e.target.closest('[data-action="sizeOtherApply"]');
	if (otherApply) {
	  this._freezeSelectionVisual(); // ✅ sécurité
	  const raw = sizeOtherInput ? String(sizeOtherInput.value || "").trim() : "";
	  const n = raw === "" ? 14 : Number(raw);
	  applySize(Number.isFinite(n) ? n : 14);
	  if (popSize) popSize.hidden = true;
	  if (sizeOtherBox) sizeOtherBox.hidden = true;
	  e.preventDefault();
	  e.stopPropagation();
	  return;
	}


    // alignement
    const alignBtn = e.target.closest('button[data-action="align"]');
    if (alignBtn) {
      const a = alignBtn.dataset.align || "left";
      this.active.contentEl.style.textAlign = a;
      this.toolbar.querySelectorAll('button[data-action="align"]').forEach((b) => {
        b.classList.toggle("is-active", b.dataset.align === a);
      });
      this.syncFromDom(false);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // ✅ open native color picker (bouton/icone palette)
    const openNative = e.target.closest('button[data-action="openColorNative"]');
    if (openNative) {
      if (nativeColor) nativeColor.click();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // open color popover
	 const openColorBtn = e.target.closest('button[data-action="openColor"]');
	if (openColorBtn) {
	  if (popSize) popSize.hidden = true;
	  if (sizeOtherBox) sizeOtherBox.hidden = true;

	  // ✅ si on a une sélection (non-collapsed), on la "freeze" visuellement
	  this._freezeSelectionVisual();

	  togglePop(this.toolbar, "color", openColorBtn);
	  return;
	}


    // click swatch (theme/std/recent)
	// click swatch (theme/std/recent)
const chip = e.target.closest(".zh-rtb-chip");
if (chip) {
  const c = (chip.dataset.color || "#111827").toLowerCase();

  if (this._tempSelSpan) {
    this._tempSelSpan.style.color = c;
    this._unfreezeSelectionVisual({ applyStyle: true });
    this.syncFromDom(false);
  } else {
    this._applyColor(c);
  }

  setSwatch(c);
  nativeColors.forEach((inp) => { inp.value = c; });
  if (hexInput) hexInput.value = hexNoHash(c);
  pushRecent(c);
  if (popColor) popColor.hidden = true;
  return;
}
});


  // ------------------------------------------------------------
  // Change
  // ------------------------------------------------------------
  this.toolbar.addEventListener("change", (e) => {
    if (!this.active) return;
    const t = e.target;

  

    if (t.matches('input[data-action="lineHeightInput"]')) {
      const v = clamp(Number(t.value || 1.3), 0.8, 4);
      t.value = String(v);
      setBlockLineHeight(this.active.contentEl, v);
      this.syncFromDom(false);
      return;
    }
  });

// input autre taille: Enter applique + ✅ live apply (+/- / saisie)
if (sizeOtherInput) {
  // ✅ live apply quand on tape ou quand on clique sur +/-
  const applyLive = rafThrottle((val) => {
    if (!this.active) return;

    // garde la sélection visible même si l'input a le focus
    this._freezeSelectionVisual();

    const raw = String(val ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) return;

    applySize(n);
  });

  sizeOtherInput.addEventListener(
    "input",
    () => {
      applyLive(sizeOtherInput.value);
    },
    true
  );

  sizeOtherInput.addEventListener(
    "keydown",
    (e) => {
      if (!this.active) return;

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        applySize(sizeOtherInput.value || 14);
        if (popSize) popSize.hidden = true;
        if (sizeOtherBox) sizeOtherBox.hidden = true;
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // ✅ annule la sélection gelée si on quitte vraiment le mode
        if (this._tempSelSpan) this._unfreezeSelectionVisual({ applyStyle: false });
        return;
      }
    },
    true
  );

  sizeOtherInput.addEventListener(
    "blur",
    () => {
      // ✅ Laisse passer le click sur OK / autre élément toolbar
      setTimeout(() => {
        if (!this.active) return;

        const ae = document.activeElement;
        // si le focus reste dans la toolbar (OK, recherche, etc.) => ne pas annuler la sélection gelée
        if (ae && this.toolbar && this.toolbar.contains(ae)) return;

        if (this._tempSelSpan) this._unfreezeSelectionVisual({ applyStyle: false });
      }, 0);
    },
    true
  );
}


  // ------------------------------------------------------------
  // Native color picker -> sync everywhere
  // ------------------------------------------------------------
nativeColors.forEach((inp) => {
  inp.addEventListener(
    "input",
    () => {
      if (!this.active) return;
      const c = (inp.value || "#111827").toLowerCase();
      this._applyColor(c);
      setSwatch(c);
      if (hexInput) hexInput.value = hexNoHash(c);
      pushRecent(c);
    },
    true
  );
});


  // ------------------------------------------------------------
  // HEX typing (popover) -> sync picker + native + recent
  // ------------------------------------------------------------
  
  if (fontSearch) {
	  fontSearch.addEventListener("input", () => {
		renderFonts(fontSearch.value);
	  }, true);

	  fontSearch.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
		  e.preventDefault();
		  if (popFont) popFont.hidden = true;
		}
	  }, true);
	}

  
  if (hexInput) {
    hexInput.addEventListener(
      "input",
      (e) => {
        if (!this.active) return;
        const c = normHex(hexInput.value);
        if (!c) return;

        nativeColors.forEach((inp) => { inp.value = c; });

        // tenter de sync le picker SV/H si possible (approx)
        // on garde le hue actuel, mais on met s/v depuis la couleur courante
        // (pas parfait, mais suffisant pour que SV reflète la teinte)
        // => au pire, le prochain drag sur SV remettra tout cohérent.
        setSwatch(c);
        this._applyColor(c);
        pushRecent(c);

        e.stopPropagation();
      },
      true
    );

    hexInput.addEventListener(
      "keydown",
      (e) => {
        if (!this.active) return;
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
  }

  // ------------------------------------------------------------
  // Hue slider
  // ------------------------------------------------------------
  if (hueRange) {
    hueRange.addEventListener(
      "input",
      () => {
        picker.h = clamp(Number(hueRange.value || 0), 0, 360);
        renderSVBg();
        applyColorFromPicker();
      },
      true
    );
  }

   // ------------------------------------------------------------
  // SV square
  // ------------------------------------------------------------
  // ------------------------------------------------------------
// SV square
// ------------------------------------------------------------
if (sv) {
  let svDragging = false;

  const pickSV = (clientX, clientY) => {
    const r = sv.getBoundingClientRect();
    picker.s = clamp01((clientX - r.left) / r.width);
    picker.v = clamp01(1 - (clientY - r.top) / r.height);
    renderCursor();
    applyColorFromPicker();
  };

  sv.addEventListener(
    "pointerdown",
    (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();

      svDragging = true;

      // compat: pas de optional chaining call
      if (sv.setPointerCapture) {
        try { sv.setPointerCapture(e.pointerId); } catch {}
      }

      pickSV(e.clientX, e.clientY);
    },
    true
  );

  sv.addEventListener(
    "pointermove",
    (e) => {
      if (!this.active) return;
      if (!svDragging) return;
      pickSV(e.clientX, e.clientY);
    },
    true
  );

  const stopDrag = (e) => {
    if (!svDragging) return;
    svDragging = false;

    if (sv.releasePointerCapture) {
      try { sv.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  sv.addEventListener("pointerup", stopDrag, true);
  sv.addEventListener("pointercancel", stopDrag, true);
}

// ✅ close pop on outside (UNE SEULE FOIS)
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!this.toolbar || this.toolbar.style.display === "none") return;
    if (e.target.closest(".zh-rtb")) return;
    closePops();
  },
  true
);

this._setSwatch = setSwatch;
this._closePops = closePops;

}


 
 

  maybeHandlePointerDown(e) {
    const blockEl = (e.target && e.target.closest) ? e.target.closest(".anno-object[data-type='text_paragraph']") : null;
    if (!blockEl) return false;

    const isHandle = e.target.closest(".zh-drag-handle");
    const isResize = e.target.closest(".zh-resize-handle");
    const isRich = e.target.closest('[data-role="richtext"]');

    if (this.active && this.active.el === blockEl && isRich && !isHandle && !isResize) return true;

    if (!isHandle && !isResize) {
      e.preventDefault();
      e.stopPropagation();

      const pageIndex = Number(blockEl.dataset.pageindex || 0);
      const objectId = String(blockEl.dataset.objid || "");
      const obj = typeof CFG.getObject === "function" ? CFG.getObject(pageIndex, objectId) : null;

      this.enter({ pageIndex, objectId, obj, el: blockEl });
      return true;
    }

    return false;
  }

  enter({ pageIndex, objectId, obj, el }) {
    this.ensureToolbar();
    if (this.active) this.exit({ commit: true });

    const contentEl = getContentEl(el);
    if (!contentEl) return;
    const overlayEl = CFG.getOverlayFromEl ? CFG.getOverlayFromEl(el) : getOverlayFallback(el);

    this.active = { pageIndex, objectId: String(objectId), obj: obj || null, el, contentEl, overlayEl };
    this._savedRange = null;
    this._pending = { fontFamily: null, fontSizePx: null, color: null };

    if (CFG.setEditingState) CFG.setEditingState(true, String(objectId));

    contentEl.contentEditable = "true";
    el.classList.add("is-editing");

    this._applyBlockStylesFromObj();

    this.toolbar.style.display = "block";
    this._syncToolbarFromObj();
    this._reposition();

    requestAnimationFrame(() => {
      placeCaret(contentEl, true);
      this._saveSelectionIfInside();
    });

    document.addEventListener("pointerdown", this._onOutsideClick, true);
    document.addEventListener("keydown", this._onKeyDown, true);
    document.addEventListener("selectionchange", this._onSelectionChange, true);

    // ✅ pending style application while typing
    contentEl.addEventListener("keydown", this._onContentKeyDown, true);
  }

  exit({ commit } = { commit: true }) {
    if (!this.active) return;
    if (commit) this.syncFromDom(true);

    const { contentEl, el } = this.active;
    contentEl.contentEditable = "false";
    el.classList.remove("is-editing");

    if (this.toolbar) this.toolbar.style.display = "none";
    if (this._closePops) this._closePops();

    if (CFG.setEditingState) CFG.setEditingState(false, null);

    document.removeEventListener("pointerdown", this._onOutsideClick, true);
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("selectionchange", this._onSelectionChange, true);

    contentEl.removeEventListener("keydown", this._onContentKeyDown, true);

    this._savedRange = null;
    this.active = null;
  }

  syncFromDom(_commit) {
    if (!this.active) return;

    let obj = this.active.obj;
    if (!obj && typeof CFG.getObject === "function") {
      obj = CFG.getObject(this.active.pageIndex, this.active.objectId);
      this.active.obj = obj || null;
    }
    if (!obj) return;

    const raw = this.active.contentEl.innerHTML || "";
    const clean = (typeof CFG.sanitize === "function" ? CFG.sanitize(raw) : raw) || "";

    obj.html = clean;
    obj.text = (this.active.contentEl.textContent || "").trim();

    obj.style = obj.style || {};
    const lh = this.active.contentEl.style.lineHeight;
    if (lh) obj.style.lineHeight = lh;
	
	
	const ta = this.active.contentEl.style.textAlign;
	if (ta) {
	  obj.style.textAlign = ta;
	} else if (obj.style && obj.style.textAlign) {
	  delete obj.style.textAlign;
	}


    if (typeof CFG.onDirty === "function") CFG.onDirty();
  }

  onMoveOrResize() {
    if (this.active) this._reposition();
  }

  _reposition = rafThrottle(() => {
    if (!this.active || !this.toolbar) return;
    computeToolbarPos(this.toolbar, this.active.el, this.active.overlayEl);
  });

  _onOutsideClick = (e) => {
    if (!this.active) return;
    if (e.target.closest(".zh-rtb")) return;
    if (e.target.closest(".anno-object") === this.active.el) return;
    this.exit({ commit: true });
  };

  _onKeyDown = (e) => {
    if (!this.active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.exit({ commit: true });
    }
  };

  _onSelectionChange = () => {
    this._saveSelectionIfInside();
  };

  _saveSelectionIfInside() {
    if (!this.active) return;
    const r = getLiveRange();
    if (r && isRangeInside(r, this.active.contentEl)) this._savedRange = r.cloneRange();
  }

  _restoreSelectionAndFocus() {
    if (!this.active) return false;

    const live = getLiveRange();
    if (live && isRangeInside(live, this.active.contentEl)) {
      this.active.contentEl.focus();
      return true;
    }

    if (this._savedRange && isRangeInside(this._savedRange, this.active.contentEl)) {
      restoreRange(this._savedRange);
      this.active.contentEl.focus();
      return true;
    }

    return false;
  }
  // ✅ AJOUTE ICI (dans la classe)
_freezeSelectionVisual() {
  if (!this.active) return false;
  if (this._tempSelSpan) return true;

  // ✅ 1) On part du live range si possible
  let r = getLiveRange();
  if (!r || !isRangeInside(r, this.active.contentEl)) {
    // ✅ 2) Sinon on repart de la sélection sauvegardée (celle-ci est LA bonne)
    if (this._savedRange && isRangeInside(this._savedRange, this.active.contentEl)) {
      restoreRange(this._savedRange);
      r = getLiveRange();
    }
  }

  if (!r || !isRangeInside(r, this.active.contentEl)) return false;
  if (r.collapsed) return false;

  const span = document.createElement("span");
  span.className = "zh-rtb-temp-sel";

  const frag = r.extractContents();
  span.appendChild(frag);
  r.insertNode(span);

  this._tempSelSpan = span;
  this._tempSelApplied = false;

  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.addRange(nr);
    this._savedRange = nr.cloneRange();
  }
  return true;
}

_unfreezeSelectionVisual({ applyStyle = false } = {}) {
  if (!this._tempSelSpan) return;

  if (applyStyle) {
    this._tempSelSpan.classList.remove("zh-rtb-temp-sel");
  } else {
    unwrapSpan(this._tempSelSpan);
  }

  this._tempSelSpan = null;
  this._tempSelApplied = false;
}


  // ✅ Apply pending style while typing (when caret)
  _onContentKeyDown(e) {
    if (!this.active) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;

    const p = this._pending;
    if (!p.fontFamily && !p.fontSizePx && !p.color) return;

    e.preventDefault();
    this._restoreSelectionAndFocus();

    const style = {};
    if (p.fontFamily) style.fontFamily = p.fontFamily;
    if (p.fontSizePx) style.fontSize = `${p.fontSizePx}px`;
    if (p.color) style.color = p.color;

    const ok = insertStyledTextAtCaret(this.active.contentEl, e.key, style);
    if (ok) {
      this._saveSelectionIfInside();
      this.syncFromDom(false);
    }
  }

  _applyFontFamily(fontName) {
    if (!this.active) return;
    this._restoreSelectionAndFocus();

    const res = applyInlineStyle(this.active.contentEl, this._savedRange, { fontFamily: fontName });
    if (res.mode === "caret") this._pending.fontFamily = fontName;
    if (res.applied) this.syncFromDom(false);

    this._saveSelectionIfInside();
    this._reposition();
  }

  _applyFontSize(px) {
    if (!this.active) return;
    const v = clamp(Number(px || 14), 6, 200);

    this._restoreSelectionAndFocus();

    const res = applyInlineStyle(this.active.contentEl, this._savedRange, { fontSize: `${v}px` });
    if (res.mode === "caret") this._pending.fontSizePx = v;
    if (res.applied) this.syncFromDom(false);

    this._saveSelectionIfInside();
    this._reposition();
  }

  _applyColor(color) {
    if (!this.active) return;
    const c = String(color || "#111827");

    this._restoreSelectionAndFocus();

    const res = applyInlineStyle(this.active.contentEl, this._savedRange, { color: c });
    if (res.mode === "caret") this._pending.color = c;
    if (res.applied) this.syncFromDom(false);

    this._saveSelectionIfInside();
    if (this._setSwatch) this._setSwatch(c);
  }

	_applyBlockStylesFromObj() {
	  if (!this.active) return;

	  const obj = this.active.obj || {};
	  const st = obj.style || {};

	  // interligne
	  setBlockLineHeight(this.active.contentEl, st.lineHeight || "1.3");

	  // ✅ alignement du texte
	  if (st.textAlign) {
		this.active.contentEl.style.textAlign = st.textAlign;
	  } else {
		this.active.contentEl.style.textAlign = "";
	  }
	}


  _syncToolbarFromObj() {
    if (!this.toolbar || !this.active) return;

    const obj = this.active.obj || {};
    const st = obj.style || {};

    const lhInp = this.toolbar.querySelector('input[data-action="lineHeightInput"]');
    if (lhInp) lhInp.value = String(st.lineHeight || "1.3");

    // taille affichée
    const sizeVal = this.toolbar.querySelector('[data-role="sizeVal"]');
    const otherInput = this.toolbar.querySelector('input[data-action="sizeOtherInput"]');
    const defaultSize = 14;
	
	const fv = this.toolbar.querySelector('[data-role="fontVal"]');
		if (fv) {
		  // si tu stockes une font par défaut ailleurs, mets la vraie valeur
		  fv.textContent = "Helvetica (défaut)";
		}


    if (sizeVal) sizeVal.textContent = String(defaultSize);
    if (otherInput) otherInput.value = String(defaultSize);
	
	  const current = st.textAlign || "left";
	  this.toolbar
		.querySelectorAll('button[data-action="align"]')
		.forEach((b) => {
		  b.classList.toggle("is-active", b.dataset.align === current);
		});
		
  }
}

const ParagraphEditor = new ParagraphEditorClass();
try { window.ParagraphEditor = ParagraphEditor; } catch {}
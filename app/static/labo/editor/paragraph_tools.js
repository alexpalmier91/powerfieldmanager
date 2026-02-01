// app/static/labo/editor/paragraph_tools.js
// ------------------------------------------------------------
// Paragraph Tools — bloc paragraphe (contenteditable multi-lignes)
// ✅ Toolbar unifiée via TextToolbarTools + FontPickerTools + ColorPickerTools
// ✅ Sélection partielle (Range) + save/restore pour popovers
// ✅ Bold/Italic/Underline, Align, Size, Font, Color, Transform
// ✅ Pending style si caret
// ✅ Sanitize HTML (script/style/on* supprimés) + whitelist tags/styles
// ✅ Commit: click outside / ESC (ENTER reste newline)
// ✅ Sauvegarde obj.html + obj.text (texte brut cohérent)
// ✅ NEW (aligné text_simple_tools.js):
//    - attach()/detach() + handlers document pointerdown/keydown/resize/scroll
//    - plus de stopImmediatePropagation ici, et plus de “outside handler” doublonné
// Sans dépendances externes.
// ------------------------------------------------------------
(function (global) {
  "use strict";

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rafThrottle = (fn) => {
    let locked = false;
    return (...args) => {
      if (locked) return;
      locked = true;
      requestAnimationFrame(() => {
        locked = false;
        fn(...args);
      });
    };
  };

  function isInPopover(target) {
    if (!target || !target.closest) return false;
    if (target.closest('[data-zh-popover="1"]')) return true;
    if (target.closest(".zh-font-pop")) return true;
    if (target.closest(".zh-color-pop")) return true;
    if (target.closest(".zh-cp-pop")) return true;
    if (target.closest(".tt-color-pop")) return true;
    if (target.closest(".color-pop")) return true;
    if (target.closest("[data-color-picker-pop]")) return true;
    return false;
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const t = el.tagName ? el.tagName.toLowerCase() : "";
    if (t === "input" || t === "textarea" || t === "select" || t === "option" || t === "button") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }

  function isRangeInside(range, rootEl) {
    if (!range || !rootEl) return false;
    const node = range.commonAncestorContainer;
    return rootEl.contains(node);
  }

  function restoreRange(range) {
    if (!range) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function placeCaretEnd(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function getPlainText(el) {
    return String((el && el.textContent) || "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ------------------------------------------------------------
  // Sanitizer (robuste, sans lib)
  // ------------------------------------------------------------
  const ALLOWED_TAGS = new Set(["DIV", "P", "BR", "SPAN", "B", "STRONG", "I", "EM", "U"]);
  const ALLOWED_CSS = new Set([
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "text-transform",
    "letter-spacing",
    "line-height",
    "text-align",
  ]);

  function sanitizeHtml(inputHtml) {
    const html = String(inputHtml || "");
    if (!html) return "";

    const tpl = document.createElement("template");
    tpl.innerHTML = html;

    const walker = document.createTreeWalker(
      tpl.content,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
      null
    );

    const toRemove = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;

      if (n.nodeType === 8) { // comment
        toRemove.push(n);
        continue;
      }

      const el = n;
      const tag = el.tagName;

      if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "META") {
        toRemove.push(el);
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        const parent = el.parentNode;
        if (parent) {
          const frag = document.createDocumentFragment();
          while (el.firstChild) frag.appendChild(el.firstChild);
          parent.replaceChild(frag, el);
        }
        continue;
      }

      const attrs = Array.from(el.attributes || []);
      for (const a of attrs) {
        const name = a.name.toLowerCase();
        const val = String(a.value || "");

        if (name.startsWith("on")) { el.removeAttribute(a.name); continue; }
        if (name === "src" || name === "href" || name === "xlink:href") { el.removeAttribute(a.name); continue; }
        if (name === "contenteditable") { el.removeAttribute(a.name); continue; }

        if (name === "style") {
          const clean = sanitizeStyle(val);
          if (clean) el.setAttribute("style", clean);
          else el.removeAttribute("style");
          continue;
        }

        if (name === "class" || name === "id") continue;
        el.removeAttribute(a.name);
      }
    }

    toRemove.forEach((n) => { try { n.remove(); } catch (_) {} });
    return tpl.innerHTML;
  }

  function sanitizeStyle(styleText) {
    const s = String(styleText || "").trim();
    if (!s) return "";
    const parts = s.split(";").map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const idx = p.indexOf(":");
      if (idx <= 0) continue;
      const k = p.slice(0, idx).trim().toLowerCase();
      const v = p.slice(idx + 1).trim();
      if (!ALLOWED_CSS.has(k)) continue;
      if (/expression\s*\(/i.test(v)) continue;
      if (/url\s*\(/i.test(v)) continue;
      out.push(`${k}:${v}`);
    }
    return out.join("; ");
  }

  // ------------------------------------------------------------
  // Inline style apply helpers (range vs caret)
  // ------------------------------------------------------------
  function wrapRangeWithSpan(range, styleObj) {
    if (!range || range.collapsed) return false;
    const span = document.createElement("span");
    for (const [k, v] of Object.entries(styleObj || {})) {
      if (v == null || v === "") continue;
      span.style[k] = String(v);
    }
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);

    const sel = window.getSelection();
    sel.removeAllRanges();
    const r2 = document.createRange();
    r2.selectNodeContents(span);
    sel.addRange(r2);
    return true;
  }

  function applyInlineStyle(contentEl, savedRange, styleObj) {
    let r = getSelectionRange();
    if (!r || !isRangeInside(r, contentEl)) {
      if (savedRange && isRangeInside(savedRange, contentEl)) {
        restoreRange(savedRange);
        r = getSelectionRange();
      }
    }
    if (!r || !isRangeInside(r, contentEl)) return { mode: "none", applied: false };
    if (r.collapsed) return { mode: "caret", applied: false };
    return { mode: "range", applied: wrapRangeWithSpan(r, styleObj) };
  }

  function insertStyledCharAtCaret(contentEl, ch, styleObj) {
    const r = getSelectionRange();
    if (!r || !contentEl || !isRangeInside(r, contentEl)) return false;

    const span = document.createElement("span");
    for (const [k, v] of Object.entries(styleObj || {})) {
      if (v == null || v === "") continue;
      span.style[k] = String(v);
    }
    span.textContent = ch;

    r.insertNode(span);

    const sel = window.getSelection();
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.setStartAfter(span);
    nr.collapse(true);
    sel.addRange(nr);
    return true;
  }

  // ------------------------------------------------------------
  // Controller factory
  // ------------------------------------------------------------
  function createParagraphController(cfg) {
    cfg = cfg || {};

    const getObject = cfg.getObject;
    const getFonts  = cfg.getFonts || (() => []);
    const getHostRect = cfg.getHostRect || (() => null);
    const onDirty  = cfg.onDirty || (() => {});
    const setEditingState = cfg.setEditingState || (() => {});
    const getOverlayFromEl = cfg.getOverlayFromEl || null;
    const getToolbarHostEl = cfg.getToolbarHostEl || null;

    // ✅ public object
    const api = {};

    // --- lifecycle like text_simple_tools.js ---
    const state = {
      attached: false,
      onDocPointerDown: null,
      onDocKeyDown: null,
      onWinResize: null,
      onScroll: null,
      onSelChange: null,
    };

    let toolbar = null;

    // active state (selection OU édition)
    let active = null; // {pageIndex, objectId, obj, el, contentEl, overlayEl, isEditing}
    let savedRange = null;

    const pending = {
      fontFamily: null,
      fontSizePx: null,
      color: null,
      transform: null,
    };

    function hideToolbar() {
      try { toolbar && toolbar.hide && toolbar.hide(); } catch (_) {}
    }

function showToolbar() {
  try {
    // Selon ton TextToolbarTools, l’API peut être show() ou open()
    if (toolbar?.show) toolbar.show();
    else if (toolbar?.open) toolbar.open();
    else if (toolbar?.el) toolbar.el.style.display = ""; // fallback soft
  } catch (_) {}
}


    function ensureToolbar() {
  if (toolbar) return;

  // ✅ Aligner exactement sur TextSimple: TextToolbarTools.createTextToolbar(...)
  const TT = global.TextToolbarTools;
  if (!TT || typeof TT.createTextToolbar !== "function") {
    console.warn("[Paragraph] TextToolbarTools manquant: charge text_toolbar_tools.js avant paragraph_tools.js");
    return;
  }

  const hostEl =
    (typeof getToolbarHostEl === "function" && getToolbarHostEl()) ||
    document.getElementById("canvasWrap") ||
    document.body;

  // assurer repère + pas de clipping
  try {
    const cs = window.getComputedStyle(hostEl);
    if (cs.position === "static") hostEl.style.position = "relative";
    if (cs.overflow === "hidden") hostEl.style.overflow = "visible";
  } catch (_) {}

  toolbar = TT.createTextToolbar({
    hostEl,
    getContext: () => buildToolbarContext(),
    onBeforeOpenFontPicker: () => saveSelectionIfInside(),
    onBeforeOpenColorPicker: () => saveSelectionIfInside(),
    onAction: (a) => handleToolbarAction(a),
  });

  // exposé pour éventuels adapters (ignore click)
  try { api.__toolbarEl = toolbar.el || null; } catch (_) {}
}


    function buildToolbarContext() {
      if (!active || !active.el) return { isVisible: false };

      const obj = active.obj || {};
      const f = (obj.font || (obj.style && obj.style.font)) || obj.font || {};
      const fontKey = String((f.family || obj.fontFamily || "helv") || "helv").trim();

      const size = Number(f.size || obj.fontSize || 14) || 14;
      const color = String(obj.color || f.color || "#111827");
      const align = String(obj.align || obj.style?.textAlign || "left");
      const bold = !!(f.weight && String(f.weight) !== "400") || !!obj.bold;
      const italic = !!(f.style === "italic") || !!obj.italic;
      const underline = !!f.underline || !!obj.underline;
      const transform = String(f.transform || "none");

      const r = active.el.getBoundingClientRect();
      const hostR = (typeof getHostRect === "function") ? getHostRect() : null;

      return {
        isVisible: true,
        fonts: (typeof getFonts === "function" ? getFonts() : []) || [],
        currentFontKey: fontKey,
        fontKey,
        size,
        color,
        align,
        bold,
        italic,
        underline,
        transform,
        anchorRect: r,
        hostRect: hostR,
      };
    }

    const reposition = rafThrottle(() => {
      if (!toolbar || !active) return;
      try { toolbar.updateFromContext && toolbar.updateFromContext(); } catch (_) {}
    });

    function resolveFontFamily(fontKey) {
      const k = String(fontKey || "").trim();
      if (!k || k === "helv") return "Helvetica, Arial, sans-serif";
      return `${k}, Helvetica, Arial, sans-serif`;
    }

    function saveSelectionIfInside() {
      if (!active || !active.contentEl) return;
      const r = getSelectionRange();
      if (r && isRangeInside(r, active.contentEl)) savedRange = r.cloneRange();
    }

    function restoreSelectionAndFocus() {
      if (!active || !active.contentEl) return false;

      const live = getSelectionRange();
      if (live && isRangeInside(live, active.contentEl)) {
        active.contentEl.focus({ preventScroll: true });
        return true;
      }
      if (savedRange && isRangeInside(savedRange, active.contentEl)) {
        restoreRange(savedRange);
        active.contentEl.focus({ preventScroll: true });
        return true;
      }
      return false;
    }

    function syncToObject(commit) {
      if (!active) return;
      const obj = active.obj || (typeof getObject === "function" ? getObject(active.pageIndex, active.objectId) : null);
      if (!obj) return;

      const raw = active.contentEl?.innerHTML || "";
      const clean = sanitizeHtml(raw);

      obj.html = clean;
      obj.text = getPlainText(active.contentEl);

      obj.align = active.contentEl.style.textAlign || obj.align || "left";
      obj.lineHeight = obj.lineHeight || null;

      obj.font = obj.font || {};
      if (!obj.font.family) obj.font.family = "helv";
      if (!obj.font.size) obj.font.size = 14;
      if (!obj.font.weight) obj.font.weight = "400";
      if (!obj.font.style) obj.font.style = "normal";
      if (obj.font.underline == null) obj.font.underline = false;
      if (!obj.font.transform) obj.font.transform = "none";

      if (typeof onDirty === "function") onDirty(!!commit);
    }

    function applyBlockStylesFromObj() {
      if (!active) return;
      const obj = active.obj || {};
      const contentEl = active.contentEl;
      if (!contentEl) return;

      const align = obj.align || obj.style?.textAlign || "left";
      contentEl.style.textAlign = align;

      const lh = obj.lineHeight || obj.style?.lineHeight || null;
      contentEl.style.lineHeight = lh ? String(lh) : "";

      const f = obj.font || {};
      const ff = resolveFontFamily(f.family || "helv");
      const fs = clamp(Number(f.size || 14), 4, 200);
      contentEl.style.fontFamily = ff;
      contentEl.style.fontSize = `${fs}px`;
      contentEl.style.color = String(obj.color || f.color || "#111827");

      const tr = String(f.transform || "none");
      contentEl.style.textTransform =
        tr === "upper" ? "uppercase" :
        tr === "lower" ? "lowercase" :
        tr === "capitalize" ? "capitalize" : "none";
    }

    function handleToolbarAction(a) {
      if (!active) return;
      const t = a && a.type;

      restoreSelectionAndFocus();

      if (t === "bold" || t === "italic" || t === "underline") {
        try { document.execCommand(t); } catch (_) {}
        saveSelectionIfInside();
        syncToObject(false);
        reposition();
        return;
      }

      if (t === "align") {
        const v = String(a.value || "left");
        active.contentEl.style.textAlign = v;
        if (active.obj) active.obj.align = v;
        syncToObject(false);
        reposition();
        return;
      }

      if (t === "transform") {
        const v = String(a.value || "none");
        pending.transform = v;

        const css =
          v === "upper" ? "uppercase" :
          v === "lower" ? "lowercase" :
          v === "capitalize" ? "capitalize" : "none";

        active.contentEl.style.textTransform = css;
        if (active.obj) {
          active.obj.font = active.obj.font || {};
          active.obj.font.transform = v;
        }
        syncToObject(false);
        reposition();
        return;
      }

      if (t === "font") {
        const key = String(a.value || "helv").trim() || "helv";
        const familyCss = resolveFontFamily(key);

        const res = applyInlineStyle(active.contentEl, savedRange, { fontFamily: familyCss });
        if (res.mode === "caret") pending.fontFamily = familyCss;

        if (active.obj) {
          active.obj.font = active.obj.font || {};
          active.obj.font.family = key;
        }
        active.contentEl.style.fontFamily = familyCss;

        saveSelectionIfInside();
        syncToObject(false);
        reposition();
        return;
      }

      if (t === "size") {
        const n = clamp(Number(a.value || 14), 4, 200);
        const res = applyInlineStyle(active.contentEl, savedRange, { fontSize: `${n}px` });
        if (res.mode === "caret") pending.fontSizePx = n;

        if (active.obj) {
          active.obj.font = active.obj.font || {};
          active.obj.font.size = n;
        }
        active.contentEl.style.fontSize = `${n}px`;

        saveSelectionIfInside();
        syncToObject(false);
        reposition();
        return;
      }

      if (t === "color") {
        const c = String(a.value || "#111827").toLowerCase();

        const res = applyInlineStyle(active.contentEl, savedRange, { color: c });
        if (res.mode === "caret") pending.color = c;

        if (active.obj) {
          active.obj.color = c;
          active.obj.font = active.obj.font || {};
          active.obj.font.color = c;
        }
        active.contentEl.style.color = c;

        saveSelectionIfInside();
        syncToObject(false);
        reposition();
        return;
      }
    }

    function onTypingKeyDown(e) {
      if (!active || !active.isEditing) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exit(true); // ✅ commit sur ESC (comme comment)
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1) return;

      const hasPending = !!(pending.fontFamily || pending.fontSizePx || pending.color);
      if (!hasPending) return;

      e.preventDefault();
      restoreSelectionAndFocus();

      const style = {};
      if (pending.fontFamily) style.fontFamily = pending.fontFamily;
      if (pending.fontSizePx) style.fontSize = `${pending.fontSizePx}px`;
      if (pending.color) style.color = pending.color;

      const ok = insertStyledCharAtCaret(active.contentEl, e.key, style);
      if (ok) {
        saveSelectionIfInside();
        syncToObject(false);
      }
    }

    function onSelectionChange() {
      saveSelectionIfInside();
    }

    // -------------------------------------------------------------------------
    // Public entry points (enter/setActive) restent pilotés par ton adapter
    // -------------------------------------------------------------------------
    function enter(pageIndex, objectId, blockEl) {
      ensureToolbar();
      if (!toolbar) return;

      const obj = (typeof getObject === "function") ? getObject(pageIndex, objectId) : null;
      if (!obj) return;

      const contentEl = blockEl?.querySelector?.('[data-role="richtext"]');
      if (!contentEl) return;

      const overlayEl = getOverlayFromEl ? getOverlayFromEl(blockEl) : null;

      active = {
        pageIndex,
        objectId: String(objectId),
        obj,
        el: blockEl,
        contentEl,
        overlayEl,
        isEditing: true,
      };
      savedRange = null;

      try { setEditingState(true, String(objectId)); } catch (_) {}

      contentEl.contentEditable = "true";
      blockEl.classList.add("is-editing");

      applyBlockStylesFromObj();

      try { toolbar.updateFromContext(); } catch (_) {}
	 showToolbar();    
      reposition();

      requestAnimationFrame(() => {
        placeCaretEnd(contentEl);
        saveSelectionIfInside();
      });

      // ✅ handlers liés au content (comme avant)
      contentEl.addEventListener("keydown", onTypingKeyDown, true);
      contentEl.addEventListener("input", onInput, true);
    }

    function onInput() {
      if (!active || !active.isEditing) return;
      syncToObject(false);
      reposition();
    }

    // ✅ sélection simple (sans édition)
function setActive(pageIndex, objectId, blockEl) {
  ensureToolbar(); // Toujours vérifier que la toolbar est créée
  if (!toolbar) return;

  const obj = (typeof getObject === "function") ? getObject(pageIndex, objectId) : null;
  if (!obj) return;

  const contentEl = blockEl?.querySelector?.('[data-role="richtext"]');
  if (!contentEl) return;

  // 🔄 Si édition sur le même object => repositionner seulement
  if (active && active.isEditing && active.objectId === String(objectId)) {
    reposition();
    return;
  }

  // 🔄 Mémorisation de l'objet actif (édité)
  active = {
    pageIndex,
    objectId: String(objectId),
    obj,
    el: blockEl,
    contentEl,
    overlayEl: null,
    isEditing: false, // Actuellement hors du mode édition
  };

  savedRange = null;

  try { setEditingState(false, null); } catch (_) {}
  
  // Désactiver l'édition sur le bloc
  contentEl.contentEditable = "false";
  blockEl.classList.remove("is-editing");

  applyBlockStylesFromObj(); // Appliquer les styles définis sur l’objet

  try { 
    toolbar.updateFromContext(); 
  } catch (_) {}

  // 🔄 Modifications : Contrôle explicite de l'affichage de la toolbar
  if (active.isEditing) {
    // Si on est en mode édition, afficher la toolbar
    console.log("[Paragraph] setActive -> toolbar affichée pour bloc édité");
    showToolbar(); // Appeler explicitement l'affichage
  } else {
    // Si hors édition, cacher la toolbar
    console.log("[Paragraph] setActive -> toolbar cachée (édition désactivée)");
    hideToolbar(); // Appeler explicitement pour cacher
  }

  reposition(); // Repositionner la toolbar si elle est visible
}

    function clearActive() {
      // si édition => commit + exit
      if (active && active.isEditing) {
        try { exit(true); } catch (_) {}
        return;
      }
      active = null;
      savedRange = null;
      hideToolbar();
    }

	   function exit(commit) {
	  if (!active) return;

	  const prev = active; // ✅ important

	  if (commit) {
		const clean = sanitizeHtml(active.contentEl.innerHTML || "");
		active.contentEl.innerHTML = clean;
		syncToObject(true);
	  } else {
		syncToObject(false);
	  }

	  const { contentEl, el } = active;

	  contentEl.removeEventListener("keydown", onTypingKeyDown, true);
	  contentEl.removeEventListener("input", onInput, true);

	  contentEl.contentEditable = "false";
	  el.classList.remove("is-editing");

	  try { setEditingState(false, null); } catch (_) {}

	  // ✅ RESTER ACTIF (sélection) au lieu de tout clear + hide
	  active = {
		pageIndex: prev.pageIndex,
		objectId: prev.objectId,
		obj: prev.obj,
		el: prev.el,
		contentEl: prev.contentEl,
		overlayEl: prev.overlayEl,
		isEditing: false,
	  };

	  savedRange = null;

	  try { toolbar.updateFromContext(); } catch (_) {}
	  showToolbar();
	  reposition();
	}


    function isEditingObject(objectId) {
      return !!(active && active.isEditing && active.objectId === String(objectId));
    }

    function onMoveOrResize() {
    reposition(); // Met à jour la position
    hideToolbar(); // Cache la toolbar pendant le mouvement
}

    // -------------------------------------------------------------------------
    // ✅ Global handlers (aligné text_simple_tools.js)
    // -------------------------------------------------------------------------
    function onDocumentPointerDown(e) {
		
		  
      const t = e.target;

  // ✅ ignore toolbar + popovers (sinon capture doc peut commit/clear trop tôt)
	  if (isInPopover(t)) return;
	  if (toolbar?.el && toolbar.el.contains(t)) return;

      

      // si click dans un paragraphe quelconque:
      // - si on édite un autre paragraphe => commit, puis laisser l'event continuer
      const insideAnyParagraph = !!(t && t.closest && t.closest('[data-type="text_paragraph"]'));
      if (insideAnyParagraph) {
        if (active?.isEditing && active.el && !active.el.contains(t)) {
          exit(true);
        }
        return; // ne pas clearActive: l'adapter va setActive/enter
      }

      // si click dans un autre outil texte (TextSimple)
      const insideTextSimple = !!(t && t.closest && t.closest('.anno-object[data-kind="text_simple"]'));
		  if (insideTextSimple) {
	  // ✅ si on éditait un paragraphe, on commit
			  if (active?.isEditing) exit(true);

			  // ✅ IMPORTANT: ne pas hideToolbar ici (sinon tu tues la toolbar du TextSimple)
			  active = null;
			  savedRange = null;

			  // (optionnel) marque l'event comme géré par text_simple si pas déjà fait
			  if (!e.__zhHandledBy) e.__zhHandledBy = "text_simple";
			  return;
			}


      // click outside (canvas/ailleurs)
      if (active?.isEditing) {
        exit(true);
        return;
      }
      clearActive();
	  hideToolbar();
    }

    function onDocumentKeyDown(e) {
      // si focus dans un input/textarea/contenteditable, on laisse faire
      if (isEditableTarget(document.activeElement)) return;

      if (e.key === "Escape") {
        if (active?.isEditing) {
          e.preventDefault();
          e.stopPropagation();
          exit(true); // commit sur ESC
          return;
        }
        // sinon, juste clear la sélection
        clearActive();
        return;
      }
    }

    function onWindowResize() { reposition(); }
    function onScrollAny() { reposition(); }

    function attach() {
      if (state.attached) return;
      state.attached = true;

      ensureToolbar();

      state.onDocPointerDown = onDocumentPointerDown;
      state.onDocKeyDown = onDocumentKeyDown;
      state.onWinResize = onWindowResize;
      state.onScroll = onScrollAny;
      state.onSelChange = onSelectionChange;

      document.addEventListener("pointerdown", state.onDocPointerDown, true);
      document.addEventListener("keydown", state.onDocKeyDown, true);
      document.addEventListener("selectionchange", state.onSelChange, true);
      window.addEventListener("resize", state.onWinResize);
      window.addEventListener("scroll", state.onScroll, true);
    }

    function detach() {
      if (!state.attached) return;
      state.attached = false;

      document.removeEventListener("pointerdown", state.onDocPointerDown, true);
      document.removeEventListener("keydown", state.onDocKeyDown, true);
      document.removeEventListener("selectionchange", state.onSelChange, true);
      window.removeEventListener("resize", state.onWinResize);
      window.removeEventListener("scroll", state.onScroll, true);

      state.onDocPointerDown = null;
      state.onDocKeyDown = null;
      state.onWinResize = null;
      state.onScroll = null;
      state.onSelChange = null;
    }

    Object.assign(api, {
      // lifecycle (TextSimple-like)
      attach,
      detach,

      ensureToolbar,
      enter,
      exit,
      setActive,
      clearActive,
      hideToolbar,
      isEditingObject,
      onMoveOrResize,
      saveSelectionIfInside,
      restoreSelectionAndFocus,
      getActive: () => active,

      applyLineHeight: (lh) => {
        if (!active) return;
        const v = clamp(Number(lh || 1.3), 0.8, 6);
        active.contentEl.style.lineHeight = String(v);
        if (active.obj) active.obj.lineHeight = v;
        syncToObject(false);
        reposition();
      },
    });

    return api;
  }

  // ------------------------------------------------------------
  // Export
  // ------------------------------------------------------------
  global.ParagraphTools = global.ParagraphTools || {};
  global.ParagraphTools.createController = createParagraphController;

  try { console.log("[ParagraphTools] loaded v=textsimple-like-attach+global-outside"); } catch (_) {}
})(window);

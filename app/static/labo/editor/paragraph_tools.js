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

// à continuer la base améliorée
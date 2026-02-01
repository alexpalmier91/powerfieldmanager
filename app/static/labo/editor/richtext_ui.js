// app/static/labo/editor/richtext_ui.js
// UI modal + contenteditable + conversion HTML <-> runs
// Object shape: { type:"richtext", runs:[{text,bold,fontSize,color,fontFamily,fontWeight}], ...defaults on block }

import { state, setStatus } from "./state.js?v=12";

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normColor(c) {
  if (!c) return null;
  const s = String(c).trim();
  if (!s) return null;
  // accept #RGB, #RRGGBB, rgb(...)
  return s;
}

function normFontFamily(f) {
  if (!f) return null;
  return String(f).trim();
}

function sameStyle(a, b) {
  return (
    !!a.bold === !!b.bold &&
    (a.fontSize || null) === (b.fontSize || null) &&
    (normColor(a.color) || null) === (normColor(b.color) || null) &&
    (normFontFamily(a.fontFamily) || null) === (normFontFamily(b.fontFamily) || null) &&
    (a.fontWeight || null) === (b.fontWeight || null)
  );
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    if (!r || r.text == null) continue;
    const txt = String(r.text);
    if (!txt) continue;
    const cur = {
      text: txt,
      bold: !!r.bold,
      fontSize: r.fontSize != null ? Number(r.fontSize) : undefined,
      color: r.color ? String(r.color) : undefined,
      fontFamily: r.fontFamily ? String(r.fontFamily) : undefined,
      fontWeight: r.fontWeight != null ? Number(r.fontWeight) : undefined,
    };
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, cur)) {
      prev.text += cur.text;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Convert runs -> HTML for contenteditable.
 * We only generate <span style=""> + <b> + <br>.
 */
export function runsToHtml(runs, blockDefaults) {
  const def = blockDefaults || {};
  const chunks = [];
  for (const r of runs || []) {
    const text = String(r.text ?? "");
    if (!text) continue;

    // handle embedded \n by splitting and inserting <br>
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.length) {
        const style = [];
        const fs = r.fontSize ?? def.fontSize;
        const col = r.color ?? def.color;
        const fam = r.fontFamily ?? def.fontFamily;

        if (fs) style.push(`font-size:${Number(fs)}px`);
        if (col) style.push(`color:${col}`);
        if (fam) style.push(`font-family:${fam}`);
        if (r.fontWeight) style.push(`font-weight:${Number(r.fontWeight)}`);

        const spanOpen = style.length ? `<span style="${escHtml(style.join(";"))}">` : `<span>`;
        const spanClose = `</span>`;

        const inner = escHtml(p).replaceAll("  ", " &nbsp;"); // keep double spaces a bit
        if (r.bold) chunks.push(`${spanOpen}<b>${inner}</b>${spanClose}`);
        else chunks.push(`${spanOpen}${inner}${spanClose}`);
      }
      if (i !== parts.length - 1) chunks.push("<br>");
    }
  }
  return chunks.join("");
}

/**
 * Sanitize contenteditable DOM:
 * allow only: B/STRONG/SPAN/BR and text nodes
 * convert DIV/P into BR boundaries
 */
function sanitizeToFragment(rootEl) {
  const frag = document.createDocumentFragment();

  function walk(node, outParent) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      outParent.appendChild(document.createTextNode(node.nodeValue || ""));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toUpperCase();

    if (tag === "BR") {
      outParent.appendChild(document.createElement("br"));
      return;
    }

    if (tag === "DIV" || tag === "P") {
      // treat as block: walk children then add BR
      for (const child of Array.from(node.childNodes)) walk(child, outParent);
      outParent.appendChild(document.createElement("br"));
      return;
    }

    if (tag === "B" || tag === "STRONG") {
      const b = document.createElement("b");
      for (const child of Array.from(node.childNodes)) walk(child, b);
      outParent.appendChild(b);
      return;
    }

    if (tag === "SPAN") {
      const sp = document.createElement("span");
      // only keep style attributes we care about
      const style = node.getAttribute("style") || "";
      if (style) sp.setAttribute("style", style);
      for (const child of Array.from(node.childNodes)) walk(child, sp);
      outParent.appendChild(sp);
      return;
    }

    // any other tag: unwrap its children
    for (const child of Array.from(node.childNodes)) walk(child, outParent);
  }

  for (const child of Array.from(rootEl.childNodes)) walk(child, frag);
  return frag;
}

/**
 * Parse style string -> {fontSize,color,fontFamily,fontWeight}
 */
function parseStyle(styleStr) {
  const out = {};
  const s = String(styleStr || "").trim();
  if (!s) return out;

  // naive parsing: key:value; ...
  const parts = s.split(";").map(x => x.trim()).filter(Boolean);
  for (const kv of parts) {
    const idx = kv.indexOf(":");
    if (idx <= 0) continue;
    const k = kv.slice(0, idx).trim().toLowerCase();
    const v = kv.slice(idx + 1).trim();

    if (k === "font-size") {
      const m = v.match(/([\d.]+)\s*(px|pt)?/i);
      if (m) out.fontSize = Number(m[1]);
    } else if (k === "color") {
      out.color = v;
    } else if (k === "font-family") {
      // keep raw, including LABO_FONT_*
      out.fontFamily = v.replaceAll('"', "").replaceAll("'", "").trim();
    } else if (k === "font-weight") {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) out.fontWeight = n;
      else if (v === "bold") out.fontWeight = 700;
      else if (v === "normal") out.fontWeight = 400;
    }
  }
  return out;
}

/**
 * DOM -> runs with inherited styles.
 * We interpret <b>/<strong> as bold=true.
 * We interpret <span style="..."> overrides.
 * <br> becomes "\n" in a run (with current style) so wrap is consistent.
 */
export function htmlToRuns(editableEl, blockDefaults) {
  const def = blockDefaults || {};
  const frag = sanitizeToFragment(editableEl);

  const runs = [];
  const styleStack = [{
    bold: false,
    fontSize: def.fontSize != null ? Number(def.fontSize) : undefined,
    color: def.color != null ? String(def.color) : undefined,
    fontFamily: def.fontFamily != null ? String(def.fontFamily) : undefined,
    fontWeight: def.fontWeight != null ? Number(def.fontWeight) : undefined,
  }];

  const curStyle = () => styleStack[styleStack.length - 1];

  function pushText(txt) {
    if (txt == null) return;
    const t = String(txt);
    if (!t) return;
    const s = curStyle();
    runs.push({
      text: t,
      bold: !!s.bold,
      fontSize: s.fontSize,
      color: s.color,
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
    });
  }

  function walk(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.nodeValue || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toUpperCase();

    if (tag === "BR") {
      pushText("\n");
      return;
    }

    if (tag === "B" || tag === "STRONG") {
      const prev = curStyle();
      styleStack.push({ ...prev, bold: true, fontWeight: prev.fontWeight || 700 });
      for (const child of Array.from(node.childNodes)) walk(child);
      styleStack.pop();
      return;
    }

    if (tag === "SPAN") {
      const prev = curStyle();
      const st = parseStyle(node.getAttribute("style") || "");
      styleStack.push({
        ...prev,
        fontSize: st.fontSize != null ? st.fontSize : prev.fontSize,
        color: st.color != null ? st.color : prev.color,
        fontFamily: st.fontFamily != null ? st.fontFamily : prev.fontFamily,
        fontWeight: st.fontWeight != null ? st.fontWeight : prev.fontWeight,
      });
      for (const child of Array.from(node.childNodes)) walk(child);
      styleStack.pop();
      return;
    }

    // unwrap anything else
    for (const child of Array.from(node.childNodes)) walk(child);
  }

  for (const child of Array.from(frag.childNodes)) walk(child);

  // Normalize: collapse CRLF, keep \n, merge consecutive identical styles
  const norm = [];
  for (const r of runs) {
    const t = String(r.text).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (!t) continue;
    norm.push({ ...r, text: t });
  }
  return mergeRuns(norm);
}

// ------------------------------------------------------------
// Modal UI
// ------------------------------------------------------------

function ensureModal() {
  let m = document.getElementById("rt-modal");
  if (m) return m;

  m = document.createElement("div");
  m.id = "rt-modal";
  m.className = "rt-modal hidden";
  m.innerHTML = `
    <div class="rt-backdrop"></div>
    <div class="rt-panel">
      <div class="rt-head">
        <div class="rt-title">Paragraphe</div>
        <button class="rt-close" type="button" title="Fermer">✕</button>
      </div>

      <div class="rt-toolbar">
        <button class="rt-btn" data-act="bold" type="button"><b>B</b></button>

        <label class="rt-label">Taille
          <select class="rt-select" data-act="size">
            <option value="12">12</option>
            <option value="14">14</option>
            <option value="16" selected>16</option>
            <option value="18">18</option>
            <option value="22">22</option>
            <option value="28">28</option>
            <option value="36">36</option>
          </select>
        </label>

        <label class="rt-label">Couleur
          <input class="rt-color" data-act="color" type="color" value="#111827"/>
        </label>

        <label class="rt-label">Police
          <select class="rt-select" data-act="font">
            <option value="">(défaut)</option>
            <option value="helv">helv</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times-Roman">Times-Roman</option>
            <option value="Courier">Courier</option>
          </select>
        </label>

        <div class="rt-spacer"></div>

        <button class="rt-btn" data-act="align-left" type="button">⟸</button>
        <button class="rt-btn" data-act="align-center" type="button">≡</button>
        <button class="rt-btn" data-act="align-right" type="button">⟹</button>
        <button class="rt-btn" data-act="align-justify" type="button">☰</button>
      </div>

      <div class="rt-body">
        <div class="rt-edit" contenteditable="true" spellcheck="false"></div>
      </div>

      <div class="rt-foot">
        <button class="rt-save" type="button">Enregistrer</button>
        <button class="rt-cancel" type="button">Annuler</button>
      </div>
    </div>
  `;

  // minimal CSS (kept here to avoid touching your main css; you can move later)
  const css = document.createElement("style");
  css.textContent = `
    .rt-modal.hidden{display:none}
    .rt-modal{position:fixed;inset:0;z-index:9999}
    .rt-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
    .rt-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(900px, 92vw); height:min(640px, 86vh);
      background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.2);
      display:flex;flex-direction:column;overflow:hidden;
    }
    .rt-head{display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;border-bottom:1px solid rgba(17,24,39,.12);
    }
    .rt-title{font-weight:700}
    .rt-close{border:0;background:transparent;font-size:18px;cursor:pointer}
    .rt-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
      padding:10px 12px;border-bottom:1px solid rgba(17,24,39,.12);
    }
    .rt-btn{border:1px solid rgba(17,24,39,.18); background:#fff; border-radius:10px;
      padding:6px 10px; cursor:pointer;
    }
    .rt-btn.active{outline:2px solid rgba(59,130,246,.35)}
    .rt-label{display:flex;gap:8px;align-items:center;font-size:12px;color:#111827}
    .rt-select{padding:6px 8px;border-radius:10px;border:1px solid rgba(17,24,39,.18)}
    .rt-color{width:34px;height:34px;border:0;background:transparent;padding:0}
    .rt-spacer{flex:1}
    .rt-body{flex:1; padding:12px}
    .rt-edit{height:100%; border:1px solid rgba(17,24,39,.15); border-radius:12px;
      padding:12px; overflow:auto; outline:none;
      white-space:pre-wrap; word-break:break-word;
    }
    .rt-foot{display:flex;justify-content:flex-end;gap:10px;padding:10px 12px;
      border-top:1px solid rgba(17,24,39,.12);
    }
    .rt-save{background:#111827;color:#fff;border:0;border-radius:12px;padding:10px 14px;cursor:pointer}
    .rt-cancel{background:#fff;color:#111827;border:1px solid rgba(17,24,39,.18);border-radius:12px;padding:10px 14px;cursor:pointer}
  `;
  document.head.appendChild(css);

  document.body.appendChild(m);
  return m;
}

function applySpanStyle(editEl, styleObj) {
  // Use execCommand to wrap selection in <span>
  // then set style on the created span (or current selection parent span)
  document.execCommand("insertHTML", false, `<span>${document.getSelection()?.toString() || ""}</span>`);
  // Not perfect: we prefer Range wrapping
  // We'll do a better approach below: wrap selection with range
}

function wrapSelectionWithSpan(styleStr) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;

  const span = document.createElement("span");
  if (styleStr) span.setAttribute("style", styleStr);

  try {
    range.surroundContents(span);
  } catch (e) {
    // fallback: extract contents
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }

  // move caret after span
  sel.removeAllRanges();
  const r2 = document.createRange();
  r2.setStartAfter(span);
  r2.collapse(true);
  sel.addRange(r2);
}

function setParagraphAlign(editEl, align) {
  // keep it simple: set text-align on the editable root
  editEl.style.textAlign = align;
}

export function openRichTextModal(obj, onSave) {
  const modal = ensureModal();
  modal.classList.remove("hidden");

  const closeBtn = modal.querySelector(".rt-close");
  const cancelBtn = modal.querySelector(".rt-cancel");
  const saveBtn = modal.querySelector(".rt-save");
  const editEl = modal.querySelector(".rt-edit");

  const btnBold = modal.querySelector('[data-act="bold"]');
  const selSize = modal.querySelector('[data-act="size"]');
  const inpColor = modal.querySelector('[data-act="color"]');
  const selFont = modal.querySelector('[data-act="font"]');

  const btnAL = modal.querySelector('[data-act="align-left"]');
  const btnAC = modal.querySelector('[data-act="align-center"]');
  const btnAR = modal.querySelector('[data-act="align-right"]');
  const btnAJ = modal.querySelector('[data-act="align-justify"]');

  const defaults = {
    fontFamily: obj.fontFamily || "helv",
    fontSize: obj.fontSize || 16,
    fontWeight: obj.fontWeight || 400,
    color: obj.color || "#111827",
    align: obj.align || "left",
    lineHeight: obj.lineHeight || 1.25,
  };

  // init toolbar defaults
  inpColor.value = defaults.color || "#111827";
  selSize.value = String(defaults.fontSize || 16);

  // only set if option exists
  const fontVal = String(defaults.fontFamily || "");
  if ([...selFont.options].some(o => o.value === fontVal)) selFont.value = fontVal;
  else selFont.value = "";

  // set align
  const applyAlignUI = (a) => {
    btnAL.classList.toggle("active", a === "left");
    btnAC.classList.toggle("active", a === "center");
    btnAR.classList.toggle("active", a === "right");
    btnAJ.classList.toggle("active", a === "justify");
  };

  applyAlignUI(defaults.align);

  // load content
  editEl.style.fontFamily = defaults.fontFamily || "";
  editEl.style.fontSize = `${defaults.fontSize || 16}px`;
  editEl.style.color = defaults.color || "#111827";
  editEl.style.lineHeight = String(defaults.lineHeight || 1.25);
  editEl.style.textAlign = defaults.align || "left";

  const html = runsToHtml(obj.runs || [{ text: "Nouveau paragraphe", bold: false }], defaults);
  editEl.innerHTML = html || "";

  // focus
  setTimeout(() => editEl.focus(), 10);

  const cleanup = () => {
    modal.classList.add("hidden");
    // remove handlers by cloning (simple & safe)
    const clone = modal.cloneNode(true);
    modal.parentNode.replaceChild(clone, modal);
  };

  // toolbar actions
  btnBold.addEventListener("click", () => {
    document.execCommand("bold", false, null);
    editEl.focus();
  });

  selSize.addEventListener("change", () => {
    const v = Number(selSize.value || defaults.fontSize || 16);
    wrapSelectionWithSpan(`font-size:${v}px`);
    editEl.focus();
  });

  inpColor.addEventListener("change", () => {
    const v = inpColor.value || defaults.color || "#111827";
    wrapSelectionWithSpan(`color:${v}`);
    editEl.focus();
  });

  selFont.addEventListener("change", () => {
    const v = selFont.value || "";
    if (!v) return;
    wrapSelectionWithSpan(`font-family:${v}`);
    editEl.focus();
  });

  btnAL.addEventListener("click", () => { setParagraphAlign(editEl, "left"); applyAlignUI("left"); });
  btnAC.addEventListener("click", () => { setParagraphAlign(editEl, "center"); applyAlignUI("center"); });
  btnAR.addEventListener("click", () => { setParagraphAlign(editEl, "right"); applyAlignUI("right"); });
  btnAJ.addEventListener("click", () => { setParagraphAlign(editEl, "justify"); applyAlignUI("justify"); });

  const doClose = () => cleanup();

  closeBtn.addEventListener("click", doClose);
  cancelBtn.addEventListener("click", doClose);

  saveBtn.addEventListener("click", () => {
    try {
      const newAlign = (editEl.style.textAlign || obj.align || "left").trim() || "left";
      const runs = htmlToRuns(editEl, defaults);

      onSave({
        ...obj,
        type: "richtext",
        align: newAlign,
        runs,
      });

      cleanup();
      setStatus("Paragraphe enregistré ✅");
    } catch (e) {
      console.error(e);
      setStatus("Erreur lors de l’enregistrement du paragraphe.");
    }
  });
}

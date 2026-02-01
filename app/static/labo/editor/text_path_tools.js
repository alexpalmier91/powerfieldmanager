/* /app/static/labo/editor/text_path_tools.js
 * V0.4 — Path Bezier editor + textPath + HTML overlay editor + TextToolbarBridge
 *
 * ✅ Features:
 * - Insert cubic bezier path (2 anchors + handles)
 * - Default text follows the path (<textPath>)
 * - Drag object / anchors / handles
 * - Double-click on curve OR on text => edit text in HTML overlay (contenteditable)
 *   - input updates SVG textPath live
 *   - Enter validates, Esc cancels
 *   - click outside validates
 *
 * ✅ Toolbar:
 * - Uses TextToolbarBridge (text_toolbar_bridge.js) + TextToolbarTools (text_toolbar_tools.js)
 * - Appears when selected (not while editing)
 * - anchorRect provided (viewport coords) for correct placement
 * - Supports font/size/color/align/bold/italic/underline/transform
 *
 * NOTE:
 * - The “flip above if too low” behavior is handled inside text_toolbar_tools.js
 *   (positionUnderRect logic). This file only provides ctx.anchorRect + ctx.hostRect.
 */

(function (global) {
  "use strict";

  // ------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------
  const log = (...a) => { try { console.log("%c[TPATH]", "color:#2563eb;font-weight:700;", ...a); } catch(_){} };
  const uid = (p="id") => `${p}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

  function svgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function getSvgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return { x: p.x, y: p.y };
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx*dx + dy*dy;
  }

  // Preserve spaces: no aggressive normalization.
  function extractPlainPreserveSpaces(editEl) {
    let t = editEl.textContent || "";
    t = t.replace(/\u00A0/g, " ");   // NBSP -> space
    t = t.replace(/\u200B/g, "");    // ZWSP -> removed
    t = t.replace(/\r/g, "");
    return t;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ------------------------------------------------------------
  // Text transform (display only)
  // ------------------------------------------------------------
  function applyTextTransform(text, mode) {
    const t = String(text || "");
    const m = String(mode || "none");
    if (m === "upper") return t.toUpperCase();
    if (m === "lower") return t.toLowerCase();
    if (m === "capitalize") {
      return t.replace(/\b(\p{L})/gu, (m0) => m0.toUpperCase());
    }
    return t;
  }

  // ------------------------------------------------------------
  // Cubic utilities
  // ------------------------------------------------------------
  function cubicAt(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t2 * t;
    return {
      x: a*p0.x + b*p1.x + c*p2.x + d*p3.x,
      y: a*p0.y + b*p1.y + c*p2.y + d*p3.y
    };
  }

  function approxCubicDistanceSq(p0,p1,p2,p3, x,y) {
    const N = 30;
    let best = Infinity;
    for (let i=0;i<=N;i++){
      const t = i / N;
      const p = cubicAt(p0,p1,p2,p3,t);
      const d = dist2(p.x,p.y,x,y);
      if (d < best) best = d;
    }
    return best;
  }

  // ------------------------------------------------------------
  // Controller factory
  // ------------------------------------------------------------
  function createTextPathController(opts) {
    opts = opts || {};
    const state = {
      rootEl: opts.rootEl || null,
      dragThreshold: 4,

      svgEl: null,
      defsEl: null,
      objectsLayer: null,
      uiLayer: null,

      // HTML overlay editor
      editorHostEl: null,
      editorEl: null,
      editing: null, // { id, initialText }

      objects: [],
      selectedId: null,

      action: null,
      rafPending: false,
      lastMove: null,

      hitRadius: 10,

      // Prevent killing dblclick on text by re-render between clicks
      _deferredSelectTimer: null,
      _deferredSelectId: null,
      _deferredSelectMs: 220,

      // Toolbar
      toolbar: null, // { el, update, closePopovers, destroy }
    };

    // ----------------------------------------------------------
    // Draft object (path + text)
    // ----------------------------------------------------------
    function makeDefaultPathObject(partial) {
      const id = (partial && partial.id) || uid("tp");
      const x = (partial && partial.x) ?? 120;
      const y = (partial && partial.y) ?? 120;

      const obj = {
        id,
        type: "text",
        mode: "path",
        x, y,
        rotation: 0,

        // store RAW text (not transformed)
        text: (partial && partial.text) || "Lorem ipsum",
        textTransform: (partial && partial.textTransform) || "none",

        textFill: (partial && partial.textFill) || "#111827",
        textSize: (partial && partial.textSize) || 22,

        // fontKey is what toolbar will set; fallback to textFamily
        fontKey: (partial && partial.fontKey) || null,
        textFamily: (partial && partial.textFamily) || "Arial, sans-serif",

        textWeight: (partial && partial.textWeight) || "600",
        textStyle: (partial && partial.textStyle) || "normal",
        textUnderline: !!(partial && partial.textUnderline),

        // align stored for UI; applied via textAnchor + startOffset
        align: (partial && partial.align) || "left",
        textAnchor: (partial && partial.textAnchor) || "start",

        stroke: (partial && partial.stroke) || "#111827",
        strokeWidth: (partial && partial.strokeWidth) || 2,

        _pathRefId: (partial && partial._pathRefId) || `tp_path_${id}`,
        startOffset: (partial && partial.startOffset) || "0%",
        textDy: (partial && partial.textDy) ?? -8,

        path: {
          closed: false,
          points: [
            { ax: 0,   ay: 0,   h1x: -60, h1y: 0,   h2x: 60,  h2y: 0 },
            { ax: 320, ay: 120, h1x: 260, h1y: 120, h2x: 380, h2y: 120 },
          ]
        },
      };

      // normalize align to offsets
      normalizeAlign(obj);

      return Object.assign(obj, partial || {});
    }

    function normalizeAlign(obj) {
      const a = String(obj.align || "left");
      if (a === "center") { obj.textAnchor = "middle"; obj.startOffset = "50%"; return; }
      if (a === "right")  { obj.textAnchor = "end";    obj.startOffset = "100%"; return; }
      obj.textAnchor = "start";
      obj.startOffset = "0%";
      obj.align = "left";
    }

    function getDisplayText(obj) {
      return applyTextTransform(obj.text || "", obj.textTransform || "none");
    }

    // ----------------------------------------------------------
    // Helpers: detect text target + object id
    // ----------------------------------------------------------
    function isTextTarget(t) {
      if (!t || !t.closest) return false;
      return !!(t.closest("[data-tp-text='1']") || t.closest("[data-tp-textpath-hit='1']"));
    }

    function getObjIdFromTarget(t) {
      const grp = t && t.closest && t.closest("[data-obj-id]");
      return grp ? grp.getAttribute("data-obj-id") : null;
    }

    function focusEditor(selectAll) {
      const ed = state.editorEl;
      if (!ed) return;
      ed.style.display = "block";
      ed.focus({ preventScroll: true });
      if (selectAll) {
        try {
          const r = document.createRange();
          r.selectNodeContents(ed);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch(_) {}
      }
    }

    function cancelDeferredSelect() {
      if (state._deferredSelectTimer) {
        clearTimeout(state._deferredSelectTimer);
        state._deferredSelectTimer = null;
      }
      state._deferredSelectId = null;
    }

    function deferSelectAndRender(id) {
      cancelDeferredSelect();
      state._deferredSelectId = id;
      state._deferredSelectTimer = setTimeout(() => {
        state._deferredSelectTimer = null;
        state.selectedId = state._deferredSelectId;
        state._deferredSelectId = null;
        render(); // render AFTER dblclick window
      }, state._deferredSelectMs);
    }

    // ----------------------------------------------------------
    // Toolbar integration
    // ----------------------------------------------------------
    function ensureToolbar() {
      if (state.toolbar) return;

      const TB = global.TextToolbarBridge && global.TextToolbarBridge.createTextToolbarBridge;
      if (!TB) {
        // pas bloquant, mais log utile
        console.warn("[TPATH] TextToolbarBridge manquant (charge text_toolbar_bridge.js + text_toolbar_tools.js)");
        return;
      }

      const hostEl = state.rootEl;

      const textHost = {
        getContext: () => {
          const sel = getSelected();
          const isVisible = !!sel && !state.editing;

          const hostRect = hostEl && hostEl.getBoundingClientRect ? hostEl.getBoundingClientRect() : null;
          const anchorRect = isVisible ? computeAnchorRect(sel) : null;

          // fonts list (si dispo dans ton app)
          const fonts =
            (global.__ZH_FONTS__ && Array.isArray(global.__ZH_FONTS__) ? global.__ZH_FONTS__ : null) ||
            (global.__GLOBAL_FONTS__ && Array.isArray(global.__GLOBAL_FONTS__) ? global.__GLOBAL_FONTS__ : null) ||
            (global.FontPickerTools && typeof global.FontPickerTools.getFonts === "function" ? global.FontPickerTools.getFonts() : null) ||
            [];

          return {
            isVisible,
            hostRect,
            anchorRect,

            // toolbar state
            fonts,

            fontKey: (sel && (sel.fontKey || sel.textFamily)) || "helv",
            currentFontKey: (sel && (sel.fontKey || sel.textFamily)) || "helv",

            size: (sel && sel.textSize) || 22,
            color: (sel && sel.textFill) || "#111827",

            align: (sel && sel.align) || "left",
            bold: (sel && String(sel.textWeight) !== "400" && String(sel.textWeight) !== "normal") || false,
            italic: (sel && String(sel.textStyle) === "italic") || false,
            underline: (sel && !!sel.textUnderline) || false,
            transform: (sel && sel.textTransform) || "none",
          };
        },

        onBeforeOpenFontPicker: () => {
          // si besoin: lock selection, etc.
        },

        onBeforeOpenColorPicker: () => {
          // si besoin: lock selection, etc.
        },

        onAction: (action) => {
          const sel = getSelected();
          if (!sel) return;

          const t = action && action.type;

          if (t === "font") {
            // Chez toi le "fontKey" peut être GLOBAL_FONT_... ou LABO_FONT_...
            // On le stocke tel quel, et on l'utilise comme font-family CSS.
            const fk = String(action.value || "").trim();
            if (fk) {
              sel.fontKey = fk;
              sel.textFamily = fk;
            }
          } else if (t === "size") {
            sel.textSize = clamp(Number(action.value || 22), 4, 300);
          } else if (t === "color") {
            sel.textFill = String(action.value || "#111827");
          } else if (t === "align") {
            sel.align = String(action.value || "left");
            normalizeAlign(sel);
          } else if (t === "bold") {
            const isBold = String(sel.textWeight || "600") !== "400" && String(sel.textWeight || "600") !== "normal";
            sel.textWeight = isBold ? "400" : "700";
          } else if (t === "italic") {
            sel.textStyle = (String(sel.textStyle || "normal") === "italic") ? "normal" : "italic";
          } else if (t === "underline") {
            sel.textUnderline = !sel.textUnderline;
          } else if (t === "transform") {
            sel.textTransform = String(action.value || "none");
          }

          // Mise à jour live (sans perdre l'état)
          updateLiveStyle(sel);
          updateLiveTextPath(sel);
          render(); // pour bbox + handles + toolbar pos
        },
      };

      state.toolbar = TB({ hostEl, textHost });
      try { state.toolbar.update && state.toolbar.update(); } catch (_) {}
    }

    function updateToolbar() {
      if (!state.toolbar) return;
      try { state.toolbar.update(); } catch (_) {}
    }

    function computeAnchorRect(obj) {
      // On préfère le bbox du groupe SVG (inclut texte + path, en viewport)
      try {
        const gObj = state.objectsLayer && state.objectsLayer.querySelector(`[data-obj-id="${CSS.escape(obj.id)}"]`);
        if (gObj && gObj.getBoundingClientRect) {
          const r = gObj.getBoundingClientRect();
          if (r && r.width >= 0 && r.height >= 0) return r;
        }
      } catch (_) {}

      // fallback: host rect
      try {
        return state.rootEl.getBoundingClientRect();
      } catch (_) {
        return null;
      }
    }

    // ----------------------------------------------------------
    // SVG + Editor setup
    // ----------------------------------------------------------
    function ensureSVG() {
      if (state.svgEl) return;
      if (!state.rootEl) throw new Error("createTextPathController: opts.rootEl is required");

      const cs = getComputedStyle(state.rootEl);
      if (cs.position === "static") state.rootEl.style.position = "relative";

      let svg = state.rootEl.querySelector("svg[data-overlay='1']");
      if (!svg) {
        svg = svgEl("svg", { "data-overlay": "1" });
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.display = "block";
        svg.style.background = "transparent";
        svg.style.pointerEvents = "auto";
        state.rootEl.appendChild(svg);
      }

      const resize = () => {
        const r = state.rootEl.getBoundingClientRect();
        svg.setAttribute("viewBox", `0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`);
        updateToolbar();
      };
      resize();
      window.addEventListener("resize", resize);

      state.svgEl = svg;

      let defs = svg.querySelector("defs");
      if (!defs) { defs = svgEl("defs"); svg.appendChild(defs); }
      state.defsEl = defs;

      const layer = svgEl("g", { "data-layer": "objects" });
      const ui = svgEl("g", { "data-layer": "ui" });
      svg.appendChild(layer);
      svg.appendChild(ui);
      state.objectsLayer = layer;
      state.uiLayer = ui;

      svg.addEventListener("pointerdown", onPointerDown, { passive: false });
      svg.addEventListener("pointermove", onPointerMove, { passive: false });
      svg.addEventListener("pointerup", onPointerUp, { passive: false });
      svg.addEventListener("pointercancel", onPointerUp, { passive: false });

      svg.addEventListener("dblclick", onDoubleClick, { passive: false });

      window.addEventListener("keydown", onKeyDown);

      ensureEditorOverlay();
    

      log("SVG ready");
    }

    function ensureEditorOverlay() {
      if (state.editorHostEl) return;

      const host = document.createElement("div");
      host.setAttribute("data-tp-editorhost", "1");
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = "50";
      state.rootEl.appendChild(host);
      state.editorHostEl = host;

      const ed = document.createElement("div");
      ed.setAttribute("data-tp-editor", "1");
      ed.contentEditable = "true";
      ed.spellcheck = false;

      ed.style.position = "absolute";
      ed.style.minWidth = "120px";
      ed.style.maxWidth = "70%";
      ed.style.padding = "6px 8px";
      ed.style.borderRadius = "10px";
      ed.style.border = "1px solid rgba(37,99,235,.55)";
      ed.style.boxShadow = "0 10px 24px rgba(0,0,0,.12)";
      ed.style.background = "rgba(255,255,255,.98)";
      ed.style.color = "#111827";
      ed.style.outline = "none";
      ed.style.whiteSpace = "pre";
      ed.style.lineHeight = "1.15";
      ed.style.display = "none";
      ed.style.pointerEvents = "auto";

      // Prevent editor from triggering SVG pointer handlers
      ed.addEventListener("pointerdown", (e) => { e.stopPropagation(); }, true);

      // Input => update textPath live
      ed.addEventListener("input", () => {
        if (!state.editing) return;
        const obj = getObject(state.editing.id);
        if (!obj) return;
        obj.text = extractPlainPreserveSpaces(ed); // RAW
        updateLiveTextPath(obj);
        updateToolbar();
      });

      // Enter/Esc
      ed.addEventListener("keydown", (e) => {
        if (!state.editing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          exitTextEdit(true);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          exitTextEdit(false);
          return;
        }
      });

      ed.addEventListener("blur", () => {
        if (!state.editing) return;
        exitTextEdit(true);
      });

      host.appendChild(ed);
      state.editorEl = ed;

      // Click outside editor while editing => validate
      document.addEventListener("pointerdown", (e) => {
        if (!state.editing) return;

        const edNow = state.editorEl;
        if (!edNow) return;

        if (edNow.contains(e.target)) return;

        if (state.rootEl.contains(e.target) && isTextTarget(e.target)) {
          const id = getObjIdFromTarget(e.target);
          if (id && id === state.editing.id) {
            e.preventDefault();
            e.stopPropagation();
            focusEditor(false);
            return;
          }
        }

        if (state.rootEl.contains(e.target)) {
          exitTextEdit(true);
        }
      }, true);
    }

    // ----------------------------------------------------------
    // Render
    // ----------------------------------------------------------
    function buildPathD(obj) {
      const pts = obj.path.points;
      if (!pts || pts.length < 2) return "";
      const p0 = pts[0];
      let d = `M ${p0.ax} ${p0.ay}`;
      for (let i=1; i<pts.length; i++) {
        const prev = pts[i-1];
        const cur  = pts[i];
        d += ` C ${prev.h2x} ${prev.h2y} ${cur.h1x} ${cur.h1y} ${cur.ax} ${cur.ay}`;
      }
      if (obj.path.closed) d += " Z";
      return d;
    }

    function clearLayer(el) {
      while (el && el.firstChild) el.removeChild(el.firstChild);
    }

    function clearDefsOwned() {
      if (!state.defsEl) return;
      const owned = state.defsEl.querySelectorAll("[data-tp-def='1']");
      owned.forEach(n => n.remove());
    }

    function render() {
      ensureSVG();
      clearLayer(state.objectsLayer);
      clearLayer(state.uiLayer);
      clearDefsOwned();

      for (const obj of state.objects) renderObject(obj);

      const sel = getSelected();
      if (sel) renderSelection(sel);

      if (state.editing) {
        const o = getObject(state.editing.id);
        if (o) positionEditorForObject(o);
      }

      updateToolbar();
	  try { state._toolbarBridge && state._toolbarBridge.update && state._toolbarBridge.update(); } catch (_) {}
    }

    function renderObject(obj) {
      normalizeAlign(obj);

      const d = buildPathD(obj);

      const defPath = svgEl("path", {
        id: obj._pathRefId,
        d,
        "data-tp-def": "1",
      });
      state.defsEl.appendChild(defPath);

      const g = svgEl("g", {
        "data-obj-id": obj.id,
        "transform": `translate(${obj.x} ${obj.y}) rotate(${obj.rotation || 0})`,
      });

      const hit = svgEl("path", {
        d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 18,
        "vector-effect": "non-scaling-stroke",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "data-hit": "1",
      });

      const path = svgEl("path", {
        d,
        fill: "none",
        stroke: obj.stroke || "#111827",
        "stroke-width": obj.strokeWidth || 2,
        "vector-effect": "non-scaling-stroke",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });

      const textEl = svgEl("text", {
        fill: obj.textFill || "#111827",
        "font-size": String(obj.textSize || 22),
        "font-family": (obj.fontKey || obj.textFamily || "Arial, sans-serif"),
        "font-weight": obj.textWeight || "600",
        "font-style": obj.textStyle || "normal",
        "pointer-events": "auto",
        "data-tp-text": "1",
        "text-anchor": obj.textAnchor || "start",
      });
      if (obj.textUnderline) textEl.setAttribute("text-decoration", "underline");
      textEl.setAttribute("dy", String(obj.textDy ?? -8));

      const tp = svgEl("textPath", {
        href: `#${obj._pathRefId}`,
        "xlink:href": `#${obj._pathRefId}`,
        startOffset: obj.startOffset || "0%",
        "data-tp-textpath": "1",
        "data-tp-textpath-hit": "1",
      });
      tp.textContent = getDisplayText(obj);
      textEl.appendChild(tp);

      g.appendChild(hit);
      g.appendChild(path);
      g.appendChild(textEl);
      state.objectsLayer.appendChild(g);
    }

    function getRenderedTextBBoxLocal(objId) {
      try {
        const gObj = state.objectsLayer && state.objectsLayer.querySelector(`[data-obj-id="${CSS.escape(objId)}"]`);
        if (!gObj) return null;
        const t = gObj.querySelector("[data-tp-text='1']");
        if (!t || !t.getBBox) return null;
        const bb = t.getBBox(); // local coords within gObj
        if (!bb || !(bb.width > 0 || bb.height > 0)) return null;
        return bb;
      } catch (_) {
        return null;
      }
    }

   function renderSelection(obj) {
  const g = svgEl("g", {
    "data-ui-for": obj.id,
    "transform": `translate(${obj.x} ${obj.y}) rotate(${obj.rotation || 0})`,
  });

  const pts = (obj.path && obj.path.points) || [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // bbox from anchors + handles
  for (const p of pts) {
    const arr = [
      [p.ax, p.ay],
      [p.h1x, p.h1y],
      [p.h2x, p.h2y],
    ];
    for (const [x, y] of arr) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  // bbox from rendered text (so selection contains glyphs)
  const tbb = getRenderedTextBBoxLocal(obj.id);
  if (tbb) {
    minX = Math.min(minX, tbb.x);
    minY = Math.min(minY, tbb.y);
    maxX = Math.max(maxX, tbb.x + tbb.width);
    maxY = Math.max(maxY, tbb.y + tbb.height);
  }

  if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
    const bb = { x: minX, y: minY, width: (maxX - minX), height: (maxY - minY) };

    if (bb.width > 1 || bb.height > 1) {
      // ✅ OUTLINE visible (capte la souris via pointer-events: stroke)
      const outline = svgEl("rect", {
        x: bb.x - 10,
        y: bb.y - 10,
        width: bb.width + 20,
        height: bb.height + 20,
        fill: "none",
        stroke: "#2563eb",
        "stroke-width": 1,
        "stroke-dasharray": "6 4",
        "vector-effect": "non-scaling-stroke",

        // ✅ maintenant cliquable / draggable
        "pointer-events": "stroke",
        "data-ui-outline": "1",
        cursor: "move",
      });
      g.appendChild(outline);

      // ✅ HIT-AREA invisible (beaucoup plus facile à saisir)
      const outlineHit = svgEl("rect", {
        x: bb.x - 14,
        y: bb.y - 14,
        width: bb.width + 28,
        height: bb.height + 28,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 14,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "stroke",
        "data-ui-outline-hit": "1",
        cursor: "move",
      });
      g.appendChild(outlineHit);
    }
  }

  // anchors + handles
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];

    const l1 = svgEl("line", {
      x1: p.ax, y1: p.ay, x2: p.h1x, y2: p.h1y,
      stroke: "#60a5fa", "stroke-width": 1, "stroke-dasharray": "4 3",
      "vector-effect": "non-scaling-stroke", "pointer-events": "none",
    });
    const l2 = svgEl("line", {
      x1: p.ax, y1: p.ay, x2: p.h2x, y2: p.h2y,
      stroke: "#60a5fa", "stroke-width": 1, "stroke-dasharray": "4 3",
      "vector-effect": "non-scaling-stroke", "pointer-events": "none",
    });
    g.appendChild(l1);
    g.appendChild(l2);

    const h1 = svgEl("circle", {
      cx: p.h1x, cy: p.h1y, r: 5,
      fill: "#ffffff",
      stroke: "#3b82f6",
      "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
      "data-handle": "h1",
      "data-index": String(i),
    });
    const h2 = svgEl("circle", {
      cx: p.h2x, cy: p.h2y, r: 5,
      fill: "#ffffff",
      stroke: "#3b82f6",
      "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
      "data-handle": "h2",
      "data-index": String(i),
    });
    g.appendChild(h1);
    g.appendChild(h2);

    const a = svgEl("rect", {
      x: p.ax - 5, y: p.ay - 5, width: 10, height: 10,
      fill: "#2563eb",
      stroke: "#ffffff",
      "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
      rx: 2, ry: 2,
      "data-anchor": "1",
      "data-index": String(i),
    });
    g.appendChild(a);
  }

  state.uiLayer.appendChild(g);
}


    // ----------------------------------------------------------
    // Live update (text + style)
    // ----------------------------------------------------------
    function updateLiveTextPath(obj) {
      const g = state.objectsLayer && state.objectsLayer.querySelector(`[data-obj-id="${CSS.escape(obj.id)}"]`);
      if (!g) { render(); return; }
      const tp = g.querySelector("[data-tp-textpath='1']");
      if (!tp) { render(); return; }
      tp.textContent = getDisplayText(obj);
    }

    function updateLiveStyle(obj) {
      const g = state.objectsLayer && state.objectsLayer.querySelector(`[data-obj-id="${CSS.escape(obj.id)}"]`);
      if (!g) return;

      const textEl = g.querySelector("[data-tp-text='1']");
      if (!textEl) return;

      normalizeAlign(obj);

      try { textEl.setAttribute("fill", obj.textFill || "#111827"); } catch (_) {}
      try { textEl.setAttribute("font-size", String(obj.textSize || 22)); } catch (_) {}
      try { textEl.setAttribute("font-family", (obj.fontKey || obj.textFamily || "Arial, sans-serif")); } catch (_) {}
      try { textEl.setAttribute("font-weight", String(obj.textWeight || "600")); } catch (_) {}
      try { textEl.setAttribute("font-style", String(obj.textStyle || "normal")); } catch (_) {}
      try { textEl.setAttribute("text-anchor", String(obj.textAnchor || "start")); } catch (_) {}
      try {
        if (obj.textUnderline) textEl.setAttribute("text-decoration", "underline");
        else textEl.removeAttribute("text-decoration");
      } catch (_) {}

      const tp = g.querySelector("[data-tp-textpath='1']");
      if (tp) {
        try { tp.setAttribute("startOffset", String(obj.startOffset || "0%")); } catch (_) {}
        tp.textContent = getDisplayText(obj);
      }
    }

    // ----------------------------------------------------------
    // Text edit mode
    // ----------------------------------------------------------
    function onDoubleClick(e) {
      cancelDeferredSelect(); // IMPORTANT

      if (state.editing) {
        const id = isTextTarget(e.target) ? getObjIdFromTarget(e.target) : null;
        if (id && id === state.editing.id) {
          e.preventDefault();
          e.stopPropagation();
          focusEditor(true);
          return;
        }
        exitTextEdit(true);
      }

      state.action = null;
      state.lastMove = null;
      state.rafPending = false;

      const objGroup = e.target && e.target.closest && e.target.closest("[data-obj-id]");
      if (objGroup) {
        const id = objGroup.getAttribute("data-obj-id");
        if (id) {
          state.selectedId = id; // no immediate render
          const obj = getObject(id);
          if (obj) {
            enterTextEdit(obj);
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      const svg = state.svgEl;
      const p = getSvgPoint(svg, e.clientX, e.clientY);
      const hitObjId = hitTestPath(p.x, p.y);
      if (!hitObjId) return;

      state.selectedId = hitObjId;
      const obj = getObject(hitObjId);
      if (!obj) return;

      enterTextEdit(obj);
      e.preventDefault();
      e.stopPropagation();
    }

    function enterTextEdit(obj) {
      if (!state.editorEl) ensureEditorOverlay();
      if (!state.editorEl) return;

      state.action = null;
      state.rafPending = false;
      state.lastMove = null;

      state.editing = { id: obj.id, initialText: obj.text || "" };

      const ed = state.editorEl;
      ed.style.display = "block";

      ed.style.fontFamily = (obj.fontKey || obj.textFamily || "Arial, sans-serif");
      ed.style.fontSize = `${obj.textSize || 22}px`;
      ed.style.fontWeight = obj.textWeight || "600";
      ed.style.fontStyle = obj.textStyle || "normal";
      ed.style.textDecoration = obj.textUnderline ? "underline" : "none";
      ed.style.color = obj.textFill || "#111827";

      // show RAW text while editing
      ed.textContent = obj.text || "";

      positionEditorForObject(obj);
      focusEditor(true);

      render(); // toolbar hidden in getContext while editing
    }

    function positionEditorForObject(obj) {
      const ed = state.editorEl;
      if (!ed) return;

      const p0 = obj.path.points && obj.path.points[0] ? obj.path.points[0] : { ax:0, ay:0 };
      const svgX = obj.x + p0.ax;
      const svgY = obj.y + p0.ay + (obj.textDy ?? -8) - 26;

      const svg = state.svgEl;
      const pt = svg.createSVGPoint();
      pt.x = svgX; pt.y = svgY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const sp = pt.matrixTransform(ctm);

      const rootRect = state.rootEl.getBoundingClientRect();
      const left = sp.x - rootRect.left;
      const top  = sp.y - rootRect.top;

      ed.style.left = `${Math.max(8, left)}px`;
      ed.style.top  = `${Math.max(8, top)}px`;
    }

    function exitTextEdit(commit) {
      if (!state.editing) return;
      const { id, initialText } = state.editing;
      const obj = getObject(id);

      const ed = state.editorEl;
      let finalText = initialText;

      if (commit && ed) {
        finalText = extractPlainPreserveSpaces(ed);
      }

      if (obj) {
        obj.text = finalText; // RAW
        updateLiveTextPath(obj);
      }

      state.editing = null;

      if (ed) {
        ed.style.display = "none";
        ed.textContent = "";
      }

      render();
    }

    // ----------------------------------------------------------
    // Selection helpers
    // ----------------------------------------------------------
    function getObject(id) {
      return state.objects.find(o => o.id === id) || null;
    }
    function getSelected() {
      return state.selectedId ? getObject(state.selectedId) : null;
    }
    function select(id) {
      cancelDeferredSelect();
      if (state.editing && state.editing.id !== id) exitTextEdit(true);
      state.selectedId = id || null;
      render();
    }

    // ----------------------------------------------------------
    // Insert / delete
    // ----------------------------------------------------------
    function insertPath(partial) {
      const obj = makeDefaultPathObject(partial);
      state.objects.push(obj);
      select(obj.id);
      return obj;
    }

    function deleteById(id) {
      cancelDeferredSelect();
      if (state.editing && state.editing.id === id) exitTextEdit(false);

      const idx = state.objects.findIndex(o => o.id === id);
      if (idx >= 0) state.objects.splice(idx, 1);
      if (state.selectedId === id) state.selectedId = null;
      render();
    }

    // ----------------------------------------------------------
    // Pointer interactions
    // ----------------------------------------------------------
    function onPointerDown(e) {
      if (!state.svgEl) return;
      if (e.button !== 0) return;

      const svg = state.svgEl;
      const p = getSvgPoint(svg, e.clientX, e.clientY);
      const target = e.target;

      if (state.editing) {
        if (isTextTarget(target)) {
          const id = getObjIdFromTarget(target);
          if (id && id === state.editing.id) {
            e.preventDefault();
            e.stopPropagation();
            focusEditor(false);
          }
        }
        return;
      }

      const uiHost = target && target.closest && target.closest("[data-ui-for]");
		if (uiHost && uiHost.getAttribute) {
		  cancelDeferredSelect();
		  const forId = uiHost.getAttribute("data-ui-for");
		  if (forId) select(forId);

		  const sel = getSelected();
		  if (!sel) return;

		  // ✅ NEW: outline => move
		  if (target && (target.hasAttribute("data-ui-outline") || target.hasAttribute("data-ui-outline-hit"))) {
			beginDragObject(e, sel, p);
			e.preventDefault();
			return;
		  }

        const idx = Number(target.getAttribute("data-index"));
        if (Number.isFinite(idx) && idx >= 0) {
          if (target.hasAttribute("data-anchor")) {
            beginDragAnchor(e, sel, idx, p);
            e.preventDefault();
            return;
          }
          const handle = target.getAttribute("data-handle");
          if (handle === "h1" || handle === "h2") {
            beginDragHandle(e, sel, idx, handle, p);
            e.preventDefault();
            return;
          }
        }
        return;
      }

      // Click on TEXT:
      if (isTextTarget(target)) {
        const id = getObjIdFromTarget(target);
        if (id) {
          cancelDeferredSelect();
          state.selectedId = id; // no render now

          const obj = getObject(id);
          if (obj) {
            state.action = {
              kind: "maybe-drag-object",
              id: obj.id,
              startObjX: obj.x,
              startObjY: obj.y,
              startX: p.x,
              startY: p.y,
              pointerId: e.pointerId,
              _fromText: true,
            };
            return; // don't preventDefault to keep dblclick
          }
        }
      }

      const hitObjId = hitTestPath(p.x, p.y);
      if (hitObjId) {
        cancelDeferredSelect();
        select(hitObjId);
        const sel = getSelected();
        if (sel) {
          beginDragObject(e, sel, p);
          e.preventDefault();
          return;
        }
      }

      cancelDeferredSelect();
      select(null);
    }

    function onPointerMove(e) {
		
	if (!state.action) {
	  const t = e.target;
	  if (t && (t.hasAttribute("data-ui-outline") || t.hasAttribute("data-ui-outline-hit"))) {
		try { state.svgEl.style.cursor = "move"; } catch(_) {}
	  } else {
		try { state.svgEl.style.cursor = ""; } catch(_) {}
	  }
	}	
		
      if (!state.action) return;

      if (state.action.kind === "maybe-drag-object") {
        const svg = state.svgEl;
        const p = getSvgPoint(svg, e.clientX, e.clientY);
        const dx = p.x - state.action.startX;
        const dy = p.y - state.action.startY;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist >= (state.dragThreshold || 4)) {
          cancelDeferredSelect();
          state.action.kind = "drag-object";
          try { state.svgEl.setPointerCapture(state.action.pointerId); } catch(_){}
          e.preventDefault();
        } else {
          return;
        }
      }

      state.lastMove = e;
      if (!state.rafPending) {
        state.rafPending = true;
        requestAnimationFrame(applyMove);
      }
      e.preventDefault();
    }

    function onPointerUp(e) {
      if (!state.action) return;

      if (state.action.kind === "maybe-drag-object" && state.action._fromText) {
        const id = state.action.id;
        state.action = null;
        state.lastMove = null;
        state.rafPending = false;

        deferSelectAndRender(id);
        return;
      }

      state.action = null;
      state.lastMove = null;
      state.rafPending = false;
      e.preventDefault();
    }

    function beginDragObject(e, obj, p) {
      cancelDeferredSelect();
      state.action = {
        kind: "drag-object",
        id: obj.id,
        startObjX: obj.x,
        startObjY: obj.y,
        startX: p.x,
        startY: p.y,
        pointerId: e.pointerId,
      };
      try { state.svgEl.setPointerCapture(e.pointerId); } catch(_){}
    }

    function beginDragAnchor(e, obj, idx, p) {
      cancelDeferredSelect();
      const pt = obj.path.points[idx];
      state.action = {
        kind: "drag-anchor",
        id: obj.id,
        idx,
        startX: p.x,
        startY: p.y,
        startAx: pt.ax,
        startAy: pt.ay,
        startH1x: pt.h1x, startH1y: pt.h1y,
        startH2x: pt.h2x, startH2y: pt.h2y,
        pointerId: e.pointerId,
      };
      try { state.svgEl.setPointerCapture(e.pointerId); } catch(_){}
    }

    function beginDragHandle(e, obj, idx, which, p) {
      cancelDeferredSelect();
      const pt = obj.path.points[idx];
      state.action = {
        kind: "drag-handle",
        id: obj.id,
        idx,
        which,
        startX: p.x,
        startY: p.y,
        startH1x: pt.h1x, startH1y: pt.h1y,
        startH2x: pt.h2x, startH2y: pt.h2y,
        pointerId: e.pointerId,
      };
      try { state.svgEl.setPointerCapture(e.pointerId); } catch(_){}
    }

    function applyMove() {
      state.rafPending = false;
      const a = state.action;
      const ev = state.lastMove;
      if (!a || !ev) return;

      const svg = state.svgEl;
      const p = getSvgPoint(svg, ev.clientX, ev.clientY);
      const dx = p.x - a.startX;
      const dy = p.y - a.startY;

      const obj = getObject(a.id);
      if (!obj) return;

      if (a.kind === "drag-object") {
        obj.x = a.startObjX + dx;
        obj.y = a.startObjY + dy;
      } else if (a.kind === "drag-anchor") {
        const pt = obj.path.points[a.idx];
        if (!pt) return;
        pt.ax = a.startAx + dx;
        pt.ay = a.startAy + dy;
        pt.h1x = a.startH1x + dx; pt.h1y = a.startH1y + dy;
        pt.h2x = a.startH2x + dx; pt.h2y = a.startH2y + dy;
      } else if (a.kind === "drag-handle") {
        const pt = obj.path.points[a.idx];
        if (!pt) return;
        if (a.which === "h1") {
          pt.h1x = a.startH1x + dx;
          pt.h1y = a.startH1y + dy;
        } else {
          pt.h2x = a.startH2x + dx;
          pt.h2y = a.startH2y + dy;
        }
      }

      render();
    }

    function hitTestPath(x, y) {
      const order = [];
      if (state.selectedId) order.push(state.selectedId);
      for (const o of state.objects) if (o.id !== state.selectedId) order.push(o.id);

      const r2 = state.hitRadius * state.hitRadius;

      for (const id of order) {
        const obj = getObject(id);
        if (!obj) continue;

        const pts = obj.path.points;
        if (!pts || pts.length < 2) continue;

        const lx = x - obj.x;
        const ly = y - obj.y;

        let best = Infinity;
        for (let i=1;i<pts.length;i++){
          const p0 = { x: pts[i-1].ax,  y: pts[i-1].ay  };
          const p1 = { x: pts[i-1].h2x, y: pts[i-1].h2y };
          const p2 = { x: pts[i].h1x,   y: pts[i].h1y   };
          const p3 = { x: pts[i].ax,    y: pts[i].ay    };
          const d2 = approxCubicDistanceSq(p0,p1,p2,p3,lx,ly);
          if (d2 < best) best = d2;
        }

        if (best <= r2) return obj.id;
      }
      return null;
    }

    // ----------------------------------------------------------
    // Keys
    // ----------------------------------------------------------
    function onKeyDown(e) {
      if (state.editing) return;
      if (!state.selectedId) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const ae = document.activeElement;
        const tag = (ae && ae.tagName || "").toLowerCase();
        const isEdit = ae && (ae.isContentEditable || tag === "input" || tag === "textarea");
        if (isEdit) return;

        deleteById(state.selectedId);
        e.preventDefault();
      }
    }
	
// ----------------------------------------------------------
// Toolbar Bridge (TextToolbarBridge + TextToolbarTools)
// ----------------------------------------------------------
function _getObjGroupEl(id) {
  try {
    return state.objectsLayer && state.objectsLayer.querySelector(`[data-obj-id="${CSS.escape(id)}"]`);
  } catch (_) {
    return null;
  }
}

function _getAnchorRectForSelected() {
  const id = state.selectedId;
  if (!id) return null;

  const g = _getObjGroupEl(id);
  if (!g || !g.getBoundingClientRect) return null;

  // ✅ screen rect stable (inclut texte + path + rotation)
  const r = g.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height
  };
}

function _applyToolbarAction(obj, action) {
  if (!obj || !action) return;

  switch (action.type) {
    case "font":
      obj.textFamily = String(action.value || "Arial, sans-serif");
      break;

    case "size":
      obj.textSize = Math.max(4, Math.min(220, Number(action.value || obj.textSize || 22)));
      break;

    case "color":
      obj.textFill = String(action.value || obj.textFill || "#111827");
      break;

    case "bold": {
      const cur = String(obj.textWeight || "600");
      obj.textWeight = (cur === "700" || cur === "800" || cur === "900") ? "400" : "700";
      break;
    }

    case "italic":
      obj.textStyle = (String(obj.textStyle || "normal") === "italic") ? "normal" : "italic";
      break;

    case "underline":
      obj.textUnderline = !obj.textUnderline;
      break;

	 case "align":
	  obj.align = String(action.value || "left");
	  normalizeAlign(obj);
	  break;

    case "transform":
      // (optionnel) stocké pour toi; si tu veux l'appliquer au texte, fais-le côté rendu/édition.
      obj.textTransform = String(action.value || "none");
      break;

    default:
      break;
  }
}

function attachTextToolbarBridge({ hostEl } = {}) {
  if (!global.TextToolbarBridge || !global.TextToolbarBridge.createTextToolbarBridge) {
    console.warn("[TPATH] TextToolbarBridge manquant (charge text_toolbar_bridge.js)");
    return null;
  }

  const toolbarHostEl = hostEl || state.rootEl;

  // ✅ 1) Si déjà attachée et encore dans le DOM => on réutilise
  try {
    if (state._toolbarBridge && state._toolbarBridge.el && document.contains(state._toolbarBridge.el)) {
      state._toolbarBridge.update && state._toolbarBridge.update();
      return state._toolbarBridge;
    }
  } catch (_) {}

  // ✅ 2) Juste avant de recréer : cleanup si une ancienne instance traîne
  try { state._toolbarBridge && state._toolbarBridge.destroy && state._toolbarBridge.destroy(); } catch (_) {}
  state._toolbarBridge = null;

  const textHost = {
    getContext: () => {
      const id = state.selectedId;
      const obj = id ? getObject(id) : null;
      if (!obj) return { isVisible: false };

      const anchorRect = _getAnchorRectForSelected();
      const hostRect = (toolbarHostEl && toolbarHostEl.getBoundingClientRect) ? toolbarHostEl.getBoundingClientRect() : null;

      return {
        isVisible: true,
        anchorRect,
        hostRect,

        fonts: (state.fonts || []),
        currentFontKey: obj.textFamily || "helv",
        fontKey: obj.textFamily || "helv",

        size: obj.textSize || 22,
        color: obj.textFill || "#111827",
        bold: String(obj.textWeight || "600") !== "400",
        italic: String(obj.textStyle || "normal") === "italic",
        underline: !!obj.textUnderline,

        // ✅ important : align cohérent avec ton render
        align: obj.align || "left",
        transform: obj.textTransform || "none",
      };
    },

    onAction: (action) => {
      const obj = getSelected();
      if (!obj) return;

      _applyToolbarAction(obj, action);

      render(); // reposition + bbox + handles

      try { state._toolbarBridge && state._toolbarBridge.update && state._toolbarBridge.update(); } catch (_) {}
    }
  };

  // ✅ 3) Recréation propre
  const bridge = global.TextToolbarBridge.createTextToolbarBridge({
    hostEl: toolbarHostEl,
    textHost
  });

  state._toolbarBridge = bridge;

  try { bridge && bridge.update && bridge.update(); } catch (_) {}
  return bridge;
}

	

    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    function attach() { ensureSVG(); render(); return api; }

    function detach() {
      cancelDeferredSelect();

      if (state.toolbar) {
        try { state.toolbar.destroy && state.toolbar.destroy(); } catch (_) {}
        state.toolbar = null;
      }

      if (state.svgEl) {
        try { state.svgEl.removeEventListener("pointerdown", onPointerDown); } catch(_){}
        try { state.svgEl.removeEventListener("pointermove", onPointerMove); } catch(_){}
        try { state.svgEl.removeEventListener("pointerup", onPointerUp); } catch(_){}
        try { state.svgEl.removeEventListener("pointercancel", onPointerUp); } catch(_){}
        try { state.svgEl.removeEventListener("dblclick", onDoubleClick); } catch(_){}
      }
      window.removeEventListener("keydown", onKeyDown);

      if (state.editing) exitTextEdit(false);

      state.action = null;
      state.selectedId = null;
      render();
      return api;
    }

    function insertTextPath(partial) { insertPath(partial); render(); }

    function setupSandbox() {
      const root = document.querySelector("#pageOverlay");
      if (!root) throw new Error("setupSandbox: #pageOverlay not found");
      const ctrl = createTextPathController({ rootEl: root });
      ctrl.attach();
      global.__textPathCtrl = ctrl;
      return ctrl;
    }

    const api = {
      attach,
      detach,
      render,
      insertTextPath,
      select,
      delete: deleteById,
      setupSandbox,
      _state: state,
	  attachTextToolbarBridge,
    };

    return api;
  }

  global.createTextPathController = createTextPathController;

})(window);

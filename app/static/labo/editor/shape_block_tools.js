/* app/static/labo/editor/shape_block_tools.js
 * Bloc Shapes avancé (LABO overlay) — sans dépendances externes
 *
 * FIXES V1.0.2b
 * ✅ setupSandbox() bien exposée (corrige: ctrl.setupSandbox is not a function)
 * ✅ setupSandbox() n'écrase plus le paramètre onChange (évite erreurs)
 * ✅ Drag / resize / rotate conservés
 * ✅ Color picker HSV Google-like (sv + hue + hex + pipette + transparent + recents)
 * ✅ FIX CRITIQUE: popover séparé du chip => plus de stdWrap null + fill/stroke OK
 * ✅ Fill: transparent => fill OFF, couleur => fill ON
 * ✅ Stroke: transparent => stroke OFF, couleur => stroke ON
 * ✅ Circle / Ellipse distinctes + circle reste rond (w=h)
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function round(n, p = 2) {
    const m = Math.pow(10, p);
    return Math.round(n * m) / m;
  }
  function isTextEditingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }
  function parseHexColor(s) {
    if (!s) return null;
    let v = String(s).trim();
    if (v.toLowerCase() === "transparent") return "transparent";
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#([0-9a-fA-F]{6})$/.test(v)) return v.toUpperCase();
    return null;
  }
  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }
  function rotateVec(dx, dy, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function invRotateVec(dx, dy, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }
  function svgEl(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }
  function ensurePagesDraft(draft, pageIndex) {
    if (!draft.pages) draft.pages = [];
    while (draft.pages.length <= pageIndex) draft.pages.push({ objects: [] });
    if (!draft.pages[pageIndex]) draft.pages[pageIndex] = { objects: [] };
    if (!draft.pages[pageIndex].objects) draft.pages[pageIndex].objects = [];
    return draft.pages[pageIndex];
  }
  function getObjects(draft, pageIndex) {
    const page = ensurePagesDraft(draft, pageIndex);
    return page.objects;
  }
  function getObjById(draft, pageIndex, id) {
    const objs = getObjects(draft, pageIndex);
    return objs.find((o) => o && o.id === id) || null;
  }
  function removeObjById(draft, pageIndex, id) {
    const page = ensurePagesDraft(draft, pageIndex);
    const idx = page.objects.findIndex((o) => o && o.id === id);
    if (idx >= 0) page.objects.splice(idx, 1);
    return idx >= 0;
  }

  // ---------------------------------------------------------------------------
  // Color helpers (HSV picker)
  // ---------------------------------------------------------------------------
  function rgbToHex(r, g, b) {
    const to = (x) => x.toString(16).padStart(2, "0").toUpperCase();
    return `#${to(clamp(Math.round(r), 0, 255))}${to(clamp(Math.round(g), 0, 255))}${to(clamp(Math.round(b), 0, 255))}`;
  }
  function hexToRgb(hex) {
    const v = parseHexColor(hex);
    if (!v || v === "transparent") return null;
    const m = /^#([0-9A-F]{6})$/.exec(v);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
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
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  function defaultShapeObject(kind) {
    const base = {
      id: uid("shape"),
      type: "shape",
      shape: kind, // rect | circle | ellipse | line | triangle | arrow
      x: 100,
      y: 100,
      w: 160,
      h: 110,
      rotation: 0,
      opacity: 1,
      stroke: { enabled: true, color: "#111827", width: 2 },
      fill: { enabled: false, color: "#60A5FA" },
      shadow: { enabled: false, x: 2, y: 3, blur: 8, opacity: 0.25 },
      radius: 14
    };

    if (kind === "line") {
      base.w = 240;
      base.h = 0;
      base.fill.enabled = false;
      base.radius = 0;
    } else if (kind === "arrow") {
      base.w = 260;
      base.h = 0;
      base.fill.enabled = false;
      base.radius = 0;
    } else if (kind === "ellipse") {
      base.w = 190;
      base.h = 120;
      base.radius = 0;
    } else if (kind === "circle") {
      base.w = 140;
      base.h = 140;
      base.radius = 0;
    } else if (kind === "triangle") {
      base.w = 180;
      base.h = 160;
      base.radius = 0;
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Controller
  // ---------------------------------------------------------------------------
  function createShapeBlockController({ overlayEl, draft, pageIndex, onChange }) {
    if (!overlayEl) throw new Error("createShapeBlockController: overlayEl requis");
    if (!draft) throw new Error("createShapeBlockController: draft requis");
    if (typeof pageIndex !== "number") throw new Error("createShapeBlockController: pageIndex requis");

    // onChange local (évite de réassigner le param)
    let onChangeCb = (typeof onChange === "function") ? onChange : null;

    const RECENTS = [];
    function pushRecent(hex) {
      const v = parseHexColor(hex);
      if (!v || v === "transparent") return;
      const idx = RECENTS.indexOf(v);
      if (idx >= 0) RECENTS.splice(idx, 1);
      RECENTS.unshift(v);
      if (RECENTS.length > 12) RECENTS.length = 12;
    }

    const state = {
      attached: false,
      selectedId: null,
      hoverId: null,
      elById: new Map(),

      action: null,
      lastMoveEv: null,
      rafPending: false,

      toolbarEl: null,
      toolbarOpenPanel: null,
	  
	   colorPopCleanups: [],



      onOverlayPointerDown: null,
      onOverlayPointerMove: null,
      onOverlayPointerUp: null,
      onKeyDown: null,
      onDocPointerDownCapture: null
    };

    // -------------------------------------------------------------------------
    // CSS injection
    // -------------------------------------------------------------------------
    function injectCssOnce() {
      const ID = "shape_block_tools_css_v102b";
      if (document.getElementById(ID)) return;

      const style = document.createElement("style");
      style.id = ID;
      style.textContent = `
.anno-object.shape-object{
  position:absolute;
  box-sizing:border-box;
  user-select:none;
  touch-action:none;
  transform-origin:50% 50%;
}
.anno-object.shape-object .shape-svg{
  width:100%;
  height:100%;
  display:block;
  pointer-events:none;
}
.anno-object.shape-object::after{
  content:"";
  position:absolute;
  inset:-2px;
  border-radius:6px;
  pointer-events:none;
  opacity:0;
}
.anno-object.shape-object.is-hover::after{
  opacity:1;
  border:2px dashed rgba(37,99,235,0.9);
}
.anno-object.shape-object.is-selected::after{
  opacity:1;
  border:2px solid rgba(37,99,235,0.95);
}
.shape-handle{
  position:absolute;
  width:10px;height:10px;
  background:#fff;
  border:2px solid rgba(37,99,235,0.95);
  border-radius:3px;
  box-sizing:border-box;
  z-index:5;
  touch-action:none;
}
.shape-handle[data-h="n"]{top:-6px;left:50%;transform:translateX(-50%);cursor:ns-resize;}
.shape-handle[data-h="s"]{bottom:-6px;left:50%;transform:translateX(-50%);cursor:ns-resize;}
.shape-handle[data-h="e"]{right:-6px;top:50%;transform:translateY(-50%);cursor:ew-resize;}
.shape-handle[data-h="w"]{left:-6px;top:50%;transform:translateY(-50%);cursor:ew-resize;}
.shape-handle[data-h="ne"]{right:-6px;top:-6px;cursor:nesw-resize;}
.shape-handle[data-h="nw"]{left:-6px;top:-6px;cursor:nwse-resize;}
.shape-handle[data-h="se"]{right:-6px;bottom:-6px;cursor:nwse-resize;}
.shape-handle[data-h="sw"]{left:-6px;bottom:-6px;cursor:nesw-resize;}

.shape-rot-wrap{
  position:absolute;
  left:50%;
  top:-34px;
  transform:translateX(-50%);
  width:28px;height:28px;
  display:flex;align-items:center;justify-content:center;
  z-index:6;
  touch-action:none;
}
.shape-rot-line{
  position:absolute;left:50%;top:24px;transform:translateX(-50%);
  width:2px;height:12px;background:rgba(37,99,235,0.95);
  border-radius:2px;pointer-events:none;
}
.shape-rot-handle{
  width:12px;height:12px;background:#fff;
  border:2px solid rgba(37,99,235,0.95);
  border-radius:999px;box-sizing:border-box;
  cursor:grab;
}
.shape-rot-handle:active{cursor:grabbing;}

.shape-toolbar{
  position:fixed; /* ✅ au lieu de absolute */
  z-index:10000;
  display:none;align-items:center;gap:8px;
  padding:8px 10px;border-radius:12px;
  background:rgba(255,255,255,0.96);
  border:1px solid rgba(17,24,39,0.12);
  box-shadow:0 10px 26px rgba(0,0,0,0.10);
  backdrop-filter: blur(6px);
  max-width:min(820px,92vw);
}

.shape-toolbar.is-visible{display:flex;}
.shape-toolbar .tb-btn{
  width:34px;height:34px;border-radius:10px;
  border:1px solid rgba(17,24,39,0.12);
  background:#fff;display:inline-flex;
  align-items:center;justify-content:center;
  cursor:pointer;
}
.shape-toolbar .tb-btn:hover{
  border-color:rgba(37,99,235,0.35);
  box-shadow:0 6px 14px rgba(37,99,235,0.10);
}
.shape-toolbar .tb-btn.is-active{
  border-color:rgba(37,99,235,0.8);
  box-shadow:0 6px 14px rgba(37,99,235,0.18);
}
.shape-toolbar .tb-sep{width:1px;height:26px;background:rgba(17,24,39,0.12);margin:0 2px;}
.shape-toolbar .tb-panel{
  display:none;align-items:flex-start;gap:10px;
  padding:10px;border-radius:12px;
  border:1px solid rgba(17,24,39,0.12);
  background:#fff;
}
.shape-toolbar .tb-panel.is-open{display:flex;}

.tb-field{
  display:flex;
  flex-direction:column;
  gap:6px;
  font-size:12px;
  color:#111827;
  min-width:150px;
  position:relative; /* ✅ ancre .color-pop si sibling */
}
.tb-field label{color:rgba(17,24,39,0.72);font-size:11px;}
.tb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.tb-mini{width:64px;}
.tb-toggle{display:inline-flex;align-items:center;gap:6px;}
.tb-input,.tb-range{width:160px;}

.tb-chip{
  width:32px;height:32px;border-radius:10px;
  border:1px solid rgba(17,24,39,0.12);
  cursor:pointer;background:#fff;
  display:inline-flex;align-items:center;justify-content:center;
  position:relative;
}
.tb-chip .swatch{
  width:18px;height:18px;border-radius:6px;
  border:1px solid rgba(17,24,39,0.10);
  background: conic-gradient(#eee 0 25%, #fff 0 50%, #eee 0 75%, #fff 0) 0 / 10px 10px;
}
.tb-chip .swatch[data-solid="1"]{ background: var(--swatch, transparent); }

.color-pop{
  position:fixed; /* ✅ plus jamais tronqué par overflow des parents */
  top:0;left:0;
  z-index:100000; /* ✅ au-dessus */
  width:320px;padding:12px;border-radius:14px;
  border:1px solid rgba(17,24,39,0.12);
  background:#fff;box-shadow:0 12px 26px rgba(0,0,0,0.12);
  display:none;
}
.color-pop.is-open{display:block;}

.color-pop .row{display:flex;gap:10px;align-items:center;}
.color-pop .left{display:flex;flex-direction:column;gap:10px;flex:1;}
.color-pop .topbar{display:flex;gap:10px;align-items:center;justify-content:space-between;}
.color-pop .preview{
  width:22px;height:22px;border-radius:8px;
  border:1px solid rgba(17,24,39,0.12);
  background: conic-gradient(#eee 0 25%, #fff 0 50%, #eee 0 75%, #fff 0) 0 / 10px 10px;
}
.color-pop .preview[data-solid="1"]{ background: var(--swatch, transparent); }

.color-pop .sv{
  width:260px;height:160px;border-radius:12px;
  border:1px solid rgba(17,24,39,0.12);
  position:relative; overflow:hidden;
  touch-action:none;
}
.color-pop canvas{display:block;}
.color-pop .sv .cursor{
  position:absolute;width:12px;height:12px;border-radius:999px;
  border:2px solid #fff;
  box-shadow:0 2px 10px rgba(0,0,0,0.25);
  transform:translate(-6px,-6px);
  pointer-events:none;
}
.color-pop .hue{
  width:260px;height:14px;border-radius:999px;
  border:1px solid rgba(17,24,39,0.12);
  position:relative; overflow:hidden;
  touch-action:none;
}
.color-pop .hue .cursor{
  position:absolute;top:50%;
  width:12px;height:12px;border-radius:999px;
  border:2px solid #fff;
  box-shadow:0 2px 10px rgba(0,0,0,0.25);
  transform:translate(-6px,-50%);
  pointer-events:none;
}
.color-pop .hexrow{display:flex;gap:8px;align-items:center;}
.color-pop input.hex{
  flex:1;
  padding:8px 10px;border-radius:10px;
  border:1px solid rgba(17,24,39,0.12);outline:none;
}
.color-pop input.hex:focus{
  border-color:rgba(37,99,235,0.75);
  box-shadow:0 0 0 3px rgba(37,99,235,0.12);
}
.color-pop .btn{
  height:34px;padding:0 10px;border-radius:10px;
  border:1px solid rgba(17,24,39,0.12);
  background:#fff;cursor:pointer;
}
.color-pop .btn:hover{border-color:rgba(37,99,235,0.35);}
.color-pop .btn:disabled{opacity:.5;cursor:not-allowed;}

.color-pop .swatches{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;}
.color-pop .swatches button{
  width:22px;height:22px;border-radius:8px;
  border:1px solid rgba(17,24,39,0.12);
  cursor:pointer;background:#fff;padding:0;
}
.color-pop .swatches button:hover{box-shadow:0 8px 18px rgba(0,0,0,0.10);}

.color-pop .section-title{font-size:11px;color:rgba(17,24,39,0.62);margin-top:8px;margin-bottom:6px;}
`;
      document.head.appendChild(style);
    }

    // -------------------------------------------------------------------------
    // Toolbar UI
    // -------------------------------------------------------------------------
    const SWATCHES = [
      "#111827", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB", "#F3F4F6", "#FFFFFF",
      "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#22C55E", "#10B981", "#06B6D4", "#3B82F6",
      "#6366F1", "#8B5CF6", "#A855F7", "#EC4899", "#F43F5E", "#0EA5E9", "#14B8A6", "#84CC16"
    ];

    function iconSvg(name) {
      const common = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
      if (name === "stroke") return `<svg ${common}><path d="M4 20h16"/><path d="M7 16l10-10"/><path d="M8.5 7.5l8 8"/></svg>`;
      if (name === "fill") return `<svg ${common}><path d="M3 7h18"/><path d="M7 7v14h10V7"/><path d="M7 11h10"/></svg>`;
      if (name === "shadow") return `<svg ${common}><path d="M3 12a9 9 0 1 0 9-9"/><path d="M21 21l-6-6"/></svg>`;
      if (name === "opacity") return `<svg ${common}><path d="M12 3v18"/><path d="M3 12h18"/><path d="M7 7l10 10"/></svg>`;
      if (name === "radius") return `<svg ${common}><path d="M7 7h6a4 4 0 0 1 4 4v6"/></svg>`;
      if (name === "rotate") return `<svg ${common}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v7h-7"/></svg>`;
      if (name === "trash") return `<svg ${common}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 16h10l1-16"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
      if (name === "pipette") return `<svg ${common}><path d="M2 22l6-2 12-12-4-4L4 16l-2 6z"/><path d="M14 6l4 4"/></svg>`;
      return `<svg ${common}><circle cx="12" cy="12" r="9"/></svg>`;
    }

    function buildToolbar() {
      if (state.toolbarEl) return state.toolbarEl;

      const tb = document.createElement("div");
      tb.className = "shape-toolbar";
      tb.innerHTML = `
        <button class="tb-btn" data-panel="stroke" title="Bordure">${iconSvg("stroke")}</button>
        <button class="tb-btn" data-panel="fill" title="Remplissage">${iconSvg("fill")}</button>
        <button class="tb-btn" data-panel="shadow" title="Ombre">${iconSvg("shadow")}</button>
        <button class="tb-btn" data-panel="opacity" title="Opacité">${iconSvg("opacity")}</button>
        <button class="tb-btn" data-panel="radius" title="Arrondis">${iconSvg("radius")}</button>
        <button class="tb-btn" data-panel="rotate" title="Rotation">${iconSvg("rotate")}</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" data-action="delete" title="Supprimer">${iconSvg("trash")}</button>

        <div class="tb-panel" data-panelbox="stroke"></div>
        <div class="tb-panel" data-panelbox="fill"></div>
        <div class="tb-panel" data-panelbox="shadow"></div>
        <div class="tb-panel" data-panelbox="opacity"></div>
        <div class="tb-panel" data-panelbox="radius"></div>
        <div class="tb-panel" data-panelbox="rotate"></div>
      `;

      document.body.appendChild(tb);
      state.toolbarEl = tb;

      tb.querySelector('[data-panelbox="stroke"]').appendChild(buildStrokePanel());
      tb.querySelector('[data-panelbox="fill"]').appendChild(buildFillPanel());
      tb.querySelector('[data-panelbox="shadow"]').appendChild(buildShadowPanel());
      tb.querySelector('[data-panelbox="opacity"]').appendChild(buildOpacityPanel());
      tb.querySelector('[data-panelbox="radius"]').appendChild(buildRadiusPanel());
      tb.querySelector('[data-panelbox="rotate"]').appendChild(buildRotatePanel());

      tb.addEventListener("pointerdown", (e) => e.stopPropagation());

      tb.addEventListener("click", (e) => {
        const btn = e.target.closest(".tb-btn");
        if (!btn) return;

        const act = btn.getAttribute("data-action");
        const panel = btn.getAttribute("data-panel");

        if (act === "delete") {
          if (state.selectedId) api.delete(state.selectedId);
          return;
        }
        if (panel) togglePanel(panel);
      });

      return tb;
    }

    function togglePanel(name) {
      const tb = state.toolbarEl;
      if (!tb) return;

      const buttons = [...tb.querySelectorAll(".tb-btn[data-panel]")];
      const panels = [...tb.querySelectorAll(".tb-panel[data-panelbox]")];

      const willOpen = state.toolbarOpenPanel !== name;
      state.toolbarOpenPanel = willOpen ? name : null;

      buttons.forEach((b) => b.classList.toggle("is-active", willOpen && b.getAttribute("data-panel") === name));
      panels.forEach((p) => p.classList.toggle("is-open", willOpen && p.getAttribute("data-panelbox") === name));

      closeAllColorPops();
      refreshToolbarFromSelection();
    }

    function closeAllColorPops() {
      document.querySelectorAll(".color-pop.is-open").forEach((p) => p.classList.remove("is-open"));
    }

    function applySelectedStyleNow(throttled) {
      const o = getSelectedObj();
      if (!o) return;
      const el = state.elById.get(o.id);
      if (el) applyObjectToElement(o, el);
      positionToolbarUnderObject(o);
      commitChange(!!throttled);
    }

    // -------------------------------------------------------------------------
    // HSV Color Picker Field (FIXED: pop is sibling, queries are on pop)
    // -------------------------------------------------------------------------
    function buildColorPickerField(labelText, getColor, setColor) {
      const wrap = document.createElement("div");
      wrap.className = "tb-field";
      wrap.innerHTML = `<label>${labelText}</label>`;

      const row = document.createElement("div");
      row.className = "tb-row";

      // chip (just the small square)
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tb-chip";
      chip.innerHTML = `<span class="swatch"></span>`;

      const swatchEl = chip.querySelector(".swatch");

      // popover (sibling of chip, anchored by .tb-field position:relative)
      const pop = document.createElement("div");
      pop.className = "color-pop";
      pop.innerHTML = `
        <div class="topbar">
          <div class="row" style="gap:10px;">
            <div class="preview"></div>
            <button class="btn btn-transparent" type="button" title="Transparent">Transparent</button>
          </div>
          <button class="btn btn-pipette" type="button" title="Pipette">${iconSvg("pipette")}</button>
        </div>

        <div class="left">
          <div class="sv">
            <canvas class="svc" width="260" height="160"></canvas>
            <div class="cursor svcur"></div>
          </div>

          <div class="hue">
            <canvas class="huc" width="260" height="14"></canvas>
            <div class="cursor hucur"></div>
          </div>

          <div class="hexrow">
            <input class="hex" type="text" spellcheck="false" placeholder="#RRGGBB" />
            <button class="btn btn-ok" type="button">OK</button>
          </div>

          <div class="section-title">Couleurs standard</div>
          <div class="swatches std"></div>

          <div class="section-title">Récemment utilisé</div>
          <div class="swatches recent"></div>
        </div>
      `;
	  document.body.appendChild(pop);

      // ✅ all queries from pop (not chip)
      const preview = pop.querySelector(".preview");
      const svCanvas = pop.querySelector("canvas.svc");
      const huCanvas = pop.querySelector("canvas.huc");
      const svCur = pop.querySelector(".svcur");
      const huCur = pop.querySelector(".hucur");
      const hexInput = pop.querySelector("input.hex");
      const okBtn = pop.querySelector(".btn-ok");
      const transBtn = pop.querySelector(".btn-transparent");
      const pipBtn = pop.querySelector(".btn-pipette");
      const stdWrap = pop.querySelector(".swatches.std");
      const recWrap = pop.querySelector(".swatches.recent");

      let hsv = { h: 210, s: 0.6, v: 1.0 };

      function setChipSwatch(c) {
        if (c && c !== "transparent") {
          swatchEl.setAttribute("data-solid", "1");
          swatchEl.style.setProperty("--swatch", c);
          preview.setAttribute("data-solid", "1");
          preview.style.setProperty("--swatch", c);
        } else {
          swatchEl.removeAttribute("data-solid");
          swatchEl.style.removeProperty("--swatch");
          preview.removeAttribute("data-solid");
          preview.style.removeProperty("--swatch");
        }
      }

      function drawHue() {
        const ctx = huCanvas.getContext("2d");
        const w = huCanvas.width, h = huCanvas.height;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 360; i += 60) {
          const rgb = hsvToRgb(i, 1, 1);
          grad.addColorStop(i / 360, rgbToHex(rgb.r, rgb.g, rgb.b));
        }
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      function drawSV() {
        const ctx = svCanvas.getContext("2d");
        const w = svCanvas.width, h = svCanvas.height;

        const rgb = hsvToRgb(hsv.h, 1, 1);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = rgbToHex(rgb.r, rgb.g, rgb.b);
        ctx.fillRect(0, 0, w, h);

        const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
        whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, w, h);

        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, "rgba(0,0,0,0)");
        blackGrad.addColorStop(1, "rgba(0,0,0,1)");
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);
      }

      function updateCursors() {
        const svW = svCanvas.width, svH = svCanvas.height;
        svCur.style.left = `${hsv.s * svW}px`;
        svCur.style.top = `${(1 - hsv.v) * svH}px`;

        const huW = huCanvas.width;
        huCur.style.left = `${(hsv.h / 360) * huW}px`;
      }

      function currentHexFromHSV() {
        const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
        return rgbToHex(rgb.r, rgb.g, rgb.b);
      }

      function refreshRecents() {
        recWrap.innerHTML = "";
        RECENTS.forEach((c) => {
          const b = document.createElement("button");
          b.type = "button";
          b.title = c;
          b.style.background = c;
          b.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            applyHex(c, true);
          });
          recWrap.appendChild(b);
        });
      }

      function applyHex(hex, fromUser) {
        const v = parseHexColor(hex);
        if (!v) return;

        if (v === "transparent") {
          setChipSwatch("transparent");
          setColor("transparent");
          applySelectedStyleNow(false);
          return;
        }

        const rgb = hexToRgb(v);
        if (!rgb) return;

        hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

        drawHue();
        drawSV();
        updateCursors();

        setChipSwatch(v);
        hexInput.value = v;

        if (fromUser) pushRecent(v);

        setColor(v);
        applySelectedStyleNow(false);
        refreshRecents();
      }
	  
	  function placePop() {
	  // chip rect in viewport coordinates
	  const r = chip.getBoundingClientRect();

	  // ensure visible to measure
	  pop.style.left = "0px";
	  pop.style.top = "0px";

	  // mesure réelle du pop
	  const popRect = pop.getBoundingClientRect();
	  const pw = popRect.width || 320;
	  const ph = popRect.height || 240;

	  const margin = 10;

	  // position préférée : sous le chip, aligné gauche
	  let left = r.left;
	  let top = r.bottom + 8;

	  // si ça déborde en bas => on met au-dessus
	  if (top + ph > window.innerHeight - margin) {
		top = r.top - ph - 8;
	  }

	  // si ça déborde en haut malgré tout => clamp
	  top = clamp(top, margin, window.innerHeight - ph - margin);

	  // clamp horizontal
	  if (left + pw > window.innerWidth - margin) {
		left = window.innerWidth - pw - margin;
	  }
	  left = clamp(left, margin, window.innerWidth - pw - margin);

	  pop.style.left = `${Math.round(left)}px`;
	  pop.style.top  = `${Math.round(top)}px`;
	}


		function openPop() {
		  const isOpen = pop.classList.contains("is-open");
		  closeAllColorPops();
		  pop.classList.toggle("is-open", !isOpen);

		  // ✅ si on vient de fermer, on stop ici (pas de reposition inutile)
		  if (isOpen) return;

		  // ✅ seulement à l'ouverture
		  requestAnimationFrame(placePop);

		  const c = getColor();
		  if (c === "transparent") {
			setChipSwatch("transparent");
			hexInput.value = "#FFFFFF";
		  } else if (c) {
			applyHex(c, false);
		  } else {
			applyHex("#60A5FA", false);
		  }

		  drawHue();
		  drawSV();
		  updateCursors();
		  refreshRecents();

		  pipBtn.disabled = !window.EyeDropper;
		}

		function onWinRelayout() {
		  if (!pop.classList.contains("is-open")) return;
		  placePop();
		}
		window.addEventListener("scroll", onWinRelayout, true);
		window.addEventListener("resize", onWinRelayout, true);
		
		// ✅ cleanup pour éviter fuites (pop + listeners)
		state.colorPopCleanups.push(() => {
		  try { window.removeEventListener("scroll", onWinRelayout, true); } catch (_){}
		  try { window.removeEventListener("resize", onWinRelayout, true); } catch (_){}
		  try { pop.remove(); } catch (_){}
		});



      function refresh() {
        const c = getColor();
        setChipSwatch(c);
        if (c && c !== "transparent") hexInput.value = c;
        pipBtn.disabled = !window.EyeDropper;
      }

      // std swatches
      stdWrap.innerHTML = "";
      SWATCHES.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.title = c;
        b.style.background = c;
        b.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          applyHex(c, true);
        });
        stdWrap.appendChild(b);
      });

      // open pop
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPop();
        refresh();
      });

      transBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        applyHex("transparent", true);
      });

      pipBtn.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!window.EyeDropper) return;
        try {
          const ed = new window.EyeDropper();
          const res = await ed.open();
          const hex = parseHexColor(res && (res.sRGBHex || res.srgbHex));
          if (hex) applyHex(hex, true);
        } catch (_) {}
      });

      okBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const v = parseHexColor(hexInput.value);
        if (!v) return;
        applyHex(v, true);
      });

      hexInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          okBtn.click();
        }
      });

      function svFromEvent(ev) {
        const r = svCanvas.getBoundingClientRect();
        const x = clamp(ev.clientX - r.left, 0, r.width);
        const y = clamp(ev.clientY - r.top, 0, r.height);
        hsv.s = clamp(x / r.width, 0, 1);
        hsv.v = clamp(1 - (y / r.height), 0, 1);
      }

      function onSVDown(ev) {
        ev.preventDefault(); ev.stopPropagation();
        svFromEvent(ev);
        drawSV();
        updateCursors();
        const hex = currentHexFromHSV();
        setChipSwatch(hex);
        hexInput.value = hex;
        pushRecent(hex);
        setColor(hex);
        applySelectedStyleNow(false);
        refreshRecents();

        const move = (e) => onSVMove(e);
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
      }

      function onSVMove(ev) {
        svFromEvent(ev);
        drawSV();
        updateCursors();
        const hex = currentHexFromHSV();
        setChipSwatch(hex);
        hexInput.value = hex;
        setColor(hex);
        applySelectedStyleNow(true);
      }

      svCanvas.addEventListener("pointerdown", onSVDown);

      function hueFromEvent(ev) {
        const r = huCanvas.getBoundingClientRect();
        const x = clamp(ev.clientX - r.left, 0, r.width);
        hsv.h = clamp((x / r.width) * 360, 0, 360);
      }

      function onHueDown(ev) {
        ev.preventDefault(); ev.stopPropagation();
        hueFromEvent(ev);
        drawHue();
        drawSV();
        updateCursors();
        const hex = currentHexFromHSV();
        setChipSwatch(hex);
        hexInput.value = hex;
        pushRecent(hex);
        setColor(hex);
        applySelectedStyleNow(false);
        refreshRecents();

        const move = (e) => onHueMove(e);
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
      }

      function onHueMove(ev) {
        hueFromEvent(ev);
        drawHue();
        drawSV();
        updateCursors();
        const hex = currentHexFromHSV();
        setChipSwatch(hex);
        hexInput.value = hex;
        setColor(hex);
        applySelectedStyleNow(true);
      }

      huCanvas.addEventListener("pointerdown", onHueDown);

      // ✅ close outside (chip OR pop)
      document.addEventListener("pointerdown", (e) => {
        if (chip.contains(e.target)) return;
        if (pop.contains(e.target)) return;
        pop.classList.remove("is-open");
      }, true);

      row.appendChild(chip);
      wrap.appendChild(row);


      wrap._refresh = refresh;
      return wrap;
    }

    // -------------------------------------------------------------------------
    // Panels
    // -------------------------------------------------------------------------
    function buildStrokePanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const enabledWrap = document.createElement("div");
      enabledWrap.className = "tb-field";
      enabledWrap.innerHTML = `
        <label>Bordure</label>
        <div class="tb-toggle">
          <input type="checkbox" class="stroke-enabled" />
          <span>Activée</span>
        </div>
      `;

      const widthWrap = document.createElement("div");
      widthWrap.className = "tb-field";
      widthWrap.innerHTML = `
        <label>Épaisseur</label>
        <input class="tb-input stroke-width" type="number" min="0" max="200" step="1" />
      `;

      const colorWrap = buildColorPickerField(
        "Couleur",
        () => {
          const o = getSelectedObj();
          if (!o) return "#111827";
          if (!o.stroke?.enabled) return "transparent";
          return o.stroke?.color || "#111827";
        },
        (c) => {
          const o = getSelectedObj();
          if (!o) return;
          if (c === "transparent") {
            o.stroke.enabled = false;
            o.stroke.color = o.stroke.color || "#111827";
          } else {
            o.stroke.enabled = true;
            o.stroke.color = c;
          }
        }
      );

      enabledWrap.querySelector(".stroke-enabled").addEventListener("change", (e) => {
        const o = getSelectedObj();
        if (!o) return;
        o.stroke.enabled = !!e.target.checked;
        applySelectedStyleNow(false);
      });

      widthWrap.querySelector(".stroke-width").addEventListener("input", (e) => {
        const o = getSelectedObj();
        if (!o) return;
        const v = clamp(Number(e.target.value || 0), 0, 200);
        o.stroke.width = v;
        if (v > 0) o.stroke.enabled = true;
        applySelectedStyleNow(true);
      });

      box.appendChild(enabledWrap);
      box.appendChild(widthWrap);
      box.appendChild(colorWrap);

      box._refresh = () => {
        const o = getSelectedObj();
        if (!o) return;
        enabledWrap.querySelector(".stroke-enabled").checked = !!o.stroke.enabled;
        widthWrap.querySelector(".stroke-width").value = String(o.stroke.width ?? 2);
        colorWrap._refresh && colorWrap._refresh();
      };

      return box;
    }

    function buildFillPanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const colorWrap = buildColorPickerField(
        "Remplissage",
        () => {
          const o = getSelectedObj();
          if (!o) return "#60A5FA";
          if (!o.fill?.enabled) return "transparent";
          return o.fill?.color || "#60A5FA";
        },
        (c) => {
          const o = getSelectedObj();
          if (!o) return;
          if (c === "transparent") {
            o.fill.enabled = false;
            o.fill.color = o.fill.color || "#60A5FA";
          } else {
            o.fill.enabled = true;
            o.fill.color = c;
          }
        }
      );

      box.appendChild(colorWrap);

      box._refresh = () => {
        const o = getSelectedObj();
        if (!o) return;
        const noFill = (o.shape === "line" || o.shape === "arrow");
        box.style.display = noFill ? "none" : "";
        if (noFill) return;
        colorWrap._refresh && colorWrap._refresh();
      };

      return box;
    }

    function buildShadowPanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const enabledWrap = document.createElement("div");
      enabledWrap.className = "tb-field";
      enabledWrap.innerHTML = `
        <label>Ombre</label>
        <div class="tb-toggle">
          <input type="checkbox" class="sh-enabled" />
          <span>Activée</span>
        </div>
      `;

      const xWrap = document.createElement("div");
      xWrap.className = "tb-field";
      xWrap.innerHTML = `<label>X</label><input class="tb-input sh-x tb-mini" type="number" step="1" />`;

      const yWrap = document.createElement("div");
      yWrap.className = "tb-field";
      yWrap.innerHTML = `<label>Y</label><input class="tb-input sh-y tb-mini" type="number" step="1" />`;

      const blurWrap = document.createElement("div");
      blurWrap.className = "tb-field";
      blurWrap.innerHTML = `<label>Flou</label><input class="tb-input sh-blur tb-mini" type="number" min="0" step="1" />`;

      const opWrap = document.createElement("div");
      opWrap.className = "tb-field";
      opWrap.innerHTML = `<label>Opacité</label><input class="tb-range sh-op" type="range" min="0" max="1" step="0.01" />`;

      enabledWrap.querySelector(".sh-enabled").addEventListener("change", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.shadow.enabled = !!e.target.checked;
        applySelectedStyleNow(false);
      });
      xWrap.querySelector(".sh-x").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.shadow.x = clamp(Number(e.target.value || 0), -200, 200);
        applySelectedStyleNow(true);
      });
      yWrap.querySelector(".sh-y").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.shadow.y = clamp(Number(e.target.value || 0), -200, 200);
        applySelectedStyleNow(true);
      });
      blurWrap.querySelector(".sh-blur").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.shadow.blur = clamp(Number(e.target.value || 0), 0, 300);
        applySelectedStyleNow(true);
      });
      opWrap.querySelector(".sh-op").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.shadow.opacity = clamp(Number(e.target.value || 0), 0, 1);
        applySelectedStyleNow(true);
      });

      box.appendChild(enabledWrap);
      box.appendChild(xWrap);
      box.appendChild(yWrap);
      box.appendChild(blurWrap);
      box.appendChild(opWrap);

      box._refresh = () => {
        const o = getSelectedObj(); if (!o) return;
        enabledWrap.querySelector(".sh-enabled").checked = !!o.shadow.enabled;
        xWrap.querySelector(".sh-x").value = String(o.shadow.x ?? 2);
        yWrap.querySelector(".sh-y").value = String(o.shadow.y ?? 3);
        blurWrap.querySelector(".sh-blur").value = String(o.shadow.blur ?? 8);
        opWrap.querySelector(".sh-op").value = String(o.shadow.opacity ?? 0.25);
      };
      return box;
    }

    function buildOpacityPanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const opWrap = document.createElement("div");
      opWrap.className = "tb-field";
      opWrap.innerHTML = `<label>Opacité</label><input class="tb-range op" type="range" min="0" max="1" step="0.01" />`;

      opWrap.querySelector(".op").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.opacity = clamp(Number(e.target.value || 1), 0, 1);
        applySelectedStyleNow(true);
      });

      box.appendChild(opWrap);
      box._refresh = () => {
        const o = getSelectedObj(); if (!o) return;
        opWrap.querySelector(".op").value = String(o.opacity ?? 1);
      };
      return box;
    }

    function buildRadiusPanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const rWrap = document.createElement("div");
      rWrap.className = "tb-field";
      rWrap.innerHTML = `<label>Arrondis (rect)</label><input class="tb-range rad" type="range" min="0" max="80" step="1" />`;

      rWrap.querySelector(".rad").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.radius = clamp(Number(e.target.value || 0), 0, 200);
        applySelectedStyleNow(true);
      });

      box.appendChild(rWrap);

      box._refresh = () => {
        const o = getSelectedObj(); if (!o) return;
        const isRect = o.shape === "rect";
        box.style.display = isRect ? "" : "none";
        if (isRect) rWrap.querySelector(".rad").value = String(o.radius ?? 0);
      };
      return box;
    }

    function buildRotatePanel() {
      const box = document.createElement("div");
      box.className = "tb-row";

      const degWrap = document.createElement("div");
      degWrap.className = "tb-field";
      degWrap.innerHTML = `<label>Degrés</label><input class="tb-input rot tb-mini" type="number" step="1" />`;

      degWrap.querySelector(".rot").addEventListener("input", (e) => {
        const o = getSelectedObj(); if (!o) return;
        o.rotation = Number(e.target.value || 0);
        applySelectedStyleNow(true);
      });

      box.appendChild(degWrap);

      box._refresh = () => {
        const o = getSelectedObj(); if (!o) return;
        degWrap.querySelector(".rot").value = String(Math.round(o.rotation || 0));
      };
      return box;
    }

    function refreshToolbarFromSelection() {
      const tb = state.toolbarEl;
      if (!tb) return;
      tb.querySelectorAll("*").forEach((el) => {
        if (el && typeof el._refresh === "function") el._refresh();
      });
    }

    function showToolbarForSelection() {
      const tb = buildToolbar();
      const o = getSelectedObj();
      if (!tb || !o) return hideToolbar();
      tb.classList.add("is-visible");
      positionToolbarUnderObject(o);
      refreshToolbarFromSelection();
    }

    function hideToolbar() {
      if (!state.toolbarEl) return;
      state.toolbarEl.classList.remove("is-visible");
      state.toolbarOpenPanel = null;
      state.toolbarEl.querySelectorAll(".tb-panel").forEach((p) => p.classList.remove("is-open"));
      state.toolbarEl.querySelectorAll(".tb-btn.is-active").forEach((b) => b.classList.remove("is-active"));
      closeAllColorPops();
    }

  function positionToolbarUnderObject(o) {
  if (!state.toolbarEl) return;
  const el = state.elById.get(o.id);
  if (!el) return;

  const r = el.getBoundingClientRect();

  const padY = 10;
  const x = r.left + (r.width / 2);
  const y = r.bottom + padY;

  const tb = state.toolbarEl;
  tb.style.left = `${Math.round(x)}px`;
  tb.style.top  = `${Math.round(y)}px`;
  tb.style.transform = `translateX(-50%)`;

  // clamp viewport
  requestAnimationFrame(() => {
    const tbr = tb.getBoundingClientRect();
    const margin = 8;

    let dx = 0;
    if (tbr.left < margin) dx = margin - tbr.left;
    if (tbr.right > window.innerWidth - margin) dx = (window.innerWidth - margin) - tbr.right;

    let dy = 0;
    if (tbr.bottom > window.innerHeight - margin) dy = (window.innerHeight - margin) - tbr.bottom;
    if (tbr.top < margin) dy = margin - tbr.top;

    if (dx || dy) {
      const curLeft = parseFloat(tb.style.left || "0") || 0;
      const curTop  = parseFloat(tb.style.top  || "0") || 0;
      tb.style.left = `${Math.round(curLeft + dx)}px`;
      tb.style.top  = `${Math.round(curTop + dy)}px`;
    }
  });
}


    // -------------------------------------------------------------------------
    // Shape DOM
    // -------------------------------------------------------------------------
    function buildShapeElement(obj) {
      const el = document.createElement("div");
      el.className = "anno-object shape-object";
      el.dataset.objid = obj.id;
      el.dataset.pageindex = String(pageIndex);
      el.dataset.type = "shape";

      const svg = svgEl("svg");
      svg.classList.add("shape-svg");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");

      const defs = svgEl("defs");
      svg.appendChild(defs);

      const g = svgEl("g");
      g.setAttribute("data-role", "shape-g");
      svg.appendChild(g);

      el.appendChild(svg);

      const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
      handles.forEach((h) => {
        const hd = document.createElement("div");
        hd.className = "shape-handle";
        hd.dataset.handle = "resize";
        hd.setAttribute("data-h", h);
        hd.style.display = "none";
        el.appendChild(hd);
      });

      const rotWrap = document.createElement("div");
      rotWrap.className = "shape-rot-wrap";
      rotWrap.dataset.handle = "rotate";
      rotWrap.style.display = "none";

      const rotLine = document.createElement("div");
      rotLine.className = "shape-rot-line";
      const rot = document.createElement("div");
      rot.className = "shape-rot-handle";
      rot.dataset.handle = "rotate";

      rotWrap.appendChild(rotLine);
      rotWrap.appendChild(rot);
      el.appendChild(rotWrap);

      return el;
    }

    function setHandlesVisible(el, visible) {
      el.querySelectorAll(".shape-handle").forEach((h) => (h.style.display = visible ? "" : "none"));
      const rw = el.querySelector(".shape-rot-wrap");
      if (rw) rw.style.display = visible ? "" : "none";
    }

    function applyObjectToElement(obj, el) {
      const w = Math.max(1, Number(obj.w || 1));
      const h = Math.max(1, Number(obj.h || 1));

      if (obj.shape === "circle") {
        const m = Math.max(12, Math.max(w, h));
        obj.w = m;
        obj.h = m;
      }

      el.style.left = `${obj.x}px`;
      el.style.top = `${obj.y}px`;

      const isLine = (obj.shape === "line" || obj.shape === "arrow");
      const visualW = Math.max(16, Math.abs(obj.w || 16));
      const visualH = isLine ? 16 : Math.max(16, Math.abs(obj.h || 16));

      el.style.width = `${visualW}px`;
      el.style.height = `${visualH}px`;

      el.style.transform = `rotate(${Number(obj.rotation || 0)}deg)`;
      el.style.opacity = String(clamp(Number(obj.opacity ?? 1), 0, 1));

      if (obj.shadow && obj.shadow.enabled) {
        const so = clamp(Number(obj.shadow.opacity ?? 0.25), 0, 1);
        const sx = Number(obj.shadow.x ?? 2);
        const sy = Number(obj.shadow.y ?? 3);
        const sb = Number(obj.shadow.blur ?? 8);
        el.style.filter = `drop-shadow(${sx}px ${sy}px ${sb}px rgba(0,0,0,${so}))`;
      } else {
        el.style.filter = "none";
      }

      const svg = el.querySelector("svg.shape-svg");
      if (!svg) return;

      if (isLine) svg.setAttribute("viewBox", "0 0 100 20");
      else svg.setAttribute("viewBox", "0 0 100 100");

      const g = svg.querySelector('[data-role="shape-g"]');
      if (!g) return;
      while (g.firstChild) g.removeChild(g.firstChild);
	  
		const strokeColor = obj.stroke?.color || "#111827";
		const fillColor   = obj.fill?.color || "#60A5FA";
		const strokeWidth = clamp(Number(obj.stroke?.width ?? 2), 0, 200);

		// ✅ garde-fou: si une couleur = "transparent" dans le draft, on force OFF
		const strokeOn = !!(obj.stroke && obj.stroke.enabled) && strokeColor !== "transparent" && strokeWidth > 0;
		const fillOn   = !!(obj.fill && obj.fill.enabled) && fillColor !== "transparent";


      function applyPaint(node) {
        node.setAttribute("vector-effect", "non-scaling-stroke");
        node.setAttribute("stroke", strokeOn ? strokeColor : "none");
        node.setAttribute("stroke-width", strokeOn ? String(strokeWidth) : "0");
        node.setAttribute("fill", fillOn ? fillColor : "none");
      }

      if (obj.shape === "rect") {
        const r = svgEl("rect");
        const rad = clamp(Number(obj.radius ?? 0), 0, 60);
        r.setAttribute("x", "6");
        r.setAttribute("y", "6");
        r.setAttribute("width", "88");
        r.setAttribute("height", "88");
        r.setAttribute("rx", String(rad));
        r.setAttribute("ry", String(rad));
        applyPaint(r);
        g.appendChild(r);
      } else if (obj.shape === "ellipse") {
        const e = svgEl("ellipse");
        e.setAttribute("cx", "50");
        e.setAttribute("cy", "50");
        e.setAttribute("rx", "44");
        e.setAttribute("ry", "34");
        applyPaint(e);
        g.appendChild(e);
      } else if (obj.shape === "circle") {
        const c = svgEl("circle");
        c.setAttribute("cx", "50");
        c.setAttribute("cy", "50");
        c.setAttribute("r", "40");
        applyPaint(c);
        g.appendChild(c);
      } else if (obj.shape === "triangle") {
        const p = svgEl("polygon");
        p.setAttribute("points", "50,8 92,92 8,92");
        applyPaint(p);
        g.appendChild(p);
      } else if (obj.shape === "line") {
        const l = svgEl("line");
        l.setAttribute("x1", "6");
        l.setAttribute("y1", "10");
        l.setAttribute("x2", "94");
        l.setAttribute("y2", "10");
        l.setAttribute("fill", "none");
        l.setAttribute("stroke", strokeOn ? strokeColor : "none");
        l.setAttribute("stroke-width", String(strokeOn ? strokeWidth : 0));
        l.setAttribute("vector-effect", "non-scaling-stroke");
        g.appendChild(l);
      } else if (obj.shape === "arrow") {
        const defs = svg.querySelector("defs");
        const markerId = `arrow_${obj.id}`;
        let marker = defs.querySelector(`#${CSS.escape(markerId)}`);
        if (!marker) {
          marker = svgEl("marker");
          marker.setAttribute("id", markerId);
          marker.setAttribute("markerWidth", "10");
          marker.setAttribute("markerHeight", "10");
          marker.setAttribute("refX", "9");
          marker.setAttribute("refY", "5");
          marker.setAttribute("orient", "auto");
          const path = svgEl("path");
          path.setAttribute("d", "M0,0 L10,5 L0,10 z");
          marker.appendChild(path);
          defs.appendChild(marker);
        }
        const mp = marker.querySelector("path");
        if (mp) mp.setAttribute("fill", strokeOn ? strokeColor : "none");

        const l = svgEl("line");
        l.setAttribute("x1", "6");
        l.setAttribute("y1", "10");
        l.setAttribute("x2", "92");
        l.setAttribute("y2", "10");
        l.setAttribute("fill", "none");
        l.setAttribute("stroke", strokeOn ? strokeColor : "none");
        l.setAttribute("stroke-width", String(strokeOn ? strokeWidth : 0));
        l.setAttribute("vector-effect", "non-scaling-stroke");
        l.setAttribute("marker-end", strokeOn ? `url(#${markerId})` : "none");
        g.appendChild(l);
      }
    }

    // -------------------------------------------------------------------------
    // Render / Selection
    // -------------------------------------------------------------------------
    function renderAll() {
      const objs = getObjects(draft, pageIndex).filter((o) => o && o.type === "shape");
      const keep = new Set();

      for (const obj of objs) {
        keep.add(obj.id);
        let el = state.elById.get(obj.id);
        if (!el) {
          el = buildShapeElement(obj);
          overlayEl.appendChild(el);
          state.elById.set(obj.id, el);
        }
        applyObjectToElement(obj, el);
        el.classList.toggle("is-selected", obj.id === state.selectedId);
        el.classList.toggle("is-hover", obj.id === state.hoverId && obj.id !== state.selectedId);
        setHandlesVisible(el, obj.id === state.selectedId);
      }

      for (const [id, el] of state.elById.entries()) {
        if (!keep.has(id)) {
          el.remove();
          state.elById.delete(id);
        }
      }

      if (state.selectedId) {
        const o = getSelectedObj();
        if (o) showToolbarForSelection();
        else hideToolbar();
      } else {
        hideToolbar();
      }
    }

    function getSelectedObj() {
      if (!state.selectedId) return null;
      return getObjById(draft, pageIndex, state.selectedId);
    }

    function setSelected(id) {
      if (state.selectedId === id) return;
      state.selectedId = id || null;
      state.hoverId = null;
      renderAll();
      if (state.selectedId) showToolbarForSelection();
      else hideToolbar();
      commitChange(false);
    }

    function setHover(id) {
      if (state.hoverId === id) return;
      state.hoverId = id || null;
      for (const [oid, el] of state.elById.entries()) {
        el.classList.toggle("is-hover", oid === state.hoverId && oid !== state.selectedId);
      }
    }

    function deselect() {
      if (!state.selectedId) return;
      state.selectedId = null;
      state.hoverId = null;
      renderAll();
      hideToolbar();
      commitChange(false);
    }

    // -------------------------------------------------------------------------
    // Insert / Delete
    // -------------------------------------------------------------------------
    function fitIntoOverlay(obj) {
      const W = overlayEl.clientWidth || 1;
      const H = overlayEl.clientHeight || 1;
      const margin = 12;

      const isLine = obj.shape === "line" || obj.shape === "arrow";
      const maxW = W - margin * 2;
      const maxH = H - margin * 2;

      if (obj.w > maxW) obj.w = Math.max(40, maxW);
      if (!isLine && obj.h > maxH) obj.h = Math.max(40, maxH);

      if (obj.shape === "circle") {
        const m = Math.min(obj.w, obj.h);
        obj.w = m;
        obj.h = m;
      }

      const bw = Math.max(16, obj.w);
      const bh = Math.max(16, isLine ? 16 : obj.h);

      obj.x = Math.round((W - bw) / 2);
      obj.y = Math.round((H - bh) / 2);

      obj.x = clamp(obj.x, margin, W - bw - margin);
      obj.y = clamp(obj.y, margin, H - bh - margin);
    }

    function insertShape(kind, options) {
      const obj = defaultShapeObject(kind);
      if (options && typeof options === "object") {
        Object.assign(obj, options);
        if (options.stroke) obj.stroke = Object.assign(obj.stroke, options.stroke);
        if (options.fill) obj.fill = Object.assign(obj.fill, options.fill);
        if (options.shadow) obj.shadow = Object.assign(obj.shadow, options.shadow);
      }

      fitIntoOverlay(obj);

      const page = ensurePagesDraft(draft, pageIndex);
      page.objects.push(obj);

      renderAll();
      setSelected(obj.id);
      commitChange(false);
      return obj.id;
    }

    function deleteById(id) {
      if (!id) return false;
      const ok = removeObjById(draft, pageIndex, id);
      if (ok) {
        if (state.selectedId === id) state.selectedId = null;
        state.hoverId = null;
        renderAll();
        hideToolbar();
        commitChange(false);
      }
      return ok;
    }

    // -------------------------------------------------------------------------
    // Pointer interactions
    // -------------------------------------------------------------------------
    function getOverlayPoint(ev) {
      const r = overlayEl.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function findShapeElFromEventTarget(t) {
      if (!t) return null;
      const handle = t.closest?.("[data-h], .shape-rot-handle, .shape-rot-wrap, .shape-handle");
      if (handle) return handle.closest(".anno-object.shape-object") || null;
      return t.closest?.(".anno-object.shape-object") || null;
    }

    function handlePointerDown(ev) {
      if (ev.button !== 0) return;

      const shapeEl = findShapeElFromEventTarget(ev.target);

      if (!shapeEl) {
        deselect();
        return;
      }

      const id = shapeEl.dataset.objid;
      if (!id) return;

      if (state.selectedId !== id) setSelected(id);

      const obj = getObjById(draft, pageIndex, id);
      if (!obj) return;

      const pt = getOverlayPoint(ev);

      const handle = ev.target.closest?.(".shape-handle");
      const rotHandle = ev.target.closest?.(".shape-rot-handle, .shape-rot-wrap");

      if (handle) {
        const h = handle.getAttribute("data-h");
        startResize(ev, obj, h, pt);
        return;
      }
      if (rotHandle) {
        startRotate(ev, obj, pt);
        return;
      }
      startMove(ev, obj, pt);
    }

    function startMove(ev, obj, pt) {
      ev.preventDefault();
      ev.stopPropagation();
      overlayEl.setPointerCapture?.(ev.pointerId);

      state.action = {
        type: "move",
        id: obj.id,
        pointerId: ev.pointerId,
        startX: pt.x,
        startY: pt.y,
        origX: obj.x,
        origY: obj.y
      };
    }

    function startResize(ev, obj, handle, pt) {
      ev.preventDefault();
      ev.stopPropagation();
      overlayEl.setPointerCapture?.(ev.pointerId);

      const rot = degToRad(Number(obj.rotation || 0));
      const isLine = (obj.shape === "line" || obj.shape === "arrow");
      const allowAspectShapes = new Set(["rect", "ellipse", "triangle", "arrow", "circle"]);

      state.action = {
        type: "resize",
        id: obj.id,
        handle,
        pointerId: ev.pointerId,
        startX: pt.x,
        startY: pt.y,
        origX: obj.x,
        origY: obj.y,
        origW: obj.w,
        origH: obj.h,
        rotationRad: rot,
        aspect: (allowAspectShapes.has(obj.shape) && !isLine)
          ? (Math.max(1, obj.w) / Math.max(1, Math.max(1, obj.h || 1)))
          : null
      };
    }

    function startRotate(ev, obj, pt) {
      ev.preventDefault();
      ev.stopPropagation();
      overlayEl.setPointerCapture?.(ev.pointerId);

      const isLine = (obj.shape === "line" || obj.shape === "arrow");
      const cx = obj.x + (Math.max(16, obj.w) / 2);
      const cy = obj.y + (Math.max(16, isLine ? 16 : Math.max(1, obj.h)) / 2);

      const ang0 = Math.atan2(pt.y - cy, pt.x - cx);

      state.action = {
        type: "rotate",
        id: obj.id,
        pointerId: ev.pointerId,
        centerX: cx,
        centerY: cy,
        startAngle: ang0,
        origRotation: Number(obj.rotation || 0)
      };
    }

    function handlePointerMove(ev) {
      if (!state.action) {
        const shapeEl = findShapeElFromEventTarget(ev.target);
        if (shapeEl && shapeEl.dataset.objid) setHover(shapeEl.dataset.objid);
        else setHover(null);
        return;
      }
      if (state.action.pointerId !== ev.pointerId) return;
      state.lastMoveEv = ev;
      scheduleRafApply();
    }

    function handlePointerUp(ev) {
      if (!state.action) return;
      if (state.action.pointerId !== ev.pointerId) return;

      state.lastMoveEv = null;
      state.action = null;
      try { overlayEl.releasePointerCapture?.(ev.pointerId); } catch (_) {}

      const o = getSelectedObj();
      if (o) showToolbarForSelection();
      commitChange(false);
    }

    function scheduleRafApply() {
      if (state.rafPending) return;
      state.rafPending = true;
      requestAnimationFrame(applyActionRaf);
    }

    function clampObjToOverlay(obj) {
      const W = overlayEl.clientWidth || 1;
      const H = overlayEl.clientHeight || 1;
      const margin = 2;

      const isLine = obj.shape === "line" || obj.shape === "arrow";
      const bw = Math.max(16, Math.abs(obj.w || 16));
      const bh = Math.max(16, isLine ? 16 : Math.abs(obj.h || 16));

      obj.x = clamp(obj.x, margin, W - bw - margin);
      obj.y = clamp(obj.y, margin, H - bh - margin);
    }

    function applyActionRaf() {
      state.rafPending = false;
      if (!state.action || !state.lastMoveEv) return;

      const ev = state.lastMoveEv;
      const a = state.action;
      const obj = getObjById(draft, pageIndex, a.id);
      if (!obj) return;

      const pt = getOverlayPoint(ev);

      if (a.type === "move") {
        const dx = pt.x - a.startX;
        const dy = pt.y - a.startY;
        obj.x = Math.round(a.origX + dx);
        obj.y = Math.round(a.origY + dy);
        clampObjToOverlay(obj);
        applySelectedStyleNow(true);
        return;
      }

      if (a.type === "resize") {
        const dx = pt.x - a.startX;
        const dy = pt.y - a.startY;
        const local = invRotateVec(dx, dy, a.rotationRad);

        const minSize = 12;
        const isLine = obj.shape === "line" || obj.shape === "arrow";

        let w = a.origW || 1;
        let h = a.origH || 1;

        let dW = 0, dH = 0;
        const handle = a.handle;

        if (handle.includes("e")) dW = local.x;
        if (handle.includes("w")) dW = -local.x;
        if (handle.includes("s")) dH = local.y;
        if (handle.includes("n")) dH = -local.y;

        let newW = w + dW;
        let newH = h + dH;

        if (ev.shiftKey && a.aspect && !isLine) {
          const asp = a.aspect;
          if (Math.abs(dW) >= Math.abs(dH)) newH = newW / asp;
          else newW = newH * asp;
        }

        newW = Math.max(minSize, newW);
        if (isLine) newH = 0;
        else newH = Math.max(minSize, newH);

        if (obj.shape === "circle") {
          const m = Math.max(newW, newH);
          newW = m;
          newH = m;
        }

        const actualDW = newW - w;
        const actualDH = newH - h;

        let offLocalX = 0, offLocalY = 0;
        if (handle.includes("w")) offLocalX = -actualDW;
        if (handle.includes("n")) offLocalY = -actualDH;

        const offWorld = rotateVec(offLocalX, offLocalY, a.rotationRad);

        obj.x = Math.round(a.origX + offWorld.x);
        obj.y = Math.round(a.origY + offWorld.y);
        obj.w = Math.round(newW);
        obj.h = Math.round(newH);

        clampObjToOverlay(obj);
        applySelectedStyleNow(true);
        return;
      }

      if (a.type === "rotate") {
        const ang = Math.atan2(pt.y - a.centerY, pt.x - a.centerX);
        let deg = a.origRotation + ((ang - a.startAngle) * 180 / Math.PI);
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        obj.rotation = round(deg, 2);
        applySelectedStyleNow(true);
        return;
      }
    }

    // -------------------------------------------------------------------------
    // Keyboard delete
    // -------------------------------------------------------------------------
    function handleKeyDown(ev) {
      const key = ev.key;
      if (key !== "Delete" && key !== "Backspace") return;
      if (isTextEditingTarget(ev.target)) return;
      if (!state.selectedId) return;
      ev.preventDefault();
      ev.stopPropagation();
      deleteById(state.selectedId);
    }

    // -------------------------------------------------------------------------
    // Change hook
    // -------------------------------------------------------------------------
    let changeRaf = 0;
    function commitChange(throttled) {
      if (typeof onChangeCb !== "function") return;
      if (throttled) {
        if (changeRaf) return;
        changeRaf = requestAnimationFrame(() => {
          changeRaf = 0;
          try { onChangeCb(draft, pageIndex); } catch (_) {}
        });
      } else {
        try { onChangeCb(draft, pageIndex); } catch (_) {}
      }
    }

    // -------------------------------------------------------------------------
    // Attach/Detach
    // -------------------------------------------------------------------------
    function attach() {
      if (state.attached) return;
      injectCssOnce();
      buildToolbar();

      state.onOverlayPointerDown = (e) => handlePointerDown(e);
      state.onOverlayPointerMove = (e) => handlePointerMove(e);
      state.onOverlayPointerUp = (e) => handlePointerUp(e);

      overlayEl.addEventListener("pointerdown", state.onOverlayPointerDown);
      overlayEl.addEventListener("pointermove", state.onOverlayPointerMove);
      overlayEl.addEventListener("pointerup", state.onOverlayPointerUp);
      overlayEl.addEventListener("pointercancel", state.onOverlayPointerUp);

      state.onKeyDown = (e) => handleKeyDown(e);
      window.addEventListener("keydown", state.onKeyDown, true);

     state.onDocPointerDownCapture = (e) => {
		  if (!state.selectedId) return;

		  // ✅ clic dans le color picker => ne pas deselect
		  if (e.target && e.target.closest && e.target.closest(".color-pop")) return;

		  // ✅ clic dans l'overlay => ne pas deselect
		  if (overlayEl.contains(e.target)) return;

		  // ✅ clic dans la toolbar => ne pas deselect
		  if (state.toolbarEl && state.toolbarEl.contains(e.target)) return;

		  deselect();
		};

      document.addEventListener("pointerdown", state.onDocPointerDownCapture, true);

      state.attached = true;
      renderAll();
    }

    function detach() {
      if (!state.attached) return;

      overlayEl.removeEventListener("pointerdown", state.onOverlayPointerDown);
      overlayEl.removeEventListener("pointermove", state.onOverlayPointerMove);
      overlayEl.removeEventListener("pointerup", state.onOverlayPointerUp);
      overlayEl.removeEventListener("pointercancel", state.onOverlayPointerUp);

      window.removeEventListener("keydown", state.onKeyDown, true);
      document.removeEventListener("pointerdown", state.onDocPointerDownCapture, true);

      for (const el of state.elById.values()) el.remove();
      state.elById.clear();

      if (state.toolbarEl) state.toolbarEl.remove();
      state.toolbarEl = null;
	  
	  // ✅ cleanup popovers + listeners (évite accumulation)
		if (state.colorPopCleanups && state.colorPopCleanups.length) {
		  const cbs = state.colorPopCleanups.slice();
		  state.colorPopCleanups.length = 0;
		  for (const fn of cbs) {
			try { fn(); } catch (_) {}
		  }
		}


      state.selectedId = null;
      state.hoverId = null;
      state.action = null;
      state.lastMoveEv = null;

      state.attached = false;
    }

    // -------------------------------------------------------------------------
    // Sandbox helper (FIX)
    // -------------------------------------------------------------------------
    function setupSandbox({ sidebarEl, debugTextarea } = {}) {
      if (sidebarEl) {
        sidebarEl.querySelectorAll("[data-shape]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const kind = btn.getAttribute("data-shape");
            insertShape(kind);
          });
        });
      }

      if (debugTextarea) {
        const update = () => {
          try { debugTextarea.value = JSON.stringify(draft, null, 2); } catch (_) {}
        };

        const prev = onChangeCb;
        onChangeCb = () => {
          try { if (typeof prev === "function") prev(draft, pageIndex); } catch (_) {}
          update();
        };

        update();
      }
    }

    // -------------------------------------------------------------------------
    // API
    // -------------------------------------------------------------------------
    const api = {
      attach,
      detach,
      insertShape,
      select: (id) => setSelected(id),
      delete: (id) => deleteById(id),
      render: () => renderAll(),
      setupSandbox
    };

    return api;
  }

  global.createShapeBlockController = createShapeBlockController;

})(window);

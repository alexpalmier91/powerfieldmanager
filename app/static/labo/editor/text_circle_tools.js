/* app/static/labo/editor/text_circle_tools.js
 * Bloc "Texte sur cercle" (SVG <textPath>) — Sandbox autonome, sans dépendances.
 *
 * ✅ Toolbar (TextToolbarBridge) :
 * - La toolbar apparaît dès qu’un objet texte cercle est sélectionné (clic simple).
 * - En édition (double-clic), la toolbar agit sur le contentEditable “source”.
 * - API: attachTextToolbarBridge({ hostEl }) pour brancher la toolbar commune.
 *
 * API:
 *   window.createTextCircleController({ overlayEl, draft, pageIndex, fonts?, onChange? })
 * returns:
 *   { attach, detach, insertTextCircle, select, delete, render, setupSandbox,
 *     attachTextToolbarBridge, getSelected }
 */

(function (global) {
  "use strict";

  // ------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------
  function uid(prefix = "id") {
    return (
      prefix +
      "_" +
      Math.random().toString(16).slice(2) +
      "_" +
      Date.now().toString(16)
    );
  }

  function clamp(n, a, b) {
    n = Number(n);
    if (Number.isNaN(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  function deg2rad(d) {
    return (d * Math.PI) / 180;
  }

  function rad2deg(r) {
    return (r * 180) / Math.PI;
  }

  function snapAngle(deg, step) {
    return Math.round(deg / step) * step;
  }

  function px(n) {
    return `${Math.round(n)}px`;
  }
  
  // --- mesure texte (px) via canvas ---
let __tcMeasureCanvas = null;
function measureTextPx(text, font) {
  const t = String(text || "");
  if (!__tcMeasureCanvas) __tcMeasureCanvas = document.createElement("canvas");
  const ctx = __tcMeasureCanvas.getContext("2d");

  const f = font || {};
  const size = Number(f.size || 26);
  const weight = String(f.weight || 400);
  const style = String(f.style || "normal");
  const family = String(f.family || "Arial");

  ctx.font = `${style} ${weight} ${size}px ${family}`;
  let w = ctx.measureText(t).width || 0;

  // letterSpacing approx : (n-1)*ls
  const ls = Number(f.letterSpacing || 0);
  if (ls && t.length > 1) w += (t.length - 1) * ls;

  return w;
}

function wrapPct(p) {
  let x = Number(p) || 0;
  x = x % 100;
  if (x < 0) x += 100;
  return x;
}


  function isMac() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  }

  function stopEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function safePlainText(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/\u200B/g, ""); // ZWSP out
  }

  function setStyle(el, styles) {
    for (const k in styles) el.style[k] = styles[k];
  }

  function getPageObjects(draft, pageIndex) {
    if (!draft) return [];
    if (draft.pages && draft.pages[pageIndex] && Array.isArray(draft.pages[pageIndex].objects)) {
      return draft.pages[pageIndex].objects;
    }
    if (draft.objectsByPage && Array.isArray(draft.objectsByPage[pageIndex])) {
      return draft.objectsByPage[pageIndex];
    }
    if (Array.isArray(draft.objects)) return draft.objects;

    if (draft.pages && !draft.pages[pageIndex]) {
      draft.pages[pageIndex] = { objects: [] };
      return draft.pages[pageIndex].objects;
    }
    if (draft.pages && draft.pages[pageIndex] && !Array.isArray(draft.pages[pageIndex].objects)) {
      draft.pages[pageIndex].objects = [];
      return draft.pages[pageIndex].objects;
    }
    draft.objects = draft.objects || [];
    return draft.objects;
  }

  function findObj(objs, id) {
    for (let i = 0; i < objs.length; i++) if (objs[i] && objs[i].id === id) return objs[i];
    return null;
  }

  function removeObj(objs, id) {
    const idx = objs.findIndex((o) => o && o.id === id);
    if (idx >= 0) objs.splice(idx, 1);
  }

  function svgEl(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function setAttrs(el, attrs) {
    for (const k in attrs) el.setAttribute(k, attrs[k]);
  }

  // circle path from angle 0..360, clockwise
  function buildCirclePathD(r, clockwise) {
  // ✅ départ en haut : (0, -r)
  const sweep = clockwise ? 1 : 0;
  const x = 0, y = -r;
  // 2 arcs de 180° pour faire le cercle complet
  return `M ${x} ${y}
          A ${r} ${r} 0 1 ${sweep} ${x} ${r}
          A ${r} ${r} 0 1 ${sweep} ${x} ${-r}`;
}


  function rotatePoint(px0, py0, deg) {
    const a = deg2rad(deg);
    const c = Math.cos(a), s = Math.sin(a);
    return { x: px0 * c - py0 * s, y: px0 * s + py0 * c };
  }
  
  function getCharIndexAtPoint(state, obj, ptOverlay) {
		  const g = state.objectsG.querySelector(`g[data-id="${CSS.escape(obj.id)}"]`);
		  if (!g) return null;

		  const tp = g.querySelector("text.tc-text textPath");
		  if (!tp) return null;

		  // overlay(px) -> local du <g> (donc du <textPath>)
		  let local;
		  try {
			const p = state.svg.createSVGPoint();
			p.x = ptOverlay.x;
			p.y = ptOverlay.y;
			const m = g.getCTM();
			if (!m) return null;
			local = p.matrixTransform(m.inverse());
		  } catch (_) {
			return null;
		  }

		  // natif si dispo
		  try {
			const idx = tp.getCharNumAtPosition(local);
			if (Number.isFinite(idx) && idx >= 0) return idx;
		  } catch (_) {}

		  // fallback distance
		  try {
			const n = tp.getNumberOfChars ? tp.getNumberOfChars() : 0;
			if (!n) return 0;
			let best = 0, bestD = Infinity;
			for (let i = 0; i < n; i++) {
			  const pos = tp.getStartPositionOfChar(i);
			  const dx = pos.x - local.x;
			  const dy = pos.y - local.y;
			  const d = dx*dx + dy*dy;
			  if (d < bestD) { bestD = d; best = i; }
			}
			return best;
		  } catch (_) {
			return 0;
		  }
}


  // ------------------------------------------------------------
  // Minimal selection helpers (bridge-ready)
  // (Compatible with your future shared helpers; if global versions exist, use them.)
  // ------------------------------------------------------------
  function saveSelectionRangeLocal(editEl) {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0);
      if (!editEl.contains(r.commonAncestorContainer)) return null;
      return r.cloneRange();
    } catch (_) {
      return null;
    }
  }
  
  function selectAllContenteditable(el){
  try{
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch(_){}
}

function isEditableTarget(t){
  const tag = (t && t.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable);
}


  function restoreSelectionRangeLocal(range) {
    try {
      if (!range) return;
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function highlightSavedSelectionLocal() {
    // no-op minimal (your real system highlights spans)
  }

  function clearSelectionHighlightLocal() {
    // no-op minimal
  }

function setCaretInEditable(editEl, index) {
		  if (!editEl) return;

		  editEl.focus();

		  const t = editEl.textContent || "";
		  const i = Math.max(0, Math.min(t.length, index | 0));

		  // ⚠️ force UN SEUL textNode (important pour Range)
		  editEl.textContent = t;

		  const node = editEl.firstChild;
		  if (!node) return;

		  const sel = window.getSelection();
		  if (!sel) return;

		  const r = document.createRange();
		  r.setStart(node, i);
		  r.setEnd(node, i);
		  sel.removeAllRanges();
		  sel.addRange(r);
}



  // ------------------------------------------------------------
  // Controller
  // ------------------------------------------------------------
  function createTextCircleController(opts) {
    const overlayEl = opts && opts.overlayEl;
    const draft = (opts && opts.draft) || { pages: [{ objects: [] }] };
    const pageIndex = Number(opts && opts.pageIndex) || 0;
    const fonts = (opts && opts.fonts) || null;
    const onChange = typeof (opts && opts.onChange) === "function" ? opts.onChange : null;

    if (!overlayEl) throw new Error("createTextCircleController: overlayEl missing");

    // Ensure overlay positioning
    const overlayCS = getComputedStyle(overlayEl);
    if (overlayCS.position === "static") overlayEl.style.position = "relative";

    const state = {
      attached: false,
      selectedId: null,
      hoverId: null,
      editingId: null,

      // pointer action
      action: null,
      rafPending: false,
      lastMove: null,
	  
	  inlineFO: null,
	inlineEdit: null,
	inlineDiv: null,


      // dom
      root: null,
      svg: null,
      defs: null,
      objectsG: null,
      uiLayer: null,
      handles: null,
      rotHandle: null,
      rotStem: null,
      outline: null,
      guide: null,
      selG: null,

      // editor input
      editWrap: null,
      editInput: null,

      // cursor / hover
      lastCursor: "",

      // Toolbar bridge
      toolbarHostEl: null,
      toolbar: null, // { update, closePopovers, destroy, el }
      _savedRange: null, // saved selection during popovers
	  _clearDefaultOnFirstInput: false,
    };

    // ----------------------------------------------------------
    // DOM bootstrap
    // ----------------------------------------------------------
    function buildDOM() {
      const root = document.createElement("div");
      root.className = "tc-root";
      setStyle(root, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });

      const svg = svgEl("svg");
      svg.classList.add("tc-svg");
      setAttrs(svg, { width: "100%", height: "100%" });
      setStyle(svg, { position: "absolute", inset: "0", overflow: "visible", pointerEvents: "auto" });

      const defs = svgEl("defs");
      const objectsG = svgEl("g");
      objectsG.classList.add("tc-objects");
      svg.appendChild(defs);
      svg.appendChild(objectsG);

      const ui = document.createElement("div");
      ui.className = "tc-ui";
      setStyle(ui, { position: "absolute", inset: "0", pointerEvents: "none" });

      // selection outline circle (svg)
      const outline = svgEl("circle");
      outline.classList.add("tc-outline");
      setAttrs(outline, { cx: "0", cy: "0", r: "10" });
      setStyle(outline, { pointerEvents: "none" });

      // guide circle (svg)
      const guide = svgEl("circle");
      guide.classList.add("tc-guide");
      setAttrs(guide, { cx: "0", cy: "0", r: "10" });
      setStyle(guide, { pointerEvents: "none" });

      const selG = svgEl("g");
      selG.classList.add("tc-sel-g");
      selG.appendChild(guide);
      selG.appendChild(outline);
      svg.appendChild(selG);
	  
	  
	  // --- Inline editor (SVG foreignObject) ---
		const fo = svgEl("foreignObject");
		fo.classList.add("tc-fo");
		fo.style.display = "none"; // visible seulement en édition
		fo.setAttribute("x", "0");
		fo.setAttribute("y", "0");
		fo.setAttribute("width", "10");
		fo.setAttribute("height", "10");

		const foDiv = document.createElement("div");
		foDiv.className = "tc-fo-div";
		foDiv.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

		const foEdit = document.createElement("div");
		foEdit.className = "tc-fo-edit";
		foEdit.setAttribute("contenteditable", "true");
		foEdit.setAttribute("spellcheck", "false");

		foDiv.appendChild(foEdit);
		fo.appendChild(foDiv);
		svg.appendChild(fo);

		// stocke
		state.inlineFO = fo;
		state.inlineEdit = foEdit;
		state.inlineDiv = foDiv;


      // Handles
      const handles = {};
      const handleNames = ["n", "e", "s", "w"];
      for (const name of handleNames) {
        const h = document.createElement("div");
        h.className = `tc-handle tc-handle-${name}`;
        h.dataset.handle = name;
        setStyle(h, {
          position: "absolute",
          width: "10px",
          height: "10px",
          borderRadius: "2px",
          pointerEvents: "auto",
        });
        ui.appendChild(h);
        handles[name] = h;
      }

      const rotStem = document.createElement("div");
      rotStem.className = "tc-rot-stem";
      setStyle(rotStem, { position: "absolute", width: "2px", height: "18px", pointerEvents: "none" });
      ui.appendChild(rotStem);

      const rot = document.createElement("div");
      rot.className = "tc-rot-handle";
      rot.dataset.handle = "rot";
      setStyle(rot, {
        position: "absolute",
        width: "12px",
        height: "12px",
        borderRadius: "999px",
        pointerEvents: "auto",
      });
      ui.appendChild(rot);

      // Editor overlay (contentEditable source)
      const editWrap = document.createElement("div");
      editWrap.className = "tc-edit-wrap";
      setStyle(editWrap, {
        position: "absolute",
        pointerEvents: "auto",
        display: "none",
      });

      const editInput = document.createElement("div");
      editInput.className = "tc-edit-input";
      editInput.setAttribute("contenteditable", "true");
      editInput.setAttribute("spellcheck", "false");
      setStyle(editInput, {
        outline: "none",
        whiteSpace: "pre",
        overflow: "hidden",
      });

      editWrap.appendChild(editInput);
      root.appendChild(svg);
      root.appendChild(ui);
      root.appendChild(editWrap);

      overlayEl.appendChild(root);

      state.root = root;
      state.svg = svg;
      state.defs = defs;
      state.objectsG = objectsG;
      state.uiLayer = ui;
      state.handles = handles;
      state.rotHandle = rot;
      state.rotStem = rotStem;
      state.outline = outline;
      state.guide = guide;
      state.selG = selG;
      state.editWrap = editWrap;
      state.editInput = editInput;

      injectCSSOnce();
    }

    let CSS_DONE = false;
    function injectCSSOnce() {
      if (CSS_DONE) return;
      CSS_DONE = true;

      const style = document.createElement("style");
      style.id = "text-circle-tools-css";
      style.textContent = `
        .tc-svg { user-select: none; }
        .tc-outline { fill: none; stroke: #2563eb; stroke-width: 1.5; stroke-dasharray: 6 4; opacity: .95; }
        .tc-guide { fill: none; stroke: rgba(37,99,235,.45); stroke-width: 1; stroke-dasharray: 2 4; opacity: .0; }
        .tc-sel-g { pointer-events: none; }
        .tc-handle { background: #fff; border: 1px solid #2563eb; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
        .tc-handle.tc-handle-n, .tc-handle.tc-handle-s { cursor: ns-resize; }
        .tc-handle.tc-handle-e, .tc-handle.tc-handle-w { cursor: ew-resize; }
        .tc-rot-stem { background: #2563eb; opacity: .8; transform-origin: 50% 100%; }
        .tc-rot-handle { background: #fff; border: 1px solid #2563eb; box-shadow: 0 1px 2px rgba(0,0,0,.15); cursor: grab; }
        .tc-rot-handle:active { cursor: grabbing; }

        .tc-edit-wrap {
          background: rgba(255,255,255,.92);
          border: 1px solid rgba(37,99,235,.6);
          box-shadow: 0 4px 16px rgba(0,0,0,.12);
          border-radius: 8px;
          padding: 6px 10px;
        }
        .tc-edit-input {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
          font-size: 16px;
          color: #111827;
          white-space: pre;
		  }
		  
		  /* ✅ Texte sélectionnable (comme Photoshop/Figma) */
			.tc-text {
			  cursor: text;
			  user-select: text;
			}

			
				
				/* --- Inline circle editor --- */
			.tc-fo { pointer-events: auto; overflow: visible; }
			.tc-fo-div{
				  width:100%;
				  height:100%;
				  display:block;          /* ✅ plus de flex */
				}

				.tc-fo-edit{
				  width:100%;
				  height:100%;
				  display:block;          /* ✅ plus de flex */
				  line-height:1.1;
				  text-align:left;
				  padding:0;
				  margin:0;
				  outline:none;
				  background:transparent;
				  white-space:pre;
				  user-select:text;
				  cursor:text;
				}
				

				

	
			
			.tc-edit-hl{
			  display:none !important; /* ✅ on désactive ce rectangle */
			}

				.tc-item.is-editing text.tc-text{
				  fill: inherit !important;    /* ou ne rien mettre */
				}

				.tc-item.is-editing text.tc-text{
				  pointer-events:none;
				}
			.tc-sel-path{
			  fill: none;
			  stroke: #2563eb;
			  stroke-width: 14;           /* épaisseur du surlignage */
			  stroke-linecap: round;
			  stroke-linejoin: round;
			  opacity: 0.95;
			}
			.tc-caret{
			  stroke: #2563eb;
			  stroke-width: 2;
			}
	      /* selection bien visible en édition */
		.tc-editLayer{
		  position:absolute;
		  z-index:9999;
		  min-width:40px;
		  padding:2px 4px;
		  border-radius:6px;
		  outline:2px solid rgba(59,130,246,.35);
		  background:rgba(59,130,246,.06);
		  color:#111827;
		  font:inherit;
		  white-space:pre;
		}
		.tc-editLayer::selection{
		  background:rgba(59,130,246,.35);
		}




        
      `;
      document.head.appendChild(style);
    }

    // ----------------------------------------------------------
    // Object defaults
    // ----------------------------------------------------------
    function defaultFont() {
      return {
        family: "Arial",
        size: 26,
        weight: 400,
        style: "normal",
        underline: false,
        letterSpacing: 0,
        transform: "none", // none/upper/lower/capitalize
        align: "center",
      };
    }

    function newTextCircle(x, y) {
      return {
        id: uid("tc"),
        type: "text",
        mode: "circle",
        x: x,
        y: y,
        r: 90,
        rotation: 0,
        text: "Texte cercle",
        color: "#111827",
        font: defaultFont(),
        side: "outer",
        startAngle: 0,
      };
    }

    // ----------------------------------------------------------
    // Toolbar Bridge
    // ----------------------------------------------------------
	function attachTextToolbarBridge({ hostEl } = {}) {
	  // ⚠️ IMPORTANT : ne jamais mettre la toolbar dans un parent pointer-events:none (ex: .tc-root)
	  // => on la met sur document.body par défaut (safe), sinon overlayEl.
	  const safeHost = hostEl || document.body || overlayEl;
	  state.toolbarHostEl = safeHost;

	  if (!global.TextToolbarBridge || !global.TextToolbarBridge.createTextToolbarBridge) {
		console.warn("[TC] TextToolbarBridge manquant (charge text_toolbar_bridge.js)");
		return null;
	  }
	  if (!global.TextToolbarTools || !global.TextToolbarTools.createTextToolbar) {
		console.warn("[TC] TextToolbarTools manquant (charge text_toolbar_tools.js)");
		return null;
	  }

	  const textHost = createTextHost();
	  state.toolbar = global.TextToolbarBridge.createTextToolbarBridge({
		hostEl: state.toolbarHostEl,
		textHost,
	  });

	  // ✅ force cliquable + au-dessus de l’overlay
	  try {
		if (state.toolbar && state.toolbar.el) {
		  state.toolbar.el.style.pointerEvents = "auto";
		  state.toolbar.el.style.zIndex = "999999";
		}
	  } catch (_) {}

	  try { state.toolbar.update(); } catch (_) {}
	  return state.toolbar;
	}

    function toolbarUpdate() {
      if (!state.toolbar) return;
      try { state.toolbar.update(); } catch (_) {}
    }

    function toolbarClosePopovers() {
      if (!state.toolbar) return;
      try { state.toolbar.closePopovers(); } catch (_) {}
    }

    function toolbarDestroy() {
      if (!state.toolbar) return;
      try { state.toolbar.destroy(); } catch (_) {}
      state.toolbar = null;
    }

	function clampAnchorPointToViewport(x, y, pad = 12) {
	  const vw = window.innerWidth || 0;
	  const vh = window.innerHeight || 0;

	  // évite d’ancrer trop près des bords
	  const cx = Math.max(pad, Math.min(vw - pad, x));
	  const cy = Math.max(pad, Math.min(vh - pad, y));
	  return { x: cx, y: cy };
	}

	function getAnchorRectForObj(obj) {
	  // bbox du cercle en coords viewport
	  const hostR = overlayEl.getBoundingClientRect();
	  const left = hostR.left + (obj.x - obj.r);
	  const top  = hostR.top  + (obj.y - obj.r);
	  const w = obj.r * 2;
	  const h = obj.r * 2;

	  // ✅ ancre = petit point à l’extérieur du cercle (bas-droite)
	  // (plus l’offset est grand, moins le picker recouvre le cercle)
	  const OUT = 18;

	  // point cible
	  const targetX = left + w + OUT;
	  const targetY = top + h + OUT;

	  // clamp viewport
	  const p = clampAnchorPointToViewport(targetX, targetY, 16);

	  // retourne un "mini rect" (1x1) => popovers se placent autour de ce point
	  return {
		left: p.x,
		top: p.y,
		right: p.x + 1,
		bottom: p.y + 1,
		width: 1,
		height: 1,
	  };
	}


    function createTextHost() {
      return {
        getContext: () => {
          const obj = getSelectedObj();
          if (!obj || obj.type !== "text" || obj.mode !== "circle") return { isVisible: false };

          const hostRect = (state.toolbarHostEl || overlayEl).getBoundingClientRect();
          const anchorRect = getAnchorRectForObj(obj);

          const f = obj.font || defaultFont();
          const fontKey = String(f.key || f.family || "helv");

          return {
            isVisible: true,
            anchorRect,
            hostRect,
            fonts: fonts || [],

            fontKey,
            currentFontKey: fontKey,
            size: Number(f.size || 26),
            color: obj.color || "#111827",
            align: f.align || "center",
            bold: String(f.weight) === "700" || Number(f.weight) >= 700,
            italic: (f.style === "italic"),
            underline: !!f.underline,
            transform: f.transform || "none",
			circleSide: (obj.side === "inner" ? "inner" : "outer"),
          };
        },

        onBeforeOpenColorPicker: () => {
          if (!state.editingId || !state.inlineEdit) return;

			if (typeof global.saveSelectionRange === "function") {
			  try { global.saveSelectionRange(state.inlineEdit); } catch (_) {}
			} else {
			  state._savedRange = saveSelectionRangeLocal(state.inlineEdit);
			}

			if (typeof global.highlightSavedSelection === "function") {
			  try { global.highlightSavedSelection(state.inlineEdit); } catch (_) {}
			} else {
			  highlightSavedSelectionLocal();
			}

        },

        onBeforeOpenFontPicker: () => {
		  if (!state.editingId || !state.inlineEdit) return;

		  if (typeof global.saveSelectionRange === "function") {
			try { global.saveSelectionRange(state.inlineEdit); } catch (_) {}
		  } else {
			state._savedRange = saveSelectionRangeLocal(state.inlineEdit);
		  }

		  if (typeof global.highlightSavedSelection === "function") {
			try { global.highlightSavedSelection(state.inlineEdit); } catch (_) {}
		  } else {
			highlightSavedSelectionLocal();
		  }
		},


        onAction: (action) => {
			  console.log("[TC] toolbar action", action); // ✅ DEBUG
          const obj = getSelectedObj();
          if (!obj) return;

          // Restore selection if editing
          if (state.editingId && state.inlineEdit) {
			  if (typeof global.restoreSelectionRange === "function") {
				try { global.restoreSelectionRange(state.inlineEdit); } catch (_) {}
			  } else {
				restoreSelectionRangeLocal(state._savedRange);
			  }
			}


          applyToolbarAction(action, obj);

          // Re-save selection after apply (future)
					  // Re-save selection after apply (future)
			if (state.editingId && state.inlineEdit) {
			  if (typeof global.saveSelectionRange === "function") {
				try { global.saveSelectionRange(state.inlineEdit); } catch (_) {}
			  } else {
				state._savedRange = saveSelectionRangeLocal(state.inlineEdit);
			  }
			}



          renderAll();
          fireChange("toolbar_action", obj);
          toolbarUpdate();
        },
      };
    }

    function applyToolbarAction(action, obj) {
      obj.font = obj.font || defaultFont();

      const type = action && action.type;
      const value = action && action.value;
	  
	  if (type === "circleSide") {
	  obj.side = (String(value) === "inner") ? "inner" : "outer";
	  return;
	}

      // In this first jet: we apply styles globally (object + editInput inline style)
      if (type === "color" || type === "textColor" || type === "fill") {
	  obj.color = String(value || "#111827");
	  if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.color = obj.color;
	  return;
	}


      if (type === "size") {
        obj.font.size = clamp(Number(value || obj.font.size || 26), 4, 220);
        if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.fontSize = px(obj.font.size);
        return;
      }

      if (type === "font") {
        // value is fontKey; we store as family for now
        const key = String(value || "").trim();
        obj.font.family = key || obj.font.family || "Arial";
        obj.font.key = key || obj.font.key;

        if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.fontFamily = obj.font.family;
        return;
      }

      if (type === "bold") {
        const isBold = String(obj.font.weight) === "700" || Number(obj.font.weight) >= 700;
        obj.font.weight = isBold ? 400 : 700;
        if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.fontWeight = String(obj.font.weight);
        return;
      }

      if (type === "italic") {
        obj.font.style = (obj.font.style === "italic") ? "normal" : "italic";
        if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.fontStyle = obj.font.style;
        return;
      }

      if (type === "underline") {
        obj.font.underline = !obj.font.underline;
        if (state.editingId === obj.id && state.inlineEdit) state.inlineEdit.style.textDecoration = obj.font.underline ? "underline" : "none";
        return;
      }

      if (type === "align") {
        // Not really used for textPath (alignment is complex). We store it for future.
        obj.font.align = String(value || "center");
        return;
      }

      if (type === "transform") {
        const v = String(value || "none");
        // normalize to your toolbar values
        if (v === "upper") obj.font.transform = "uppercase";
        else if (v === "lower") obj.font.transform = "lowercase";
        else if (v === "capitalize") obj.font.transform = "capitalize";
        else obj.font.transform = "none";
        return;
      }
    }

    // ----------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------
    function ensureNodeFor(obj) {
      const id = obj.id;

      let g = state.objectsG.querySelector(`g[data-id="${CSS.escape(id)}"]`);
      if (!g) {
        g = svgEl("g");
        g.dataset.id = id;
        g.classList.add("tc-item");

        // hit circle for pointer interactions
        const hit = svgEl("circle");
        hit.classList.add("tc-hit");
        setAttrs(hit, { cx: "0", cy: "0", r: String(obj.r + 18) });
        setStyle(hit, { fill: "transparent", pointerEvents: "stroke" });
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", "30");
        hit.dataset.hit = "1";
        g.appendChild(hit);

        const pathOuter = svgEl("path");
        pathOuter.dataset.path = "outer";
        pathOuter.id = `tc_path_outer_${id}`;
        state.defs.appendChild(pathOuter);

        const pathInner = svgEl("path");
        pathInner.dataset.path = "inner";
        pathInner.id = `tc_path_inner_${id}`;
        state.defs.appendChild(pathInner);
		
		const hl = svgEl("rect");
		hl.classList.add("tc-edit-hl");
		setAttrs(hl, { x: "-1", y: "-1", width: "2", height: "2", rx: "3", ry: "3" });
		hl.style.display = "none";
		g.appendChild(hl);
		
		// ✅ Selection highlight + caret (SVG) pour édition "sur le cercle"
		const sel = svgEl("path");
		sel.classList.add("tc-sel-path");
		sel.style.display = "none";
		g.appendChild(sel);

		const caret = svgEl("line");
		caret.classList.add("tc-caret");
		caret.style.display = "none";
		g.appendChild(caret);



        const text = svgEl("text");
        text.classList.add("tc-text");
        text.setAttribute("text-rendering", "geometricPrecision");

        const tp = svgEl("textPath");
        tp.dataset.tp = "1";
        tp.setAttribute("href", `#${pathOuter.id}`);
        tp.setAttribute("startOffset", "0");
        text.appendChild(tp);

        g.appendChild(text);
        state.objectsG.appendChild(g);
      }
      return g;
    }

    function computeTextPathStartOffsetPercent(startAngleDeg) {
      const a = ((startAngleDeg % 360) + 360) % 360;
      return (a / 360) * 100;
    }

    function applyFontStyle(textEl, obj) {
      const f = obj.font || defaultFont();
      const family = f.family || "Arial";

      // transform (global) — for this first jet, we transform the raw text before render
      // (future: will be done by html/runs)
      textEl.setAttribute("font-family", family);
      textEl.setAttribute("font-size", String(f.size || 24));
      textEl.setAttribute("font-weight", String(f.weight || 400));
      textEl.setAttribute("font-style", f.style || "normal");
      textEl.setAttribute("fill", obj.color || "#111827");
      textEl.setAttribute("text-decoration", f.underline ? "underline" : "none");
	  const align = (obj.font && obj.font.align) ? String(obj.font.align) : "center";
		const anchor =
		  align === "right" ? "end" :
		  align === "left"  ? "start" :
		  "middle"; // center par défaut

		textEl.setAttribute("text-anchor", anchor);
            // important
		textEl.setAttribute("dominant-baseline", "middle");     // baseline stable

      const ls = Number(f.letterSpacing || 0);
      textEl.setAttribute("letter-spacing", String(ls));
    }

    function transformTextByFontTransform(txt, fontTransform) {
      const t = String(fontTransform || "none");
      if (t === "uppercase") return txt.toUpperCase();
      if (t === "lowercase") return txt.toLowerCase();
      if (t === "capitalize") {
        // simple capitalize words
        return txt.replace(/\b(\p{L})/gu, (m) => m.toUpperCase());
      }
      return txt;
    }

  function renderOne(obj) {
  const g = ensureNodeFor(obj);

  const rot = Number(obj.rotation || 0);
  g.setAttribute("transform", `translate(${obj.x} ${obj.y}) rotate(${rot})`);

  const hit = g.querySelector("circle.tc-hit");
  if (hit) hit.setAttribute("r", String(Math.max(6, Number(obj.r || 10) + 18)));

  const outerPath = state.defs.querySelector(`#tc_path_outer_${CSS.escape(obj.id)}`);
  const innerPath = state.defs.querySelector(`#tc_path_inner_${CSS.escape(obj.id)}`);
  const r = Math.max(8, Number(obj.r || 10));

  // ------------------------------------------------------------
  // ✅ Décaler le texte AU-DESSUS de la ligne du cercle
  // ------------------------------------------------------------
 // ------------------------------------------------------------
// ✅ Distance texte ↔ cercle (plus petit = plus proche)
// ------------------------------------------------------------
	const f0 = obj.font || {};
	const fontSize = Math.max(8, Number(f0.size || 24));

	// 🔧 Réglage principal : rapproche le texte du cercle
	// Essayes 0.06 → 0.12 selon ton rendu
	const gap = Math.max(1, fontSize * 0.08);

	// Outer = juste un chouïa à l’extérieur
	const rOuterText = r + gap;

	// Inner = juste un chouïa à l’intérieur (et surtout PAS “r - 0.85*fontSize”)
	const rInnerText = Math.max(6, r - gap);


  // ------------------------------------------------------------
  // ✅ Paths
  // - outer : sens normal (clockwise)
  // - inner : sens inversé (counter) pour pouvoir faire du concave
  // ------------------------------------------------------------
  if (outerPath) outerPath.setAttribute("d", buildCirclePathD(rOuterText, true));
  if (innerPath) innerPath.setAttribute("d", buildCirclePathD(rInnerText, false)); // <-- IMPORTANT

  const textEl = g.querySelector("text.tc-text");
  const tp = textEl ? textEl.querySelector("textPath") : null;

  if (!textEl || !tp) return;

  applyFontStyle(textEl, obj);

  const side = obj.side === "inner" ? "inner" : "outer";

  const hrefId =
    side === "inner"
      ? `#tc_path_inner_${obj.id}`
      : `#tc_path_outer_${obj.id}`;

  // ✅ compat Firefox : set href + xlink:href
  tp.setAttribute("href", hrefId);
  try {
    tp.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", hrefId);
  } catch (_) {}

  // ------------------------------------------------------------
  // ✅ Inner concave (robuste multi-navigateurs)
  // - Le path inner est inversé (buildCirclePathD(..., false))
  // - Pour garder le texte lisible : flip vertical du <text>
  // ------------------------------------------------------------
 textEl.removeAttribute("transform");
textEl.setAttribute("dominant-baseline", "middle");


  // ------------------------------------------------------------
  // ✅ startOffset "safe" : centre en haut + évite clip
  // ------------------------------------------------------------
  const angle = ((Number(obj.startAngle || 0) % 360) + 360) % 360;

  // rayon utilisé par le path (doit matcher)
  const rUsed = side === "inner" ? rInnerText : rOuterText;
  const circumference = 2 * Math.PI * Math.max(8, rUsed);

  // mesure du texte (px)
  const rawForMeasure = safePlainText(obj.text || "");
  const textPx = (typeof measureTextPx === "function")
    ? measureTextPx(rawForMeasure, obj.font)
    : 0;

  const anchor = textEl.getAttribute("text-anchor") || "middle";

  let startLen = (angle / 360) * circumference;

  // compensation anchor
  if (anchor === "middle") startLen += (textPx * 0.5);
  else if (anchor === "end") startLen += textPx;

  // wrap
  startLen = startLen % circumference;
  if (startLen < 0) startLen += circumference;

  tp.setAttribute("startOffset", String(startLen));

  // ------------------------------------------------------------
  // ✅ texte
  // ------------------------------------------------------------
  let txt = safePlainText(obj.text || "");
  if (state.editingId !== obj.id) {
    const ft = (obj.font && obj.font.transform) ? String(obj.font.transform) : "none";
    txt = transformTextByFontTransform(txt, ft);
  }
  tp.textContent = txt.length ? txt : " ";

  // ------------------------------------------------------------
  // ✅ Edition "courbée" : selection + caret dessinés sur le SVG
  // ------------------------------------------------------------
  const selPath = g.querySelector(".tc-sel-path");
  const caretLn = g.querySelector(".tc-caret");

  if (state.editingId === obj.id && selPath && caretLn) {
    const raw = safePlainText(obj.text || "");
    const n = raw.length;

    let a = 0, b = 0;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const rr = sel.getRangeAt(0);
        if (state.inlineEdit &&
            state.inlineEdit.contains(rr.startContainer) &&
            state.inlineEdit.contains(rr.endContainer)) {
          a = Math.max(0, Math.min(n, rr.startOffset));
          b = Math.max(0, Math.min(n, rr.endOffset));
        } else {
          a = b = n;
        }
      } else {
        a = b = n;
      }
    } catch (_) { a = b = n; }

    const start = Math.min(a, b);
    const end = Math.max(a, b);

    if (start === end) {
      selPath.style.display = "none";

      const i = Math.max(0, Math.min(Math.max(0, n - 1), start));
      try {
        const p = tp.getStartPositionOfChar(i);
        const ext = tp.getExtentOfChar(i);

        caretLn.style.display = "";
        caretLn.setAttribute("x1", String(p.x));
        caretLn.setAttribute("y1", String(p.y - ext.height * 0.9));
        caretLn.setAttribute("x2", String(p.x));
        caretLn.setAttribute("y2", String(p.y + ext.height * 0.2));
      } catch (_) {
        caretLn.style.display = "none";
      }
    } else {
      caretLn.style.display = "none";

      const segs = [];
      for (let i = start; i < end; i++) {
        try {
          const e = tp.getExtentOfChar(i);
          const cx = e.x + e.width * 0.5;
          const cy = e.y + e.height * 0.5;
          segs.push(`M ${cx - 2} ${cy} L ${cx + 2} ${cy}`);
        } catch (_) {}
      }

      if (segs.length) {
        selPath.style.display = "";
        selPath.setAttribute("d", segs.join(" "));
      } else {
        selPath.style.display = "none";
      }
    }
  } else {
    if (selPath) selPath.style.display = "none";
    if (caretLn) caretLn.style.display = "none";
  }

  const hl = g.querySelector("rect.tc-edit-hl");
  if (hl) hl.style.display = "none";

  // ✅ pas de dy (sinon ça recentre sur le chemin)
  textEl.setAttribute("dy", "0");
  textEl.style.opacity = state.editingId === obj.id ? "0.9" : "1";
}




    function renderAll() {
      const objs = getPageObjects(draft, pageIndex);
      for (const obj of objs) {
        if (!obj || obj.type !== "text" || obj.mode !== "circle") continue;
        renderOne(obj);
      }

      cleanupOrphans(objs);
      renderSelection();
      updateCursor();

      // ✅ toolbar follows selection while rendering (cheap + safe)
      toolbarUpdate();
    }

    function cleanupOrphans(objs) {
      const keep = new Set();
      for (const o of objs) {
        if (o && o.type === "text" && o.mode === "circle") keep.add(o.id);
      }
      const nodes = Array.from(state.objectsG.querySelectorAll("g.tc-item[data-id]"));
      for (const g of nodes) {
        const id = g.dataset.id;
        if (!keep.has(id)) {
          const p1 = state.defs.querySelector(`#tc_path_outer_${CSS.escape(id)}`);
          const p2 = state.defs.querySelector(`#tc_path_inner_${CSS.escape(id)}`);
          if (p1) p1.remove();
          if (p2) p2.remove();
          g.remove();
        }
      }
    }

    function renderSelection() {
      const id = state.selectedId;
      const objs = getPageObjects(draft, pageIndex);
      const obj = id ? findObj(objs, id) : null;

      const showSel = !!obj && obj.type === "text" && obj.mode === "circle";
      state.selG.style.display = showSel ? "" : "none";
      state.uiLayer.style.display = showSel ? "" : "none";

      if (!showSel) return;

      const guideOpacity = (state.hoverId === id || state.editingId === id) ? 0.9 : 0.35;
      state.guide.style.opacity = String(guideOpacity);

      state.guide.setAttribute("r", String(Math.max(6, Number(obj.r || 10))));
      state.outline.setAttribute("r", String(Math.max(6, Number(obj.r || 10))));

      const rot = Number(obj.rotation || 0);
      state.selG.setAttribute("transform", `translate(${obj.x} ${obj.y}) rotate(${rot})`);

      const r = Math.max(6, Number(obj.r || 10));
      const pts = {
        n: { x: 0, y: -r },
        e: { x: r, y: 0 },
        s: { x: 0, y: r },
        w: { x: -r, y: 0 },
      };

      for (const k of ["n", "e", "s", "w"]) {
        const p = rotatePoint(pts[k].x, pts[k].y, rot);
        placeHandle(state.handles[k], obj.x + p.x, obj.y + p.y);
      }

      const rotDist = r + 26;
      const rp = rotatePoint(0, -rotDist, rot);
      placeHandle(state.rotHandle, obj.x + rp.x, obj.y + rp.y);

      const stemEnd = rotatePoint(0, -(r + 20), rot);
      const stemStart = rotatePoint(0, -r, rot);
      placeStem(state.rotStem, obj.x + stemStart.x, obj.y + stemStart.y, obj.x + stemEnd.x, obj.y + stemEnd.y);
    }

    function placeHandle(el, x, y) {
      const w = el.offsetWidth || 10;
      const h = el.offsetHeight || 10;
      setStyle(el, { left: px(x - w / 2), top: px(y - h / 2) });
    }

    function placeStem(el, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(0, Math.hypot(dx, dy));
      const ang = rad2deg(Math.atan2(dy, dx)) + 90;
      setStyle(el, {
        left: px(x2 - 1),
        top: px(y2 - len),
        height: px(len),
        transform: `rotate(${ang}deg)`,
        transformOrigin: "50% 100%",
      });
    }

    function updateCursor() {
	  let desired = "";

	  if (state.editingId) {
		desired = "text";
	  } else if (state.action) {
		desired = (state.action.kind === "rot") ? "grabbing" : "move";
	  } else if (state.hoverId) {
		// ✅ si l’objet sous la souris est sélectionné → move (prêt à drag)
		desired = (state.hoverId === state.selectedId) ? "move" : "text";
	  } else if (state.selectedId) {
		// optionnel : si un objet est sélectionné même sans hover
		desired = "";
	  }

	  if (desired !== state.lastCursor) {
		state.svg.style.cursor = desired || "default";
		state.lastCursor = desired;
	  }
	}

    // ----------------------------------------------------------
    // Hit testing
    // ----------------------------------------------------------
    function clientToOverlayPoint(ev) {
      const r = overlayEl.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function pickObjectAt(pt) {
	  const objs = getPageObjects(draft, pageIndex);
	  for (let i = objs.length - 1; i >= 0; i--) {
		const o = objs[i];
		if (!o || o.type !== "text" || o.mode !== "circle") continue;

		const dx = pt.x - o.x;
		const dy = pt.y - o.y;
		const dist = Math.hypot(dx, dy);
		const r = Math.max(6, Number(o.r || 10));

		// ✅ On ne "hit" QUE près de l'anneau (guide), pas à l'intérieur.
		const band = 18; // ajuste 14..24
		const near = Math.abs(dist - r) <= band;

		if (near) return o;
	  }
	  return null;
	}


    function getSelectedObj() {
      const objs = getPageObjects(draft, pageIndex);
      return state.selectedId ? findObj(objs, state.selectedId) : null;
    }

    // ----------------------------------------------------------
    // Editing
    // ----------------------------------------------------------
	
	
	
	
	function enterEdit(id, ptOpt) {
  const objs = getPageObjects(draft, pageIndex);
  const obj = findObj(objs, id);
  if (!obj) return;

  // Si on était déjà en édition sur un autre objet -> commit
  if (state.editingId && state.editingId !== id) {
    exitEdit(true);
  }

  state.editingId = id;
  state.selectedId = id;

  // Masque/flag rendu SVG pendant l’édition
  const g = state.objectsG.querySelector(`g[data-id="${CSS.escape(id)}"]`);
  if (g) {
    g.style.opacity = "1";
    g.classList.add("is-editing");
  }

  // ------------------------------------------------------------
  // ✅ 1) Taille COMPACTE (une ligne)
  // ------------------------------------------------------------
  const r = Math.max(20, Number(obj.r || 80));
  const fontPx = Math.max(10, Number((obj.font && obj.font.size) || 26));
  const w = Math.min(520, Math.max(140, fontPx * 12));
  const h = Math.max(34, Math.min(80, fontPx * 1.8));

  // ------------------------------------------------------------
  // ✅ 2) Position (éditeur placé sur le cercle, sans modifier la géométrie)
  // ------------------------------------------------------------
  const rotObj = ((Number(obj.rotation || 0) % 360) + 360) % 360;
  const startA = ((Number(obj.startAngle || 0) % 360) + 360) % 360;
  const absDeg = ((rotObj + startA) % 360 + 360) % 360;

  const a = deg2rad(absDeg);

  // Point sur le cercle au niveau de l’angle courant (ou ptOpt)
  const ax = (ptOpt && Number.isFinite(ptOpt.x)) ? ptOpt.x : (obj.x + r * Math.cos(a));
  const ay = (ptOpt && Number.isFinite(ptOpt.y)) ? ptOpt.y : (obj.y + r * Math.sin(a));

  // Offset léger au-dessus
  const offX = 0;
  const offY = -(h + 12);

  state.inlineFO.setAttribute("x", String(ax - w / 2 + offX));
  state.inlineFO.setAttribute("y", String(ay - h / 2 + offY));

  // ------------------------------------------------------------
  // ✅ 3) Setup foreignObject
  // ------------------------------------------------------------
  state.inlineFO.style.display = "";
  state.inlineFO.setAttribute("width", String(w));
  state.inlineFO.setAttribute("height", String(h));
  state.inlineFO.removeAttribute("transform");

  // ------------------------------------------------------------
  // Styles édition (contenteditable)
  // ------------------------------------------------------------
  const f = obj.font || defaultFont();
  state.inlineEdit.style.fontFamily = f.family || "Arial";
  state.inlineEdit.style.fontSize = px(Number(f.size || 24));
  state.inlineEdit.style.fontWeight = String(f.weight || 400);
  state.inlineEdit.style.fontStyle = f.style || "normal";
  state.inlineEdit.style.textDecoration = f.underline ? "underline" : "none";
  state.inlineEdit.style.letterSpacing = px(Number(f.letterSpacing || 0));
  state.inlineEdit.style.color = (obj.color || "#111827");
  state.inlineEdit.style.textTransform =
    (f.transform === "uppercase" ? "uppercase" :
     f.transform === "lowercase" ? "lowercase" :
     f.transform === "capitalize" ? "capitalize" : "none");

  state.inlineEdit.style.overflow = "hidden";
  state.inlineEdit.style.whiteSpace = "pre";
  state.inlineEdit.style.position = "relative";

  state.inlineEdit.style.background = "rgba(255,255,255,.92)";
  state.inlineEdit.style.border = "1px solid rgba(37,99,235,.65)";
  state.inlineEdit.style.borderRadius = "8px";
  state.inlineEdit.style.boxShadow = "0 6px 18px rgba(0,0,0,.14)";
  state.inlineEdit.style.padding = "10px 12px";
  state.inlineEdit.style.caretColor = "#2563eb";
  state.inlineEdit.style.outline = "none";

  // ------------------------------------------------------------
  // Texte + default
  // ------------------------------------------------------------
  state._clearDefaultOnFirstInput = false;
  const raw = safePlainText(obj.text || "");
  const isDefault = raw.trim().toLowerCase() === "texte cercle" || raw.trim() === "";
  state._clearDefaultOnFirstInput = isDefault;

  state.inlineEdit.textContent = raw.length ? raw : "Texte cercle";

  // 1) render pour textPath à jour (si ton SVG en dépend)
  renderAll();

  // ------------------------------------------------------------
  // ✅ 4) FOCUS + SÉLECTION TOTALE (fond bleu natif)
  // ------------------------------------------------------------
  requestAnimationFrame(() => {
    try {
      state.inlineEdit.focus({ preventScroll: true });

      // Sélection totale (fond bleu)
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(state.inlineEdit);
        sel.addRange(range);
      }
    } catch (_) {}
  });

  toolbarUpdate();
  renderSelection();
}


function exitEdit(commit) {
  const id = state.editingId;
  if (!id) return;

  const objs = getPageObjects(draft, pageIndex);
  const obj = findObj(objs, id);

  // ------------------------------------------------------------
  // 1) Commit si demandé
  // ------------------------------------------------------------
  if (commit && obj) {
    const txt = safePlainText(state.inlineEdit.textContent || "");
    obj.text = txt;
    fireChange("edit_text_commit", obj);
  }

  // ------------------------------------------------------------
  // 2) Restaurer SVG normal
  // ------------------------------------------------------------
  const g = state.objectsG.querySelector(`g[data-id="${CSS.escape(id)}"]`);
  if (g) {
    g.style.opacity = "1";
    g.classList.remove("is-editing");
  }

  // ------------------------------------------------------------
  // 3) Nettoyage selection + éditeur
  // ------------------------------------------------------------
  state.editingId = null;

  // Retire la sélection bleue (sinon ça peut rester “accrochée”)
  try {
    const sel = window.getSelection();
    sel && sel.removeAllRanges();
  } catch (_) {}

  if (state.inlineEdit) {
    // blur propre
    try { state.inlineEdit.blur(); } catch (_) {}
  }

  if (state.inlineFO) {
    state.inlineFO.removeAttribute("transform");
    state.inlineFO.style.display = "none";
  }

  if (state.inlineEdit) {
    state.inlineEdit.textContent = "";
    state.inlineEdit.style.color = "";
    state.inlineEdit.style.caretColor = "";
  }

  state._savedRange = null;
  state._clearDefaultOnFirstInput = false;

  // ------------------------------------------------------------
  // 4) Rerender + toolbar
  // ------------------------------------------------------------
  renderAll();
  toolbarUpdate();
  renderSelection && renderSelection();
}





    function focusEnd(el) {
      el.focus();
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.addRange(range);
    }

    // ----------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------
    function onPointerMove(ev) {
      if (!state.attached) return;
      if (!state.action) {
        const pt = clientToOverlayPoint(ev);
        const hit = pickObjectAt(pt);
        state.hoverId = hit ? hit.id : null;
        updateCursor();
        renderSelection();
        return;
      }

      state.lastMove = ev;
      if (!state.rafPending) {
        state.rafPending = true;
        requestAnimationFrame(applyMove);
      }
    }

    function applyMove() {
      state.rafPending = false;
      if (!state.action || !state.lastMove) return;

      const a = state.action;
      const ev = state.lastMove;
      const pt = clientToOverlayPoint(ev);

      const objs = getPageObjects(draft, pageIndex);
      const obj = findObj(objs, a.id);
      if (!obj) return;

      if (a.kind === "move_pending") {
		  const dx0 = pt.x - a.startX;
		  const dy0 = pt.y - a.startY;
		  const dist0 = Math.hypot(dx0, dy0);

		  // ✅ seuil anti "micro déplacement" (double clic)
		  if (dist0 < 3) return;

		  // on passe en vrai move
		  a.kind = "move";
		}


      if (a.kind === "move") {
        obj.x = a.startObjX + (pt.x - a.startX);
        obj.y = a.startObjY + (pt.y - a.startY);
        fireChange("move", obj);
        renderAll();
        return;
      }

      if (a.kind === "resize") {
        const dx = pt.x - obj.x;
        const dy = pt.y - obj.y;
        const dist = Math.hypot(dx, dy);
        obj.r = clamp(dist, 10, 2000);
        fireChange("resize", obj);
        renderAll();
        return;
      }

      if (a.kind === "rot") {
        const dx = pt.x - obj.x;
        const dy = pt.y - obj.y;
        const ang = rad2deg(Math.atan2(dy, dx));
        let rot = ang - a.startPointerAngle + a.startObjRotation;
        rot = ((rot % 360) + 360) % 360;
        if (ev.shiftKey) rot = snapAngle(rot, 15);
        obj.rotation = rot;
        fireChange("rotate", obj);
        renderAll();
        return;
      }
    }

    function onPointerDown(ev) {
      if (!state.attached) return;

      // If editing, click outside commits (and then continue selection)
      if (state.editingId) {
		  const t = ev.target;

		  // ✅ si clic dans la toolbar, ne pas quitter l’édition
		  if (state.toolbar && state.toolbar.el && state.toolbar.el.contains(t)) return;

		  // ✅ si clic dans l’éditeur inline, ne pas quitter
		  if (state.inlineFO && state.inlineFO.contains && state.inlineFO.contains(t)) return;

		  exitEdit(true);
		}


      const pt = clientToOverlayPoint(ev);
      const target = ev.target;

      // Handle handles
      if (target && target.dataset && target.dataset.handle) {
        const h = target.dataset.handle;
        const obj = getSelectedObj();
        if (!obj) return;

        // ✅ clicking a handle should keep selection + toolbar visible
        select(obj.id);

        target.setPointerCapture && target.setPointerCapture(ev.pointerId);

        if (h === "rot") {
          const dx = pt.x - obj.x;
          const dy = pt.y - obj.y;
          const pointerAngle = rad2deg(Math.atan2(dy, dx));
          state.action = {
            kind: "rot",
            id: obj.id,
            startX: pt.x,
            startY: pt.y,
            startPointerAngle: pointerAngle,
            startObjRotation: Number(obj.rotation || 0),
          };
          updateCursor();
          stopEvent(ev);
          return;
        }

        if (h === "n" || h === "e" || h === "s" || h === "w") {
          state.action = { kind: "resize", id: obj.id, startX: pt.x, startY: pt.y };
          updateCursor();
          stopEvent(ev);
          return;
        }
      }

      // Pick object
      const hit = pickObjectAt(pt);

      if (!hit) {
        // ✅ deselect => toolbar hide
        select(null);
        return;
      }

      // ✅ select on simple click => toolbar appears
      select(hit.id);
	  
	  // ✅ Ne jamais déplacer depuis le texte SVG
// ✅ 1 clic = prêt à drag (même si on clique sur le texte)
		if (ev.button === 0) {
		  state.action = {
			kind: "move_pending",
			id: hit.id,
			pointerId: ev.pointerId,
			startX: pt.x,
			startY: pt.y,
			startObjX: Number(hit.x || 0),
			startObjY: Number(hit.y || 0),
		  };
		  state.svg.setPointerCapture && state.svg.setPointerCapture(ev.pointerId);

		  updateCursor();     // ✅ curseur move tout de suite
		  stopEvent(ev);
		}
		return;

	  
	  

	  

      // start drag move if primary button
     if (ev.button === 0) {
	  state.action = {
		kind: "move_pending",
		id: hit.id,
		pointerId: ev.pointerId,
		startX: pt.x,
		startY: pt.y,
		startObjX: Number(hit.x || 0),
		startObjY: Number(hit.y || 0),
	  };
	  state.svg.setPointerCapture && state.svg.setPointerCapture(ev.pointerId);
	  updateCursor();
	  stopEvent(ev);
	}

    }

	function onPointerUp() {
	  if (!state.attached) return;
	  if (!state.action) return;

	  // ✅ si on n’a jamais dépassé le seuil, on considère que c’était un clic
	  if (state.action.kind === "move_pending") {
		state.action = null;
		state.lastMove = null;
		updateCursor();
		renderSelection();
		toolbarUpdate();
		return;
	  }

	  state.action = null;
	  state.lastMove = null;
	  updateCursor();
	  renderSelection();
	  toolbarUpdate();
	}


function onDblClick(ev) {
	  if (!state.attached) return;

	  const pt = clientToOverlayPoint(ev);
	  const hit = pickObjectAt(pt);
	  if (!hit) return;

	  select(hit.id);

	  try { state.svg.releasePointerCapture && state.svg.releasePointerCapture(ev.pointerId); } catch(_){}
	  state.action = null;
	  state.lastMove = null;
	  updateCursor();

	  enterEdit(hit.id, pt);
	  stopEvent(ev);
	}



    function onKeyDown(ev) {
      if (!state.attached) return;

      if (state.editingId) {
        if (ev.key === "Escape") {
          stopEvent(ev);
          exitEdit(false);
          toolbarUpdate();
          return;
        }
        if (ev.key === "Enter") {
          if (!ev.shiftKey) {
            stopEvent(ev);
            exitEdit(true);
            toolbarUpdate();
          }
          return;
        }
        return;
      }

      if (ev.key === "Delete" || (isMac() && ev.key === "Backspace")) {
        const id = state.selectedId;
        if (id) {
          stopEvent(ev);
          del(id);
        }
      }
    }

    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    function attach() {
      if (state.attached) return;
      state.attached = true;

      buildDOM();
      renderAll();

      state.svg.addEventListener("pointermove", onPointerMove);
      state.svg.addEventListener("pointerdown", onPointerDown);
      state.svg.addEventListener("pointerup", onPointerUp);
      state.svg.addEventListener("pointercancel", onPointerUp);
      state.svg.addEventListener("dblclick", onDblClick);

      for (const k in state.handles) {
        state.handles[k].addEventListener("pointerdown", onPointerDown);
        state.handles[k].addEventListener("pointermove", onPointerMove);
        state.handles[k].addEventListener("pointerup", onPointerUp);
        state.handles[k].addEventListener("pointercancel", onPointerUp);
      }
      state.rotHandle.addEventListener("pointerdown", onPointerDown);
      state.rotHandle.addEventListener("pointermove", onPointerMove);
      state.rotHandle.addEventListener("pointerup", onPointerUp);
      state.rotHandle.addEventListener("pointercancel", onPointerUp);

     state.inlineEdit.addEventListener("blur", () => {
		  if (state.editingId) exitEdit(true);
		});


      // Live toolbar update on selection changes inside contentEditable
	  state.inlineEdit.addEventListener("beforeinput", (e) => {
  if (!state.editingId) return;

  // ✅ si texte par défaut, on vide avant la première vraie saisie
	  if (state._clearDefaultOnFirstInput) {
		// on ne clear que si l'utilisateur tape réellement (insertText / insertFromPaste)
		const t = e.inputType || "";
		if (t.startsWith("insert")) {
		  state.inlineEdit.textContent = "";
		  state._clearDefaultOnFirstInput = false;

		  // place caret
		  const sel = window.getSelection();
		  if (sel) {
			sel.removeAllRanges();
			const r = document.createRange();
			r.selectNodeContents(state.inlineEdit);
			r.collapse(false);
			sel.addRange(r);
		  }
		}
	  }
	});

	  
	  
   state.inlineEdit.addEventListener("input", () => {
  if (!state.editingId) return;

  const obj = getSelectedObj();
  if (obj && obj.id === state.editingId) {
    obj.text = safePlainText(state.inlineEdit.textContent || "");
    fireChange("edit_input", obj);

    const sel = window.getSelection();
    const hasSel = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;

    if (!hasSel) renderAll();  // ✅ live update seulement si pas de surlignage
  }

  toolbarUpdate();
});



      document.addEventListener("selectionchange", () => {
        if (!state.editingId) return;
        toolbarUpdate();
      });

      window.addEventListener("keydown", onKeyDown, true);

      state.svg.addEventListener("mouseleave", () => {
        state.hoverId = null;
        updateCursor();
        renderSelection();
      });

      toolbarUpdate();
    }

    function detach() {
      if (!state.attached) return;
      state.attached = false;

      window.removeEventListener("keydown", onKeyDown, true);
      toolbarDestroy();

      if (state.root && state.root.parentNode === overlayEl) state.root.remove();

      state.root = null;
      state.svg = null;
      state.defs = null;
      state.objectsG = null;
      state.uiLayer = null;
      state.handles = null;
      state.rotHandle = null;
      state.rotStem = null;
      state.outline = null;
      state.guide = null;
      state.selG = null;
      state.editWrap = null;
      state.editInput = null;

      state.selectedId = null;
      state.hoverId = null;
      state.editingId = null;
      state.action = null;
      state.rafPending = false;
      state.lastMove = null;
      state._savedRange = null;
    }

    function insertTextCircle(partial) {
      const objs = getPageObjects(draft, pageIndex);

      const w = overlayEl.clientWidth || 800;
      const h = overlayEl.clientHeight || 600;

      const base = newTextCircle(
        (partial && Number.isFinite(partial.x) ? partial.x : w * 0.5),
        (partial && Number.isFinite(partial.y) ? partial.y : h * 0.4)
      );

      const obj = Object.assign(base, partial || {});
      obj.r = clamp(Number(obj.r || base.r), 10, 2000);
      obj.rotation = ((Number(obj.rotation || 0) % 360) + 360) % 360;
      obj.startAngle = ((Number(obj.startAngle || 0) % 360) + 360) % 360;
      obj.side = obj.side === "inner" ? "inner" : "outer";
      obj.text = safePlainText(obj.text || base.text);

      if (!obj.font) obj.font = defaultFont();
      if (!obj.color) obj.color = "#111827";

      objs.push(obj);

      // ✅ selection uses select() to update toolbar
      select(obj.id);

      fireChange("insert", obj);
      renderAll();

      return obj;
    }

    function select(id) {
      const next = id || null;

      // leaving edit if selecting none or another
      if (state.editingId && next !== state.editingId) {
        exitEdit(true);
      }

      state.selectedId = next;

      if (!state.selectedId) {
        state.hoverId = null;
        toolbarClosePopovers();
      }

      renderAll();
      fireChange("select", getSelectedObj() || null);
      toolbarUpdate();
    }

    function del(id) {
      const objs = getPageObjects(draft, pageIndex);
      const obj = findObj(objs, id);
      if (!obj) return;

      if (state.editingId === id) exitEdit(false);

      removeObj(objs, id);
      if (state.selectedId === id) state.selectedId = null;
      if (state.hoverId === id) state.hoverId = null;

      // ✅ close popovers when deleting
      toolbarClosePopovers();

      fireChange("delete", obj);
      renderAll();
      toolbarUpdate();
    }

    function render() {
      renderAll();
    }

    function fireChange(reason, obj) {
      if (!onChange) return;
      try {
        onChange({
          reason,
          pageIndex,
          selectedId: state.selectedId,
          object: obj,
          draft,
        });
      } catch (e) {
        console.warn("[TextCircleTools] onChange error:", e);
      }
    }

    // ----------------------------------------------------------
    // Mini "bridge-ready" host (kept for compatibility)
    // ----------------------------------------------------------
    function getTextHost() {
      return {
        isEditing: () => !!state.editingId,
        getEditingEl: () => state.inlineEdit,
        getSelectedId: () => state.selectedId,
        getSelectedObject: () => getSelectedObj(),
        applyStylePatch: (patch) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.font = obj.font || defaultFont();
          if (patch.font) obj.font = Object.assign({}, obj.font, patch.font);
          if (patch.color) obj.color = patch.color;
          if (patch.side) obj.side = patch.side === "inner" ? "inner" : "outer";
          if (Number.isFinite(patch.startAngle)) obj.startAngle = ((patch.startAngle % 360) + 360) % 360;
          fireChange("style_patch", obj);
          renderAll();
          toolbarUpdate();
        },
      };
    }

    // ----------------------------------------------------------
    // Sandbox helper
    // ----------------------------------------------------------
    function setupSandbox(ui) {
      const api = {
        insert: () => insertTextCircle({}),
        setSide: (side) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.side = side === "inner" ? "inner" : "outer";
          fireChange("side", obj);
          renderAll();
        },
        setText: (t) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.text = safePlainText(t);
          fireChange("text", obj);
          renderAll();
        },
        setSize: (n) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.font = obj.font || defaultFont();
          obj.font.size = clamp(Number(n), 6, 220);
          fireChange("font_size", obj);
          renderAll();
        },
        setColor: (c) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.color = String(c || "#111827");
          fireChange("color", obj);
          renderAll();
        },
        setStartAngle: (a) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.startAngle = ((Number(a) % 360) + 360) % 360;
          fireChange("startAngle", obj);
          renderAll();
        },
        setRotation: (r) => {
          const obj = getSelectedObj();
          if (!obj) return;
          obj.rotation = ((Number(r) % 360) + 360) % 360;
          fireChange("rotation", obj);
          renderAll();
        },
        updateDebug: (ta) => {
          if (!ta) return;
          try { ta.value = JSON.stringify(draft, null, 2); } catch (_) {}
        },
      };

      if (ui && ui.btnAdd) {
        ui.btnAdd.addEventListener("click", () => {
          const o = insertTextCircle({});
          enterEdit(o.id);
          if (ui.inputText) ui.inputText.value = o.text || "";
          if (ui.inputSize) ui.inputSize.value = o.font && o.font.size ? o.font.size : 26;
          if (ui.inputColor) ui.inputColor.value = o.color || "#111827";
          if (ui.toggleSide) ui.toggleSide.value = o.side || "outer";
          if (ui.inputStartAngle) ui.inputStartAngle.value = o.startAngle || 0;
          if (ui.inputRotation) ui.inputRotation.value = o.rotation || 0;
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.toggleSide) {
        ui.toggleSide.addEventListener("change", () => {
          api.setSide(ui.toggleSide.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.inputText) {
        ui.inputText.addEventListener("input", () => {
          api.setText(ui.inputText.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.inputSize) {
        ui.inputSize.addEventListener("input", () => {
          api.setSize(ui.inputSize.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.inputColor) {
        ui.inputColor.addEventListener("input", () => {
          api.setColor(ui.inputColor.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.inputStartAngle) {
        ui.inputStartAngle.addEventListener("input", () => {
          api.setStartAngle(ui.inputStartAngle.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      if (ui && ui.inputRotation) {
        ui.inputRotation.addEventListener("input", () => {
          api.setRotation(ui.inputRotation.value);
          api.updateDebug(ui.debugTextarea);
        });
      }

      return api;
    }

    // Public object
    const api = {
      attach,
      detach,
      insertTextCircle,
      select,
      delete: del,
      render,
      setupSandbox,

      // ✅ new
      attachTextToolbarBridge,
      getSelected: () => state.selectedId,

      // legacy/internal
      _getTextHost: getTextHost,
    };

    return api;
  }

  // expose
  global.createTextCircleController = createTextCircleController;
})(window);

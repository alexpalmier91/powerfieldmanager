/* app/static/labo/editor/editor_interactions.js
   Interactions: selection, drag (delegation), delete, wheel zoom, options live
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const A = EditorApp.actions;
  const { state } = EditorApp;

  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }

  function rotateVec(x, y, deg) {
    const a = degToRad(deg);
    const c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function screenToPagePoint(e) {
    const wrap = document.getElementById("canvasWrap");
    const pageEl = EditorApp.refs?.pageEl;
    if (!wrap || !pageEl) return { x: 0, y: 0 };

    const wrapRect = wrap.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    const mx = e.clientX - wrapRect.left + wrap.scrollLeft;
    const my = e.clientY - wrapRect.top + wrap.scrollTop;

    const pageLeftInWrap = (pageRect.left - wrapRect.left + wrap.scrollLeft);
    const pageTopInWrap  = (pageRect.top - wrapRect.top + wrap.scrollTop);

    const pxZoomed = mx - pageLeftInWrap;
    const pyZoomed = my - pageTopInWrap;

    const z = state.zoom || 1;
    return { x: pxZoomed / z, y: pyZoomed / z };
  }

  function setupButtons() {
    const btnAddPage = document.getElementById("btnAddPage");
    const btnZoomIn = document.getElementById("btnZoomIn");
    const btnZoomOut = document.getElementById("btnZoomOut");
    const btnZoomFit = document.getElementById("btnZoomFit");

    btnAddPage.addEventListener("click", () => A.addPage());
    btnZoomIn.addEventListener("click", () => A.setZoom(state.zoom * 1.1));
    btnZoomOut.addEventListener("click", () => A.setZoom(state.zoom * 0.9));
    btnZoomFit.addEventListener("click", () => A.setZoom(1));
  }

  // ---------------------------------------------------------------------------
  // ✅ NEW: sélection unifiée pour les blocs Paragraph (toolbar au clic)
  // ---------------------------------------------------------------------------

  function getParagraphIdsFromBlock(blockEl) {
    if (!blockEl) return null;
    const objId =
      blockEl.getAttribute("data-objid") ||
      blockEl.getAttribute("data-obj-id") ||
      blockEl.dataset?.objid ||
      blockEl.dataset?.objId;

    const pageIndex = Number(blockEl.getAttribute("data-pageindex") || "0") || 0;
    if (!objId) return null;
    return { pageIndex, objId: String(objId), blockEl };
  }

  function ensureParaCtrl() {
    // 1) si ton adapter expose une méthode, on l’utilise (le plus fiable)
    try {
      if (typeof EditorApp.ensureParagraphController === "function") {
        const c = EditorApp.ensureParagraphController();
        if (c) return c;
      }
    } catch (_) {}

    // 2) fallback sur global
    return global.__PARA_CTRL__ || null;
  }

  function notifyParagraphSelected(ctrl, pageIndex, objId, blockEl) {
    if (!ctrl) return;

    try { if (typeof ctrl.select === "function") { ctrl.select(pageIndex, objId, blockEl); return; } } catch (_) {}
    try { if (typeof ctrl.setSelected === "function") { ctrl.setSelected(pageIndex, objId, blockEl); return; } } catch (_) {}
    try { if (typeof ctrl.onSelect === "function") { ctrl.onSelect(pageIndex, objId, blockEl); return; } } catch (_) {}
    try { if (typeof ctrl.updateToolbar === "function") { ctrl.updateToolbar(); return; } } catch (_) {}
  
	try { if (typeof ctrl.ensureToolbar === "function") { ctrl.ensureToolbar(); } } catch (_) {}
try { if (typeof ctrl.onMoveOrResize === "function") { ctrl.onMoveOrResize(); } } catch (_) {}

  }

  function setupParagraphSelectionBridge() {
    // Capture = passe avant certains handlers qui pourraient déselectionner,
    // MAIS on ne bloque rien (pas de preventDefault/stopPropagation)
    document.addEventListener("pointerdown", (e) => {
      const blockEl = e.target?.closest?.('.anno-object[data-type="text_paragraph"]');
      if (!blockEl) return;

      const ids = getParagraphIdsFromBlock(blockEl);
      if (!ids) return;

      // ✅ sélection globale via actions (critique pour toolbar/options panel/selBox)
      try {
        A.selectObject(ids.objId);
      } catch (_) {
        state.selectedObjectId = ids.objId;
        try { EditorApp.render?.renderAll?.(); } catch (_) {}
      }

      // ✅ options panel
      try { EditorApp.render?.renderOptionsPanel?.(); } catch (_) {}

      // ✅ notifier ParagraphTools pour afficher la toolbar texte
      // NOTE: on "ensure" le ctrl ici, sinon souvent null au 1er clic
      const ctrl = ensureParaCtrl();
      if (ctrl) {
        notifyParagraphSelected(ctrl, ids.pageIndex, ids.objId, ids.blockEl);
        try { ctrl.onMoveOrResize && ctrl.onMoveOrResize(); } catch (_) {}
      }
      // IMPORTANT: on ne bloque pas l’event => dblclick/édition reste OK
    }, { capture: true });
  }

  // --- Drag via delegation (scalable + évite de rebind à chaque render) -------
  function setupDragDelegation() {
    let dragging = null; // {id, startX, startY, baseX, baseY}

    document.addEventListener("mousedown", (e) => {
      // ✅ Ne jamais démarrer un drag "sandbox" si on clique dans un bloc overlay (Paragraph, Text tools, etc.)
      if (e.target?.closest?.(".anno-object")) return;
      if (e.target?.closest?.('[data-role="richtext"]')) return;

      const objEl = e.target.closest?.(".obj");
      if (!objEl) return;

      const id = objEl.dataset.objId;
      if (!id) return;

      const obj = A.getActivePage()?.objects.find(o => o.id === id);
      if (!obj) return;

      if (e.button !== 0) return;

      const zoom = state.zoom || 1;

      dragging = {
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        baseX: obj.x,
        baseY: obj.y,
        zoom
      };

      A.selectObject(id);
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = (e.clientX - dragging.startClientX) / dragging.zoom;
      const dy = (e.clientY - dragging.startClientY) / dragging.zoom;
      A.updateObject(dragging.id, {
        x: dragging.baseX + dx,
        y: dragging.baseY + dy
      });
    });

    document.addEventListener("mouseup", () => {
      dragging = null;
    });
  }

  function setupUiLayerTransformEngine() {
    const wrap = document.getElementById("canvasWrap");
    if (!wrap) return;

    let mode = null; // "move" | "resize" | "rotate"
    let handle = null;
    let start = null; // snapshot

    function beginTransform(e, nextMode, nextHandle) {
      const obj = A.getSelectedObject();
      if (!obj) return;

      // ✅ laisse les modules spécialisés gérer:
      if (obj.type === "shape") return;

      // ✅ FIX CRITIQUE: paragraph = type:"text" + mode:"paragraph"
      if (obj.type === "text" && (obj.mode === "line" || obj.mode === "paragraph")) return;

      const p0 = screenToPagePoint(e);
      const cx0 = obj.x + obj.w / 2;
      const cy0 = obj.y + obj.h / 2;

      mode = nextMode;
      handle = nextHandle || null;

      start = {
        id: obj.id,
        p0,
        obj0: { ...obj },
        cx0, cy0
      };

      if (mode === "rotate") {
        const ang0 = Math.atan2(p0.y - cy0, p0.x - cx0);
        start.ang0 = ang0;
      }

      e.preventDefault();
    }

    function applyMove(e) {
      const p = screenToPagePoint(e);
      const dx = p.x - start.p0.x;
      const dy = p.y - start.p0.y;

      A.updateObject(start.id, {
        x: start.obj0.x + dx,
        y: start.obj0.y + dy
      }, { silent: true });

      EditorApp.render.renderTransformsOnly();
    }

    function applyRotate(e) {
      const p = screenToPagePoint(e);
      const cx = start.cx0, cy = start.cy0;

      const ang = Math.atan2(p.y - cy, p.x - cx);
      const delta = ang - start.ang0;

      const rot = start.obj0.rotation + radToDeg(delta);

      A.updateObject(start.id, { rotation: rot }, { silent: true });
      EditorApp.render.renderTransformsOnly();
    }

    function applyResize(e) {
      const obj0 = start.obj0;
      const rot = obj0.rotation || 0;

      const p = screenToPagePoint(e);
      const dxP = p.x - start.p0.x;
      const dyP = p.y - start.p0.y;

      const dL = rotateVec(dxP, dyP, -rot);
      const dxL = dL.x;
      const dyL = dL.y;

      let w = obj0.w;
      let h = obj0.h;

      const hasE = handle.includes("e");
      const hasW = handle.includes("w");
      const hasN = handle.includes("n");
      const hasS = handle.includes("s");

      const alt = e.altKey;

      if (hasE) w = obj0.w + (alt ? 2 * dxL : dxL);
      if (hasW) w = obj0.w - (alt ? 2 * dxL : dxL);
      if (hasS) h = obj0.h + (alt ? 2 * dyL : dyL);
      if (hasN) h = obj0.h - (alt ? 2 * dyL : dyL);

      const MIN = 10;
      w = Math.max(MIN, w);
      h = Math.max(MIN, h);

      if (e.shiftKey) {
        const r = obj0.w / obj0.h || 1;
        const dw = Math.abs(w - obj0.w);
        const dh = Math.abs(h - obj0.h);
        if (dw >= dh) h = Math.max(MIN, w / r);
        else w = Math.max(MIN, h * r);
      }

      let shiftLocalX = 0;
      let shiftLocalY = 0;
      if (!alt) {
        if (hasE || hasW) shiftLocalX = dxL / 2;
        if (hasN || hasS) shiftLocalY = dyL / 2;
      }

      const shiftPage = rotateVec(shiftLocalX, shiftLocalY, rot);

      const cx = start.cx0 + shiftPage.x;
      const cy = start.cy0 + shiftPage.y;

      const x = cx - w / 2;
      const y = cy - h / 2;

      A.updateObject(start.id, { x, y, w, h }, { silent: true });
      EditorApp.render.renderTransformsOnly();
    }

    function endTransform() {
      if (!mode) return;
      mode = null;
      handle = null;
      start = null;
      EditorApp.render.renderAll();
    }

    document.addEventListener("mousedown", (e) => {
      const sel = EditorApp.refs?.selBoxEl;
      if (!sel || sel.classList.contains("hidden")) return;

      const isRot = e.target?.closest?.('[data-role="rot"]');
      const h = e.target?.closest?.(".handle")?.dataset?.h;

      if (isRot) { beginTransform(e, "rotate", null); return; }
      if (h) { beginTransform(e, "resize", h); return; }

      if (e.target === sel || e.target.closest?.(".selBox") === sel) {
        beginTransform(e, "move", null);
        return;
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (!mode || !start) return;
      if (mode === "move") applyMove(e);
      else if (mode === "resize") applyResize(e);
      else if (mode === "rotate") applyRotate(e);
    });

    document.addEventListener("mouseup", () => endTransform());
  }

  // --- Delete selection ------------------------------------------------------
  function setupDeleteKey() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
        A.deleteSelectedObject();
      }
    });
  }

  // --- Options inputs live ---------------------------------------------------
  function setupOptionsInputs() {
    const map = { optX: "x", optY: "y", optW: "w", optH: "h", optR: "rotation", optO: "opacity" };

    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("input", () => {
        if (!state.selectedObjectId) return;
        const key = map[id];
        const v = parseFloat(el.value);
        if (Number.isNaN(v)) return;
        A.updateObject(state.selectedObjectId, { [key]: v });
      });
    });
  }

  // --- Wheel zoom (sur bloc 3) ----------------------------------------------
  function setupWheelZoom() {
    const wrap = document.getElementById("canvasWrap");
    if (!wrap) return;

    wrap.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();

      const beforeZoom = state.zoom;
      const factor = (e.deltaY < 0) ? 1.1 : 0.9;

      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const contentX = wrap.scrollLeft + mx;
      const contentY = wrap.scrollTop + my;

      const px = contentX / beforeZoom;
      const py = contentY / beforeZoom;

      A.setZoom(beforeZoom * factor);

      const afterZoom = state.zoom;

      const newContentX = px * afterZoom;
      const newContentY = py * afterZoom;

      wrap.scrollLeft = newContentX - mx;
      wrap.scrollTop  = newContentY - my;
    }, { passive: false });
  }

  function setupPanSpaceDrag() {
    const wrap = document.getElementById("canvasWrap");
    if (!wrap) return;

    let isSpace = false;
    let panning = null;

    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        isSpace = true;
        wrap.style.cursor = "grab";
        e.preventDefault();
      }
    });

    document.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        isSpace = false;
        wrap.style.cursor = "";
        panning = null;
      }
    });

    wrap.addEventListener("mousedown", (e) => {
      if (!isSpace || e.button !== 0) return;
      panning = { sx: e.clientX, sy: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      wrap.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!panning) return;
      const dx = e.clientX - panning.sx;
      const dy = e.clientY - panning.sy;
      wrap.scrollLeft = panning.sl - dx;
      wrap.scrollTop  = panning.st - dy;
    });

    document.addEventListener("mouseup", () => {
      if (!panning) return;
      panning = null;
      wrap.style.cursor = isSpace ? "grab" : "";
    });

    function isTypingTarget(el) {
      const t = el?.tagName?.toLowerCase?.() || "";
      return t === "input" || t === "textarea" || el?.isContentEditable;
    }
  }

  EditorApp.interactions = {
    setupButtons,
    setupDragDelegation,
    setupDeleteKey,
    setupPanSpaceDrag,
    setupOptionsInputs,
    setupUiLayerTransformEngine,
    setupWheelZoom,

    // ✅ NEW
    setupParagraphSelectionBridge
  };
})(window);

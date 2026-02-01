/* app/static/labo/editor/editor_paragraph_adapter.js
   Adapter ParagraphTools (paragraph_tools.js) <-> EditorApp sandbox UI
   - dblclick = edit
   - drag = via hit-layer hors édition (para-hit)
   - ✅ hover = toolbar visible (même comportement que Simple Text)
   - ✅ calé sur editor_text_simple_adapter.js (ensureController + attach/detach + hook afterCanvasRender)
   - ✅ anti-collisions: stopImmediatePropagation sur les events qui touchent un paragraphe
*/

(function (global) {
  "use strict";

  if (window.__ZH_PARA_ADAPTER_ONCE__) {
    console.warn("[para_adapter] already installed -> skip");
    return;
  }
  window.__ZH_PARA_ADAPTER_ONCE__ = true;

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const state = EditorApp.state || (EditorApp.state = {});
  const A = EditorApp.actions;

  const LOG = true;
  const log = (...a) => { if (LOG) console.log("[para_adapter]", ...a); };

  if (!global.ParagraphTools || typeof global.ParagraphTools.createController !== "function") {
    console.warn("[para_adapter] ParagraphTools.createController introuvable (paragraph_tools.js non chargé ?)");
    return;
  }

  const R = {
    mounted: false,
    ctrl: null,
    overlayBound: null,
    overlayKey: null,
    pageIndex: 0,
    __selectPatched: false
  };

  const DRAG_THRESHOLD_PX = 5;

  function getActivePageIndex() {
    const id = state.activePageId;
    if (!id) return 0;
    const idx = (state.pages || []).findIndex(p => p && p.id === id);
    return Math.max(0, idx);
  }

  function getOverlayEl() {
    return (EditorApp.refs && EditorApp.refs.overlayEl) || null;
  }

	function clearOtherTextToolbars() {
	  // ✅ ne pas hideToolbar (singleton partagé)
	  try { global.__TEXT_SIMPLE_CTRL__?.clearActive?.(); } catch (_) {}
	  try { EditorApp.textSimpleCtrl?.clearActive?.(); } catch (_) {}

	  // optionnel : juste fermer des popovers si tu as l’API
	  try { global.__TEXT_SIMPLE_CTRL__?.closePopovers?.(); } catch (_) {}
	  try { EditorApp.textSimpleCtrl?.closePopovers?.(); } catch (_) {}
	}



  function getFontsForTextTools() {
    let fonts = state.fonts;
    if (!Array.isArray(fonts) || fonts.length === 0) fonts = global.EDITOR_FONTS;

    if (!Array.isArray(fonts) || fonts.length === 0) {
      fonts = [{ name: "helv", label: "Helvetica (défaut)", scope: "default", isDefault: true }];
    }

    const out = fonts.map((f) => {
      if (typeof f === "string") return { name: f, label: f, scope: "global", isDefault: false };
      const name = String(f.name || f.value || f.family || "").trim();
      const label = String(f.label || f.name || f.value || name || "Font").trim();
      return {
        name: name || "helv",
        label,
        scope: String(f.scope || "global").toLowerCase(),
        isDefault: !!f.isDefault,
        href: f.href || f.css || f.cssUrl || null,
        url: f.url || null,
        format: f.format || null,
        weight: f.weight || null,
        style: f.style || null,
      };
    }).filter(x => x && x.name);

    state.fonts = out;
    return out;
  }

  // ---------------------------------------------------------------------------
  // CSS (hit-layer + édition)
  // ---------------------------------------------------------------------------
  function ensureParagraphCssOnce() {
    if (document.getElementById("zh_para_css_v3")) return;
    const st = document.createElement("style");
    st.id = "zh_para_css_v3";
    st.textContent = `
.anno-object[data-type="text_paragraph"]{
  position:absolute;
  box-sizing:border-box;
  touch-action:none;
}
.anno-object[data-type="text_paragraph"] [data-role="richtext"]{
  position:absolute; inset:0;
  outline:none;
  z-index:2;
  pointer-events:auto;
}
.anno-object[data-type="text_paragraph"] .para-hit{
  position:absolute; inset:0;
  z-index:3;
  cursor:move;
  pointer-events:auto;
}
.anno-object[data-type="text_paragraph"]:not(.is-editing) [data-role="richtext"]{
  pointer-events:none;
  user-select:none;
  -webkit-user-select:none;
  cursor:inherit;
}
.anno-object[data-type="text_paragraph"].is-editing .para-hit{
  pointer-events:none;
}
.anno-object[data-type="text_paragraph"].is-editing [data-role="richtext"]{
  pointer-events:auto;
  user-select:text !important;
  -webkit-user-select:text !important;
  cursor:text;
  background:transparent !important;
}
.anno-object[data-type="text_paragraph"].is-editing [data-role="richtext"]::selection{
  background: rgba(37,99,235,.35);
}
`;
    document.head.appendChild(st);
  }

  function ensureParagraphHitLayer(blockEl) {
    if (!blockEl) return;
    if (blockEl.querySelector(".para-hit")) return;
    const hit = document.createElement("div");
    hit.className = "para-hit";
    hit.setAttribute("data-role", "para-hit");
    blockEl.prepend(hit);
  }

  function ensureAllParagraphHitLayers() {
    const overlayEl = getOverlayEl();
    if (!overlayEl) return;
    overlayEl.querySelectorAll('[data-type="text_paragraph"]').forEach(ensureParagraphHitLayer);
  }

  function getParagraphBlockElById(objectId) {
    if (!objectId) return null;
    try {
      const el = EditorApp.refs?.objEls?.get?.(String(objectId));
      if (el) return el;
    } catch (_) {}

    const oe = getOverlayEl();
    if (!oe) return null;
    try {
      return oe.querySelector(`[data-type="text_paragraph"][data-objid="${CSS.escape(String(objectId))}"]`);
    } catch (_) {
      return null;
    }
  }

  function setParagraphEditingVisual(blockEl, isEditing) {
    if (!blockEl) return;
    blockEl.classList.toggle("is-editing", !!isEditing);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function isParagraphObjectId(objectId) {
    if (!objectId) return false;
    const pi = getActivePageIndex();
    const page = state.pages?.[pi];
    const obj = page?.objects?.find(o => String(o.id) === String(objectId));
    if (!obj) return false;
    return String(obj.mode || "").toLowerCase() === "paragraph";
  }

  function isInTextToolbarOrPopover(target, ctrl) {
    if (!target) return false;

    const tbRoot =
      ctrl?.__toolbarEl ||
      window.__ZH_TEXT_TOOLBAR_SINGLETON__?.el ||
      document.querySelector(".tt-toolbar");

    // ✅ dans la toolbar (même zone vide)
    if (tbRoot && tbRoot.contains(target)) return true;

    // ✅ popovers
    if (
      target.closest?.('[data-zh-popover="1"]') ||
      target.closest?.(".zh-font-pop") ||
      target.closest?.(".zh-color-pop") ||
      target.closest?.(".zh-cp-pop") ||
      target.closest?.(".tt-color-pop") ||
      target.closest?.(".color-pop") ||
      target.closest?.("[data-color-picker-pop]")
    ) return true;

    return false;
  }

  function patchSelectObjectOnce() {
    if (R.__selectPatched) return;
    R.__selectPatched = true;

    if (!EditorApp.actions || typeof EditorApp.actions.selectObject !== "function") return;

    const original = EditorApp.actions.selectObject.bind(EditorApp.actions);
    EditorApp.actions.selectObject = function patchedSelectObject(objectId, ...rest) {
      const res = original(objectId, ...rest);

      try {
        const ctrl = ensureController();
        if (!ctrl) return res;

        const act = ctrl.getActive?.();
        if (!act) return res;

        const nextId = objectId == null ? null : String(objectId);

        if (!nextId) {
          ctrl.clearActive?.();
          return res;
        }

        if (!isParagraphObjectId(nextId)) {
          ctrl.clearActive?.();
          return res;
        }
      } catch (_) {}

      return res;
    };
  }

  // ---------------------------------------------------------------------------
  // Controller
  // ---------------------------------------------------------------------------
 function ensureController() {
  // ✅ 1) Si déjà créé, on le garde (NE PAS recréer sur overlay change)
  // Ton overlay DOM est remplacé fréquemment => recréer ici = perdre l'état actif + toolbar qui disparait.
  if (R.ctrl) {
    // on met juste à jour la page (info utile pour getObject)
    R.pageIndex = getActivePageIndex();
    return R.ctrl;
  }

  // ✅ 2) Première création uniquement
  const overlayEl = getOverlayEl();
  if (!overlayEl) return null;

  const pageIndex = getActivePageIndex();

  ensureParagraphCssOnce();

  const fonts = getFontsForTextTools();

  const getHostRect = () => {
    const wrap = document.getElementById("canvasWrap");
    return wrap ? wrap.getBoundingClientRect() : null;
  };

  const getToolbarHostEl = () => document.getElementById("canvasWrap") || null;

  R.ctrl = global.ParagraphTools.createController({
    overlayEl,
    getHostRect,
    getToolbarHostEl,

    getObject: (pi, objectId) => {
      const page = state.pages?.[pi];
      if (!page || !Array.isArray(page.objects)) return null;
      return page.objects.find(o => String(o.id) === String(objectId)) || null;
    },

    setEditingState: (isEditing, objectId) => {
      state.isEditingText = !!isEditing;
      state.editingObjectId = objectId || null;

      if (!objectId) {
        if (state._lastEditingParagraphId) {
          const last = getParagraphBlockElById(state._lastEditingParagraphId);
          if (last) last.classList.remove("is-editing");
        }
        state._lastEditingParagraphId = null;
        try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
        return;
      }

      state._lastEditingParagraphId = String(objectId);

      const blockEl = getParagraphBlockElById(objectId);
      if (!blockEl) return;

      blockEl.classList.toggle("is-editing", !!isEditing);

      if (!isEditing) {
        try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
      }
    },

    onDirty: () => {
      state.dirty = true;
      try { EditorApp.render?.renderOptionsPanel?.(); } catch (_) {}
    },

    getFonts: () => fonts
  });

  try { R.ctrl.attach?.(); } catch (_) {}
  patchSelectObjectOnce();

  // ✅ on garde ça juste pour debug / info
  R.overlayBound = overlayEl;
  R.pageIndex = pageIndex;

  global.__PARA_CTRL__ = R.ctrl;
  log("controller mounted ✅", R.ctrl);

  return R.ctrl;
}



  EditorApp.ensureParagraphController = ensureController;

  // ---------------------------------------------------------------------------
  // Insert
  // ---------------------------------------------------------------------------
  function fallbackMakeParagraphObject(partial) {
    const p = partial || {};
    const id = p.id || `para_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    return {
      id,
      type: "text",
      mode: "paragraph",
      x: p.x ?? 120,
      y: p.y ?? 170,
      w: p.w ?? 360,
      h: p.h ?? 140,
      rotation: p.rotation ?? 0,
      opacity: p.opacity ?? 1,
      text: p.text ?? "Paragraphe",
      html: p.html ?? "",
      color: p.color ?? "#111827",
      align: p.align ?? "left",
      font: Object.assign(
        { family: "helv", size: 14, weight: 400, style: "normal", underline: false, transform: "none" },
        p.font || {}
      ),
      lineHeight: p.lineHeight ?? null,
    };
  }

  function insertParagraph(partial) {
    if (!Array.isArray(state.pages) || !state.pages.length) return null;

    const pageIndex = getActivePageIndex();
    const page = state.pages[pageIndex];
    page.objects = page.objects || [];

    const obj = fallbackMakeParagraphObject(partial);
    page.objects.push(obj);

    state.dirty = true;

    if (EditorApp.requestRender) EditorApp.requestRender();
    else if (EditorApp.render?.renderAll) EditorApp.render.renderAll();

    log("insertParagraph ✅", obj);
    return obj;
  }

  EditorApp.insertParagraph = insertParagraph;

  // ---------------------------------------------------------------------------
  // Routing / hit-test
  // ---------------------------------------------------------------------------
  function findParagraphBlockFromEventTarget(t) {
    if (!t || !t.closest) return null;
    return t.closest('[data-type="text_paragraph"]');
  }

  function isInsideRichtext(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('[data-role="richtext"]');
  }

  function isOnHitLayer(t) {
    if (!t || !t.closest) return false;
    return !!t.closest(".para-hit");
  }

  function getIdsFromBlock(blockEl) {
    const pageIndex = Number(blockEl.getAttribute("data-pageindex") || "0") || 0;
    const objId =
      blockEl.getAttribute("data-objid") ||
      blockEl.getAttribute("data-obj-id") ||
      blockEl.dataset.objid ||
      blockEl.dataset.objId;

    return { pageIndex, objId: String(objId || "") };
  }

  function hitTestParagraphAt(clientX, clientY) {
    const overlayEl = getOverlayEl();
    if (!overlayEl) return null;

    const nodes = Array.from(overlayEl.querySelectorAll('[data-type="text_paragraph"]'));
    if (!nodes.length) return null;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return el;
      }
    }
    return null;
  }

  function resolveParagraphBlockFromEvent(e) {
    let blockEl = findParagraphBlockFromEventTarget(e.target);
    if (blockEl) return blockEl;
    return hitTestParagraphAt(e.clientX, e.clientY);
  }

  // ---------------------------------------------------------------------------
  // Drag
  // ---------------------------------------------------------------------------
  let pending = null;
  let drag = null;
  let raf = 0;

  function scheduleDragUpdate(ctrl) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!drag) return;

      const z = Number(state.zoom || 1) || 1;
      const dx = (drag.lastX - drag.startX) / z;
      const dy = (drag.lastY - drag.startY) / z;

      const nx = drag.ox + dx;
      const ny = drag.oy + dy;

      drag.nx = nx;
      drag.ny = ny;

      if (drag.objRef) { drag.objRef.x = nx; drag.objRef.y = ny; }
      if (drag.blockEl) { drag.blockEl.style.left = nx + "px"; drag.blockEl.style.top = ny + "px"; }

      try { EditorApp.render?.renderTransformsOnly?.(); } catch (_) {}
      try { ctrl?.onMoveOrResize?.(); } catch (_) {}
      try { ctrl?.setActive?.(drag.pageIndex, drag.objId, drag.blockEl); } catch (_) {}
    });
  }

  function beginDragFromPending(e, ctrl) {
    if (!pending) return;

    drag = {
      pageIndex: pending.pageIndex,
      objId: pending.objId,
      blockEl: pending.blockEl,
      pid: pending.pid,
      startX: pending.startX,
      startY: pending.startY,
      lastX: pending.lastX,
      lastY: pending.lastY,
      ox: pending.ox,
      oy: pending.oy,
      nx: pending.ox,
      ny: pending.oy,
      objRef: pending.objRef
    };

    pending = null;

    try { window.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
    try { document.activeElement?.blur?.(); } catch (_) {}
    try { drag.blockEl && drag.blockEl.setPointerCapture(drag.pid); } catch (_) {}

    try { ctrl?.setActive?.(drag.pageIndex, drag.objId, drag.blockEl); } catch (_) {}
    try { ctrl?.onMoveOrResize?.(); } catch (_) {}

    // ✅ on bloque seulement en drag
    e.preventDefault();
    e.stopPropagation();

    scheduleDragUpdate(ctrl);
  }

  function endDrag(e) {
    if (pending) {
      if (e.pointerId == null || e.pointerId === pending.pid) pending = null;
      return;
    }
    if (!drag) return;
    if (e.pointerId != null && e.pointerId !== drag.pid) return;

    try { drag.blockEl && drag.blockEl.releasePointerCapture(drag.pid); } catch (_) {}

    try {
      if (EditorApp.actions?.updateObject) {
        EditorApp.actions.updateObject(drag.objId, { x: drag.nx, y: drag.ny });
      }
    } catch (_) {}

    drag = null;
  }

  // ---------------------------------------------------------------------------
  // Hover toolbar
  // ---------------------------------------------------------------------------
  let hoverObjId = null;

  function setHover(blockEl) {
    const ctrl = ensureController();
    if (!ctrl) return;

    if (state.selectedObjectId) return;

    const act = ctrl.getActive?.();
    if (act && ctrl.isEditingObject?.(act.objectId)) return;

    if (!blockEl) {
      if (hoverObjId && String(state.selectedObjectId || "") !== String(hoverObjId)) {
        ctrl.clearActive?.();
      }
      hoverObjId = null;
      return;
    }

    clearOtherTextToolbars();

    const { pageIndex, objId } = getIdsFromBlock(blockEl);
    if (!objId) return;

    if (String(hoverObjId || "") === String(objId)) return;

    hoverObjId = String(objId);
    try { ctrl.setActive?.(pageIndex, objId, blockEl); } catch (_) {}

    requestAnimationFrame(() => {
      try { ctrl.onMoveOrResize?.(); } catch (_) {}
      try { ctrl.setActive?.(pageIndex, objId, blockEl); } catch (_) {}
    });
  }

  // ---------------------------------------------------------------------------
  // Routing install
  // ---------------------------------------------------------------------------
  
  function isDoubleClick(e) {
  // Simple et robuste
  return !!(e && (e.detail >= 2));
}

  
  function installRoutingOnce() {
    if (installRoutingOnce.__done) return;
    installRoutingOnce.__done = true;

    // dblclick => edit
    document.addEventListener("dblclick", (e) => {
      const blockEl = resolveParagraphBlockFromEvent(e);
      if (!blockEl) return;

      // ✅ anti-collision
      e.__zhHandledBy = "paragraph";
      

      const ctrl = ensureController();
      if (!ctrl) return;

      const { pageIndex, objId } = getIdsFromBlock(blockEl);
      if (!objId) return;

      try { A.selectObject(objId); } catch (_) { state.selectedObjectId = objId; }
      try { EditorApp.render?.renderOptionsPanel?.(); } catch (_) {}

      try { ctrl.enter(pageIndex, objId, blockEl); } catch (err) {
        console.warn("[para_adapter] ctrl.enter error", err);
      }

      setParagraphEditingVisual(blockEl, true);

      const rich = blockEl.querySelector('[data-role="richtext"]');
      if (rich) {
        requestAnimationFrame(() => {
          try { rich.focus({ preventScroll: true }); } catch (_) { try { rich.focus(); } catch(_){} }
        });
      }

      e.preventDefault();
      e.stopPropagation();
    }, true);

    // pointerdown => select (+ drag seulement si hit-layer)
    document.addEventListener("pointerdown", (e) => {
      const blockEl = resolveParagraphBlockFromEvent(e);
      if (!blockEl) return;

      // ✅ anti-collision (le coeur du bug "toolbar disparait au clic")
      e.__zhHandledBy = "paragraph";
	  
      try { e.__zhHandledBy = "paragraph"; } catch (_) {}
try { e.__zhKeepToolbar = true; } catch (_) {}

      const ctrl = ensureController();
      if (!ctrl) return;

      const { pageIndex, objId } = getIdsFromBlock(blockEl);
      if (!objId) return;

      if (e.button !== 0) return;

      ensureParagraphHitLayer(blockEl);

      const inRich = isInsideRichtext(e.target);
      const onHit  = isOnHitLayer(e.target);

      const isEditingThis = !!(ctrl.isEditingObject && ctrl.isEditingObject(objId));
      const wantMoveFromText = !!e.altKey;

      try { A.selectObject(objId); } catch (_) { state.selectedObjectId = objId; }
      try { EditorApp.render?.renderOptionsPanel?.(); } catch (_) {}

      if (isEditingThis && inRich && !wantMoveFromText) {
        try { ctrl.onMoveOrResize?.(); } catch (_) {}
        return;
      }

      if (isEditingThis && !inRich) {
        try { ctrl.exit?.(true); } catch (_) {}
        setParagraphEditingVisual(blockEl, false);
        try { ctrl.setActive?.(pageIndex, objId, blockEl); } catch (_) {}
        clearOtherTextToolbars();
        return;
      }

      if (!isEditingThis) {
		  // ✅ MARQUE L’ÉVÈNEMENT TRÈS TÔT
		  e.__zhHandledBy = "paragraph";
		  try { e.__zhKeepToolbar = true; } catch (_) {}

		  // ✅ IMPORTANT : ne JAMAIS appeler textSimple.hideToolbar()
		  // On "désélectionne" l’autre tool proprement (il va updateFromContext => isVisible:false)
		  try { global.__TEXT_SIMPLE_CTRL__?.clearActive?.(); } catch (_) {}
		  try { EditorApp.textSimpleCtrl?.clearActive?.(); } catch (_) {}

		  try {
			ctrl.setActive?.(pageIndex, objId, blockEl);
			ctrl.onMoveOrResize?.();
		  } catch (err) {
			console.warn("[para_adapter] setActive error", err);
		  }
		}



      // drag prep
      if (!isEditingThis && inRich && !wantMoveFromText && !onHit) return;
      if (!onHit && !(wantMoveFromText && inRich)) return;

      const page = state.pages?.[pageIndex];
      const obj = page?.objects?.find(o => String(o.id) === String(objId));
      if (!obj) return;

      pending = {
        pid: e.pointerId,
        pageIndex,
        objId,
        blockEl,
        objRef: obj,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        ox: Number(obj.x || 0),
        oy: Number(obj.y || 0),
        ctrl
      };
    }, true);
	
	
		


    // pointermove => drag/pending + hover toolbar
    document.addEventListener("pointermove", (e) => {
      if (pending && e.pointerId === pending.pid) {
        pending.lastX = e.clientX;
        pending.lastY = e.clientY;

        const dist = Math.hypot(pending.lastX - pending.startX, pending.lastY - pending.startY);
        if (dist >= DRAG_THRESHOLD_PX) {
          const ctrl = pending.ctrl || ensureController();
          if (!ctrl) return;
          beginDragFromPending(e, ctrl);
        }
        return;
      }

      if (drag && e.pointerId === drag.pid) {
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;

        const ctrl = ensureController();
        if (!ctrl) return;

        scheduleDragUpdate(ctrl);
        e.preventDefault();
        return;
      }

      const ctrl = ensureController();
      if (!ctrl) return;

      // ✅ si on survole toolbar/popover, ne pas toucher au hover
      if (isInTextToolbarOrPopover(e.target, ctrl)) return;

      const blockEl = resolveParagraphBlockFromEvent(e);
      if (blockEl) setHover(blockEl);
      else setHover(null);
    }, true);

    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);

    log("routing installed ✅");
  }

  // ---------------------------------------------------------------------------
  // Hook afterCanvasRender
  // ---------------------------------------------------------------------------
  function mountOnAfterCanvasRender() {
    if (R.mounted) return;
    R.mounted = true;

    EditorApp.hooks = EditorApp.hooks || {};
    EditorApp.hooks.afterCanvasRender = EditorApp.hooks.afterCanvasRender || [];
    EditorApp.hooks.afterCanvasRender.push(() => {
      ensureParagraphCssOnce();
      ensureAllParagraphHitLayers();

      const ctrl = ensureController();
      if (!ctrl) return;
      try { ctrl.onMoveOrResize && ctrl.onMoveOrResize(); } catch (_) {}
	  
	  const selId = state.selectedObjectId;
		if (selId) {
		  const el = getParagraphBlockElById(selId);
		  if (el) {
			const ids = getIdsFromBlock(el);
			try { ctrl.setActive?.(ids.pageIndex, ids.objId, el); } catch (_) {}
		  }
		}

    });
  }

  // Boot
  mountOnAfterCanvasRender();
  installRoutingOnce();
  console.log("[para_adapter] ready");
})(window);

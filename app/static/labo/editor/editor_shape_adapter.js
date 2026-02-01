/* app/static/labo/editor/editor_shape_adapter.js
   Adapter entre EditorApp (pages/zoom) et shape_block_tools.js (createShapeBlockController)

   Objectif:
   - Ne pas créer d'objets "shape" dans EditorApp.state.pages[].objects (évite doublons)
   - Les shapes vivent dans un draft interne (state._shapeDraft) géré par shape_block_tools.js
   - Toujours s'accrocher à l'overlay DOM courant (EditorApp.refs.overlayEl), qui change au renderCanvas()

   + Ajout:
   - Picker de formes (rect/circle/ellipse/line/triangle/arrow) basé sur editor_ui.css (.shape-picker-pop)
   - EditorApp.insertShape(kind, options)
   - EditorApp.ui.openShapePicker(anchorEl)
   - EditorApp.insertShapeBlock(ev) => toggle picker (si event), sinon rect
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const { state } = EditorApp;

  if (typeof global.createShapeBlockController !== "function") {
    console.warn("[shape_adapter] createShapeBlockController introuvable. (shape_block_tools.js non chargé ?)");
    return;
  }

  // ---------------------------------------------------------------------------
  // Draft shapes (1:1 avec state.pages par index)
  // ---------------------------------------------------------------------------
  function ensureShapeDraft() {
    if (!state._shapeDraft) state._shapeDraft = { pages: [] };
    if (!state._shapeDraft.pages) state._shapeDraft.pages = [];

    const n = (state.pages && state.pages.length) ? state.pages.length : 0;

    while (state._shapeDraft.pages.length < n) state._shapeDraft.pages.push({ objects: [] });
    if (state._shapeDraft.pages.length > n) state._shapeDraft.pages.length = n;

    return state._shapeDraft;
  }

  function getActivePageIndex() {
    const id = state.activePageId;
    if (!id) return 0;
    const idx = (state.pages || []).findIndex(p => p && p.id === id);
    return Math.max(0, idx);
  }

  // ---------------------------------------------------------------------------
  // Controller lifecycle (overlay change safe)
  // ---------------------------------------------------------------------------
  const S = {
    ctrl: null,
    ctrlPageIndex: -1,
    ctrlOverlayEl: null,
    mounted: false
  };

  function getOverlayEl() {
    return (EditorApp.refs && EditorApp.refs.overlayEl) || null;
  }

  function detachCtrl() {
    if (S.ctrl) {
      try { S.ctrl.detach(); } catch (_) {}
    }
    S.ctrl = null;
    S.ctrlPageIndex = -1;
    S.ctrlOverlayEl = null;
  }

  function ensureCtrl() {
    const overlayEl = getOverlayEl();
    const pageIndex = getActivePageIndex();
    const draft = ensureShapeDraft();

    if (!overlayEl) return null;

    const mustRebuild =
      !S.ctrl ||
      S.ctrlOverlayEl !== overlayEl ||
      S.ctrlPageIndex !== pageIndex;

    if (mustRebuild) {
      detachCtrl();

      S.ctrl = global.createShapeBlockController({
        overlayEl,
        draft,
        pageIndex,
        onChange: () => {
          // Hook futur: sauver state._shapeDraft dans ton JSON global si besoin
        }
      });

      S.ctrlOverlayEl = overlayEl;
      S.ctrlPageIndex = pageIndex;

      try { S.ctrl.attach(); }
      catch (e) {
        console.error("[shape_adapter] ctrl.attach() error:", e);
        detachCtrl();
        return null;
      }
    }

    return S.ctrl;
  }

  // ---------------------------------------------------------------------------
  // Public API: insert kind
  // ---------------------------------------------------------------------------
  function insert(kind = "rect", options) {
    const ctrl = ensureCtrl();
    if (!ctrl) {
      console.warn("[shape_adapter] insert: ctrl indisponible (overlay pas prêt ?)");
      return null;
    }
    try {
      return ctrl.insertShape(kind, options);
    } catch (e) {
      console.error("[shape_adapter] insertShape error:", e);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Shape Picker UI (utilise editor_ui.css: .shape-picker-pop / .is-open)
  // ---------------------------------------------------------------------------
  const ShapePicker = (() => {
    let pop = null;
    let isOpen = false;
    let lastAnchor = null;

    const SHAPES = [
      { key: "rect", label: "Rectangle", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="7" width="14" height="10" rx="2"/></svg>` },
      { key: "circle", label: "Rond", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>` },
      { key: "ellipse", label: "Ovale", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="7" ry="5"/></svg>` },
      { key: "line", label: "Trait", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>` },
      { key: "triangle", label: "Triangle", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6l8 14H4l8-14z"/></svg>` },
      { key: "arrow", label: "Flèche", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h12"/><path d="M13 6l6 6-6 6"/></svg>` },
    ];

    function ensure() {
      if (pop) return pop;

      pop = document.createElement("div");
      pop.className = "shape-picker-pop";
      pop.innerHTML = `
        <div class="shape-picker-title">Formes</div>
        <div class="shape-picker-grid"></div>
      `;

      const grid = pop.querySelector(".shape-picker-grid");
      SHAPES.forEach(s => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "shape-picker-btn";
        btn.innerHTML = `${s.svg}<span>${s.label}</span>`;
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          insert(s.key);
          close();
        });
        grid.appendChild(btn);
      });

      // empêcher fermeture sur click interne
      pop.addEventListener("pointerdown", (e) => e.stopPropagation());

      document.body.appendChild(pop);
      return pop;
    }

    function placeNear(anchorEl) {
      if (!anchorEl) return;
      const p = ensure();

      // visible le temps de mesurer
      p.classList.add("is-open");
      p.style.visibility = "hidden";

      const r = anchorEl.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const margin = 10;

      let left = r.right + 10;
      let top = r.top + (r.height / 2) - (pr.height / 2);

      if (left + pr.width > window.innerWidth - margin) left = r.left - pr.width - 10;

      left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
      top  = Math.max(margin, Math.min(top, window.innerHeight - pr.height - margin));

      p.style.left = `${Math.round(left)}px`;
      p.style.top  = `${Math.round(top)}px`;
      p.style.visibility = "visible";
    }

    function open(anchorEl) {
      lastAnchor = anchorEl || lastAnchor;
      if (!lastAnchor) return;

      const p = ensure();
      isOpen = true;
      p.classList.add("is-open");
      placeNear(lastAnchor);

      // close outside (install une seule fois par ouverture)
      document.addEventListener("pointerdown", onOutside, true);
      window.addEventListener("keydown", onEsc, true);
    }

    function close() {
      if (!pop) return;
      isOpen = false;
      pop.classList.remove("is-open");
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("keydown", onEsc, true);
    }

    function toggle(anchorEl) {
      if (isOpen) close();
      else open(anchorEl);
    }

    function onOutside(e) {
      if (!isOpen || !pop) return;
      if (pop.contains(e.target)) return;
      close();
    }

    function onEsc(e) {
      if (!isOpen) return;
      if (e.key === "Escape") close();
    }

    // reposition si scroll/resize
    window.addEventListener("scroll", () => { if (isOpen) placeNear(lastAnchor); }, true);
    window.addEventListener("resize", () => { if (isOpen) placeNear(lastAnchor); }, true);

    return { open, close, toggle };
  })();

  // ---------------------------------------------------------------------------
  // Hooks: renderCanvas / selectPage / deletePage
  // ---------------------------------------------------------------------------
  function hookRenderCanvas() {
    if (!EditorApp.render || typeof EditorApp.render.renderCanvas !== "function") return;
    if (S.mounted) return;
    S.mounted = true;

    const orig = EditorApp.render.renderCanvas;
    EditorApp.render.renderCanvas = function patchedRenderCanvas() {
      const r = orig.apply(this, arguments);
      ensureCtrl(); // recolle au nouvel overlay
      return r;
    };
  }

  function hookSelectPage() {
    if (!EditorApp.actions || typeof EditorApp.actions.selectPage !== "function") return;
    const orig = EditorApp.actions.selectPage;
    EditorApp.actions.selectPage = function patchedSelectPage(id) {
      const r = orig.apply(this, arguments);
      ensureShapeDraft();
      detachCtrl();           // overlay va changer
      ShapePicker.close();    // évite popover “perdu”
      return r;
    };
  }

  function hookDeletePage() {
    if (!EditorApp.actions || typeof EditorApp.actions.deletePage !== "function") return;
    const orig = EditorApp.actions.deletePage;
    EditorApp.actions.deletePage = function patchedDeletePage(id) {
      const r = orig.apply(this, arguments);
      ensureShapeDraft();
      detachCtrl();
      ShapePicker.close();
      return r;
    };
  }

  hookRenderCanvas();
  hookSelectPage();
  hookDeletePage();

  // ---------------------------------------------------------------------------
  // Expose API
  // ---------------------------------------------------------------------------
  EditorApp.shapeAdapter = { ensureCtrl, insert };

  EditorApp.insertShape = function (kind, options) {
    return insert(kind || "rect", options);
  };

  EditorApp.ui = EditorApp.ui || {};
  EditorApp.ui.openShapePicker = function (anchorEl) { ShapePicker.open(anchorEl); };
  EditorApp.ui.closeShapePicker = function () { ShapePicker.close(); };

  // IMPORTANT: appelée par tools_bridge quand on clique "Forme"
  // - si event => toggle picker ancré sur le bouton
  // - sinon => insère un rectangle
  EditorApp.insertShapeBlock = function insertShapeBlock(ev) {
    const anchor = ev && ev.currentTarget;
    if (anchor) {
      ShapePicker.toggle(anchor);
      return null;
    }
    return insert("rect");
  };

  console.log("[shape_adapter] ready");
})(window);

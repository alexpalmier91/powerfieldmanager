/* app/static/labo/editor/editor_text_simple_adapter.js
   Adapter TextSimple (text_simple_tools.js) <-> EditorApp sandbox UI
   - Monte createTextSimpleController sur refs.overlayEl (après renderCanvas)
   - Insert via tool rail
   - Évite les collisions avec .obj placeholders
   - ✅ Ne doit PAS gérer les paragraphes (mode="paragraph")
*/




(function (global) {
  "use strict";
  
  if (window.__ZH_TEXT_SIMPLE_ADAPTER_ONCE__) {
  console.warn("[text_simple_adapter] already installed -> skip");
  return;
}
window.__ZH_TEXT_SIMPLE_ADAPTER_ONCE__ = true;

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const state = EditorApp.state || (EditorApp.state = {});
  const A = EditorApp.actions;

  if (typeof global.createTextSimpleController !== "function") {
    console.warn("[text_simple_adapter] createTextSimpleController introuvable (text_simple_tools.js non chargé ?)");
    return;
  }

  const R = {
    mounted: false,
    ctrl: null,
    overlayBound: null,
    pageIndex: 0
  };

  function getActivePageIndex() {
    const id = state.activePageId;
    if (!id) return 0;
    const idx = (state.pages || []).findIndex(p => p && p.id === id);
    return Math.max(0, idx);
  }

  function getOverlayEl() {
    return (EditorApp.refs && EditorApp.refs.overlayEl) || null;
  }

  function screenToPagePoint(e) {
    const wrap = document.getElementById("canvasWrap");
    const pageEl = EditorApp.refs?.pageEl;
    if (!wrap || !pageEl) return { x: 80, y: 80 };

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

  // ✅ Un objet "TextSimple" = type text MAIS PAS un paragraphe
  function isSimpleTextObject(obj) {
    if (!obj) return false;
    if (obj.type !== "text") return false;
    if (String(obj.mode || "").toLowerCase() === "paragraph") return false;
    return true;
  }

  // ✅ Fonts source of truth: state.fonts OR window.EDITOR_FONTS
  function getFontsForTextTools() {
    let fonts = state.fonts;

    if (!Array.isArray(fonts) || fonts.length === 0) {
      fonts = global.EDITOR_FONTS;
    }

    if (!Array.isArray(fonts) || fonts.length === 0) {
      // fallback minimal
      fonts = [{ name: "helv", label: "Helvetica (défaut)", scope: "default", isDefault: true }];
    }

    // normalize: accept {value,label} (paragraph-like) -> {name,label}
    const out = fonts.map((f) => {
      if (typeof f === "string") {
        return { name: f, label: f, scope: "global", isDefault: false };
      }
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

    // Optionnel: on synchronise dans state pour les autres modules
    state.fonts = out;

    return out;
  }

  function ensureController() {
    const overlayEl = getOverlayEl();
    if (!overlayEl) return null;

    const pageIndex = getActivePageIndex();
    const overlayChanged = R.overlayBound !== overlayEl;
    const pageChanged = R.pageIndex !== pageIndex;

    if (!R.ctrl || overlayChanged || pageChanged) {
      // si on change d’overlay, on détache l’ancien
      try { R.ctrl && R.ctrl.detach && R.ctrl.detach(); } catch (_) {}

      // IMPORTANT: draft "proxy" basé sur state.pages
      // ✅ On filtre les objets pour que TextSimple ignore les paragraphes
      const draft = {
        pages: (state.pages || []).map(p => {
          if (!p) return p;
          const objects = Array.isArray(p.objects) ? p.objects.filter(isSimpleTextObject) : [];
          // on copie p sans muter state.pages
          return Object.assign({}, p, { objects });
        })
      };

      const fonts = getFontsForTextTools();

      R.ctrl = global.createTextSimpleController({
        overlayEl,
        draft,
        pageIndex,
        fonts,
        onChange: () => {
          try { EditorApp.render?.renderOptionsPanel?.(); } catch (_) {}
        }
      });

      R.ctrl.attach();

      R.overlayBound = overlayEl;
      R.pageIndex = pageIndex;
    }

    return R.ctrl;
  }

  // --- hooks : appelé après chaque renderCanvas (overlay prêt) ---------------
  function mountOnAfterCanvasRender() {
    if (R.mounted) return;
    R.mounted = true;

    EditorApp.hooks = EditorApp.hooks || {};
    EditorApp.hooks.afterCanvasRender = EditorApp.hooks.afterCanvasRender || [];
    EditorApp.hooks.afterCanvasRender.push(() => {
      const ctrl = ensureController();
      if (!ctrl) return;
      try { ctrl.render(); } catch (_) {}
    });
  }

  // --- Insert API (tool rail) ------------------------------------------------
  function insertTextLine(e) {
    const ctrl = ensureController();
    if (!ctrl) return null;

    const p = (e && e.clientX != null) ? screenToPagePoint(e) : { x: 80, y: 80 };

    // ✅ on force un mode explicite pour éviter toute confusion avec paragraph
    const o = ctrl.insertTextLine({
      mode: "simple",
      x: Math.max(10, p.x - 80),
      y: Math.max(10, p.y - 20),
      w: 340,
      h: 90,
      text: "Texte"
    });

    try { ctrl.render(); } catch (_) {}
    return o;
  }

  // Expose API
  EditorApp.insertTextLine = insertTextLine;

  // Boot
  mountOnAfterCanvasRender();
  console.log("[text_simple_adapter] ready");
})(window);

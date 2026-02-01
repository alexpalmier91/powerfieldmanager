/* text_toolbar_bridge.js
 * Connecte TextToolbarTools à un “TextHost”
 *
 * FIX:
 *  - Si hostEl (ou un parent) a pointer-events:none → on “portal” la toolbar dans document.body
 *    => le bouton color picker devient cliquable, le picker s’ouvre, et ça ne désélectionne plus.
 *  - On ne stoppe PAS les events en capture (sinon on empêche l’ouverture du picker).
 */
(function (global) {
  "use strict";

  function hasPointerEventsNoneAncestor(el) {
    try {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cs = getComputedStyle(cur);
        if (cs && cs.pointerEvents === "none") return true;
        cur = cur.parentElement;
      }
    } catch (_) {}
    return false;
  }

  function portalToBody(toolbarEl) {
    try {
      if (!toolbarEl || !document.body) return false;
      if (toolbarEl.parentElement === document.body) return true;
      document.body.appendChild(toolbarEl);

      // s’assure qu’elle reste au dessus
      toolbarEl.style.position = "fixed"; // TextToolbarTools gère généralement via rects; fixed est safe
      toolbarEl.style.zIndex = "9999999";
      toolbarEl.style.pointerEvents = "auto";
      return true;
    } catch (_) {
      return false;
    }
  }

  function createTextToolbarBridge({ hostEl, textHost }) {
    const TT = global.TextToolbarTools;
    if (!TT || typeof TT.createTextToolbar !== "function") {
      console.warn("[TTB] TextToolbarTools manquant");
      return null;
    }

    const tb = TT.createTextToolbar({
      hostEl,

      getContext: () => {
        try { return textHost.getContext(); }
        catch (e) { console.warn("[TTB] getContext error", e); return { isVisible: false }; }
      },

      onBeforeOpenFontPicker: () => {
        try { textHost.onBeforeOpenFontPicker && textHost.onBeforeOpenFontPicker(); }
        catch (e) { console.warn("[TTB] onBeforeOpenFontPicker error", e); }
      },

      onBeforeOpenColorPicker: () => {
        try { textHost.onBeforeOpenColorPicker && textHost.onBeforeOpenColorPicker(); }
        catch (e) { console.warn("[TTB] onBeforeOpenColorPicker error", e); }
      },

      onAction: (action) => {
        try { textHost.onAction(action); }
        catch (e) { console.warn("[TTB] onAction error", action, e); }
      },
    });

    // ✅ FIX CLÉ : si hostEl est dans une zone pointer-events:none (ou un parent),
    // la toolbar peut être “non cliquable” → on la met dans body.
    try {
      const badHost = hostEl && hasPointerEventsNoneAncestor(hostEl);
      const badParent = tb.el && hasPointerEventsNoneAncestor(tb.el.parentElement);
      if (badHost || badParent) {
        portalToBody(tb.el);
        // NOTE: on garde hostEl pour les calculs de position via getContext()
      }
    } catch (e) {
      console.warn("[TTB] portal check error", e);
    }

    // ✅ Sécurité : rendre cliquable
    try {
      tb.el.style.pointerEvents = "auto";
      tb.el.style.zIndex = "9999999";
    } catch (_) {}

    return {
      el: tb.el,
      update: () => { try { tb.updateFromContext(); } catch (_) {} },
      closePopovers: () => { try { tb.closePopovers && tb.closePopovers(); } catch (_) {} },
      destroy: () => { try { tb.destroy && tb.destroy(); } catch (_) {} },
    };
  }

  global.TextToolbarBridge = { createTextToolbarBridge };
})(window);

/* app/static/labo/editor/editor_state.js
   State + helpers (données, pages, objets) – prêt à brancher tes modules
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  const state = (EditorApp.state = {
    pages: [],
    activePageId: null,
    selectedObjectId: null,
    zoom: 1,
    fonts: [], // ✅ NEW
    fontsMap: {} 
 });
  
    // ✅ Fonts: récupère la config globale posée dans le HTML


  
  function createPage(partial = {}) {
    return {
      id: uid("page"),
      width: 794,   // ~A4 @ 96dpi
      height: 1123,
      objects: [],
      ...partial
    };
  }

  function getActivePage() {
    return state.pages.find(p => p.id === state.activePageId) || null;
  }

  function getSelectedObject() {
    const page = getActivePage();
    return page?.objects.find(o => o.id === state.selectedObjectId) || null;
  }

  function selectPage(id) {
    state.activePageId = id;
    state.selectedObjectId = null;
    EditorApp.render?.renderAll?.();
  }

  function addPage(partial = {}) {
    const p = createPage(partial);
    state.pages.push(p);
    selectPage(p.id);
    return p;
  }

  function deletePage(id) {
    state.pages = state.pages.filter(p => p.id !== id);
    if (state.activePageId === id) state.activePageId = state.pages[0]?.id || null;
    state.selectedObjectId = null;
    EditorApp.render?.renderAll?.();
  }
   function getDefaultFontKey() {
    const list = state.fonts || [];
    const def = list.find(f => f && f.isDefault) || list.find(f => f && f.scope === "default");
    return (def && def.name) ? String(def.name) : "helv";
  }

	  function buildFontsMap(fonts) {
		const m = {};
		(fonts || []).forEach(f => {
		  const k = String(f?.name || "").trim();
		  if (k) m[k] = f;
		});
		return m;
	  }

	  (function initFonts() {
		  const list =
			Array.isArray(global.EDITOR_FONTS) && global.EDITOR_FONTS.length
			  ? global.EDITOR_FONTS
			  : [{ name:"helv", label:"Helvetica (défaut)", scope:"default", isDefault:true }];

		  state.fonts = list;
		  state.fontsMap = buildFontsMap(list);
		})();



  function addObjectToPage(type, partialProps = {}) {
    const page = getActivePage();
    if (!page) return null;

    const obj = {
      id: uid("obj"),
      type,
      x: 60,
      y: 80,
      w: 160,
      h: 90,
      rotation: 0,
      opacity: 1,
      // extensible:
      fill: "#9ca3af",
      text: "Texte",
      fontFamily: getDefaultFontKey(), // ✅ au lieu de "Inter"
      fontSize: 20,
      ...partialProps
    };

    page.objects.push(obj);
    selectObject(obj.id);
    return obj;
  }

  function selectObject(id) {
    state.selectedObjectId = id;
    EditorApp.render?.renderAll?.();
  }

function updateObject(id, patch, opts = {}) {
  const page = getActivePage();
  if (!page) return;

  const obj = page.objects.find(o => o.id === id);
  if (!obj) return;

  Object.assign(obj, patch);

  // ✅ mode silent: pas de renderAll (utilisé pendant drag/resize/rotate)
  if (opts.silent) return;

  EditorApp.render?.renderAll?.();
}


  function deleteSelectedObject() {
    const page = getActivePage();
    if (!page || !state.selectedObjectId) return;
    page.objects = page.objects.filter(o => o.id !== state.selectedObjectId);
    state.selectedObjectId = null;
    EditorApp.render?.renderAll?.();
  }

  function setZoom(z) {
    state.zoom = clamp(z, 0.25, 4);
    EditorApp.render?.renderCanvas?.();
    EditorApp.render?.renderZoomPill?.();
  }

  EditorApp.utils = { uid, clamp };
  EditorApp.actions = {
    createPage, addPage, deletePage, selectPage,
    addObjectToPage, selectObject, updateObject, deleteSelectedObject,
    getActivePage, getSelectedObject,
    setZoom
  };
})(window);

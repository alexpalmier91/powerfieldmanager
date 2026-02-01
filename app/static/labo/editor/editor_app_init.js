/* app/static/labo/editor/editor_app_init.js
   Init runtime de l’éditeur (sandbox)
   ⚠️ renommé volontairement pour ne PAS écraser ton ancien editor_bootstrap.js
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const A = EditorApp.actions;

  function initEditorApp() {
    // 1) Bind DOM
    EditorApp.render.bindDom();

    // 2) State initial
    if (!EditorApp.state.pages.length) {
      A.addPage();
    } else if (!EditorApp.state.activePageId && EditorApp.state.pages[0]) {
      A.selectPage(EditorApp.state.pages[0].id);
    }

    // 3) Interactions
    EditorApp.interactions.setupButtons();
    EditorApp.interactions.setupDragDelegation();
    EditorApp.interactions.setupDeleteKey();
    EditorApp.interactions.setupOptionsInputs();
    EditorApp.interactions.setupWheelZoom();
    EditorApp.interactions.setupPanSpaceDrag();
    EditorApp.interactions.setupUiLayerTransformEngine();

    // ✅ IMPORTANT : sélection paragraphe -> sélection EditorApp -> toolbar/options panel
    if (EditorApp.interactions.setupParagraphSelectionBridge) {
      EditorApp.interactions.setupParagraphSelectionBridge();
    } else {
      console.warn("[EditorApp] setupParagraphSelectionBridge introuvable (editor_interactions.js pas à jour ?)");
    }

    // 4) Premier render
    EditorApp.render.renderAll();

    console.log("[EditorApp] sandbox initialisée");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEditorApp);
  } else {
    initEditorApp();
  }
})(window);

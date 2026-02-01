/* app/static/labo/editor/editor_render.js
   Render UI: tool rail / pages / canvas / options
   Conventions:
   - overlay: contient les objets (div/SVG)
   - uiLayer: réservé sélection/handles futurs
   - data-obj-id pour les objets
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const { state } = EditorApp;
  const A = EditorApp.actions;

  const dom = (EditorApp.dom = {
    toolRail: null,
    pagesList: null,
    pageContainer: null,
    canvasWrap: null,
    zoomPill: null,
    optionsEmpty: null,
    optionsForm: null,
    optX: null, optY: null, optW: null, optH: null, optR: null, optO: null,
    optionsExtra: null
  });

  // ✅ FIX: double assign supprimé
  const refs = (EditorApp.refs = EditorApp.refs || {
    objEls: new Map(),
    pageEl: null,
    overlayEl: null,
    uiLayerEl: null,
    selBoxEl: null
  });

  // hooks container (safe)
  EditorApp.hooks = EditorApp.hooks || {};
  EditorApp.hooks.afterCanvasRender = EditorApp.hooks.afterCanvasRender || [];

  function runAfterCanvasRenderHooks() {
    const list = EditorApp.hooks?.afterCanvasRender;
    if (!Array.isArray(list) || !list.length) return;
    for (const fn of list) {
      try { fn(); } catch (e) { console.warn("[render] afterCanvasRender hook error:", e); }
    }
  }

  function bindDom() {
    dom.toolRail = document.getElementById("toolRail");
    dom.pagesList = document.getElementById("pagesList");
    dom.pageContainer = document.getElementById("pageContainer");
    dom.canvasWrap = document.getElementById("canvasWrap");
    dom.zoomPill = document.getElementById("zoomPill");
    dom.optionsEmpty = document.getElementById("optionsEmpty");
    dom.optionsForm = document.getElementById("optionsForm");
    dom.optX = document.getElementById("optX");
    dom.optY = document.getElementById("optY");
    dom.optW = document.getElementById("optW");
    dom.optH = document.getElementById("optH");
    dom.optR = document.getElementById("optR");
    dom.optO = document.getElementById("optO");
    dom.optionsExtra = document.getElementById("optionsExtra");
  }

  function renderToolRail() {
    const rail = dom.toolRail;
    rail.innerHTML = "";

    (EditorApp.tools?.list || []).forEach(t => {
      const b = document.createElement("button");
      b.className = "tool-btn";
      b.type = "button";
      b.setAttribute("data-tooltip", t.tip);
      b.textContent = t.icon;

      // ✅ IMPORTANT: passer l'event à insert(e)
      b.addEventListener("click", (e) => {
        try { t.insert && t.insert(e); } catch (err) { console.error("[toolRail] insert error:", err); }
      });

      rail.appendChild(b);
    });
  }

  function renderPagesList() {
    const el = dom.pagesList;
    el.innerHTML = "";

    state.pages.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "page-thumb" + (p.id === state.activePageId ? " active" : "");
      card.innerHTML = `
        <div class="mini"></div>
        <div class="label">
          <span>Page ${idx + 1}</span>
          <span class="actions">
            <span class="delete" title="Supprimer">🗑</span>
          </span>
        </div>
      `;

      card.addEventListener("click", () => A.selectPage(p.id));
      card.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        A.deletePage(p.id);
      });

      el.appendChild(card);
    });
  }

  function objInnerHTML(o) {
    if (o.type === "text") {
      return `<div class="placeholder" style="background: transparent; border: 1px dashed rgba(0,0,0,.12);">
        ${escapeHtml(o.text || "Texte")}
      </div>`;
    }
    return `<div class="placeholder">${escapeHtml(o.type)}</div>`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function resolveFontFamilyCss(fontKey) {
    const k = String(fontKey || "").trim();
    if (!k || k === "helv") return "Helvetica, Arial, sans-serif";
    return `${k}, Helvetica, Arial, sans-serif`;
  }

  function paragraphInnerHTML(o) {
    const html = (o.html && String(o.html).trim()) ? String(o.html) : escapeHtml(o.text || "Paragraphe…");
    return `<div data-role="richtext" spellcheck="false">${html}</div>`;
  }

  function getActivePageIndexSafe() {
    const pages = Array.isArray(state.pages) ? state.pages : [];
    const idx = pages.findIndex(p => p && p.id === state.activePageId);
    return idx >= 0 ? idx : 0;
  }

  function renderCanvas() {
    const wrap = dom.pageContainer;
    wrap.innerHTML = "";

    const page = A.getActivePage();
    if (!page) return;

    const pageEl = document.createElement("div");
    pageEl.className = "page";
    pageEl.style.width = page.width + "px";
    pageEl.style.height = page.height + "px";
    pageEl.style.transform = `scale(${state.zoom})`;

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const uiLayer = document.createElement("div");
    uiLayer.className = "uiLayer";

    // refs
    refs.objEls = new Map();
    refs.pageEl = pageEl;
    refs.overlayEl = overlay;
    refs.uiLayerEl = uiLayer;

    // --- Selection Box (unique) -------------------------------------------------
    const selBox = document.createElement("div");
    selBox.className = "selBox hidden";
    selBox.innerHTML = `
      <div class="rotLine"></div>
      <div class="rotHandle" data-role="rot"></div>
      <div class="handle" data-h="nw"></div>
      <div class="handle" data-h="n"></div>
      <div class="handle" data-h="ne"></div>
      <div class="handle" data-h="e"></div>
      <div class="handle" data-h="se"></div>
      <div class="handle" data-h="s"></div>
      <div class="handle" data-h="sw"></div>
      <div class="handle" data-h="w"></div>
    `;
    uiLayer.appendChild(selBox);
    refs.selBoxEl = selBox;

    // click empty => deselect (sans renderCanvas)
    pageEl.addEventListener("mousedown", (e) => {
      // ✅ si on clique dans le contenu riche d’un paragraphe => JAMAIS deselect
      if (e.target && e.target.closest && e.target.closest('[data-role="richtext"]')) {
        return;
      }
      // ✅ si on clique sur un bloc paragraphe (cadre) => l’adapter gère
      if (e.target && e.target.closest && e.target.closest('[data-type="text_paragraph"]')) {
        return;
      }

      if (e.target === pageEl || e.target === overlay || e.target === uiLayer) {
        state.selectedObjectId = null;
        if (EditorApp.refs?.selBoxEl) EditorApp.refs.selBoxEl.classList.add("hidden");
        EditorApp.render.renderOptionsPanel();
      }
	  try {
	  const pc = (EditorApp.ensureParagraphController?.() || window.__PARA_CTRL__);
	  pc?.clearActive?.();
	} catch (_) {}

	  
    });

    page.objects.forEach(o => {
      // ✅ shapes: rendus par shape_block_tools.js
      if (o.type === "shape") return;

      // ✅ text_simple_tools.js (line text) : rendu par son controller
      if (o.type === "text" && o.mode === "line") return;

      // ✅ paragraph: host DOM only (le controller/adapters gèrent events)
      const isParagraph =
        (o.type === "paragraph") ||
        (o.type === "text" && o.mode === "paragraph");

      const objEl = document.createElement("div");

      // IMPORTANT: pas de "selected" pour paragraphe (il a sa propre UI)
      objEl.className = isParagraph ? "anno-object obj" : "obj";

      objEl.dataset.objId = o.id;

      if (isParagraph) {
		  objEl.setAttribute("data-type", "text_paragraph");
		  objEl.setAttribute("data-objid", String(o.id));
		  objEl.setAttribute("data-pageindex", String(getActivePageIndexSafe()));

		  // ✅ cadre = déplaçable
		  objEl.style.cursor = "move";
		  objEl.style.userSelect = "none";
		}


      objEl.style.left = o.x + "px";
      objEl.style.top = o.y + "px";
      objEl.style.width = o.w + "px";
      objEl.style.height = o.h + "px";
      objEl.style.opacity = o.opacity;
      objEl.style.transform = `rotate(${o.rotation}deg)`;

      if (isParagraph) {
        objEl.innerHTML = paragraphInnerHTML(o);

        const rich = objEl.querySelector('[data-role="richtext"]');
        const f = o.font || {};

        if (rich) {
          rich.style.width = "100%";
          rich.style.height = "100%";
          rich.style.boxSizing = "border-box";
          rich.style.padding = "8px";
          rich.style.whiteSpace = "pre-wrap";
          rich.style.overflow = "hidden";

          // ✅ texte sélectionnable
         // ✅ Ne pas piloter l'édition ici : le CSS + adapter gèrent
			
			rich.style.userSelect = "";
			rich.style.webkitUserSelect = "";
		

		  
		
          rich.style.fontFamily = resolveFontFamilyCss(f.family || "helv");
          rich.style.fontSize = `${Number(f.size || 14)}px`;
          rich.style.color = String(o.color || f.color || "#111827");
          rich.style.textAlign = String(o.align || "left");

          const tr = String(f.transform || "none");
          rich.style.textTransform =
            tr === "upper" ? "uppercase" :
            tr === "lower" ? "lowercase" :
            tr === "capitalize" ? "capitalize" : "none";

          const lh = o.lineHeight || null;
          rich.style.lineHeight = lh ? String(lh) : "";
        }

        // ⚠️ Pas de handlers ici : sinon tu voles les events au controller/adapters
      } else {
        objEl.innerHTML = objInnerHTML(o);

        objEl.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          A.selectObject(o.id);
        });
      }

      overlay.appendChild(objEl);
      refs.objEls.set(o.id, objEl);
    });

    pageEl.appendChild(overlay);
    pageEl.appendChild(uiLayer);
    wrap.appendChild(pageEl);

    updateSelectionBox();

    // ✅ IMPORTANT: hook après que refs.overlayEl soit prêt
    runAfterCanvasRenderHooks();
  }

  function renderZoomPill() {
    if (!dom.zoomPill) return;
    dom.zoomPill.textContent = Math.round(state.zoom * 100) + "%";
  }

  function renderOptionsPanel() {
    const obj = A.getSelectedObject();

    if (!obj) {
      dom.optionsEmpty.classList.remove("hidden");
      dom.optionsForm.classList.add("hidden");
      return;
    }

    dom.optionsEmpty.classList.add("hidden");
    dom.optionsForm.classList.remove("hidden");

    dom.optX.value = Math.round(obj.x);
    dom.optY.value = Math.round(obj.y);
    dom.optW.value = Math.round(obj.w);
    dom.optH.value = Math.round(obj.h);
    dom.optR.value = Number(obj.rotation || 0);
    dom.optO.value = Number(obj.opacity ?? 1);

    const r = EditorApp.renderers?.get?.(obj.type);
    if (r && typeof r.buildOptions === "function") {
      r.buildOptions(obj, dom.optionsExtra, (patch) => {
        A.updateObject(obj.id, patch);
      });
    } else {
      dom.optionsExtra.textContent = "Options spécifiques – hook à brancher.";
    }
  }

  function renderAll() {
    renderToolRail();
    renderPagesList();
    renderCanvas();
    renderZoomPill();
    renderOptionsPanel();
  }

  function renderTransformsOnly() {
    const page = A.getActivePage();
    if (!page) return;

    for (const o of page.objects) {
      // ✅ shapes gérées ailleurs
      if (o.type === "shape") continue;

      // ✅ text line géré par son controller
      if (o.type === "text" && o.mode === "line") continue;

      // ✅ paragraph bouge aussi (drag via actions.updateObject)
      const el = refs.objEls.get(o.id);
      if (!el) continue;

      el.style.left = o.x + "px";
      el.style.top = o.y + "px";
      el.style.width = o.w + "px";
      el.style.height = o.h + "px";
      el.style.opacity = o.opacity;
      el.style.transform = `rotate(${o.rotation}deg)`;
    }

    updateSelectionBox();
  }

  function updateSelectionBox() {
    const sel = refs.selBoxEl;
    if (!sel) return;

    const obj = A.getSelectedObject();
    if (!obj) {
      sel.classList.add("hidden");
      return;
    }

    // ✅ pas de selBox pour les objets qui ont leur propre UI
    const isParagraph = (obj.type === "paragraph") || (obj.type === "text" && obj.mode === "paragraph");
    const isTextLine = (obj.type === "text" && obj.mode === "line");

    if (isTextLine || isParagraph) {
      sel.classList.add("hidden");
      return;
    }

    sel.classList.remove("hidden");

    sel.style.left = obj.x + "px";
    sel.style.top = obj.y + "px";
    sel.style.width = obj.w + "px";
    sel.style.height = obj.h + "px";
    sel.style.transform = `rotate(${obj.rotation}deg)`;
    sel.style.transformOrigin = "center center";
  }

  EditorApp.render = {
    bindDom,
    renderAll,
    renderToolRail,
    renderPagesList,
    renderCanvas,
    renderOptionsPanel,
    renderTransformsOnly,
    renderZoomPill
  };

})(window);

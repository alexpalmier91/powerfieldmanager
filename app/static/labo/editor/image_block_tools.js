/* app/static/labo/editor/image_block_tools.js
 * Bloc Image avancé (LABO overlay) — sans dépendances externes
 *
 * ✅ FIX CRITIQUE (affichage):
 * - Ne PAS écraser .page-overlay (absolute/inset) défini par ton HTML/app.
 *   Le bug venait de: .page-overlay { position: relative; overflow:hidden; }
 *   => overlay height=0 => tout est clipé => aucune image visible.
 *
 * ✅ insertion:
 * - src = blob URL (URL.createObjectURL) => affichage immédiat
 * - placeholder visible tout de suite, puis autofit au chargement
 * - release blob URLs sur delete/detach
 *
 * ✅ UX:
 * - Arrondis: option dans toolbar (pas par défaut)
 * - Suppr/Backspace: supprime l'image sélectionnée (sauf si focus input/textarea ou crop actif)
 *
 * ✅ Crop:
 * - Empêche l'autofit de réécraser un resize utilisateur:
 *   -> dès que l'utilisateur drag/resize/rotate: obj._pendingAutoFit = false
 *   -> au crop apply: obj._pendingAutoFit = false
 *
 * Interactions:
 * - Drag / Resize / Rotate
 * - Hover: bordure bleue pointillée
 * - Sélection: bordure + handles + toolbar sous l'image
 * - Shift+Resize: conserve proportions
 * - Crop local via canvas
 * - Remove BG V1 par coins + tolérance
 *
 * API:
 *   createImageBlockController({ overlayEl, draft, pageIndex, onChange? })
 *     .attach() / .detach()
 *     .insertImageFromFile(file)
 *     .select(id) / .delete(id)
 *     .render()
 *
 * Sandbox:
 *   setupSandbox()
 */

"use strict";

/* eslint-disable no-alert */

export function createImageBlockController({ overlayEl, draft, pageIndex, onChange }) {
  // -----------------------------
  // Helpers
  // -----------------------------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const deg = (r) => (r * 180) / Math.PI;

  function uid(prefix = "img") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function ensureDraftShape() {
    if (!draft.pages) draft.pages = [];
    if (!draft.pages[pageIndex]) draft.pages[pageIndex] = { objects: [] };
    if (!Array.isArray(draft.pages[pageIndex].objects)) draft.pages[pageIndex].objects = [];
  }

  function getObjects() {
    ensureDraftShape();
    return draft.pages[pageIndex].objects;
  }

  function findObjById(id) {
    return getObjects().find((o) => o && o.id === id) || null;
  }

  function removeObjById(id) {
    const objs = getObjects();
    const idx = objs.findIndex((o) => o && o.id === id);
    if (idx >= 0) objs.splice(idx, 1);
  }

  function emitChange(reason = "change") {
    try {
      onChange && onChange({ reason, draft, pageIndex, selectedId: state.selectedId });
    } catch (e) {
      console.warn("[image_block_tools] onChange error:", e);
    }
  }

  function overlayRect() {
    return overlayEl.getBoundingClientRect();
  }

  function overlaySize() {
    const r = overlayRect();
    const w = Math.max(1, overlayEl.clientWidth || Math.round(r.width) || 1);
    const h = Math.max(1, overlayEl.clientHeight || Math.round(r.height) || 1);
    return { w, h, rect: r };
  }

  function toOverlayLocal(clientX, clientY) {
    const r = overlayRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function getObjCenter(obj) {
    return { cx: obj.x + obj.w / 2, cy: obj.y + obj.h / 2 };
  }

  function parseNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // -----------------------------
  // Keyboard delete
  // -----------------------------
  function onKeyDown(e) {
    if (!state.attached) return;
    if (!state.selectedId) return;

    // ne pas supprimer quand on tape dans un input/textarea/select
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;

    // ✅ ne pas supprimer si crop actif (sinon DOM/listeners peuvent rester dans un état chelou)
    if (state.crop) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      apiDelete(state.selectedId);
    }
  }

  // -----------------------------
  // Styles injection
  // -----------------------------
  function ensureStyles() {
    if (document.getElementById("imgblk-styles")) return;
    const style = document.createElement("style");
    style.id = "imgblk-styles";
    style.textContent = `
/* ⚠️ IMPORTANT:
   On NE touche PAS à position/inset/size de .page-overlay.
   (c'est défini par ton HTML/app, souvent absolute + inset:0)
   On ajoute juste UX/touch + un fallback size. */
.page-overlay{
  user-select:none;
  touch-action:none;
}
.page-overlay.imgblk-overlay-fallback-size{
  width:100%;
  height:100%;
}

/* objet image */
.anno-object[data-type="image"]{
  position:absolute;
  box-sizing:border-box;
  transform-origin: 50% 50%;
}

/* viewport image */
.imgblk-viewport{
  position:absolute;
  inset:0;
  overflow:hidden; /* clip si radius>0 */
}
.imgblk-viewport img{
  width:100%; height:100%;
  display:block;
  pointer-events:none;
  user-select:none;
}

/* outline: hover/selection */
.imgblk-outline{
  position:absolute;
  inset:0;
  pointer-events:none;
  display:none;
  border:1px solid rgba(0, 140, 255, .95);
}
.anno-object[data-type="image"]:not(.is-selected):hover .imgblk-outline{
  display:block;
  border-style:dashed;
}
.anno-object.is-selected .imgblk-outline{
  display:block;
  border-style:solid;
}

/* handles */
.imgblk-handle{
  position:absolute;
  width:10px; height:10px;
  background:#fff;
  border:1px solid rgba(0,0,0,.35);
  border-radius:3px;
  box-shadow:0 1px 2px rgba(0,0,0,.25);
  z-index:5;
  display:none;
}
.anno-object.is-selected .imgblk-handle{ display:block; }
.imgblk-handle[data-h="nw"]{ left:-6px; top:-6px; cursor:nwse-resize; }
.imgblk-handle[data-h="n"] { left:50%; top:-6px; transform:translateX(-50%); cursor:ns-resize; }
.imgblk-handle[data-h="ne"]{ right:-6px; top:-6px; cursor:nesw-resize; }
.imgblk-handle[data-h="e"] { right:-6px; top:50%; transform:translateY(-50%); cursor:ew-resize; }
.imgblk-handle[data-h="se"]{ right:-6px; bottom:-6px; cursor:nwse-resize; }
.imgblk-handle[data-h="s"] { left:50%; bottom:-6px; transform:translateX(-50%); cursor:ns-resize; }
.imgblk-handle[data-h="sw"]{ left:-6px; bottom:-6px; cursor:nesw-resize; }
.imgblk-handle[data-h="w"] { left:-6px; top:50%; transform:translateY(-50%); cursor:ew-resize; }

/* rotate handle */
.imgblk-rotate{
  position:absolute;
  left:50%;
  top:-30px;
  transform:translateX(-50%);
  width:14px; height:14px;
  border-radius:999px;
  background:#fff;
  border:1px solid rgba(0,0,0,.35);
  box-shadow:0 1px 2px rgba(0,0,0,.25);
  z-index:6;
  display:none;
  cursor:grab;
}
.anno-object.is-selected .imgblk-rotate{ display:block; }
.imgblk-rotate:active{ cursor:grabbing; }
.imgblk-rotate::after{
  content:"";
  position:absolute;
  left:50%;
  top:14px;
  width:2px;
  height:12px;
  background:rgba(0,0,0,.35);
  transform:translateX(-50%);
}

/* label taille pendant resize */
.imgblk-size-label{
  position:absolute;
  left:6px; top:6px;
  font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color:#fff;
  background:rgba(0,0,0,.65);
  padding:3px 6px;
  border-radius:8px;
  z-index:10;
  display:none;
}
.anno-object.is-resizing .imgblk-size-label{ display:block; }

/* Toolbar sous l'image */
.imgblk-toolbar{
  position:absolute;
  z-index:9999;
  display:none;
  background: rgba(255,255,255,.95);
  border:1px solid rgba(0,0,0,.08);
  border-radius: 14px;
  box-shadow: 0 12px 28px rgba(0,0,0,.12);
  padding: 8px 10px;
  width: 520px;
  max-width: calc(100% - 24px);
  font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
.imgblk-toolbar.is-visible{ display:block; }

.imgblk-bar{ display:flex; align-items:center; gap:10px; }
.imgblk-chip{
  display:flex; align-items:center; justify-content:center;
  padding: 8px 10px;
  border: 1px solid rgba(0,0,0,.10);
  border-radius: 12px;
  background:#fff;
  cursor:pointer;
  user-select:none;
}
.imgblk-chip:hover{ background:#f3f4f6; }
.imgblk-chip.is-active{
  border-color: rgba(0,140,255,.35);
  background: rgba(0,140,255,.08);
}
.imgblk-chip .ico{ width:16px; height:16px; display:inline-block; }
.imgblk-spacer{ flex:1; }

.imgblk-panel{
  display:none;
  margin-top:8px;
  padding-top:8px;
  border-top:1px solid rgba(0,0,0,.08);
}
.imgblk-panel.is-open{ display:block; }

.imgblk-row{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin-bottom:8px;
}
.imgblk-row:last-child{ margin-bottom:0; }
.imgblk-row .muted{ color:#6b7280; }
.imgblk-row input[type="range"]{ width: 220px; }
.imgblk-row input[type="number"]{ width:70px; padding:4px 6px; }
.imgblk-row input[type="color"]{ width:34px; height:24px; padding:0; border:none; background:transparent; }
.imgblk-btn{
  padding:8px 10px;
  border-radius:12px;
  border:1px solid rgba(0,0,0,.14);
  background:#fff;
  cursor:pointer;
}
.imgblk-btn:hover{ background:#f3f4f6; }

/* Crop */
.imgblk-crop-layer{ position:absolute; inset:0; z-index:20; pointer-events:none; }
.imgblk-crop-rect{
  position:absolute;
  border: 2px solid rgba(0,140,255,.95);
  box-shadow: 0 0 0 9999px rgba(0,0,0,.35);
  pointer-events:auto;
  cursor:move;
}
.imgblk-crop-h{
  position:absolute;
  width:10px; height:10px;
  background:#fff;
  border:1px solid rgba(0,0,0,.35);
  border-radius:2px;
  box-shadow:0 1px 2px rgba(0,0,0,.25);
}
.imgblk-crop-h[data-ch="nw"]{ left:-6px; top:-6px; cursor:nwse-resize; }
.imgblk-crop-h[data-ch="ne"]{ right:-6px; top:-6px; cursor:nesw-resize; }
.imgblk-crop-h[data-ch="se"]{ right:-6px; bottom:-6px; cursor:nwse-resize; }
.imgblk-crop-h[data-ch="sw"]{ left:-6px; bottom:-6px; cursor:nesw-resize; }
.imgblk-crop-actions{
  position:absolute;
  right:8px; bottom:8px;
  display:flex;
  gap:8px;
  z-index:30;
  pointer-events:auto;
}
.imgblk-crop-actions button{
  padding:8px 10px;
  border-radius:12px;
  border:1px solid rgba(0,0,0,.14);
  background:#fff;
  cursor:pointer;
}
.imgblk-crop-actions button.primary{
  background: rgba(0,140,255,.12);
  border-color: rgba(0,140,255,.35);
}
`;
    document.head.appendChild(style);

    // ✅ garde-fou: si l'overlay n'a pas de taille CSS explicite, on le force à 100%
    // (sans toucher au position/inset).
    const rr = overlayEl.getBoundingClientRect();
    if ((rr.width <= 2 || rr.height <= 2) && !overlayEl.classList.contains("imgblk-overlay-fallback-size")) {
      overlayEl.classList.add("imgblk-overlay-fallback-size");
    }
  }

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    attached: false,
    selectedId: null,
    elById: new Map(),
    rafPending: false,
    pendingStyleIds: new Set(),
    action: null,
    crop: null,
    toolbarEl: null,
    activePanel: null,
    blobUrlsById: new Map(),
  };

  // -----------------------------
  // DOM create/update
  // -----------------------------
  function createImageElement(obj) {
    const el = document.createElement("div");
    el.className = "anno-object";
    el.dataset.type = "image";
    el.dataset.objid = obj.id;
    el.dataset.pageindex = String(pageIndex);

    const viewport = document.createElement("div");
    viewport.className = "imgblk-viewport";

    const img = document.createElement("img");
    img.alt = "image";
    img.decoding = "async";
    img.loading = "eager";
    img.src = obj.src || "";
    viewport.appendChild(img);

    const outline = document.createElement("div");
    outline.className = "imgblk-outline";

    const sizeLabel = document.createElement("div");
    sizeLabel.className = "imgblk-size-label";
    sizeLabel.textContent = `${Math.round(obj.w)} x ${Math.round(obj.h)} px`;

    const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => {
      const hd = document.createElement("div");
      hd.className = "imgblk-handle";
      hd.dataset.h = h;
      return hd;
    });

    const rotate = document.createElement("div");
    rotate.className = "imgblk-rotate";
    rotate.dataset.role = "rotate";

    el.appendChild(viewport);
    el.appendChild(outline);
    el.appendChild(sizeLabel);
    handles.forEach((h) => el.appendChild(h));
    el.appendChild(rotate);

    applyObjStylesToElement(obj, el);
    return el;
  }

  function applyObjStylesToElement(obj, el) {
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = `${obj.w}px`;
    el.style.height = `${obj.h}px`;

    const rot = parseNum(obj.rotation, 0);
    el.style.transform = `rotate(${rot}deg)`;

    const op = clamp(parseNum(obj.opacity, 1), 0, 1);
    el.style.opacity = String(op);

    const b = obj.border || { enabled: false, color: "#000000", width: 1 };
    if (b.enabled) {
      const bw = clamp(parseNum(b.width, 1), 0, 50);
      el.style.border = `${bw}px solid ${b.color || "#000000"}`;
    } else {
      el.style.border = "none";
    }

    const sh = obj.shadow || { enabled: false, x: 0, y: 6, blur: 16, opacity: 0.25 };
    if (sh.enabled) {
      const sx = parseNum(sh.x, 0);
      const sy = parseNum(sh.y, 0);
      const bl = clamp(parseNum(sh.blur, 0), 0, 200);
      const so = clamp(parseNum(sh.opacity, 0.25), 0, 1);
      el.style.boxShadow = `${sx}px ${sy}px ${bl}px rgba(0,0,0,${so})`;
    } else {
      el.style.boxShadow = "none";
    }

    const rad = clamp(parseNum(obj.radius, 0), 0, 200);

    const viewport = el.querySelector(".imgblk-viewport");
    if (viewport) viewport.style.borderRadius = `${rad}px`;

    const outline = el.querySelector(".imgblk-outline");
    if (outline) outline.style.borderRadius = `${rad}px`;

    // optionnel: si bordure CSS de l'objet, elle suit le radius
    el.style.borderRadius = `${rad}px`;

    const img = el.querySelector(".imgblk-viewport img");
    if (img && img.src !== obj.src) img.src = obj.src || "";

    const lab = el.querySelector(".imgblk-size-label");
    if (lab) lab.textContent = `${Math.round(obj.w)} x ${Math.round(obj.h)} px`;
  }

  function scheduleStyleUpdate(id) {
    state.pendingStyleIds.add(id);
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(() => {
      state.rafPending = false;
      for (const pid of state.pendingStyleIds) {
        const obj = findObjById(pid);
        const el = state.elById.get(pid);
        if (obj && el) applyObjStylesToElement(obj, el);
      }
      state.pendingStyleIds.clear();
      positionToolbar();
    });
  }

  function render() {
    ensureStyles();
    ensureDraftShape();

    if (!state.toolbarEl) {
      state.toolbarEl = buildToolbar();
      overlayEl.appendChild(state.toolbarEl);
    }

    const objs = getObjects();

    for (const [id, el] of state.elById.entries()) {
      if (!objs.some((o) => o && o.id === id)) {
        el.remove();
        state.elById.delete(id);
      }
    }

    for (const obj of objs) {
      if (!obj || obj.type !== "image") continue;
      let el = state.elById.get(obj.id);
      if (!el) {
        el = createImageElement(obj);
        overlayEl.appendChild(el);
        state.elById.set(obj.id, el);

        const imgEl = el.querySelector(".imgblk-viewport img");
        if (imgEl) {
          imgEl.addEventListener(
            "load",
            () => {
              const o = findObjById(obj.id);
              if (!o) return;
              if (!o._pendingAutoFit) return; // ✅ autofit seulement si encore pending

              try {
                applyNaturalSizeAndFit(o.id, imgEl.naturalWidth, imgEl.naturalHeight);
              } catch (e) {
                console.warn("[imgblk] onload autofit error", e);
              }
            },
            { passive: true }
          );
        }
      } else {
        applyObjStylesToElement(obj, el);
      }
      el.classList.toggle("is-selected", obj.id === state.selectedId);
    }

    positionToolbar();
  }

  // -----------------------------
  // Selection
  // -----------------------------
  function closePanels() {
    state.activePanel = null;
    if (!state.toolbarEl) return;
    state.toolbarEl.querySelectorAll(".imgblk-chip.is-active").forEach((n) => n.classList.remove("is-active"));
    state.toolbarEl.querySelectorAll(".imgblk-panel").forEach((p) => p.classList.remove("is-open"));
  }

  function clearSelection() {
    state.selectedId = null;
    for (const [, el] of state.elById.entries()) el.classList.remove("is-selected");
    closePanels();
    hideToolbar();
    exitCropMode(true);
    emitChange("select_clear");
  }

  function select(id) {
    if (!id) return clearSelection();
    const obj = findObjById(id);
    if (!obj) return clearSelection();

    state.selectedId = id;
    for (const [oid, el] of state.elById.entries()) el.classList.toggle("is-selected", oid === id);
    closePanels();
    showToolbarFor(obj);
    exitCropMode(true);
    emitChange("select");
  }

  // -----------------------------
  // Toolbar
  // -----------------------------
  function svgIco(pathD) {
    return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"/></svg>`;
  }

  function buildToolbar() {
    const t = document.createElement("div");
    t.className = "imgblk-toolbar";
    t.addEventListener("pointerdown", (e) => e.stopPropagation());

    const ICO_CROP = svgIco("M6 2v4H2v2h4v10a2 2 0 0 0 2 2h10v-2H8V8h10V6H8V2H6z");
    const ICO_BG = svgIco("M4 4h16v16H4z M8 8h8v8H8z");
    const ICO_OP = svgIco("M12 3c4.5 5 7 8.5 7 12a7 7 0 0 1-14 0c0-3.5 2.5-7 7-12z");
    const ICO_BORDER = svgIco("M4 4h16v16H4z");
    const ICO_RADIUS = svgIco("M7 7h4M7 7v4M17 7h-4M17 7v4M7 17h4M7 17v-4M17 17h-4M17 17v-4");
    const ICO_SHADOW = svgIco("M7 7h10v10H7z M9 19h10");
    const ICO_TRASH = svgIco("M4 7h16 M10 11v6 M14 11v6 M9 7l1-2h4l1 2 M6 7l1 14h10l1-14");
    const ICO_CLOSE = svgIco("M18 6L6 18 M6 6l12 12");

    t.innerHTML = `
      <div class="imgblk-bar">
        <div class="imgblk-chip" data-act="crop" title="Recadrer">${ICO_CROP}</div>
        <div class="imgblk-chip" data-panel="removebg" title="Supprimer fond">${ICO_BG}</div>
        <div class="imgblk-chip" data-panel="opacity" title="Opacité">${ICO_OP}</div>
        <div class="imgblk-chip" data-panel="border" title="Bordure">${ICO_BORDER}</div>
        <div class="imgblk-chip" data-panel="radius" title="Arrondis">${ICO_RADIUS}</div>
        <div class="imgblk-chip" data-panel="shadow" title="Ombre">${ICO_SHADOW}</div>

        <div class="imgblk-spacer"></div>

        <div class="imgblk-chip" data-act="delete" title="Supprimer">${ICO_TRASH}</div>
        <div class="imgblk-chip" data-act="close" title="Fermer">${ICO_CLOSE}</div>
      </div>

      <div class="imgblk-panel" data-panel="removebg">
        <div class="imgblk-row">
          <span class="muted">Tol.</span>
          <input data-k="tol" type="range" min="0" max="100" value="15" />
          <span data-k="tolv" class="muted" style="width:34px; text-align:right;">15</span>
          <button class="imgblk-btn" data-act="removebg_apply">Appliquer</button>
          <span class="muted">(coins)</span>
        </div>
      </div>

      <div class="imgblk-panel" data-panel="opacity">
        <div class="imgblk-row">
          <span class="muted">Opacité</span>
          <input data-k="opacity" type="range" min="0" max="100" value="100" />
          <span data-k="opv" class="muted" style="width:50px; text-align:right;">100%</span>
        </div>
      </div>

      <div class="imgblk-panel" data-panel="border">
        <div class="imgblk-row">
          <label style="display:flex; gap:8px; align-items:center">
            <input data-k="borderEnabled" type="checkbox" />
            Bordure
          </label>
          <input data-k="borderColor" type="color" value="#111111" />
          <span class="muted">px</span>
          <input data-k="borderWidth" type="number" min="0" max="50" value="1" />
        </div>
      </div>

      <div class="imgblk-panel" data-panel="radius">
        <div class="imgblk-row">
          <span class="muted">Arrondis</span>
          <input data-k="radius" type="range" min="0" max="80" value="0" />
          <span data-k="radiusv" class="muted" style="width:50px; text-align:right;">0px</span>
        </div>
      </div>

      <div class="imgblk-panel" data-panel="shadow">
        <div class="imgblk-row">
          <label style="display:flex; gap:8px; align-items:center">
            <input data-k="shadowEnabled" type="checkbox" />
            Ombre
          </label>
          <span class="muted">x</span><input data-k="shadowX" type="number" value="0" />
          <span class="muted">y</span><input data-k="shadowY" type="number" value="8" />
        </div>
        <div class="imgblk-row">
          <span class="muted">Blur</span>
          <input data-k="shadowBlur" type="number" value="18" />
          <span class="muted">Op.</span>
          <input data-k="shadowOpacity" type="range" min="0" max="100" value="25" />
          <span data-k="sopv" class="muted" style="width:50px; text-align:right;">25%</span>
        </div>
      </div>
    `;

    function togglePanel(name) {
      const chips = t.querySelectorAll(".imgblk-chip[data-panel]");
      const panels = t.querySelectorAll(".imgblk-panel[data-panel]");
      state.activePanel = (state.activePanel === name) ? null : name;
      chips.forEach((c) => c.classList.toggle("is-active", c.dataset.panel === state.activePanel));
      panels.forEach((p) => p.classList.toggle("is-open", p.dataset.panel === state.activePanel));
    }

    t.addEventListener("click", async (e) => {
      const chip = e.target.closest(".imgblk-chip");
      const btn = e.target.closest("button[data-act]");
      const id = state.selectedId;
      const obj = id ? findObjById(id) : null;

      if (chip && chip.dataset.act) {
        if (!obj) return;
        const act = chip.dataset.act;
        if (act === "close") return clearSelection();
        if (act === "delete") return apiDelete(id);
        if (act === "crop") return enterCropMode(id);
      }

      if (chip && chip.dataset.panel) {
        if (!obj) return;
        togglePanel(chip.dataset.panel);
        positionToolbar();
        return;
      }

      if (btn && btn.dataset.act === "removebg_apply") {
        if (!obj) return;
        const tol = getToolbarTol();
        btn.disabled = true;
        btn.textContent = "Traitement...";
        try {
          const newDataUrl = await removeBackgroundByCorners(obj.src, tol);
          obj.src = newDataUrl;
          releaseBlobUrlIfAny(obj.id);
          scheduleStyleUpdate(obj.id);
          emitChange("remove_bg");
        } catch (err) {
          console.warn("[image_block_tools] removebg error:", err);
          alert("Suppression fond: échec.");
        } finally {
          btn.disabled = false;
          btn.textContent = "Appliquer";
        }
      }
    });

    const q = (sel) => t.querySelector(sel);

    const tol = q('input[data-k="tol"]');
    const tolv = q('[data-k="tolv"]');
    tol.addEventListener("input", () => (tolv.textContent = String(tol.value)));

    const op = q('input[data-k="opacity"]');
    const opv = q('[data-k="opv"]');
    op.addEventListener("input", () => {
      opv.textContent = `${op.value}%`;
      const id = state.selectedId;
      const obj = id ? findObjById(id) : null;
      if (!obj) return;
      obj.opacity = clamp(Number(op.value) / 100, 0, 1);
      scheduleStyleUpdate(obj.id);
      emitChange("opacity");
    });

    const borderEnabled = q('input[data-k="borderEnabled"]');
    const borderColor = q('input[data-k="borderColor"]');
    const borderWidth = q('input[data-k="borderWidth"]');
    function onBorderChange() {
      const id = state.selectedId;
      const obj = id ? findObjById(id) : null;
      if (!obj) return;
      obj.border = obj.border || { enabled: false, color: "#111111", width: 1 };
      obj.border.enabled = !!borderEnabled.checked;
      obj.border.color = borderColor.value || "#111111";
      obj.border.width = clamp(parseNum(borderWidth.value, 1), 0, 50);
      scheduleStyleUpdate(obj.id);
      emitChange("border");
    }
    borderEnabled.addEventListener("change", onBorderChange);
    borderColor.addEventListener("input", onBorderChange);
    borderWidth.addEventListener("input", onBorderChange);

    const rad = q('input[data-k="radius"]');
    const radv = q('[data-k="radiusv"]');
    rad.addEventListener("input", () => {
      radv.textContent = `${rad.value}px`;
      const id = state.selectedId;
      const obj = id ? findObjById(id) : null;
      if (!obj) return;
      obj.radius = clamp(parseNum(rad.value, 0), 0, 200);
      scheduleStyleUpdate(obj.id);
      emitChange("radius");
    });

    const shadowEnabled = q('input[data-k="shadowEnabled"]');
    const shadowX = q('input[data-k="shadowX"]');
    const shadowY = q('input[data-k="shadowY"]');
    const shadowBlur = q('input[data-k="shadowBlur"]');
    const shadowOpacity = q('input[data-k="shadowOpacity"]');
    const sopv = q('[data-k="sopv"]');
    shadowOpacity.addEventListener("input", () => {
      sopv.textContent = `${shadowOpacity.value}%`;
      onShadowChange();
    });

    function onShadowChange() {
      const id = state.selectedId;
      const obj = id ? findObjById(id) : null;
      if (!obj) return;
      obj.shadow = obj.shadow || { enabled: false, x: 0, y: 8, blur: 18, opacity: 0.25 };
      obj.shadow.enabled = !!shadowEnabled.checked;
      obj.shadow.x = clamp(parseNum(shadowX.value, 0), -200, 200);
      obj.shadow.y = clamp(parseNum(shadowY.value, 0), -200, 200);
      obj.shadow.blur = clamp(parseNum(shadowBlur.value, 0), 0, 250);
      obj.shadow.opacity = clamp(parseNum(shadowOpacity.value, 25) / 100, 0, 1);
      scheduleStyleUpdate(obj.id);
      emitChange("shadow");
    }

    shadowEnabled.addEventListener("change", onShadowChange);
    shadowX.addEventListener("input", onShadowChange);
    shadowY.addEventListener("input", onShadowChange);
    shadowBlur.addEventListener("input", onShadowChange);

    return t;
  }

  function getToolbarTol() {
    const tol = state.toolbarEl?.querySelector('input[data-k="tol"]');
    return clamp(parseNum(tol?.value, 15), 0, 100);
  }

  function showToolbarFor(obj) {
    if (!state.toolbarEl) return;
    const t = state.toolbarEl;
    const q = (sel) => t.querySelector(sel);

    const rpx = clamp(parseNum(obj.radius, 0), 0, 200);
    q('input[data-k="radius"]').value = String(rpx);
    q('[data-k="radiusv"]').textContent = `${rpx}px`;

    const opPct = Math.round(clamp(parseNum(obj.opacity, 1), 0, 1) * 100);
    q('input[data-k="opacity"]').value = String(opPct);
    q('[data-k="opv"]').textContent = `${opPct}%`;

    obj.border = obj.border || { enabled: false, color: "#111111", width: 1 };
    q('input[data-k="borderEnabled"]').checked = !!obj.border.enabled;
    q('input[data-k="borderColor"]').value = obj.border.color || "#111111";
    q('input[data-k="borderWidth"]').value = String(clamp(parseNum(obj.border.width, 1), 0, 50));

    obj.shadow = obj.shadow || { enabled: false, x: 0, y: 8, blur: 18, opacity: 0.25 };
    q('input[data-k="shadowEnabled"]').checked = !!obj.shadow.enabled;
    q('input[data-k="shadowX"]').value = String(clamp(parseNum(obj.shadow.x, 0), -200, 200));
    q('input[data-k="shadowY"]').value = String(clamp(parseNum(obj.shadow.y, 0), -200, 200));
    q('input[data-k="shadowBlur"]').value = String(clamp(parseNum(obj.shadow.blur, 18), 0, 250));
    const sop = Math.round(clamp(parseNum(obj.shadow.opacity, 0.25), 0, 1) * 100);
    q('input[data-k="shadowOpacity"]').value = String(sop);
    q('[data-k="sopv"]').textContent = `${sop}%`;

    t.classList.add("is-visible");
    positionToolbar();
  }

  function hideToolbar() {
    state.toolbarEl?.classList.remove("is-visible");
  }

  function positionToolbar() {
    const t = state.toolbarEl;
    if (!t || !t.classList.contains("is-visible")) return;

    const id = state.selectedId;
    if (!id) return hideToolbar();

    const el = state.elById.get(id);
    if (!el) return hideToolbar();

    const or = overlayRect();
    const r = el.getBoundingClientRect();

    const gap = 12;
    const desiredLeft = (r.left - or.left) + (r.width / 2) - (t.offsetWidth / 2);
    const desiredTop = (r.bottom - or.top) + gap;

    const maxX = overlayEl.clientWidth - t.offsetWidth - 12;
    const maxY = overlayEl.clientHeight - t.offsetHeight - 12;

    const x = clamp(desiredLeft, 12, Math.max(12, maxX));
    const y = clamp(desiredTop, 12, Math.max(12, maxY));

    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  }

  // -----------------------------
  // Pointer interactions
  // -----------------------------
  function isOnHandle(target) {
    return !!target.closest(
      ".imgblk-handle, .imgblk-rotate, .imgblk-toolbar, .imgblk-crop-rect, .imgblk-crop-h, .imgblk-crop-actions"
    );
  }

  function onOverlayPointerDown(e) {
    if (!state.attached) return;
    if (e.button !== 0) return;
    if (isOnHandle(e.target)) return;

    const objEl = e.target.closest('.anno-object[data-type="image"]');
    if (!objEl) return clearSelection();

    const id = objEl.dataset.objid;
    if (!id) return;
    select(id);

    const obj = findObjById(id);
    if (!obj) return;
    if (state.crop && state.crop.id === id) return;

    const p = toOverlayLocal(e.clientX, e.clientY);
    state.action = {
      kind: "drag",
      id,
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      startObj: { x: obj.x, y: obj.y, w: obj.w, h: obj.h, rotation: obj.rotation },
    };

    overlayEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onObjectHandlePointerDown(e) {
    if (!state.attached) return;
    if (e.button !== 0) return;

    const handle = e.target.closest(".imgblk-handle");
    const rotate = e.target.closest(".imgblk-rotate");
    if (!handle && !rotate) return;

    const objEl = e.target.closest('.anno-object[data-type="image"]');
    if (!objEl) return;

    const id = objEl.dataset.objid;
    if (!id) return;
    select(id);

    const obj = findObjById(id);
    if (!obj) return;
    if (state.crop && state.crop.id === id) return;

    const p = toOverlayLocal(e.clientX, e.clientY);

    if (handle) {
      state.action = {
        kind: "resize",
        id,
        handle: handle.dataset.h,
        pointerId: e.pointerId,
        startX: p.x,
        startY: p.y,
        startObj: { x: obj.x, y: obj.y, w: obj.w, h: obj.h, rotation: obj.rotation },
        aspect: (obj.w && obj.h) ? (obj.w / obj.h) : 1,
      };
      objEl.classList.add("is-resizing");
    } else {
      const { cx, cy } = getObjCenter(obj);
      const startAngle = Math.atan2(p.y - cy, p.x - cx);
      state.action = {
        kind: "rotate",
        id,
        pointerId: e.pointerId,
        startObj: { rotation: parseNum(obj.rotation, 0) },
        cx, cy,
        startAngle,
      };
    }

    overlayEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  function onOverlayPointerMove(e) {
    if (!state.attached || !state.action) return;
    if (e.pointerId !== state.action.pointerId) return;

    const a = state.action;
    const obj = findObjById(a.id);
    if (!obj) return;

    const p = toOverlayLocal(e.clientX, e.clientY);

    if (a.kind === "drag") {
      const dx = p.x - a.startX;
      const dy = p.y - a.startY;
      obj.x = a.startObj.x + dx;
      obj.y = a.startObj.y + dy;

      // ✅ si l'utilisateur bouge l'image, on n'autofit plus jamais
      obj._pendingAutoFit = false;

      scheduleStyleUpdate(obj.id);
      emitChange("drag");
      return;
    }

    if (a.kind === "resize") {
      const dx = p.x - a.startX;
      const dy = p.y - a.startY;

      let nx = a.startObj.x;
      let ny = a.startObj.y;
      let nw = a.startObj.w;
      let nh = a.startObj.h;

      switch (a.handle) {
        case "nw": nx = a.startObj.x + dx; ny = a.startObj.y + dy; nw = a.startObj.w - dx; nh = a.startObj.h - dy; break;
        case "n":  ny = a.startObj.y + dy; nh = a.startObj.h - dy; break;
        case "ne": ny = a.startObj.y + dy; nw = a.startObj.w + dx; nh = a.startObj.h - dy; break;
        case "e":  nw = a.startObj.w + dx; break;
        case "se": nw = a.startObj.w + dx; nh = a.startObj.h + dy; break;
        case "s":  nh = a.startObj.h + dy; break;
        case "sw": nx = a.startObj.x + dx; nw = a.startObj.w - dx; nh = a.startObj.h + dy; break;
        case "w":  nx = a.startObj.x + dx; nw = a.startObj.w - dx; break;
      }

      if (e.shiftKey) {
        const ar = a.aspect || (a.startObj.w / Math.max(1, a.startObj.h));
        const dw = Math.abs(nw - a.startObj.w);
        const dh = Math.abs(nh - a.startObj.h);
        const useWidth = dw >= dh;

        if (useWidth) {
          const targetH = Math.round(nw / Math.max(0.0001, ar));
          if (["nw", "n", "ne"].includes(a.handle)) ny = (a.startObj.y + a.startObj.h) - targetH;
          nh = targetH;
        } else {
          const targetW = Math.round(nh * ar);
          if (["nw", "w", "sw"].includes(a.handle)) nx = (a.startObj.x + a.startObj.w) - targetW;
          nw = targetW;
        }
      }

      const minSize = 20;
      if (nw < minSize) { if (["nw","w","sw"].includes(a.handle)) nx -= (minSize - nw); nw = minSize; }
      if (nh < minSize) { if (["nw","n","ne"].includes(a.handle)) ny -= (minSize - nh); nh = minSize; }

      obj.x = nx; obj.y = ny; obj.w = nw; obj.h = nh;

      // ✅ si l'utilisateur resize l'image, on n'autofit plus jamais
      obj._pendingAutoFit = false;

      scheduleStyleUpdate(obj.id);
      emitChange("resize");
      return;
    }

    if (a.kind === "rotate") {
      const curAngle = Math.atan2(p.y - a.cy, p.x - a.cx);
      const delta = curAngle - a.startAngle;
      const newDeg = a.startObj.rotation + deg(delta);
      obj.rotation = ((newDeg % 360) + 360) % 360;

      // ✅ si l'utilisateur rotate, on n'autofit plus jamais
      obj._pendingAutoFit = false;

      scheduleStyleUpdate(obj.id);
      emitChange("rotate");
    }
  }

  function onOverlayPointerUp(e) {
    if (!state.attached || !state.action) return;
    const a = state.action;
    if (e.pointerId !== a.pointerId) return;

    if (a.kind === "resize") {
      const el = state.elById.get(a.id);
      el && el.classList.remove("is-resizing");
    }

    state.action = null;
    try { overlayEl.releasePointerCapture(e.pointerId); } catch {}
  }

  // -----------------------------
  // Crop / BG removal
  // -----------------------------
  function enterCropMode(id) {
    const obj = findObjById(id);
    const el = state.elById.get(id);
    if (!obj || !el) return;

    exitCropMode(true);

    const viewport = el.querySelector(".imgblk-viewport");
    if (!viewport) return;

    const layer = document.createElement("div");
    layer.className = "imgblk-crop-layer";
    viewport.appendChild(layer);

    const rect = document.createElement("div");
    rect.className = "imgblk-crop-rect";
    layer.appendChild(rect);

    ["nw", "ne", "se", "sw"].forEach((k) => {
      const h = document.createElement("div");
      h.className = "imgblk-crop-h";
      h.dataset.ch = k;
      rect.appendChild(h);
    });

    const actions = document.createElement("div");
    actions.className = "imgblk-crop-actions";
    actions.innerHTML = `
      <button data-cact="cancel">Annuler</button>
      <button class="primary" data-cact="apply">Appliquer</button>
    `;
    layer.appendChild(actions);

    const r = {
      x: Math.round(obj.w * 0.1),
      y: Math.round(obj.h * 0.1),
      w: Math.round(obj.w * 0.8),
      h: Math.round(obj.h * 0.8),
    };

    state.crop = { id, layerEl: layer, rectEl: rect, actionsEl: actions, r, action: null };
    updateCropRectDOM();

    rect.addEventListener("pointerdown", onCropPointerDown);
    actions.addEventListener("click", onCropActionsClick);
  }

  function exitCropMode(silent = false) {
    if (!state.crop) return;
    const c = state.crop;
    try { c.rectEl?.removeEventListener("pointerdown", onCropPointerDown); } catch {}
    try { c.actionsEl?.removeEventListener("click", onCropActionsClick); } catch {}
    try { c.layerEl?.remove(); } catch {}
    state.crop = null;
    if (!silent) emitChange("crop_exit");
  }

  function updateCropRectDOM() {
    const c = state.crop;
    if (!c) return;
    const obj = findObjById(c.id);
    if (!obj) return;

    c.r.x = clamp(c.r.x, 0, Math.max(0, obj.w - 1));
    c.r.y = clamp(c.r.y, 0, Math.max(0, obj.h - 1));
    c.r.w = clamp(c.r.w, 1, obj.w - c.r.x);
    c.r.h = clamp(c.r.h, 1, obj.h - c.r.y);

    c.rectEl.style.left = `${c.r.x}px`;
    c.rectEl.style.top = `${c.r.y}px`;
    c.rectEl.style.width = `${c.r.w}px`;
    c.rectEl.style.height = `${c.r.h}px`;

    positionToolbar();
  }

  function onCropPointerDown(e) {
    const c = state.crop;
    if (!c || e.button !== 0) return;

    const handle = e.target.closest(".imgblk-crop-h");
    c.action = {
      kind: handle ? "resize" : "move",
      handle: handle ? handle.dataset.ch : null,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startR: { ...c.r },
    };

    c.rectEl.setPointerCapture(e.pointerId);
    c.rectEl.addEventListener("pointermove", onCropPointerMove);
    c.rectEl.addEventListener("pointerup", onCropPointerUp, { once: true });
    c.rectEl.addEventListener("pointercancel", onCropPointerUp, { once: true });

    e.preventDefault();
    e.stopPropagation();
  }

  function onCropPointerMove(e) {
    const c = state.crop;
    if (!c || !c.action || e.pointerId !== c.action.pointerId) return;

    const obj = findObjById(c.id);
    if (!obj) return;

    const dx = e.clientX - c.action.startClient.x;
    const dy = e.clientY - c.action.startClient.y;
    const minCrop = 20;

    if (c.action.kind === "move") {
      c.r.x = Math.round(c.action.startR.x + dx);
      c.r.y = Math.round(c.action.startR.y + dy);
      c.r.x = clamp(c.r.x, 0, obj.w - c.r.w);
      c.r.y = clamp(c.r.y, 0, obj.h - c.r.h);
      updateCropRectDOM();
      return;
    }

    let nx = c.action.startR.x, ny = c.action.startR.y, nw = c.action.startR.w, nh = c.action.startR.h;
    switch (c.action.handle) {
      case "nw": nx = c.action.startR.x + dx; ny = c.action.startR.y + dy; nw = c.action.startR.w - dx; nh = c.action.startR.h - dy; break;
      case "ne": ny = c.action.startR.y + dy; nw = c.action.startR.w + dx; nh = c.action.startR.h - dy; break;
      case "se": nw = c.action.startR.w + dx; nh = c.action.startR.h + dy; break;
      case "sw": nx = c.action.startR.x + dx; nw = c.action.startR.w - dx; nh = c.action.startR.h + dy; break;
    }

    if (nw < minCrop) { if (["nw","sw"].includes(c.action.handle)) nx -= (minCrop - nw); nw = minCrop; }
    if (nh < minCrop) { if (["nw","ne"].includes(c.action.handle)) ny -= (minCrop - nh); nh = minCrop; }

    nx = clamp(Math.round(nx), 0, obj.w - 1);
    ny = clamp(Math.round(ny), 0, obj.h - 1);
    nw = clamp(Math.round(nw), 1, obj.w - nx);
    nh = clamp(Math.round(nh), 1, obj.h - ny);

    c.r = { x: nx, y: ny, w: nw, h: nh };
    updateCropRectDOM();
  }

  function onCropPointerUp(e) {
    const c = state.crop;
    if (!c) return;
    try { c.rectEl.releasePointerCapture(e.pointerId); } catch {}
    c.rectEl.removeEventListener("pointermove", onCropPointerMove);
    c.action = null;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load error"));
      img.src = src;
    });
  }

  async function cropImageToRect(src, dispW, dispH, cropRectCss) {
    const img = await loadImage(src);

    const sx = (cropRectCss.x / dispW) * img.naturalWidth;
    const sy = (cropRectCss.y / dispH) * img.naturalHeight;
    const sw = (cropRectCss.w / dispW) * img.naturalWidth;
    const sh = (cropRectCss.h / dispH) * img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/png");
  }

  async function removeBackgroundByCorners(src, tol) {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = im.data;

    const sampleSize = Math.max(6, Math.floor(Math.min(canvas.width, canvas.height) * 0.02));
    const corners = [
      { x0: 0, y0: 0 },
      { x0: canvas.width - sampleSize, y0: 0 },
      { x0: 0, y0: canvas.height - sampleSize },
      { x0: canvas.width - sampleSize, y0: canvas.height - sampleSize },
    ];

    function avgCorner(c) {
      let r = 0, g = 0, b = 0, n = 0;
      const x1 = clamp(c.x0, 0, canvas.width - 1);
      const y1 = clamp(c.y0, 0, canvas.height - 1);
      const x2 = clamp(x1 + sampleSize, 0, canvas.width);
      const y2 = clamp(y1 + sampleSize, 0, canvas.height);
      for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
          const i = (y * canvas.width + x) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
      }
      if (!n) return { r: 255, g: 255, b: 255 };
      return { r: r / n, g: g / n, b: b / n };
    }

    const samples = corners.map(avgCorner);
    const dom = samples.reduce((acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }), { r: 0, g: 0, b: 0 });
    dom.r /= samples.length; dom.g /= samples.length; dom.b /= samples.length;

    const tolMax = 220;
    const thr = (clamp(tol, 0, 100) / 100) * tolMax;

    const w = canvas.width, h = canvas.height;
    const visited = new Uint8Array(w * h);
    const toClear = new Uint8Array(w * h);
    const qx = new Int32Array(w * h);
    const qy = new Int32Array(w * h);
    let qh = 0, qt = 0;

    function colorDist(i) {
      const rr = d[i], gg = d[i + 1], bb = d[i + 2];
      const dr = rr - dom.r, dg = gg - dom.g, db = bb - dom.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    function push(x, y) {
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      qx[qt] = x; qy[qt] = y; qt++;
    }

    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    while (qh < qt) {
      const x = qx[qh], y = qy[qh]; qh++;
      const idx = y * w + x;
      const i = idx * 4;

      if (colorDist(i) <= thr) {
        toClear[idx] = 1;
        if (x > 0) push(x - 1, y);
        if (x < w - 1) push(x + 1, y);
        if (y > 0) push(x, y - 1);
        if (y < h - 1) push(x, y + 1);
      }
    }

    for (let idx = 0; idx < w * h; idx++) {
      if (!toClear[idx]) continue;
      d[idx * 4 + 3] = 0;
    }

    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function onCropActionsClick(e) {
    const c = state.crop;
    if (!c) return;
    const btn = e.target.closest("button[data-cact]");
    if (!btn) return;

    if (btn.dataset.cact === "cancel") {
      exitCropMode();
      return;
    }

    if (btn.dataset.cact === "apply") {
      const obj = findObjById(c.id);
      if (!obj) return;

      btn.disabled = true;
      btn.textContent = "Application...";
      try {
        const dataUrl = await cropImageToRect(obj.src, obj.w, obj.h, c.r);

        obj._pendingAutoFit = false; // ✅ IMPORTANT
        obj.src = dataUrl;

        // libère blob si besoin
        releaseBlobUrlIfAny(obj.id);

        // resize objet au crop
        obj.x = obj.x + c.r.x;
        obj.y = obj.y + c.r.y;
        obj.w = c.r.w;
        obj.h = c.r.h;

        exitCropMode(true);
        scheduleStyleUpdate(obj.id);
        select(obj.id);
        emitChange("crop_apply");
      } catch (err) {
        console.warn("[image_block_tools] crop apply error:", err);
        alert("Recadrage: échec.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Appliquer";
      }
    }
  }

  // -----------------------------
  // Insertion + autofit
  // -----------------------------
  function computeFitPlacement(natW, natH) {
    const pad = 24;
    const { w: ow, h: oh } = overlaySize();
    const maxW = Math.max(50, ow - pad * 2);
    const maxH = Math.max(50, oh - pad * 2);

    let w = Math.max(1, Math.round(natW));
    let h = Math.max(1, Math.round(natH));

    const scale = Math.min(1, maxW / w, maxH / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    let x = Math.round((ow - w) / 2);
    let y = Math.round((oh - h) / 2);

    x = Math.max(0, x);
    y = Math.max(0, y);
    return { x, y, w, h };
  }

  function applyNaturalSizeAndFit(id, natW, natH) {
    const obj = findObjById(id);
    if (!obj) return;

    const p = computeFitPlacement(natW, natH);
    obj.x = p.x;
    obj.y = p.y;
    obj.w = p.w;
    obj.h = p.h;

    obj._pendingAutoFit = false;
    scheduleStyleUpdate(obj.id);
    emitChange("autofit");
  }

  function releaseBlobUrlIfAny(id) {
    const u = state.blobUrlsById.get(id);
    if (u) {
      try { URL.revokeObjectURL(u); } catch {}
      state.blobUrlsById.delete(id);
    }
  }

  async function insertImageFromFile(file) {
    ensureDraftShape();

    const blobUrl = URL.createObjectURL(file);

    const os = overlaySize();
    const fallbackW = Math.min(420, Math.max(180, Math.round(os.w * 0.35)));
    const fallbackH = Math.round(fallbackW * 0.75);

    const obj = {
      id: uid("img"),
      type: "image",
      x: Math.max(0, Math.round((os.w - fallbackW) / 2)),
      y: Math.max(0, Math.round((os.h - fallbackH) / 2)),
      w: fallbackW,
      h: fallbackH,
      rotation: 0,
      opacity: 1,
      border: { enabled: false, color: "#111111", width: 1 },
      shadow: { enabled: false, x: 0, y: 8, blur: 18, opacity: 0.25 },
      radius: 0,
      src: blobUrl,
      _pendingAutoFit: true,
    };

    getObjects().push(obj);
    state.blobUrlsById.set(obj.id, blobUrl);

    render();
    select(obj.id);
    emitChange("insert_image");

    const el = state.elById.get(obj.id);
    const imgEl = el?.querySelector(".imgblk-viewport img");

    if (imgEl) {
      imgEl.src = blobUrl; // onload => autofit (si pas touché par user)
    } else {
      try {
        const im = await loadImage(blobUrl);
        applyNaturalSizeAndFit(obj.id, im.naturalWidth, im.naturalHeight);
      } catch (e) {
        console.warn("[imgblk] decode failed (blob). Leaving placeholder.", e);
        obj._pendingAutoFit = false;
      }
    }

    return obj;
  }

  function apiDelete(id) {
    exitCropMode(true);
    releaseBlobUrlIfAny(id);

    const el = state.elById.get(id);
    if (el) {
      el.remove();
      state.elById.delete(id);
    }
    removeObjById(id);
    if (state.selectedId === id) state.selectedId = null;
    hideToolbar();
    emitChange("delete");
  }

  // -----------------------------
  // Attach/Detach
  // -----------------------------
  function attach() {
    if (state.attached) return;
    state.attached = true;
    ensureStyles();

    overlayEl.addEventListener("pointerdown", onOverlayPointerDown);
    overlayEl.addEventListener("pointermove", onOverlayPointerMove);
    overlayEl.addEventListener("pointerup", onOverlayPointerUp);
    overlayEl.addEventListener("pointercancel", onOverlayPointerUp);
    overlayEl.addEventListener("pointerdown", onObjectHandlePointerDown);

    window.addEventListener("resize", positionToolbar, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);

    render();
  }

  function detach() {
    if (!state.attached) return;
    state.attached = false;

    overlayEl.removeEventListener("pointerdown", onOverlayPointerDown);
    overlayEl.removeEventListener("pointermove", onOverlayPointerMove);
    overlayEl.removeEventListener("pointerup", onOverlayPointerUp);
    overlayEl.removeEventListener("pointercancel", onOverlayPointerUp);
    overlayEl.removeEventListener("pointerdown", onObjectHandlePointerDown);

    window.removeEventListener("resize", positionToolbar);
    window.removeEventListener("keydown", onKeyDown, true);

    exitCropMode(true);
    hideToolbar();

    for (const [, el] of state.elById.entries()) {
      try { el.remove(); } catch {}
    }
    state.elById.clear();

    if (state.toolbarEl) {
      try { state.toolbarEl.remove(); } catch {}
      state.toolbarEl = null;
    }

    for (const [, u] of state.blobUrlsById.entries()) {
      try { URL.revokeObjectURL(u); } catch {}
    }
    state.blobUrlsById.clear();

    state.selectedId = null;
    state.action = null;
    state.rafPending = false;
    state.pendingStyleIds.clear();
    state.activePanel = null;
  }

  return {
    attach,
    detach,
    insertImageFromFile,
    select,
    delete: apiDelete,
    render,
  };
}

// ------------------------------------------------------------
// Sandbox helper
// ------------------------------------------------------------
export function setupSandbox() {
  const overlayEl = document.querySelector(".page-overlay");
  if (!overlayEl) throw new Error("Sandbox: .page-overlay introuvable");

  const draft = { pages: [{ objects: [] }] };
  const pageIndex = 0;

  const debugEl = document.querySelector("#debugJson");
  function refreshDebug() {
    if (!debugEl) return;
    debugEl.value = JSON.stringify(draft, null, 2);
  }

  const ctrl = createImageBlockController({
    overlayEl,
    draft,
    pageIndex,
    onChange: () => refreshDebug(),
  });

  ctrl.attach();

  const btnAdd = document.querySelector("#btnAddImage");
  const input = document.querySelector("#fileInput");
  if (btnAdd && input) {
    btnAdd.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;

      try {
        await ctrl.insertImageFromFile(file);
      } catch (e) {
        console.error("[sandbox] insertImageFromFile failed:", e);
        alert("Upload image: échec (voir console).");
      }
      refreshDebug();
    });
  }

  refreshDebug();
  window.__imgblk = { ctrl, draft };
}

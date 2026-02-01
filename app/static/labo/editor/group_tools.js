/* app/static/labo/editor/group_tools.js
 * - Controller multi-selection + grouping
 * - Floating toolbar (GROUPER/DÉGROUPER) anchored bottom-right of selection bbox
 * - Optional: setupSandbox() to keep HTML minimal
 */
(function (global) {
  "use strict";

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------
  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function rectFromXYWH(x, y, w, h) {
    return { x, y, w, h, x2: x + w, y2: y + h };
  }

  function rectNormalize(r) {
    const x1 = Math.min(r.x, r.x2);
    const y1 = Math.min(r.y, r.y2);
    const x2 = Math.max(r.x, r.x2);
    const y2 = Math.max(r.y, r.y2);
    return { x: x1, y: y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }

  function rectIntersects(a, b) {
    return !(a.x2 < b.x || a.x > b.x2 || a.y2 < b.y || a.y > b.y2);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  // ------------------------------------------------------------
  // Core tools
  // ------------------------------------------------------------
  function computeBoundingBox(page, ids) {
    const objs = page.objects || [];
    const byId = new Map(objs.map((o) => [String(o.id), o]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;

    for (const id of ids) {
      const o = byId.get(String(id));
      if (!o) continue;
      count++;
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + (o.w || 0));
      maxY = Math.max(maxY, o.y + (o.h || 0));
    }

    if (!count) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
  }

  function _ungroupInternal(page, groupId) {
    if (!page.groups || !page.groups[groupId]) return;
    const g = page.groups[groupId];

    for (const id of g.childIds || []) {
      const obj = page.objects.find((o) => String(o.id) === String(id));
      if (obj && String(obj.groupId) === String(groupId)) delete obj.groupId;
    }
    delete page.groups[groupId];
  }

  function createGroup(draft, pageIndex, ids) {
    const page = draft.pages[pageIndex];
    if (!page) return null;

    const unique = Array.from(new Set((ids || []).map(String))).filter(Boolean);
    if (unique.length < 2) return null;

    page.groups = page.groups || {};

    // V1: flatten existing groups touched by selection
    const toUngroup = new Set();
    for (const id of unique) {
      const obj = page.objects.find((o) => String(o.id) === String(id));
      if (obj && obj.groupId) toUngroup.add(String(obj.groupId));
    }
    for (const gid of toUngroup) _ungroupInternal(page, gid);

    const groupId = uid("grp");
    page.groups[groupId] = { id: groupId, childIds: unique.slice() };

    for (const id of unique) {
      const obj = page.objects.find((o) => String(o.id) === String(id));
      if (obj) obj.groupId = groupId;
    }
    return groupId;
  }

  function ungroup(draft, pageIndex, groupId) {
    const page = draft.pages[pageIndex];
    if (!page) return;
    _ungroupInternal(page, String(groupId));
  }

  function applyGroupMove(draft, pageIndex, groupId, dx, dy) {
    const page = draft.pages[pageIndex];
    if (!page || !page.groups || !page.groups[groupId]) return;

    const g = page.groups[groupId];
    for (const id of g.childIds || []) {
      const obj = page.objects.find((o) => String(o.id) === String(id));
      if (!obj) continue;
      obj.x += dx;
      obj.y += dy;
    }
  }

  // ------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------
  function findObjectEl(overlayEl, pageIndex, objId) {
    return overlayEl.querySelector(
      `.anno-object[data-pageindex="${String(pageIndex)}"][data-objid="${String(objId)}"]`
    );
  }

  function setElRect(el, obj) {
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = `${obj.w}px`;
    el.style.height = `${obj.h}px`;
  }

  function renderSelectionBox(overlayEl, boxEl, bbox) {
    if (!boxEl) return;
    boxEl.style.display = "block";
    boxEl.style.left = `${bbox.x}px`;
    boxEl.style.top = `${bbox.y}px`;
    boxEl.style.width = `${bbox.w}px`;
    boxEl.style.height = `${bbox.h}px`;
  }

  function hideSelectionBox(boxEl) {
    if (!boxEl) return;
    boxEl.style.display = "none";
  }

  // ------------------------------------------------------------
  // Controller
  // ------------------------------------------------------------
  function createGroupingController(opts) {
    const overlayEl = opts.overlayEl;
    const draft = opts.draft;
    const pageIndex = opts.pageIndex || 0;

    const onSelectionChanged = typeof opts.onSelectionChanged === "function" ? opts.onSelectionChanged : () => {};
    const onDraftChanged = typeof opts.onDraftChanged === "function" ? opts.onDraftChanged : () => {};

    let selectionBoxEl = opts.selectionBoxEl || null;
    let lassoBoxEl = opts.lassoBoxEl || null;

    const state = {
      selectedIds: new Set(),
      selectedGroupId: null,

      dragging: false,
      lastClientX: 0,
      lastClientY: 0,

      lassoActive: false,
      lassoStart: null,
    };

    if (!selectionBoxEl) {
      selectionBoxEl = document.createElement("div");
      selectionBoxEl.className = "gt-selection-box";
      selectionBoxEl.style.display = "none";
      overlayEl.appendChild(selectionBoxEl);
    }
    if (!lassoBoxEl) {
      lassoBoxEl = document.createElement("div");
      lassoBoxEl.className = "gt-lasso-box";
      lassoBoxEl.style.display = "none";
      overlayEl.appendChild(lassoBoxEl);
    }

    function getPage() {
      return draft.pages[pageIndex];
    }

    function getObj(id) {
      const page = getPage();
      if (!page) return null;
      return page.objects.find((o) => String(o.id) === String(id)) || null;
    }

    function getGroup(groupId) {
      const page = getPage();
      if (!page || !page.groups) return null;
      return page.groups[String(groupId)] || null;
    }

    function computeSelectedGroupId() {
      const page = getPage();
      if (!page || !page.groups) return null;
      const sel = Array.from(state.selectedIds);
      for (const [gid, g] of Object.entries(page.groups)) {
        const childIds = (g.childIds || []).map(String);
        if (childIds.length && childIds.length === sel.length) {
          const ok = childIds.every((id) => state.selectedIds.has(id));
          if (ok) return String(gid);
        }
      }
      return null;
    }

    function getSelectionInfo() {
      const ids = Array.from(state.selectedIds);
      const bbox = ids.length ? computeBoundingBox(getPage(), ids) : null;

      return {
        pageIndex,
        ids,
        bbox,
        groupId: state.selectedGroupId,
        canGroup: ids.length >= 2 && !state.selectedGroupId,
        canUngroup: !!state.selectedGroupId,
      };
    }

    function syncSelectionDom() {
      overlayEl.querySelectorAll(".anno-object.is-selected").forEach((el) => el.classList.remove("is-selected"));
      for (const id of state.selectedIds) {
        const el = findObjectEl(overlayEl, pageIndex, id);
        if (el) el.classList.add("is-selected");
      }

      const info = getSelectionInfo();
      if (info.bbox && info.ids.length) renderSelectionBox(overlayEl, selectionBoxEl, info.bbox);
      else hideSelectionBox(selectionBoxEl);
    }

    function clearSelection() {
      state.selectedIds.clear();
      state.selectedGroupId = null;
      syncSelectionDom();
      onSelectionChanged(getSelectionInfo());
    }

    function expandToGroupIfNeeded(objId) {
      const obj = getObj(objId);
      if (!obj || !obj.groupId) return { ids: [String(objId)], groupId: null };
      const g = getGroup(obj.groupId);
      if (!g) return { ids: [String(objId)], groupId: null };
      return { ids: (g.childIds || []).map(String), groupId: String(g.id) };
    }

    function setSelectionToIds(ids, groupIdOrNull) {
      state.selectedIds.clear();
      for (const id of ids) state.selectedIds.add(String(id));
      state.selectedGroupId = groupIdOrNull ? String(groupIdOrNull) : null;
      syncSelectionDom();
      onSelectionChanged(getSelectionInfo());
    }

    function toggleSelectionForObj(objId) {
      const exp = expandToGroupIfNeeded(objId);
      const ids = exp.ids;
      const allSelected = ids.every((id) => state.selectedIds.has(String(id)));

      if (allSelected) for (const id of ids) state.selectedIds.delete(String(id));
      else for (const id of ids) state.selectedIds.add(String(id));

      state.selectedGroupId = computeSelectedGroupId();
      syncSelectionDom();
      onSelectionChanged(getSelectionInfo());
    }

    function updateDomForSelected() {
      for (const id of state.selectedIds) {
        const obj = getObj(id);
        const el = obj ? findObjectEl(overlayEl, pageIndex, id) : null;
        if (obj && el) setElRect(el, obj);
      }
      syncSelectionDom();
    }

    function applyMoveSelected(dx, dy) {
      if (!dx && !dy) return;
      const page = getPage();
      if (!page) return;

      if (state.selectedGroupId) {
        applyGroupMove(draft, pageIndex, state.selectedGroupId, dx, dy);
      } else {
        for (const id of state.selectedIds) {
          const obj = getObj(id);
          if (!obj) continue;
          obj.x += dx;
          obj.y += dy;
        }
      }
      updateDomForSelected();
      onDraftChanged();
    }

    function pointerToOverlayXY(ev) {
      const r = overlayEl.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function startDrag(ev) {
      state.dragging = true;
      state.lastClientX = ev.clientX;
      state.lastClientY = ev.clientY;
      overlayEl.setPointerCapture(ev.pointerId);
    }

    function stopCapture(ev) {
      try { overlayEl.releasePointerCapture(ev.pointerId); } catch(_) {}
    }

    function onPointerDown(ev) {
      // ✅ IMPORTANT: ne jamais traiter les clics sur la toolbar comme un clic “vide”
      if (ev.target && ev.target.closest && ev.target.closest(".gt-toolbar")) {
        return;
      }

      if (ev.button != null && ev.button !== 0) return;

      const isShift = !!ev.shiftKey;
      const objEl = ev.target.closest(".anno-object");

      if (objEl) {
        ev.preventDefault();
        const objId = String(objEl.dataset.objid);
        const exp = expandToGroupIfNeeded(objId);

        if (isShift) toggleSelectionForObj(objId);
        else setSelectionToIds(exp.ids, exp.groupId);

        // drag selection
        if (state.selectedIds.has(objId) || (exp.groupId && state.selectedGroupId === exp.groupId)) {
          startDrag(ev);
        }
        return;
      }

      // empty space => lasso or clear
      if (opts.enableLasso !== false) {
        state.lassoActive = true;
        const p = pointerToOverlayXY(ev);
        state.lassoStart = p;
        lassoBoxEl.style.display = "block";
        lassoBoxEl.style.left = `${p.x}px`;
        lassoBoxEl.style.top = `${p.y}px`;
        lassoBoxEl.style.width = "0px";
        lassoBoxEl.style.height = "0px";
        overlayEl.setPointerCapture(ev.pointerId);

        if (!isShift) clearSelection();
      } else {
        clearSelection();
      }
    }

    function onPointerMove(ev) {
      if (state.dragging) {
        ev.preventDefault();
        const dx = ev.clientX - state.lastClientX;
        const dy = ev.clientY - state.lastClientY;
        state.lastClientX = ev.clientX;
        state.lastClientY = ev.clientY;
        applyMoveSelected(dx, dy);
        return;
      }

      if (state.lassoActive && state.lassoStart) {
        ev.preventDefault();
        const p = pointerToOverlayXY(ev);
        const start = state.lassoStart;
        const r = rectNormalize({ x: start.x, y: start.y, x2: p.x, y2: p.y });
        lassoBoxEl.style.left = `${r.x}px`;
        lassoBoxEl.style.top = `${r.y}px`;
        lassoBoxEl.style.width = `${r.w}px`;
        lassoBoxEl.style.height = `${r.h}px`;
      }
    }

    function onPointerUp(ev) {
      if (state.dragging) {
        ev.preventDefault();
        state.dragging = false;
        stopCapture(ev);
        return;
      }

      if (state.lassoActive) {
        ev.preventDefault();
        state.lassoActive = false;

        const page = getPage();
        if (page && state.lassoStart) {
          const p = pointerToOverlayXY(ev);
          const start = state.lassoStart;
          const r = rectNormalize({ x: start.x, y: start.y, x2: p.x, y2: p.y });

          const hits = [];
          for (const obj of page.objects || []) {
            const rr = rectFromXYWH(obj.x, obj.y, obj.w || 0, obj.h || 0);
            if (rectIntersects(
              { x:r.x, y:r.y, x2:r.x2, y2:r.y2 },
              { x:rr.x, y:rr.y, x2:rr.x2, y2:rr.y2 }
            )) {
              hits.push(String(obj.id));
            }
          }

          const expanded = new Set(Array.from(state.selectedIds));
          for (const id of hits) {
            const exp = expandToGroupIfNeeded(id);
            for (const cid of exp.ids) expanded.add(String(cid));
          }
          setSelectionToIds(Array.from(expanded), computeSelectedGroupId());
        }

        state.lassoStart = null;
        lassoBoxEl.style.display = "none";
        stopCapture(ev);
      }
    }

    function groupSelection() {
      const info = getSelectionInfo();
      if (!info.canGroup) return null;
      const gid = createGroup(draft, pageIndex, info.ids);
      if (!gid) return null;

      const g = getGroup(gid);
      setSelectionToIds((g.childIds || []).map(String), gid);
      onDraftChanged();
      return gid;
    }

    function ungroupSelection() {
      const info = getSelectionInfo();
      if (!info.canUngroup) return;

      const gid = info.groupId;
      const g = getGroup(gid);
      const idsToKeep = g ? (g.childIds || []).map(String) : info.ids.slice();

      ungroup(draft, pageIndex, gid);
      setSelectionToIds(idsToKeep, null);
      onDraftChanged();
    }

    function attach() {
      overlayEl.addEventListener("pointerdown", onPointerDown);
      overlayEl.addEventListener("pointermove", onPointerMove);
      overlayEl.addEventListener("pointerup", onPointerUp);
      overlayEl.addEventListener("pointercancel", onPointerUp);
    }

    function detach() {
      overlayEl.removeEventListener("pointerdown", onPointerDown);
      overlayEl.removeEventListener("pointermove", onPointerMove);
      overlayEl.removeEventListener("pointerup", onPointerUp);
      overlayEl.removeEventListener("pointercancel", onPointerUp);
    }

    return {
      attach,
      detach,
      clearSelection,
      getSelectionInfo,
      groupSelection,
      ungroupSelection,
      applyMoveSelected,

      // helpers requested
      computeBoundingBox: (ids) => computeBoundingBox(getPage(), ids),
      applyGroupMove: (gid, dx, dy) => applyGroupMove(draft, pageIndex, gid, dx, dy),
      findObjectEl: (objId) => findObjectEl(overlayEl, pageIndex, objId),
      renderSelectionBox: (bbox) => renderSelectionBox(overlayEl, selectionBoxEl, bbox),

      _state: state,
      _draft: draft
    };
  }

  // ------------------------------------------------------------
  // Floating toolbar (created in JS, not in HTML)
  // ------------------------------------------------------------
  function injectStylesOnce() {
    if (document.getElementById("gt-toolbar-styles")) return;
    const css = `
      .gt-toolbar{
        position:absolute;
        display:none;
        gap:8px;
        align-items:center;
        padding:6px;
        border-radius:12px;
        background:rgba(2,6,23,.78);
        border:1px solid rgba(255,255,255,.14);
        box-shadow:0 12px 28px rgba(0,0,0,.25);
        z-index:9999;
        pointer-events:auto;
      }
      .gt-toolbar button{
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.08);
        color:#fff;
        padding:8px 10px;
        border-radius:10px;
        font-size:12px;
        font-weight:900;
        cursor:pointer;
      }
      .gt-toolbar button:hover{background:rgba(255,255,255,.12)}
      .gt-toolbar button.primary{
        border-color:rgba(34,197,94,.6);
        background:rgba(34,197,94,.20);
      }
      .gt-toolbar button.danger{
        border-color:rgba(244,63,94,.6);
        background:rgba(244,63,94,.20);
      }
    `;
    const style = document.createElement("style");
    style.id = "gt-toolbar-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**
   * Toolbar flottante ancrée au bounding box de sélection.
   * anchor:
   *  - "inside": bas-droite à l'intérieur
   *  - "outside": bas-droite à l'extérieur (sous le bbox, aligné à droite)
   */
  function attachFloatingToolbar(opts) {
    injectStylesOnce();

    const overlayEl = opts.overlayEl;
    const controller = opts.controller;

    const anchor = opts.anchor || "inside";
    const pad = (opts.pad != null) ? opts.pad : 8;

    const toolbar = document.createElement("div");
    toolbar.className = "gt-toolbar";
    toolbar.innerHTML = `
      <button class="primary" data-action="group">GROUPER</button>
      <button class="danger" data-action="ungroup">DÉGROUPER</button>
    `;
    overlayEl.appendChild(toolbar);

    // ✅ IMPORTANT: empêcher l’overlay de “perdre la sélection” quand on clique la toolbar
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    toolbar.addEventListener("pointerdown", stop);
    toolbar.addEventListener("mousedown", stop);
    toolbar.addEventListener("click", (e) => e.stopPropagation());

    const btnGroup = toolbar.querySelector('[data-action="group"]');
    const btnUngroup = toolbar.querySelector('[data-action="ungroup"]');

    btnGroup.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      controller.groupSelection();
      refresh();
    });

    btnUngroup.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      controller.ungroupSelection();
      refresh();
    });

    function refresh() {
      const info = controller.getSelectionInfo();
      const show = !!info.bbox && (info.canGroup || info.canUngroup);

      toolbar.style.display = show ? "flex" : "none";
      if (!show) return;

      btnGroup.style.display = info.canGroup ? "inline-block" : "none";
      btnUngroup.style.display = info.canUngroup ? "inline-block" : "none";

      const bbox = info.bbox;

      let x = 0, y = 0;

      if (anchor === "inside") {
        x = bbox.x + bbox.w - toolbar.offsetWidth - pad;
        y = bbox.y + bbox.h - toolbar.offsetHeight - pad;
      } else {
        // ✅ outside: bas-droite EXTERIEUR (juste sous bbox, aligné à droite)
        x = bbox.x + bbox.w - toolbar.offsetWidth;
        y = bbox.y + bbox.h + pad;
      }

      const ov = overlayEl.getBoundingClientRect();
      const maxX = ov.width - toolbar.offsetWidth - 6;
      const maxY = ov.height - toolbar.offsetHeight - 6;

      x = clamp(x, 6, maxX);
      y = clamp(y, 6, maxY);

      toolbar.style.left = `${x}px`;
      toolbar.style.top = `${y}px`;
    }

    return { el: toolbar, refresh };
  }

  // ------------------------------------------------------------
  // Sandbox helper (keeps HTML minimal)
  // ------------------------------------------------------------
  function setupSandbox(cfg) {
    const overlayEl = document.getElementById(cfg.overlayId || "overlay");
    const statusEl = document.getElementById(cfg.statusId || "status");

    const btnAddParagraph = document.getElementById(cfg.btnAddParagraphId || "btnAddParagraph");
    const btnAddText = document.getElementById(cfg.btnAddTextId || "btnAddText");
    const btnAddPhoto = document.getElementById(cfg.btnAddPhotoId || "btnAddPhoto");

    if (!overlayEl) throw new Error("setupSandbox: overlayEl introuvable");
    if (!statusEl) throw new Error("setupSandbox: statusEl introuvable");

    const draft = { pages: [{ objects: [], groups: {} }] };
    const pageIndex = 0;

    const PHOTO_DATA_URI =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#60a5fa"/>
              <stop offset="1" stop-color="#22c55e"/>
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)"/>
          <circle cx="620" cy="150" r="70" fill="rgba(255,255,255,.75)"/>
          <path d="M0 430 L220 270 L420 410 L540 320 L800 500 L0 500 Z" fill="rgba(255,255,255,.55)"/>
          <text x="30" y="60" font-size="44" font-family="Arial" fill="rgba(15,23,42,.85)">PHOTO</text>
          <text x="30" y="105" font-size="22" font-family="Arial" fill="rgba(15,23,42,.75)">placeholder</text>
        </svg>
      `);

    function renderObject(obj) {
      const el = document.createElement("div");
      el.className = "anno-object";
      el.dataset.objid = String(obj.id);
      el.dataset.pageindex = String(pageIndex);
      el.dataset.type = String(obj.type);

      setElRect(el, obj);

      if (obj.type === "photo") {
        const img = document.createElement("img");
        img.src = obj.src || PHOTO_DATA_URI;
        img.alt = "photo";
        el.appendChild(img);
      } else if (obj.type === "paragraph") {
        const c = document.createElement("div");
        c.className = "content";
        c.innerHTML = `
          <div class="small">Paragraphe</div>
          <div><b>${escapeHtml(obj.title || "Offre spéciale")}</b> — ${escapeHtml(obj.text || "Texte riche simulé.")}</div>
        `;
        el.appendChild(c);
      } else {
        const c = document.createElement("div");
        c.className = "content";
        c.innerHTML = `
          <div class="small">Texte</div>
          <div>${escapeHtml(obj.text || "SKU: ABC-123 • 9,90€ HT")}</div>
        `;
        el.appendChild(c);
      }

      overlayEl.appendChild(el);
      return el;
    }

    function syncStatus(controller) {
      const info = controller.getSelectionInfo();
      const page = draft.pages[pageIndex];
      statusEl.textContent = JSON.stringify({
        selection: info,
        groups: page.groups,
        objects: page.objects.map(o => ({
          id:o.id, type:o.type, x:o.x, y:o.y, w:o.w, h:o.h, groupId:o.groupId || null
        }))
      }, null, 2);
    }

    let floating = null;

    const controller = createGroupingController({
      overlayEl,
      draft,
      pageIndex,
      enableLasso: true,
      onSelectionChanged: () => {
        syncStatus(controller);
        if (floating) floating.refresh();
      },
      onDraftChanged: () => {
        syncStatus(controller);
        if (floating) floating.refresh();
      },
    });
    controller.attach();

    // ✅ Demande: bas-droite EXTERIEUR
    floating = attachFloatingToolbar({
      overlayEl,
      controller,
      anchor: "outside",
      pad: 8,
    });

    function addParagraph() {
      const obj = {
        id: uid("obj"),
        type: "paragraph",
        x: 70 + Math.floor(Math.random()*220),
        y: 120 + Math.floor(Math.random()*220),
        w: 320,
        h: 110,
        title: "Pack découverte",
        text: "SHIFT+click pour multi-sélection, puis grouper."
      };
      draft.pages[pageIndex].objects.push(obj);
      renderObject(obj);
      syncStatus(controller);
      floating.refresh();
    }

    function addText() {
      const obj = {
        id: uid("obj"),
        type: "text",
        x: 120 + Math.floor(Math.random()*260),
        y: 320 + Math.floor(Math.random()*260),
        w: 240,
        h: 70,
        text: "SKU: ABC-123 • 9,90€ HT"
      };
      draft.pages[pageIndex].objects.push(obj);
      renderObject(obj);
      syncStatus(controller);
      floating.refresh();
    }

    function addPhoto() {
      const obj = {
        id: uid("obj"),
        type: "photo",
        x: 460 + Math.floor(Math.random()*200),
        y: 160 + Math.floor(Math.random()*240),
        w: 260,
        h: 180,
        src: PHOTO_DATA_URI
      };
      draft.pages[pageIndex].objects.push(obj);
      renderObject(obj);
      syncStatus(controller);
      floating.refresh();
    }

    btnAddParagraph && btnAddParagraph.addEventListener("click", addParagraph);
    btnAddText && btnAddText.addEventListener("click", addText);
    btnAddPhoto && btnAddPhoto.addEventListener("click", addPhoto);

    window.addEventListener("keydown", (e) => {
      const info = controller.getSelectionInfo();
      if (!info.ids || !info.ids.length) return;

      const step = e.shiftKey ? 10 : 2;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;

      e.preventDefault();
      controller.applyMoveSelected(dx, dy);
      syncStatus(controller);
      floating.refresh();
    });

    addParagraph();
    addText();
    addPhoto();

    return { draft, controller, floating };
  }

  // ------------------------------------------------------------
  // Export global
  // ------------------------------------------------------------
  const GroupTools = {
    uid,
    clamp,
    computeBoundingBox,
    createGroup,
    ungroup,
    applyGroupMove,
    findObjectEl,
    renderSelectionBox,
    createGroupingController,
    attachFloatingToolbar,
    setupSandbox,
  };

  global.GroupTools = GroupTools;
  if (typeof window !== "undefined") window.GroupTools = GroupTools;

})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));

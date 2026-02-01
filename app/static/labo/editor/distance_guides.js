/* app/static/labo/editor/distance_guides.js
 * Distance Guides (Illustrator/Photoshop-like) for HTML5 PDF overlay editor
 * - Compute nearest neighbors (left/right/top/bottom) around a moving object
 * - Render measurement guides + distance label (px) in overlay
 * - No deps, no API required
 *
 * Public API:
 *   createDistanceGuidesController({ overlayEl, draft, pageIndex, ... })
 *     -> { attach(), detach(), computeNearestNeighbors(id, rect?), renderGuides(neighbors, rect), clearGuides(),
 *          notifyDragStart(id, rect), notifyDragMove(id, rect), notifyDragEnd(id, rect) }
 *
 * Sandbox API (grouping-like):
 *   window.DistanceGuides.setupSandbox({ overlayId, statusId, btnAddParagraphId, btnAddTextId, btnAddPhotoId })
 */

export function createDistanceGuidesController(opts) {
  const {
    overlayEl,
    draft,
    pageIndex = 0,

    // Hide guides if "too far"
    maxDistancePx = 320,

    // Bonus: prefer neighbors with overlap on orthogonal axis
    preferAxisOverlap = true,
    minOverlapPx = 10,
    minOverlapRatio = 0.12,

    // Hooks (optional)
    onDragStart,
    onDragMove,
    onDragEnd,
  } = opts || {};

  if (!overlayEl) throw new Error("[distance_guides] overlayEl is required");
  if (!draft || !draft.pages) throw new Error("[distance_guides] draft.pages is required");

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let attached = false;

  // Layer for guides
  const guidesLayer = document.createElement("div");
  guidesLayer.className = "dg-guides-layer";
  guidesLayer.style.position = "absolute";
  guidesLayer.style.left = "0";
  guidesLayer.style.top = "0";
  guidesLayer.style.right = "0";
  guidesLayer.style.bottom = "0";
  guidesLayer.style.pointerEvents = "none";
  guidesLayer.style.zIndex = "999999";

  // DOM nodes reused (no flicker)
  const guideNodes = {
    left: createGuide("left"),
    right: createGuide("right"),
    top: createGuide("top"),
    bottom: createGuide("bottom"),
  };

  // rAF throttling
  let rafPending = false;
  let lastRenderPayload = null;

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------
  function getPageObjects() {
    const page = draft.pages?.[pageIndex];
    return Array.isArray(page?.objects) ? page.objects : [];
  }

  function getObjById(id) {
    const objs = getPageObjects();
    return objs.find((o) => String(o.id) === String(id)) || null;
  }

  function rectFromObj(obj) {
    const x = Number(obj.x || 0);
    const y = Number(obj.y || 0);
    const w = Number(obj.w || 0);
    const h = Number(obj.h || 0);
    return { x, y, w, h, left: x, top: y, right: x + w, bottom: y + h };
  }

  function normalizeRect(r) {
    const left = r.left != null ? Number(r.left) : Number(r.x || 0);
    const top = r.top != null ? Number(r.top) : Number(r.y || 0);
    const right = r.right != null ? Number(r.right) : left + Number(r.w || 0);
    const bottom = r.bottom != null ? Number(r.bottom) : top + Number(r.h || 0);
    return { left, top, right, bottom, x: left, y: top, w: right - left, h: bottom - top };
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function overlap1D(a1, a2, b1, b2) {
    const lo = Math.max(a1, b1);
    const hi = Math.min(a2, b2);
    return Math.max(0, hi - lo);
  }

  function pickMidOnOverlapAxis(moving, cand, axis /* 'x'|'y' */) {
    if (axis === "y") {
      const ov = overlap1D(moving.top, moving.bottom, cand.top, cand.bottom);
      if (ov > 0) {
        const mid = Math.max(moving.top, cand.top) + ov / 2;
        return clamp(mid, moving.top + 6, moving.bottom - 6);
      }
      return (moving.top + moving.bottom) / 2;
    } else {
      const ov = overlap1D(moving.left, moving.right, cand.left, cand.right);
      if (ov > 0) {
        const mid = Math.max(moving.left, cand.left) + ov / 2;
        return clamp(mid, moving.left + 6, moving.right - 6);
      }
      return (moving.left + moving.right) / 2;
    }
  }

  function overlapScoreOnOrthogonalAxis(moving, cand, direction) {
    if (direction === "left" || direction === "right") {
      const ov = overlap1D(moving.top, moving.bottom, cand.top, cand.bottom);
      const minSize = Math.min(moving.h, cand.h) || 1;
      const needed = Math.max(minOverlapPx, minOverlapRatio * minSize);
      return { ok: ov >= needed, ov };
    } else {
      const ov = overlap1D(moving.left, moving.right, cand.left, cand.right);
      const minSize = Math.min(moving.w, cand.w) || 1;
      const needed = Math.max(minOverlapPx, minOverlapRatio * minSize);
      return { ok: ov >= needed, ov };
    }
  }

  // ------------------------------------------------------------
  // Nearest neighbors computation
  // ------------------------------------------------------------
  function computeNearestNeighbors(movingObjId, movingRectOverride) {
    const movingObj = getObjById(movingObjId);
    if (!movingObj && !movingRectOverride) {
      return { left: null, right: null, top: null, bottom: null, moving: null };
    }

    const moving = normalizeRect(movingRectOverride || rectFromObj(movingObj));

    const candidates = getPageObjects()
      .filter((o) => String(o.id) !== String(movingObjId))
      .map((o) => ({ obj: o, rect: rectFromObj(o) }));

    const best = { left: null, right: null, top: null, bottom: null, moving };

    function consider(direction, candRect, candObj, dist) {
      if (!(dist > 0)) return; // ignore overlap/touch
      if (dist > maxDistancePx) return;

      const score = preferAxisOverlap
        ? overlapScoreOnOrthogonalAxis(moving, candRect, direction)
        : { ok: true, ov: 0 };

      const current = best[direction];
      if (!current) {
        best[direction] = { obj: candObj, rect: candRect, distance: dist, overlapOk: score.ok, overlap: score.ov };
        return;
      }

      // Prefer overlapOk first, then smallest distance
      if (preferAxisOverlap) {
        if (current.overlapOk && !score.ok) return;
        if (!current.overlapOk && score.ok) {
          best[direction] = { obj: candObj, rect: candRect, distance: dist, overlapOk: score.ok, overlap: score.ov };
          return;
        }
      }

      if (dist < current.distance) {
        best[direction] = { obj: candObj, rect: candRect, distance: dist, overlapOk: score.ok, overlap: score.ov };
      }
    }

    for (const c of candidates) {
      const r = c.rect;

      // left: cand.right <= moving.left
      if (r.right <= moving.left) consider("left", r, c.obj, moving.left - r.right);

      // right: cand.left >= moving.right
      if (r.left >= moving.right) consider("right", r, c.obj, r.left - moving.right);

      // top: cand.bottom <= moving.top
      if (r.bottom <= moving.top) consider("top", r, c.obj, moving.top - r.bottom);

      // bottom: cand.top >= moving.bottom
      if (r.top >= moving.bottom) consider("bottom", r, c.obj, r.top - moving.bottom);
    }

    return best;
  }

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------
  function createGuide(direction) {
    const root = document.createElement("div");
    root.className = `dg-guide dg-${direction}`;
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "0";
    root.style.height = "0";
    root.style.display = "none";
    root.style.pointerEvents = "none";

    const line = document.createElement("div");
    line.className = "dg-line";
    line.style.position = "absolute";
    line.style.left = "0";
    line.style.top = "0";
    line.style.width = "0";
    line.style.height = "0";
    line.style.background = "rgba(0,153,255,.95)";
    line.style.borderRadius = "2px";

    const capA = document.createElement("div");
    capA.className = "dg-cap dg-cap-a";
    capA.style.position = "absolute";
    capA.style.background = "rgba(0,153,255,.95)";
    capA.style.borderRadius = "2px";

    const capB = document.createElement("div");
    capB.className = "dg-cap dg-cap-b";
    capB.style.position = "absolute";
    capB.style.background = "rgba(0,153,255,.95)";
    capB.style.borderRadius = "2px";

    const label = document.createElement("div");
    label.className = "dg-label";
    label.style.position = "absolute";
    label.style.padding = "2px 6px";
    label.style.font = "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    label.style.background = "rgba(0,153,255,.95)";
    label.style.color = "#fff";
    label.style.borderRadius = "999px";
    label.style.boxShadow = "0 2px 8px rgba(0,0,0,.18)";
    label.style.whiteSpace = "nowrap";
    label.style.transform = "translate(-50%, -50%)";
    label.style.border = "1px solid rgba(255,255,255,.25)";

    root.appendChild(line);
    root.appendChild(capA);
    root.appendChild(capB);
    root.appendChild(label);

    return { root, line, capA, capB, label };
  }

  function showGuide(direction, geo) {
    const g = guideNodes[direction];
    if (!g) return;

    const x1 = geo.x1, y1 = geo.y1, x2 = geo.x2, y2 = geo.y2;
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    g.root.style.display = "block";
    g.root.style.left = `${minX}px`;
    g.root.style.top = `${minY}px`;
    g.root.style.width = `${Math.max(1, w)}px`;
    g.root.style.height = `${Math.max(1, h)}px`;

    const t = 2;

    if (geo.orientation === "h") {
      const ly = (y1 - minY) - t / 2;
      g.line.style.left = "0px";
      g.line.style.top = `${ly}px`;
      g.line.style.width = `${Math.max(1, w)}px`;
      g.line.style.height = `${t}px`;

      const capH = 10;
      g.capA.style.width = `${t}px`;
      g.capA.style.height = `${capH}px`;
      g.capA.style.left = `0px`;
      g.capA.style.top = `${(y1 - minY) - capH / 2}px`;

      g.capB.style.width = `${t}px`;
      g.capB.style.height = `${capH}px`;
      g.capB.style.left = `${Math.max(0, w - t)}px`;
      g.capB.style.top = `${(y1 - minY) - capH / 2}px`;
    } else {
      const lx = (x1 - minX) - t / 2;
      g.line.style.left = `${lx}px`;
      g.line.style.top = "0px";
      g.line.style.width = `${t}px`;
      g.line.style.height = `${Math.max(1, h)}px`;

      const capW = 10;
      g.capA.style.width = `${capW}px`;
      g.capA.style.height = `${t}px`;
      g.capA.style.left = `${(x1 - minX) - capW / 2}px`;
      g.capA.style.top = `0px`;

      g.capB.style.width = `${capW}px`;
      g.capB.style.height = `${t}px`;
      g.capB.style.left = `${(x1 - minX) - capW / 2}px`;
      g.capB.style.top = `${Math.max(0, h - t)}px`;
    }

    g.label.textContent = geo.text || "";
    g.label.style.left = `${geo.labelX - minX}px`;
    g.label.style.top = `${geo.labelY - minY}px`;
  }

  function hideGuide(direction) {
    const g = guideNodes[direction];
    if (g) g.root.style.display = "none";
  }

  function clearGuides() {
    hideGuide("left");
    hideGuide("right");
    hideGuide("top");
    hideGuide("bottom");
  }

  function renderGuides(neighbors, movingRectRaw) {
    const moving = normalizeRect(movingRectRaw);

    if (neighbors?.left?.distance != null) {
      const c = neighbors.left.rect;
      const y = pickMidOnOverlapAxis(moving, c, "y");
      const x1 = c.right;
      const x2 = moving.left;
      const dist = Math.round(neighbors.left.distance);
      showGuide("left", {
        x1, y1: y, x2, y2: y,
        labelX: (x1 + x2) / 2,
        labelY: y,
        text: `${dist}px`,
        orientation: "h",
      });
    } else hideGuide("left");

    if (neighbors?.right?.distance != null) {
      const c = neighbors.right.rect;
      const y = pickMidOnOverlapAxis(moving, c, "y");
      const x1 = moving.right;
      const x2 = c.left;
      const dist = Math.round(neighbors.right.distance);
      showGuide("right", {
        x1, y1: y, x2, y2: y,
        labelX: (x1 + x2) / 2,
        labelY: y,
        text: `${dist}px`,
        orientation: "h",
      });
    } else hideGuide("right");

    if (neighbors?.top?.distance != null) {
      const c = neighbors.top.rect;
      const x = pickMidOnOverlapAxis(moving, c, "x");
      const y1 = c.bottom;
      const y2 = moving.top;
      const dist = Math.round(neighbors.top.distance);
      showGuide("top", {
        x1: x, y1, x2: x, y2,
        labelX: x,
        labelY: (y1 + y2) / 2,
        text: `${dist}px`,
        orientation: "v",
      });
    } else hideGuide("top");

    if (neighbors?.bottom?.distance != null) {
      const c = neighbors.bottom.rect;
      const x = pickMidOnOverlapAxis(moving, c, "x");
      const y1 = moving.bottom;
      const y2 = c.top;
      const dist = Math.round(neighbors.bottom.distance);
      showGuide("bottom", {
        x1: x, y1, x2: x, y2,
        labelX: x,
        labelY: (y1 + y2) / 2,
        text: `${dist}px`,
        orientation: "v",
      });
    } else hideGuide("bottom");
  }

  // ------------------------------------------------------------
  // Controller attach/detach
  // ------------------------------------------------------------
  function attach() {
    if (attached) return;
    attached = true;

    const cs = getComputedStyle(overlayEl);
    if (cs.position === "static") overlayEl.style.position = "relative";

    overlayEl.appendChild(guidesLayer);
    guidesLayer.appendChild(guideNodes.left.root);
    guidesLayer.appendChild(guideNodes.right.root);
    guidesLayer.appendChild(guideNodes.top.root);
    guidesLayer.appendChild(guideNodes.bottom.root);

    clearGuides();
  }

  function detach() {
    if (!attached) return;
    attached = false;
    clearGuides();
    if (guidesLayer.parentNode) guidesLayer.parentNode.removeChild(guidesLayer);
  }

  // ------------------------------------------------------------
  // rAF render pipeline
  // ------------------------------------------------------------
  function scheduleRender(payload) {
    lastRenderPayload = payload;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const p = lastRenderPayload;
      lastRenderPayload = null;
      if (!p) return;

      const neighbors = computeNearestNeighbors(p.movingObjId, p.movingRect);
      renderGuides(neighbors, p.movingRect);

      if (typeof onDragMove === "function") {
        onDragMove({
          neighbors,
          movingRect: normalizeRect(p.movingRect),
          movingObjId: p.movingObjId,
        });
      }
    });
  }

  function notifyDragStart(movingObjId, movingRect) {
    if (typeof onDragStart === "function") {
      onDragStart({ movingObjId, movingRect: normalizeRect(movingRect) });
    }
    scheduleRender({ movingObjId, movingRect });
  }

  function notifyDragMove(movingObjId, movingRect) {
    scheduleRender({ movingObjId, movingRect });
  }

  function notifyDragEnd(movingObjId, movingRect) {
    clearGuides();
    if (typeof onDragEnd === "function") {
      onDragEnd({ movingObjId, movingRect: normalizeRect(movingRect) });
    }
  }

  return {
    attach,
    detach,
    computeNearestNeighbors,
    renderGuides,
    clearGuides,
    notifyDragStart,
    notifyDragMove,
    notifyDragEnd,
  };
}

// ------------------------------------------------------------
// Sandbox (grouping-like) wiring
// ------------------------------------------------------------
export function setupSandbox(cfg = {}) {
  // grouping-like mode (IDs)
  if (!cfg.overlayId) {
    throw new Error(
      "[distance_guides] setupSandbox: attendu { overlayId, statusId, btnAddParagraphId, btnAddTextId, btnAddPhotoId }"
    );
  }

  const overlayEl = document.getElementById(cfg.overlayId);
  const statusEl = cfg.statusId ? document.getElementById(cfg.statusId) : null;
  if (!overlayEl) throw new Error("[distance_guides] overlayId introuvable");

  const draft = { pages: [{ objects: [] }] };
  const pageIndex = 0;

  const ctrl = createDistanceGuidesController({
    overlayEl,
    draft,
    pageIndex,
    maxDistancePx: 320,
    preferAxisOverlap: true,
    minOverlapPx: 10,
    minOverlapRatio: 0.12,
    onDragMove: ({ neighbors, movingRect, movingObjId }) => {
      if (!statusEl) return;
      const slim = (side) => {
        const n = neighbors?.[side];
        if (!n) return null;
        return {
          id: n.obj?.id,
          type: n.obj?.type,
          distance: Math.round(n.distance),
          overlapOk: n.overlapOk,
          overlap: Math.round(n.overlap || 0),
        };
      };
      statusEl.textContent = JSON.stringify(
        {
          movingObjId,
          movingRect: {
            x: Math.round(movingRect.x),
            y: Math.round(movingRect.y),
            w: Math.round(movingRect.w),
            h: Math.round(movingRect.h),
          },
          left: slim("left"),
          right: slim("right"),
          top: slim("top"),
          bottom: slim("bottom"),
        },
        null,
        2
      );
    },
  });

  ctrl.attach();

  // Helpers
  let seq = 1;
  const uid = (p = "o") => `${p}_${Date.now().toString(16)}_${++seq}`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const rectFromObj = (obj) => ({
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    left: obj.x,
    top: obj.y,
    right: obj.x + obj.w,
    bottom: obj.y + obj.h,
  });

  const getObjById = (id) =>
    draft.pages[pageIndex].objects.find((o) => String(o.id) === String(id)) || null;

  const svgPhotoDataUri = () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#22c55e" stop-opacity="0.25"/>
            <stop offset="1" stop-color="#60a5fa" stop-opacity="0.25"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <circle cx="560" cy="210" r="70" fill="#ffffff" fill-opacity="0.55"/>
        <path d="M100 520 L310 300 L430 430 L540 310 L710 520 Z" fill="#ffffff" fill-opacity="0.45"/>
      </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  };

  function renderObj(obj) {
    const el = document.createElement("div");
    el.className = `anno-object type-${obj.type}`;
    el.dataset.objid = String(obj.id);
    el.dataset.pageindex = String(pageIndex);
    el.dataset.type = String(obj.type);

    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = `${obj.w}px`;
    el.style.height = `${obj.h}px`;

    const content = document.createElement("div");
    content.className = "content";

    if (obj.type === "photo") {
      const img = document.createElement("img");
      img.alt = "photo";
      img.src = svgPhotoDataUri();
      content.appendChild(img);
    } else if (obj.type === "paragraph") {
      content.innerHTML = `<div class="small">Paragraphe</div>${
        obj.text || "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec."
      }`;
    } else {
      content.innerHTML = `<div class="small">Texte</div>${obj.text || "Texte"}`;
    }

    el.appendChild(content);
    overlayEl.appendChild(el);

    installDrag(el);
  }

  function updateDom(obj) {
    const el = overlayEl.querySelector(`.anno-object[data-objid="${CSS.escape(String(obj.id))}"]`);
    if (!el) return;
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
  }

  function installDrag(el) {
    let dragging = false;
    let startX = 0,
      startY = 0;
    let startObjX = 0,
      startObjY = 0;
    let objId = null;

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      dragging = true;
      el.classList.add("is-dragging");
      el.setPointerCapture?.(e.pointerId);

      objId = el.dataset.objid;
      const obj = getObjById(objId);
      if (!obj) return;

      startX = e.clientX;
      startY = e.clientY;
      startObjX = obj.x;
      startObjY = obj.y;

      ctrl.notifyDragStart(objId, rectFromObj(obj));
      e.preventDefault();
      e.stopPropagation();
    }

    function onMove(e) {
      if (!dragging) return;
      const obj = getObjById(objId);
      if (!obj) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      obj.x = Math.round(startObjX + dx);
      obj.y = Math.round(startObjY + dy);

      // sandbox page is 860x1120
      obj.x = clamp(obj.x, 0, 860 - obj.w);
      obj.y = clamp(obj.y, 0, 1120 - obj.h);

      updateDom(obj);
      ctrl.notifyDragMove(objId, rectFromObj(obj));

      e.preventDefault();
      e.stopPropagation();
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      const obj = getObjById(objId);
      if (obj) ctrl.notifyDragEnd(objId, rectFromObj(obj));
      e.preventDefault();
      e.stopPropagation();
    }

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });
    window.addEventListener("pointercancel", onUp, { passive: false });
  }

  function addObject(type, partial = {}) {
    const obj = {
      id: uid("o"),
      type,
      x: partial.x ?? Math.round(60 + Math.random() * 640),
      y: partial.y ?? Math.round(80 + Math.random() * 900),
      w: partial.w ?? (type === "photo" ? 240 : 300),
      h: partial.h ?? (type === "paragraph" ? 150 : type === "photo" ? 200 : 90),
      text: partial.text ?? "",
    };
    draft.pages[pageIndex].objects.push(obj);
    renderObj(obj);
    return obj;
  }

  // Bind buttons
  const btnP = cfg.btnAddParagraphId ? document.getElementById(cfg.btnAddParagraphId) : null;
  const btnT = cfg.btnAddTextId ? document.getElementById(cfg.btnAddTextId) : null;
  const btnI = cfg.btnAddPhotoId ? document.getElementById(cfg.btnAddPhotoId) : null;

  btnP?.addEventListener("click", () => addObject("paragraph"));
  btnT?.addEventListener("click", () => addObject("text", { text: "Texte" }));
  btnI?.addEventListener("click", () => addObject("photo"));

  // Seed 6–8 objects
  addObject("text", { x: 90, y: 90, w: 300, h: 90, text: "Titre produit" });
  addObject("paragraph", { x: 110, y: 220, w: 320, h: 150 });
  addObject("photo", { x: 520, y: 110, w: 250, h: 200 });
  addObject("text", { x: 520, y: 360, w: 240, h: 90, text: "Prix: 12,90€" });
  addObject("paragraph", { x: 170, y: 520, w: 360, h: 160 });
  addObject("photo", { x: 560, y: 720, w: 240, h: 200 });
  addObject("text", { x: 90, y: 850, w: 320, h: 90, text: "EAN: 3700..." });

  return { draft, overlayEl, controller: ctrl };
}

// ------------------------------------------------------------
// Global bridge (sandbox-friendly)
// ------------------------------------------------------------
if (typeof window !== "undefined") {
  window.DistanceGuides = {
    createDistanceGuidesController,
    setupSandbox,
  };
}

// app/static/labo/editor/grid_tools.js?v=12

// ===============================
// Grid defaults
// ===============================
export const DEFAULT_GRID = {
  enabled: false,            // grille visible
  snap: false,               // snap on/off
  size: 20,                  // pas en px
  opacity: 0.12,             // 0.05 -> 0.5
  color: "#2c3e50",          // couleur
  bigEvery: 5,               // grande grille = size * bigEvery
  showBig: true,             // afficher grande grille par-dessus petite
  snapMode: "always",        // "always" | "shift" | "alt"
  snapDuringMoveOnly: false, // si true: insertion non-snappée, drag snappé
  snapOnResize: true,        // snap w/h pendant resize
  snapToCenter: false        // optionnel (off par défaut)
};

// ===============================
// Get grid settings from state
// ===============================
export function getGridSettings(state) {
  const g = (state && state.grid) ? state.grid : {};
  const merged = { ...DEFAULT_GRID, ...g };

  // guards
  merged.size = Math.max(1, parseInt(merged.size, 10) || DEFAULT_GRID.size);
  merged.opacity = Math.min(0.5, Math.max(0.0, Number(merged.opacity ?? DEFAULT_GRID.opacity)));
  merged.bigEvery = Math.max(2, parseInt(merged.bigEvery, 10) || DEFAULT_GRID.bigEvery);

  // normalize enums
  const sm = String(merged.snapMode || "always");
  merged.snapMode = (sm === "always" || sm === "shift" || sm === "alt") ? sm : "always";

  return merged;
}

// ===============================
// Snap helpers
// ===============================
export function snapValue(v, step) {
  const s = Math.max(1, step || 1);
  return Math.round(v / s) * s;
}

function _shouldSnap(grid, ev) {
  if (!grid || !grid.snap) return false;
  const mode = grid.snapMode || "always";
  if (mode === "always") return true;
  if (!ev) return false;
  if (mode === "shift") return !!ev.shiftKey;
  if (mode === "alt") return !!ev.altKey;
  return true;
}

function _clampRectToOverlay(rect, overlayW, overlayH) {
  const r = { ...rect };
  const ow = Number(overlayW) || 0;
  const oh = Number(overlayH) || 0;
  if (ow <= 0 || oh <= 0) return r;

  r.w = Math.max(1, Math.min(Number(r.w) || 1, ow));
  r.h = Math.max(1, Math.min(Number(r.h) || 1, oh));
  r.x = Math.max(0, Math.min(Number(r.x) || 0, ow - r.w));
  r.y = Math.max(0, Math.min(Number(r.y) || 0, oh - r.h));
  return r;
}

/**
 * Snap rect in overlay px space.
 * - snaps x/y if opts.snapXY (default true)
 * - snaps w/h if opts.snapWH (default false)
 * - optional center snapping if grid.snapToCenter
 *
 * Signature utilisée par ui_tools.js & interactions.js:
 *   snapRect(rect, grid, overlayW, overlayH, ev, { snapXY, snapWH })
 */
export function snapRect(rect, grid, overlayW, overlayH, ev, opts = {}) {
  const r0 = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

  const allow = _shouldSnap(grid, ev);
  if (!allow) return _clampRectToOverlay(r0, overlayW, overlayH);

  const step = Math.max(1, Number(opts.step ?? grid?.size ?? 1) || 1);

  const snapWH = !!opts.snapWH;
  const snapXY = opts.snapXY !== false;

  let x = Number(r0.x) || 0;
  let y = Number(r0.y) || 0;
  let w = Number(r0.w) || 1;
  let h = Number(r0.h) || 1;

  // optional: snap to center
  if (grid?.snapToCenter && snapXY) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const scx = snapValue(cx, step);
    const scy = snapValue(cy, step);
    x = scx - w / 2;
    y = scy - h / 2;
  } else if (snapXY) {
    x = snapValue(x, step);
    y = snapValue(y, step);
  }

  if (snapWH) {
    w = Math.max(1, snapValue(w, step));
    h = Math.max(1, snapValue(h, step));
  }

  return _clampRectToOverlay({ x, y, w, h }, overlayW, overlayH);
}

// ===============================
// Apply grid overlay (Option A: CSS background on overlay)
// ===============================
export function applyGridOverlay(overlayEl, grid) {
  if (!overlayEl) return;

  // Important: ne jamais bloquer les events
  // (la grille est juste un background, donc OK)
  overlayEl.style.pointerEvents = overlayEl.style.pointerEvents || "auto";

  if (!grid || !grid.enabled) {
    overlayEl.style.backgroundImage = "";
    overlayEl.style.backgroundSize = "";
    overlayEl.style.backgroundPosition = "";
    overlayEl.style.backgroundRepeat = "";
    overlayEl.style.backgroundColor = "";
    overlayEl.dataset.gridEnabled = "0";
    return;
  }

  const size = Math.max(1, grid.size || 20);
  const bigEvery = Math.max(2, grid.bigEvery || 5);
  const bigSize = size * bigEvery;
  const opacity = Math.min(0.5, Math.max(0.0, Number(grid.opacity ?? 0.12)));
  const color = grid.color || "#2c3e50";
  const showBig = grid.showBig !== false;

  // Petite grille
  const smallA =
    `linear-gradient(to right, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(100% - 1px), ${_rgba(color, opacity)} calc(100% - 1px), ${_rgba(color, opacity)} 100%)`;
  const smallB =
    `linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(100% - 1px), ${_rgba(color, opacity)} calc(100% - 1px), ${_rgba(color, opacity)} 100%)`;

  // Grande grille
  const bigOpacity = Math.min(0.5, opacity * 1.6);
  const bigA =
    `linear-gradient(to right, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(100% - 1px), ${_rgba(color, bigOpacity)} calc(100% - 1px), ${_rgba(color, bigOpacity)} 100%)`;
  const bigB =
    `linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(100% - 1px), ${_rgba(color, bigOpacity)} calc(100% - 1px), ${_rgba(color, bigOpacity)} 100%)`;

  const images = showBig ? [bigA, bigB, smallA, smallB] : [smallA, smallB];
  const sizes = showBig
    ? [`${bigSize}px ${bigSize}px`, `${bigSize}px ${bigSize}px`, `${size}px ${size}px`, `${size}px ${size}px`]
    : [`${size}px ${size}px`, `${size}px ${size}px`];

  overlayEl.style.backgroundImage = images.join(", ");
  overlayEl.style.backgroundSize = sizes.join(", ");

  // ✅ positions doivent matcher le nombre de layers
  overlayEl.style.backgroundPosition = showBig
    ? "0 0, 0 0, 0 0, 0 0"
    : "0 0, 0 0";

  overlayEl.style.backgroundRepeat = "repeat";
  overlayEl.dataset.gridEnabled = "1";
}

export function applyGridToAllOverlays(containerEl, grid) {
  const root = containerEl || document;
  const overlays = root.querySelectorAll(".pdf-overlay");
  overlays.forEach((ov) => applyGridOverlay(ov, grid));
}

// ===============================
// Utility: color => rgba
// - supports #rgb, #rrggbb
// - pass-through if already rgba()/rgb()/hsl()/hsla()
// ===============================
function _rgba(color, alpha) {
  const a = Math.min(1, Math.max(0, Number(alpha ?? 0.12)));
  const s = String(color || "").trim();

  // pass-through for css functions
  if (/^(rgba?|hsla?)\(/i.test(s)) return s;

  // #rgb
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const v = m[1];
    const r = parseInt(v[0] + v[0], 16);
    const g = parseInt(v[1] + v[1], 16);
    const b = parseInt(v[2] + v[2], 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // #rrggbb
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const v = m[1];
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // fallback
  return `rgba(44,62,80,${a})`;
}

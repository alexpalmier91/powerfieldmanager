// app/static/labo/editor/color_picker_tools.js
// ------------------------------------------------------------
// Color Picker Tools — popover réutilisable (style “Google”)
// Sans dépendances externes — Firefox/Chrome
//
// ✅ SV picker (saturation/value) + slider teinte
// ✅ Champ HEX avec préfixe "#"
// ✅ Bouton pipette (EyeDropper API si dispo)
// ✅ Sections: Couleurs du thème / Couleurs standard / Récemment utilisé
// ✅ “Transparent”
// ✅ API: window.ColorPickerTools.createColorPickerPopover({...})
//
// FIX (sélection texte):
// ✅ Le popover ne vole pas le focus (sauf sur input/textarea/select/range)
// ✅ Ne focus plus automatiquement le champ HEX à l’ouverture
// ✅ Guard focus “à la Google” : on peut picker sans casser la sélection
// ------------------------------------------------------------
(function (global) {
  "use strict";

  // ------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stop = (e) => {
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}
  };

  function isHex6(s) { return /^#?[0-9a-f]{6}$/i.test(String(s || "").trim()); }
  function normalizeHex(s) {
    const v = String(s || "").trim();
    if (!v) return null;
    if (/^transparent$/i.test(v)) return "transparent";
    if (!isHex6(v)) return null;
    return (v[0] === "#" ? v : `#${v}`).toUpperCase();
  }

  function rgbToHex(r, g, b) {
    const to2 = (n) => clamp(n, 0, 255).toString(16).padStart(2, "0");
    return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
  }

  function hexToRgb(hex) {
    const h = String(hex || "").trim();
    if (!h) return null;
    if (h.toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const m = h.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  // ------------------------------------------------------------
  // Focus guards (ne pas voler la sélection)
  // ------------------------------------------------------------
  function installFocusGuards(rootEl) {
    if (!rootEl || rootEl.__zhCpGuardsInstalled) return;
    rootEl.__zhCpGuardsInstalled = true;

    const allowFocus = (t) => {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      // range (slider hue) est un input, donc OK
      // laisser aussi les éléments explicitement marqués
      if (t.closest && t.closest("[data-allow-focus]")) return true;
      return false;
    };

    // capture: empêche le focus change sur le popover (sauf inputs)
    const guard = (e) => {
      if (allowFocus(e.target)) return;
      // empêche le navigateur de donner le focus au bouton cliqué
      try { e.preventDefault(); } catch (_) {}
      // mais on laisse les handlers internes (chips, sv drag, etc.) bosser
      // => PAS de stopPropagation ici
    };

    rootEl.addEventListener("pointerdown", guard, true);
    rootEl.addEventListener("mousedown", guard, true);
  }

  // ------------------------------------------------------------
  // Recent colors (localStorage)
  // ------------------------------------------------------------
  function loadRecent(key, max = 10) {
    try {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map(normalizeHex)
        .filter((x) => x && x !== "transparent")
        .slice(0, max);
    } catch (_) {
      return [];
    }
  }

  function saveRecent(key, hex, max = 10) {
    const v = normalizeHex(hex);
    if (!v || v === "transparent") return;
    const cur = loadRecent(key, max);
    const next = [v, ...cur.filter((x) => x !== v)].slice(0, max);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch (_) {}
  }

  // ------------------------------------------------------------
  // CSS (Google-like)
  // ------------------------------------------------------------
  function ensureCssOnce() {
    if (document.getElementById("zh_color_picker_css")) return;
    const st = document.createElement("style");
    st.id = "zh_color_picker_css";
    st.textContent = `
.zh-cp-pop{
  position:fixed;
  z-index:999999;
  width:330px;
  background:#fff;
  border:1px solid rgba(0,0,0,.14);
  border-radius:14px;
  box-shadow:0 18px 45px rgba(0,0,0,.18);
  padding:10px;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;
  user-select:none;
}
.zh-cp-pop[hidden]{display:none;}
.zh-cp-top{
  display:flex;
  align-items:center;
  gap:10px;
  padding:6px 6px 10px 6px;
}
.zh-cp-swatch{
  width:28px;height:28px;border-radius:10px;
  border:1px solid rgba(0,0,0,.18);
  background:#111827;
  position:relative;
  overflow:hidden;
}
.zh-cp-swatch.transparent::before{
  content:"";
  position:absolute; inset:0;
  background:
    linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%, rgba(0,0,0,.10)),
    linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%, rgba(0,0,0,.10));
  background-size:10px 10px;
  background-position:0 0,5px 5px;
}
.zh-cp-hexwrap{
  flex:1;
  display:flex;
  align-items:center;
  gap:6px;
  border:1px solid rgba(0,0,0,.14);
  border-radius:12px;
  padding:0 10px;
  height:34px;
}
.zh-cp-hexwrap .hash{
  font-weight:800;
  opacity:.55;
}
.zh-cp-hexwrap input{
  flex:1;
  border:0;
  outline:none;
  font-size:13px;
  font-weight:700;
  color:#0f172a;
  padding:0;
  background:transparent;
}
.zh-cp-ico{
  width:28px;height:28px;
  border-radius:10px;
  border:1px solid rgba(0,0,0,.12);
  background:#fff;
  cursor:pointer;
  display:flex;align-items:center;justify-content:center;
}
.zh-cp-ico:hover{background:rgba(2,6,23,.04);}
.zh-cp-ico[disabled]{opacity:.35;cursor:not-allowed;}
.zh-cp-body{padding:0 6px 6px 6px;}

.zh-cp-sv{
  position:relative;
  height:170px;
  border-radius:12px;
  overflow:hidden;
  border:1px solid rgba(0,0,0,.12);
}
.zh-cp-sv canvas{display:block;width:100%;height:100%;}
.zh-cp-sv .cursor{
  position:absolute;
  width:14px;height:14px;border-radius:999px;
  border:2px solid #fff;
  box-shadow:0 2px 8px rgba(0,0,0,.35);
  transform:translate(-7px,-7px);
}
.zh-cp-row{
  margin-top:10px;
  display:flex;
  align-items:center;
  gap:10px;
}
.zh-cp-row label{
  font-size:12px;
  color:rgba(15,23,42,.70);
  width:46px;
}
.zh-cp-row input[type="range"]{
  flex:1;
  cursor:pointer;
}
.zh-cp-title{
  margin-top:12px;
  font-size:12px;
  color:rgba(15,23,42,.70);
  font-weight:800;
}
.zh-cp-grid{
  margin-top:8px;
  display:grid;
  grid-template-columns:repeat(10, 1fr);
  gap:8px;
}
.zh-cp-chip{
  width:100%;
  height:22px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,.12);
  cursor:pointer;
  background:#111827;
  position:relative;
}
.zh-cp-chip.transparent{
  overflow:hidden;
}
.zh-cp-chip.transparent::before{
  content:"";
  position:absolute; inset:0;
  background:
    linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%, rgba(0,0,0,.10)),
    linear-gradient(45deg, rgba(0,0,0,.10) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.10) 75%, rgba(0,0,0,.10));
  background-size:10px 10px;
  background-position:0 0,5px 5px;
}
.zh-cp-chip:hover{filter:brightness(.98);}
.zh-cp-foot{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 6px 4px 6px;
}
.zh-cp-btn{
  height:32px;
  border-radius:12px;
  border:1px solid rgba(0,0,0,.14);
  background:#fff;
  cursor:pointer;
  font-size:12px;
  font-weight:900;
  padding:0 10px;
}
.zh-cp-btn:hover{background:rgba(2,6,23,.04);}
.zh-cp-close{
  border:0;background:transparent;cursor:pointer;
  font-size:14px;opacity:.65;
  width:34px;height:34px;border-radius:12px;
}
.zh-cp-sv .cursor{ pointer-events:none; }
.zh-cp-close:hover{background:rgba(2,6,23,.04);opacity:.9;}
    `.trim();
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Popover
  // ------------------------------------------------------------
  function createColorPickerPopover(opts = {}) {
    ensureCssOnce();
	
	const DBG = !!opts.debug;
	const dlog = (...a) => { if (DBG) console.log("%c[CP]", "color:#7c3aed;font-weight:800;", ...a); };

    const onPick = (typeof opts.onPick === "function") ? opts.onPick : () => {};
    const onClose = (typeof opts.onClose === "function") ? opts.onClose : () => {};
    const storageKey = String(opts.storageKey || "zh_color_recent");

    let current = normalizeHex(opts.initial) || "#111827";
    if (current === "transparent") current = "transparent";

    // default palette (proche “Google”)
    const themeColors = Array.isArray(opts.themeColors) && opts.themeColors.length
      ? opts.themeColors
      : ["#111827","#334155","#64748B","#0F766E","#16A34A","#CA8A04","#EA580C","#DC2626","#7C3AED","#DB2777"];

    const standardColors = Array.isArray(opts.standardColors) && opts.standardColors.length
      ? opts.standardColors
      : ["#000000","#FFFFFF","#EF4444","#F97316","#F59E0B","#EAB308","#22C55E","#06B6D4","#3B82F6","#A855F7"];

    // DOM
    const pop = document.createElement("div");
    pop.className = "zh-cp-pop";
	pop.setAttribute("data-no-deselect", "1");
	pop.setAttribute("data-zh-popover", "1"); // ✅ même marqueur que font picker

    pop.hidden = true;

    pop.innerHTML = `
      <div class="zh-cp-top">
        <div class="zh-cp-swatch" data-role="swatch"></div>
        <div class="zh-cp-hexwrap">
          <div class="hash">#</div>
          <input data-role="hex" type="text" inputmode="text" autocomplete="off" spellcheck="false" maxlength="6" />
        </div>
        <button class="zh-cp-ico" type="button" data-role="dropper" title="Pipette">🎯</button>
        <button class="zh-cp-close" type="button" data-role="close" title="Fermer">✕</button>
      </div>

      <div class="zh-cp-body">
        <div class="zh-cp-sv" data-role="sv">
          <canvas data-role="svc" width="310" height="170"></canvas>
          <div class="cursor" data-role="svc"></div>
        </div>

        <div class="zh-cp-row">
          <label>Teinte</label>
          <input data-role="hue" type="range" min="0" max="360" value="0" />
        </div>

        <div class="zh-cp-title">Couleurs du thème</div>
        <div class="zh-cp-grid" data-role="theme"></div>

        <div class="zh-cp-title">Couleurs standard</div>
        <div class="zh-cp-grid" data-role="std"></div>

        <div class="zh-cp-title">Récemment utilisé</div>
        <div class="zh-cp-grid" data-role="recent"></div>

        <div class="zh-cp-foot">
          <button class="zh-cp-btn" type="button" data-role="transparent">Transparent</button>
          <button class="zh-cp-btn" type="button" data-role="ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(pop);

    // ✅ Guard focus: ne casse pas la sélection texte quand tu cliques dans le popover
    installFocusGuards(pop);

    const elSwatch = pop.querySelector('[data-role="swatch"]');
    const elHex = pop.querySelector('[data-role="hex"]');
    const elDropper = pop.querySelector('[data-role="dropper"]');
    const elClose = pop.querySelector('[data-role="close"]');

    const svWrap = pop.querySelector('[data-role="sv"]');
    const svCanvas = pop.querySelector('canvas[data-role="svc"]');
    const svCursor = pop.querySelector('div.cursor[data-role="svc"]');
    const elHue = pop.querySelector('[data-role="hue"]');

    const elTheme = pop.querySelector('[data-role="theme"]');
    const elStd = pop.querySelector('[data-role="std"]');
    const elRecent = pop.querySelector('[data-role="recent"]');

    const btnTransparent = pop.querySelector('[data-role="transparent"]');
    const btnOk = pop.querySelector('[data-role="ok"]');



    // state HSV
    let rgba = hexToRgb(current) || { r: 17, g: 24, b: 39, a: 1 };
    let hsv = rgbToHsv(rgba.r, rgba.g, rgba.b);

    const ctx = svCanvas.getContext("2d");

    function setSwatch(hexOrTransparent) {
      const v = normalizeHex(hexOrTransparent);
      if (!v) return;
      current = v;

      if (v === "transparent") {
        elSwatch.classList.add("transparent");
        elSwatch.style.background = "transparent";
        elHex.value = "";
      } else {
        elSwatch.classList.remove("transparent");
        elSwatch.style.background = v;
        elHex.value = v.replace("#", "");
      }
    }

    function emit(live = true) {
	  dlog("emit()", { current, live });
	  try { onPick(current); } catch (e) { console.error("[CP] onPick error", e); }
	  if (current !== "transparent") saveRecent(storageKey, current, 10);
	  if (!live) rebuildRecent();
	}


    function redrawSV() {
      const base = hsvToRgb(hsv.h, 1, 1);
      ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
      ctx.fillRect(0, 0, svCanvas.width, svCanvas.height);

      const gW = ctx.createLinearGradient(0, 0, svCanvas.width, 0);
      gW.addColorStop(0, "rgba(255,255,255,1)");
      gW.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gW;
      ctx.fillRect(0, 0, svCanvas.width, svCanvas.height);

      const gB = ctx.createLinearGradient(0, 0, 0, svCanvas.height);
      gB.addColorStop(0, "rgba(0,0,0,0)");
      gB.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = gB;
      ctx.fillRect(0, 0, svCanvas.width, svCanvas.height);
    }

    function syncCursor() {
      const x = hsv.s * svCanvas.width;
      const y = (1 - hsv.v) * svCanvas.height;
      svCursor.style.left = `${x}px`;
      svCursor.style.top = `${y}px`;
    }

    function applyHsvToCurrent(live = true) {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      rgba = { ...rgb, a: 1 };
      current = rgbToHex(rgba.r, rgba.g, rgba.b);
      setSwatch(current);
      emit(live);
    }

    function pickFromSV(clientX, clientY, live = true) {
	   dlog("pickFromSV()", { clientX, clientY, live });	
      const r = svCanvas.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      const y = clamp(clientY - r.top, 0, r.height);

      hsv.s = x / r.width;
      hsv.v = 1 - (y / r.height);

      syncCursor();
      applyHsvToCurrent(live);
    }

    function bindDrag(el, onMove) {
      el.addEventListener("pointerdown", (e) => {
        // ✅ ici on veut empêcher sélection native / drag image
        stop(e);
        el.setPointerCapture(e.pointerId);
        onMove(e.clientX, e.clientY, true);

        const mm = (ev) => onMove(ev.clientX, ev.clientY, true);
        const uu = () => {
          el.removeEventListener("pointermove", mm);
          el.removeEventListener("pointerup", uu);
          el.removeEventListener("pointercancel", uu);
        };
        el.addEventListener("pointermove", mm);
        el.addEventListener("pointerup", uu);
        el.addEventListener("pointercancel", uu);
      }, { capture: true });
    }

    bindDrag(svWrap, pickFromSV);

    // hue slider: on laisse l'input prendre le focus si besoin
    elHue.addEventListener("input", () => {
      hsv.h = Number(elHue.value || 0);
      redrawSV();
      applyHsvToCurrent(true);
    }, true);

    // HEX typing (6 chars, sans #)
    elHex.addEventListener("input", () => {
      const raw = String(elHex.value || "").replace(/[^0-9a-f]/gi, "").slice(0, 6);
      if (raw !== elHex.value) elHex.value = raw;
      if (raw.length === 6) {
        const v = normalizeHex(raw);
        if (v && v !== "transparent") {
          const rgb = hexToRgb(v);
          if (rgb) {
            hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            elHue.value = String(Math.round(hsv.h));
            redrawSV();
            syncCursor();
            current = v;
            setSwatch(current);
            emit(true);
          }
        }
      }
    }, true);

    elHex.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = normalizeHex(elHex.value);
        if (v && v !== "transparent") {
          current = v;
          setSwatch(current);
          emit(false);
        }
      }
    }, true);

    // Eyedropper (si dispo)
    async function runEyeDropper() {
      if (!("EyeDropper" in window)) return;
      try {
        const ed = new window.EyeDropper();
        const res = await ed.open();
        const v = normalizeHex(res && res.sRGBHex);
        if (v && v !== "transparent") {
          const rgb = hexToRgb(v);
          if (rgb) {
            hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            elHue.value = String(Math.round(hsv.h));
            redrawSV();
            syncCursor();
          }
          current = v;
          setSwatch(current);
          emit(true);
        }
      } catch (_) {}
    }

    if (!("EyeDropper" in window)) {
      elDropper.disabled = true;
      elDropper.title = "Pipette non supportée";
    } else {
      elDropper.addEventListener("click", (e) => { e.stopPropagation(); runEyeDropper(); }, true);
    }

    // Palette grids
    function addChip(parent, hex) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "zh-cp-chip";
      const v = normalizeHex(hex);
      if (v === "transparent") b.classList.add("transparent");
      b.style.background = (v && v !== "transparent") ? v : "transparent";

      // ✅ pointerdown preventDefault pour ne pas donner focus au bouton
      b.addEventListener("pointerdown", (e) => { try { e.preventDefault(); } catch(_){} }, true);

      b.addEventListener("click", (e) => {
        e.stopPropagation();
		  dlog("chip click", { hex, normalized: normalizeHex(hex) });
        const vv = normalizeHex(hex);
        if (!vv) return;

        if (vv === "transparent") {
          current = "transparent";
          setSwatch("transparent");
          emit(true);
          return;
        }

        const rgb = hexToRgb(vv);
        if (rgb) {
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          elHue.value = String(Math.round(hsv.h));
          redrawSV();
          syncCursor();
        }
        current = vv;
        setSwatch(current);
        emit(true);
      }, true);

      parent.appendChild(b);
    }

    function rebuildGrid(parent, arr) {
      parent.innerHTML = "";
      (arr || []).forEach((c) => addChip(parent, c));
    }

    function rebuildRecent() {
      const rec = loadRecent(storageKey, 10);
      rebuildGrid(elRecent, rec);
    }

    rebuildGrid(elTheme, themeColors);
    rebuildGrid(elStd, standardColors);
    rebuildRecent();

    // buttons
    btnTransparent.addEventListener("click", (e) => {
      e.stopPropagation();
      current = "transparent";
      setSwatch("transparent");
      emit(true);
    }, true);

    btnOk.addEventListener("click", (e) => {
      e.stopPropagation();
      emit(false);
      close();
    }, true);

    function close() {
      pop.hidden = true;
      try { onClose(); } catch (_) {}
    }

    elClose.addEventListener("click", (e) => { e.stopPropagation(); close(); }, true);

    // Positioning (anchor)
    function positionToAnchor(anchorEl) {
      const pad = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const a = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
      const W = 330;
      const H = 520;
      let left = a ? a.left : (vw / 2 - W / 2);
      let top = a ? (a.bottom + 8) : (vh / 2 - H / 2);

      if (left + W + pad > vw) left = vw - W - pad;
      if (top + H + pad > vh) top = Math.max(pad, (a ? (a.top - H - 8) : (vh - H - pad)));
      left = Math.max(pad, left);
      top = Math.max(pad, top);

      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }

    function open(anchorEl) {
      // sync from current
      if (current === "transparent") {
        setSwatch("transparent");
      } else {
        const rgb = hexToRgb(current);
        if (rgb) {
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          elHue.value = String(Math.round(hsv.h));
        }
        setSwatch(current);
      }

      redrawSV();
      syncCursor();

      positionToAnchor(anchorEl);
      pop.hidden = false;
	    dlog("open()", { current, anchor: !!anchorEl });

      // ✅ FIX: NE PAS focus automatiquement le champ HEX
      // (sinon ça flingue la sélection dans le contenteditable)
      // Si tu veux quand même permettre le focus rapide, clique dans l'input.
    }

    function isOpen() { return !pop.hidden; }

    function setColor(hexOrTransparent, { silent = false } = {}) {
      const v = normalizeHex(hexOrTransparent);
      if (!v) return;
      current = v;

      if (v === "transparent") {
        setSwatch("transparent");
        if (!silent) emit(true);
        return;
      }

      const rgb = hexToRgb(v);
      if (rgb) {
        hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        elHue.value = String(Math.round(hsv.h));
        redrawSV();
        syncCursor();
      }
      setSwatch(current);
      if (!silent) emit(true);
    }

    function destroy() {
      try { pop.remove(); } catch (_) {}
    }

    // init
    setColor(current, { silent: true });
    redrawSV();
    syncCursor();

    return {
      // ✅ important: text_toolbar_tools.js récupère pop/el/root etc.
      pop,
      el: pop,
      open,
      close,
      isOpen,
      setColor,
      getColor: () => current,
      setThemeColors(arr) { if (Array.isArray(arr)) rebuildGrid(elTheme, arr); },
      setStandardColors(arr) { if (Array.isArray(arr)) rebuildGrid(elStd, arr); },
      refreshRecent: rebuildRecent,
      destroy,
    };
  }

  // ------------------------------------------------------------
  // Export
  // ------------------------------------------------------------
  global.ColorPickerTools = global.ColorPickerTools || {};
  global.ColorPickerTools.createColorPickerPopover = createColorPickerPopover;
  global.ColorPickerTools.normalizeHex = normalizeHex;
  global.ColorPickerTools.hexToRgb = hexToRgb;
  global.ColorPickerTools.rgbToHex = rgbToHex;
    // Aliases compat toolbar (au cas où)
  global.ColorPickerTools.createColorPicker = createColorPickerPopover;
  global.ColorPickerTools.createColorPickerTools = createColorPickerPopover;


})(window);

// app/static/labo/editor/text_toolbar_tools.js
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants / Utils
  // ---------------------------------------------------------------------------
  const Z_TOOLBAR = 2147483000;
  const Z_POPOVER = 2147483647;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  
  
  // ---------------------------------------------------------------------------
// Global force-hide latch (prevents immediate re-show after delete)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Global force-hide latch (prevents immediate re-show after delete)
// ---------------------------------------------------------------------------
global.__ZH_TT_FORCE_HIDDEN__ = global.__ZH_TT_FORCE_HIDDEN__ || false;
global.__ZH_TT_FORCE_HIDDEN_AT__ = global.__ZH_TT_FORCE_HIDDEN_AT__ || 0;

if (!global.__ZH_TT_HIDEALL_WIRED__) {
  global.__ZH_TT_HIDEALL_WIRED__ = true;

  document.addEventListener("zh:toolbar-hide-all", () => {
    const now = performance.now();
    try {
      global.__ZH_TT_FORCE_HIDDEN__ = true;
      global.__ZH_TT_FORCE_HIDDEN_AT__ = now;
    } catch (_) {}

    try {
      const s = global.__ZH_TEXT_TOOLBAR_SINGLETON__;
      if (s && typeof s.hide === "function") s.hide();
    } catch (_) {}
  }, true);
}




  function isInPopover(target) {
    if (!target || !target.closest) return false;
    if (target.closest('[data-zh-popover="1"]')) return true;
    if (target.closest(".zh-font-pop")) return true;
    if (target.closest(".zh-color-pop")) return true;
    if (target.closest(".zh-cp-pop")) return true;
    if (target.closest(".tt-color-pop")) return true;
    if (target.closest(".color-pop")) return true;
    if (target.closest("[data-color-picker-pop]")) return true;
    return false;
  }

  function viewportHostRect() {
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------
  function ensureCssOnce() {
    if (document.getElementById("tt_toolbar_css")) return;
    const st = document.createElement("style");
    st.id = "tt_toolbar_css";
    st.textContent = `
.tt-toolbar{
  position:fixed;
  z-index:${Z_TOOLBAR};
  display:flex;
  flex-direction:row;
  flex-wrap:nowrap;
  align-items:center;
  gap:10px;
  padding:8px 10px;
  background:#ffffff;
  color:#0f172a;
  border:1px solid rgba(15,23,42,.10);
  border-radius:14px;
  box-shadow:0 10px 30px rgba(2,6,23,.12);
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;
  user-select:none;
  white-space:nowrap;
}
.tt-toolbar[hidden]{display:none;}
.tt-toolbar .tt-group{display:flex;align-items:center;gap:8px;white-space:nowrap;}
.tt-toolbar .tt-sep{width:1px;height:22px;background:rgba(15,23,42,.10);margin:0 2px;}
.tt-toolbar select{
  height:30px;border-radius:12px;border:1px solid rgba(15,23,42,.12);
  background:#fff;color:#0f172a;padding:0 10px;font-size:13px;outline:none;cursor:pointer;
}
.tt-toolbar .tt-iconbtn{
  width:30px;height:30px;border-radius:12px;border:1px solid rgba(15,23,42,.12);
  background:#fff;display:inline-flex;align-items:center;justify-content:center;
  cursor:pointer;font-size:13px;line-height:1;padding:0;
}
.tt-toolbar .tt-iconbtn:hover{background:rgba(15,23,42,.04);}
.tt-toolbar .tt-iconbtn.is-on{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.35);}
.tt-toolbar .tt-textbtn{
  height:30px;padding:0 10px;border-radius:12px;border:1px solid rgba(15,23,42,.12);
  background:#fff;cursor:pointer;font-size:13px;font-weight:800;
}
.tt-toolbar .tt-textbtn:hover{background:rgba(15,23,42,.04);}
.tt-toolbar .tt-textbtn.is-on{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.35);}

.tt-toolbar .tt-color-dot{
  width:14px;height:14px;border-radius:7px;border:1px solid rgba(15,23,42,.18);
  background:#111827;
}

.zh-font-pop{
  position:fixed !important;
  z-index:${Z_POPOVER} !important;
  width:min(560px, calc(100vw - 24px)) !important;
  max-width:calc(100vw - 24px) !important;
}

`.trim();
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------
  // Popover helpers (font)
  // ---------------------------------------------------------------------------
  function getFontPopEl(fontPop) {
    if (!fontPop) return null;
    return fontPop.el || fontPop.pop || fontPop.root || fontPop.container || fontPop._el || null;
  }

  // Force top layering and prevent the library from re-lowering the z-index.
  function lockPopoverZ(popEl) {
    if (!popEl) return;

    popEl.setAttribute("data-zh-popover", "1");
    popEl.style.position = "fixed";
    popEl.style.zIndex = String(Z_POPOVER);
    popEl.style.transform = "none";
    popEl.style.right = "auto";
    popEl.style.bottom = "auto";

    if (popEl.__zhZLocked) return;
    popEl.__zhZLocked = true;

    // MutationObserver: some popovers rewrite `style` after open
    const mo = new MutationObserver(() => {
      try {
        if (!popEl.isConnected) return;
        const z = getComputedStyle(popEl).zIndex;
        if (String(z) !== String(Z_POPOVER)) popEl.style.zIndex = String(Z_POPOVER);
        if (getComputedStyle(popEl).position !== "fixed") popEl.style.position = "fixed";
      } catch (_) {}
    });
    mo.observe(popEl, { attributes: true, attributeFilter: ["style", "class"] });
    popEl.__zhZMo = mo;
  }

  function unlockPopoverZ(popEl) {
    if (!popEl) return;
    try {
      if (popEl.__zhZMo) popEl.__zhZMo.disconnect();
    } catch (_) {}
    popEl.__zhZMo = null;
    popEl.__zhZLocked = false;
  }

  function positionFontPopAboveToolbar(popEl, btnEl, tbEl) {
    if (!popEl || !btnEl || !tbEl) return;

    const br = btnEl.getBoundingClientRect();
    const tbr = tbEl.getBoundingClientRect();
    const pad = 10;

    // ensure measurable (some libs keep it display:none until open)
    const pw = popEl.offsetWidth || 560;
    const ph = popEl.offsetHeight || 360;

    // X centered on button
    let left = br.left + br.width / 2 - pw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad));

    // Y: prefer above toolbar (NOT just above button)
    const topAboveToolbar = tbr.top - ph - 12;
    const topBelowToolbar = tbr.bottom + 12;

    let top = topAboveToolbar;
    if (top < pad) top = topBelowToolbar;
    top = Math.max(pad, Math.min(top, window.innerHeight - ph - pad));

    popEl.style.left = `${Math.round(left)}px`;
    popEl.style.top = `${Math.round(top)}px`;

    // second pass (libraries sometimes reapply their own layout)
    requestAnimationFrame(() => {
      popEl.style.left = `${Math.round(left)}px`;
      popEl.style.top = `${Math.round(top)}px`;
      popEl.style.zIndex = String(Z_POPOVER);
      popEl.style.position = "fixed";
      popEl.style.transform = "none";
    });
  }

  // ---------------------------------------------------------------------------
  // SINGLETON CORE (DOM unique) + "bound instances" par owner
  // ---------------------------------------------------------------------------
  function createTextToolbar(cfg = {}) {
    ensureCssOnce();

    global.__ZH_TEXT_TOOLBAR_SINGLETON__ = global.__ZH_TEXT_TOOLBAR_SINGLETON__ || null;

    function makeBound(singleton, boundCfg) {
      const withCfg = (fn) => (...args) => {
        try { singleton.setConfig(boundCfg); } catch (_) {}
        return fn.apply(singleton, args);
      };

      return {
        el: singleton.el,
        updateFromContext: withCfg(singleton.updateFromContext),
        show: withCfg(singleton.show),
        hide: withCfg(singleton.hide),
        setValues: withCfg(singleton.setValues),
        positionUnderRect: withCfg(singleton.positionUnderRect),
        closePopovers: withCfg(singleton.closePopovers),
        destroy: () => { /* no-op */ },
        _getFontPop: singleton._getFontPop,
        _getColorPop: singleton._getColorPop,
      };
    }

    if (global.__ZH_TEXT_TOOLBAR_SINGLETON__) {
      return makeBound(global.__ZH_TEXT_TOOLBAR_SINGLETON__, cfg || {});
    }

    // ----------------------------------------------------------
    // Create singleton DOM once
    // ----------------------------------------------------------
    let hostEl = cfg.hostEl || document.body;
    let _cfg = cfg || {};

    const call = (name, ...args) => {
      const fn = _cfg && _cfg[name];
      if (typeof fn === "function") return fn(...args);
      return undefined;
    };

    const getContext = () => call("getContext") || {};
    const fireAction = (payload) => call("onAction", payload);
    const beforeFont = (ctx) => call("onBeforeOpenFontPicker", ctx);
    const beforeColor = (ctx) => call("onBeforeOpenColorPicker", ctx);

    const tb = document.createElement("div");
    tb.className = "tt-toolbar";
    tb.setAttribute("data-tt-singleton", "1");
    tb.setAttribute("data-zh-popover", "1");
    tb.hidden = true;

    tb.addEventListener("pointerdown", (e) => e.stopPropagation(), { capture: true });
    tb.addEventListener("mousedown", (e) => e.stopPropagation(), { capture: true });

    const group = () => { const g = document.createElement("div"); g.className = "tt-group"; return g; };
    const sep = () => { const s = document.createElement("div"); s.className = "tt-sep"; return s; };

    const iconBtn = (label, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tt-iconbtn";
      b.textContent = label;
      b.title = title || "";
      return b;
    };
    const textBtn = (label, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tt-textbtn";
      b.textContent = label;
      b.title = title || "";
      return b;
    };

    // ---------------- Font picker ----------------
    const btnFont = iconBtn("Aa", "Police");
    btnFont.style.width = "42px";
    btnFont.style.fontWeight = "900";

    let fontPop = null;

    btnFont.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const ctx = getContext() || {};
      try { beforeFont(ctx); } catch (_) {}
    }, { capture: true });

    btnFont.addEventListener("click", (e) => {
      e.stopPropagation();

      const FP = global.FontPickerTools || null;
      const createFontPickerPopover = FP && FP.createFontPickerPopover;
      if (!createFontPickerPopover) return;

      const ctx = getContext() || {};
      const selectedKey = String(ctx.currentFontKey || ctx.fontKey || "helv").trim();

      if (!fontPop) {
        fontPop = createFontPickerPopover({
          fonts: ctx.fonts || [],
          selected: selectedKey,
          onPick: (picked) => {
            let fontKey = picked;
            if (fontKey && typeof fontKey === "object") {
              fontKey = fontKey.name || fontKey.family || fontKey.key || fontKey.label;
            }
            fontKey = String(fontKey || "helv").trim();
            fireAction({ type: "font", value: fontKey });
          },
        });
      } else {
        try { fontPop.setFonts && fontPop.setFonts(ctx.fonts || []); } catch (_) {}
        try { fontPop.setSelected && fontPop.setSelected(selectedKey); } catch (_) {}
      }

      requestAnimationFrame(() => {
        if (!fontPop) return;

        const opened = (fontPop.isOpen && fontPop.isOpen()) || false;
        if (opened) {
          try {
            const popEl = getFontPopEl(fontPop);
            unlockPopoverZ(popEl);
          } catch (_) {}
          try { fontPop.close && fontPop.close(); } catch (_) {}
          return;
        }

        // open
        if (typeof fontPop.open === "function") {
          fontPop.open(btnFont);
        } else if (typeof fontPop.openAt === "function") {
          const r = btnFont.getBoundingClientRect();
          fontPop.openAt(r.left, r.bottom + 8);
        }

        // post-open fix (appendToBody + z-lock + position + widen)
        requestAnimationFrame(() => {
          try {
            const popEl = getFontPopEl(fontPop);
            if (!popEl) return;

            // get out of any stacking context
            if (popEl.parentNode !== document.body) document.body.appendChild(popEl);

            // widen
            popEl.style.width = "min(560px, calc(100vw - 24px))";
            popEl.style.maxWidth = "calc(100vw - 24px)";

            // lock above toolbar (even if lib rewrites z-index)
            lockPopoverZ(popEl);

            // position above toolbar
            positionFontPopAboveToolbar(popEl, btnFont, tb);
          } catch (_) {}
        });
      });
    }, { capture: true });

    // ---------------- Size ----------------
    const sizeSel = document.createElement("select");
    const sizeOptions = [];
    for (let i = 4; i <= 90; i++) sizeOptions.push(i);
    sizeSel.innerHTML = sizeOptions.map((n) => `<option value="${n}">${n}</option>`).join("");
    sizeSel.addEventListener("change", () => {
      const v = clamp(Number(sizeSel.value || 14), 4, 90);
      fireAction({ type: "size", value: v });
    }, true);

    // ---------------- Color picker ----------------
    const btnColor = iconBtn("", "Couleur");
    const dot = document.createElement("span");
    dot.className = "tt-color-dot";
    btnColor.appendChild(dot);

    let colorPop = null;

    function getPopEl(pop) {
      if (!pop) return null;
      return pop.el || pop.pop || pop.root || pop.container || pop._el || null;
    }
    function popIsOpen(pop) {
      if (!pop) return false;
      if (typeof pop.isOpen === "function") return !!pop.isOpen();
      const el = getPopEl(pop);
      if (el && el.hidden != null) return !el.hidden;
      if (el && el.style) return el.style.display !== "none";
      return false;
    }
    function forcePopoverFixed(pop) {
      const el = getPopEl(pop);
      if (!el) return;
      el.setAttribute("data-zh-popover", "1");
      el.style.position = "fixed";
      el.style.zIndex = String(Z_POPOVER);
    }
    function popClose(pop) {
      if (!pop) return;
      if (typeof pop.close === "function") return pop.close();
      const el = getPopEl(pop);
      if (el) el.hidden = true;
    }
    function popSetColor(pop, c) {
      if (!pop) return;
      if (typeof pop.setColor === "function") return pop.setColor(c, { silent: true });
      if (typeof pop.setInitial === "function") return pop.setInitial(c);
      if (typeof pop.setValue === "function") return pop.setValue(c);
    }
    function popOpenAtRect(pop, rect) {
      if (!pop || !rect) return;
      forcePopoverFixed(pop);
      if (typeof pop.openAt === "function") return pop.openAt(rect.left, rect.bottom + 8);
      const el = getPopEl(pop);
      if (el) {
        el.hidden = false;
        el.style.left = `${Math.round(rect.left)}px`;
        el.style.top = `${Math.round(rect.bottom + 8)}px`;
      }
    }

    let colorGuards = false;

    function installColorGuards(pop) {
      if (colorGuards) return;
      const el = getPopEl(pop);
      if (!el || !el.addEventListener) return;

      const allow = (t) => {
        const tag = (t?.tagName || "").toLowerCase();
        return tag === "input" || tag === "textarea" || tag === "select" || !!t?.isContentEditable;
      };

      const guard = (e) => {
        if (allow(e.target)) return;
        try { e.preventDefault(); } catch (_) {}
      };

      el.addEventListener("pointerdown", guard, true);
      el.addEventListener("mousedown", guard, true);
      colorGuards = true;
    }

    btnColor.addEventListener("pointerdown", (e) => {
      try { e.preventDefault(); } catch (_) {}
      e.stopPropagation();
      const ctx = getContext() || {};
      try { beforeColor(ctx); } catch (_) {}
    }, { capture: true });

    btnColor.addEventListener("click", (e) => {
      e.stopPropagation();

      const ctx = getContext() || {};
      const initial = ctx.color || "#111827";

      const CP = global.ColorPickerTools || null;
      const create = CP && (CP.createColorPickerPopover || CP.createColorPopover);
      if (!create) return;

      if (!colorPop) {
        try {
          colorPop = create({
            initial,
            storageKey: "zh_color_recent",
            onPick: (hex) => fireAction({ type: "color", value: hex }),
          });
        } catch (_) {
          colorPop = create(initial, (hex) => fireAction({ type: "color", value: hex }));
        }
      }

      try { forcePopoverFixed(colorPop); } catch (_) {}
      try { popSetColor(colorPop, initial); } catch (_) {}

      requestAnimationFrame(() => {
        if (popIsOpen(colorPop)) {
          popClose(colorPop);
        } else {
          const r = btnColor.getBoundingClientRect();
          popOpenAtRect(colorPop, r);
          installColorGuards(colorPop);
        }
      });
    }, { capture: true });

    // ---------------- Align ----------------
    const btnLeft = iconBtn("≡", "Align gauche");
    const btnCenter = iconBtn("≣", "Align centre");
    const btnRight = iconBtn("≡", "Align droite");
    btnLeft.style.justifyContent = "flex-start"; btnLeft.style.paddingLeft = "8px";
    btnCenter.style.justifyContent = "center";
    btnRight.style.justifyContent = "flex-end"; btnRight.style.paddingRight = "8px";

    btnLeft.addEventListener("click", () => fireAction({ type: "align", value: "left" }), true);
    btnCenter.addEventListener("click", () => fireAction({ type: "align", value: "center" }), true);
    btnRight.addEventListener("click", () => fireAction({ type: "align", value: "right" }), true);

    // ---------------- Circle EXT/INT ----------------
    const btnOuter = textBtn("EXT", "Texte à l'extérieur du cercle");
    const btnInner = textBtn("INT", "Texte à l'intérieur du cercle");
    btnOuter.style.fontWeight = "900";
    btnInner.style.fontWeight = "900";
    btnOuter.addEventListener("click", () => fireAction({ type: "circleSide", value: "outer" }), true);
    btnInner.addEventListener("click", () => fireAction({ type: "circleSide", value: "inner" }), true);

    // ---------------- B I U ----------------
    const btnB = textBtn("B", "Gras"); btnB.style.fontWeight = "900";
    const btnI = textBtn("I", "Italique"); btnI.style.fontStyle = "italic";
    const btnU = textBtn("U", "Souligné"); btnU.style.textDecoration = "underline";

    btnB.addEventListener("click", () => fireAction({ type: "bold" }), true);
    btnI.addEventListener("click", () => fireAction({ type: "italic" }), true);
    btnU.addEventListener("click", () => fireAction({ type: "underline" }), true);

    // ---------------- Transform ----------------
    const trSel = document.createElement("select");
    trSel.innerHTML = `
      <option value="none">Aa</option>
      <option value="upper">MAJ</option>
      <option value="lower">min</option>
      <option value="capitalize">Cap</option>
    `.trim();
    trSel.addEventListener("change", () => {
      fireAction({ type: "transform", value: String(trSel.value || "none") });
    }, true);

    // Assemble
    const g1 = group(); g1.appendChild(btnFont);
    const g2 = group(); g2.appendChild(sizeSel);
    const g3 = group(); g3.appendChild(btnColor);
    const g4 = group(); g4.appendChild(btnLeft); g4.appendChild(btnCenter); g4.appendChild(btnRight);
    const g4b = group(); g4b.appendChild(btnOuter); g4b.appendChild(btnInner);
    const g5 = group(); g5.appendChild(btnB); g5.appendChild(btnI); g5.appendChild(btnU);
    const g6 = group(); g6.appendChild(trSel);

    tb.appendChild(g1);
    tb.appendChild(g2);
    tb.appendChild(sep());
    tb.appendChild(g3);
    tb.appendChild(sep());
    tb.appendChild(g4);
    tb.appendChild(sep());
    tb.appendChild(g4b);
    tb.appendChild(sep());
    tb.appendChild(g5);
    tb.appendChild(sep());
    tb.appendChild(g6);

    tb._refs = { btnFont, sizeSel, btnColor, dot, btnLeft, btnCenter, btnRight, btnOuter, btnInner, g4b, btnB, btnI, btnU, trSel };
    (hostEl || document.body).appendChild(tb);

    // Outside click => close popovers
    const onDocDown = (e) => {
      if (isInPopover(e.target)) return;
      if (tb.contains(e.target)) return;
      try {
        const popEl = getFontPopEl(fontPop);
        unlockPopoverZ(popEl);
      } catch (_) {}
      try { colorPop && (colorPop.close ? colorPop.close() : popClose(colorPop)); } catch (_) {}
      try { fontPop && fontPop.close && fontPop.close(); } catch (_) {}
    };
    document.addEventListener("pointerdown", onDocDown, true);
	
	let _lastActiveBlockEl = null;
		let _domMo = null;

		function startDomWatch() {
		  if (_domMo) return;
		  _domMo = new MutationObserver(() => {
			try {
			  if (_lastActiveBlockEl && !_lastActiveBlockEl.isConnected) {
				_lastActiveBlockEl = null;
				hideHard();
			  }
			} catch (_) {}
		  });
		  _domMo.observe(document.body, { childList: true, subtree: true });
		}

		function stopDomWatch() {
		  try { _domMo && _domMo.disconnect(); } catch (_) {}
		  _domMo = null;
		}
		
	
	let _watchLastT = 0;

	


		


    

    function setValues(state) {
      const r = tb._refs;
      if (!r) return;

      const sz = clamp(Math.round(Number(state.size || 14)), 4, 90);
      if (r.sizeSel) r.sizeSel.value = String(sz);

      const c = state.color || "#111827";
      if (r.dot) r.dot.style.background = (c === "transparent") ? "transparent" : c;

      if (r.btnLeft) r.btnLeft.classList.toggle("is-on", state.align === "left");
      if (r.btnCenter) r.btnCenter.classList.toggle("is-on", state.align === "center");
      if (r.btnRight) r.btnRight.classList.toggle("is-on", state.align === "right");

      if (r.btnB) r.btnB.classList.toggle("is-on", !!state.bold);
      if (r.btnI) r.btnI.classList.toggle("is-on", !!state.italic);
      if (r.btnU) r.btnU.classList.toggle("is-on", !!state.underline);

      if (r.trSel) r.trSel.value = String(state.transform || "none");

      if (r.g4b) {
        const hasSide = (state.circleSide === "outer" || state.circleSide === "inner");
        r.g4b.style.display = hasSide ? "" : "none";
        if (hasSide) {
          r.btnOuter && r.btnOuter.classList.toggle("is-on", state.circleSide === "outer");
          r.btnInner && r.btnInner.classList.toggle("is-on", state.circleSide === "inner");
        }
      }
    }

    function positionUnderRect(objRect, hostRect) {
      if (!objRect) return;
      const hostR = hostRect || viewportHostRect();

      const pad = 8;
      const tbW = tb.offsetWidth || 360;
      const tbH = tb.offsetHeight || 44;

      const baseLeft = objRect.left + (objRect.width / 2) - (tbW / 2);
      const belowTop = objRect.bottom + 10;
      const aboveTop = objRect.top - 10 - tbH;

      let left = clamp(baseLeft, pad, hostR.width - tbW - pad);
      let top = belowTop;

      if (top + tbH + pad > hostR.height) top = aboveTop;
      top = clamp(top, pad, hostR.height - tbH - pad);

      tb.style.left = `${Math.round(left)}px`;
      tb.style.top = `${Math.round(top)}px`;
    }

    function closePopoversLocal() {
  try {
    const popEl = getFontPopEl(fontPop);
    unlockPopoverZ(popEl);
  } catch (_) {}
  try { colorPop && (colorPop.close ? colorPop.close() : popClose(colorPop)); } catch (_) {}
  try { fontPop && fontPop.close && fontPop.close(); } catch (_) {}
}

function hideHard() {
  closePopoversLocal();

  tb.hidden = true;
  tb.setAttribute("hidden", "");
  
  // IMPORTANT: force avec !important pour override editor_ui.css
  tb.style.setProperty('display', 'none', 'important');
}


// ✅ IMPORTANT: certains modules appellent toolbar.hide()
function hide() {
  hideHard();
}

function show() {
  tb.hidden = false;
  tb.removeAttribute("hidden");
  tb.style.removeProperty('display'); // enlève le !important
  tb.style.visibility = "visible";
  tb.style.opacity = "1";
}


function updateFromContext() {
  let ctx = null;
  try { ctx = getContext(); } catch (_) { ctx = null; }

  // ✅ verrou global: on ne ré-affiche QUE si ctx.selectionStamp est plus récent
  if (global.__ZH_TT_FORCE_HIDDEN__) {
    const stamp = Number(ctx && ctx.selectionStamp) || 0;
    if (!ctx || !ctx.anchorRect || stamp <= (global.__ZH_TT_FORCE_HIDDEN_AT__ || 0)) {
      hideHard();
      return;
    }
    // sélection récente => on relâche
    global.__ZH_TT_FORCE_HIDDEN__ = false;
  }


  // si supprimé / plus actif
  if (!ctx || ctx.isVisible === false || ctx.deleted === true || ctx.exists === false) {
    hideHard();
    return;
  }

  // pas d’ancre => pas d’objet actif fiable
  if (!ctx.anchorRect) {
    hideHard();
    return;
  }

  // si le block DOM a été retiré
  if (ctx.blockEl && ctx.blockEl.isConnected === false) {
    hideHard();
    return;
  }
  
  // ✅ mémorise le block actif + surveille le DOM (suppression => hide)
	if (ctx.blockEl) {
	  _lastActiveBlockEl = ctx.blockEl;
	  startDomWatch();
	 
	}


  show();

  try { setValues(ctx); } catch (_) {}

  const hr = ctx.hostRect || viewportHostRect();
  try { positionUnderRect(ctx.anchorRect, hr); } catch (_) {}
}


    function destroy() {
		stopDomWatch();
		 
	_lastActiveBlockEl = null;
      document.removeEventListener("pointerdown", onDocDown, true);
      try {
        const popEl = getFontPopEl(fontPop);
        unlockPopoverZ(popEl);
      } catch (_) {}
      try { colorPop && colorPop.destroy && colorPop.destroy(); } catch (_) {}
      try { fontPop && fontPop.destroy && fontPop.destroy(); } catch (_) {}
      try { tb.remove(); } catch (_) {}
      colorPop = null;
      fontPop = null;
    }

    const singletonApi = {
      el: tb,
      updateFromContext,
      show,
      hide,
      setValues,
      positionUnderRect,
      destroy,
	  closePopovers: closePopoversLocal,
       _getFontPop: () => fontPop,
      _getColorPop: () => colorPop,
      setConfig: (nextCfg) => { _cfg = nextCfg || {}; },
      setHostEl: (nextHost) => { hostEl = nextHost || document.body; try { hostEl.appendChild(tb); } catch (_) {} },
    };

    global.__ZH_TEXT_TOOLBAR_SINGLETON__ = singletonApi;
	
	
	
	// ✅ écouteur optionnel: si ton app déclenche un event custom
		try {
		  document.addEventListener("zh:object-deleted", () => {
			try { hideHard(); } catch (_) {}
		  });
		} catch (_) {}
		// ✅ écouteur global: force hide toolbar (tous les outils texte)
		



    return makeBound(singletonApi, cfg || {});
  }

  // export
  global.TextToolbarTools = global.TextToolbarTools || {};
  global.TextToolbarTools.createTextToolbar = createTextToolbar;

})(window);

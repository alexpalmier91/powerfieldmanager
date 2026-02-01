/* app/static/labo/editor/google_fonts_loader.js
 * Google Fonts Loader — catalogue + lazy-load (css2) + cache
 * Sans dépendances externes.
 *
 * Objectif:
 * - Exposer window.ZHGoogleFontsTools
 * - Fournir une liste de fonts compatible avec font_picker_tools.js
 *   (name/label/scope/href/isDefault)
 * - Charger la CSS Google Fonts "à la demande" (quand on pick)
 *
 * Usage (dans sandbox_editor_ui.html, AVANT tes tools):
 *   <script src="../google_fonts_loader.js?v=1"></script>
 *   <script>
 *     // 1) ton catalogue (ou laisse celui par défaut)
 *     ZHGoogleFontsTools.setCatalog([
 *       { name:"Inter" },
 *       { name:"Poppins" },
 *       { name:"Roboto", weights:"100..900" },
 *     ]);
 *
 *     // 2) construit la liste finale pour ton editor (state.fonts)
 *     //    => tu merges avec tes fonts locales
 *     window.EDITOR_FONTS = [
 *       { name:"helv", label:"Helvetica (défaut)", scope:"default", isDefault:true },
 *       { name:"GLOBAL_FONT_Roboto", label:"Roboto (local)", scope:"global", url:"/assets/fonts_global/Roboto-VariableFont_wdth,wght.ttf" },
 *       ...ZHGoogleFontsTools.buildFontList({ scope:"global", weightsDefault:"400;700" })
 *     ];
 *   </script>
 *
 * Notes:
 * - Tu NE DOIS PAS essayer de charger “toutes” les Google fonts d’un coup.
 *   Mets un catalogue (100–500) + recherche (plus tard) + lazy-load.
 */

(function (global) {
  "use strict";

  const LOG = false;

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  function log(...a) { if (LOG) console.log("[ZHGoogleFonts]", ...a); }

  function cssEscapeIdent(v) {
    const s = String(v || "");
    if (global.CSS && typeof global.CSS.escape === "function") return global.CSS.escape(s);
    return s.replace(/["\\]/g, "\\$&");
  }

  function uniqBy(arr, keyFn) {
    const out = [];
    const seen = new Set();
    for (const it of (arr || [])) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  function toLabel(name) {
    const s = String(name || "").trim();
    return s || "";
  }

  // Google Fonts CSS2
  // family=Playfair+Display:wght@400;700&display=swap
  function makeCss2Href(familyName, weights) {
    const fam = String(familyName || "").trim().replace(/\s+/g, "+");
    const w = String(weights || "").trim();

    // Si rien => sans wght (Google va servir défaut)
    if (!w) return `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;

    // normalise "100..900" vs "400;700"
    // Google accepte:
    // - variable range: wght@100..900
    // - discrete: wght@400;700
    return `https://fonts.googleapis.com/css2?family=${fam}:wght@${encodeURIComponent(w)}&display=swap`;
  }

  // Cache injection <link>
  function injectLinkOnce(href) {
    if (!href) return;
    const id = "zh-gf-css:" + cssEscapeIdent(href);
    if (document.getElementById(id)) return;

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  async function preloadFontFamily(familyName, sizePx = 16) {
    if (!document.fonts || !document.fonts.load) return;
    const fam = String(familyName || "").trim();
    if (!fam) return;
    try {
      await document.fonts.load(`${sizePx}px "${fam}"`);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Default catalogue (petit, tu peux remplacer)
  // ---------------------------------------------------------------------------
  let CATALOG = [
    { name: "Inter", weights: "100..900" },
    { name: "Roboto", weights: "100..900" },
    { name: "Poppins", weights: "100..900" },
    { name: "Montserrat", weights: "100..900" },
    { name: "Oswald", weights: "200..700" },
    { name: "Playfair Display", weights: "400..900" },
    { name: "Bebas Neue", weights: "400" },
  ];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function setCatalog(list) {
    const arr = Array.isArray(list) ? list : [];
    CATALOG = uniqBy(
      arr
        .map((f) => {
          if (!f) return null;
          if (typeof f === "string") return { name: f, weights: "" };
          return {
            name: String(f.name || f.family || f.label || "").trim(),
            label: String(f.label || f.name || "").trim(),
            weights: String(f.weights || f.wght || "").trim(),
          };
        })
        .filter(Boolean)
        .filter((x) => x.name),
      (x) => x.name.toLowerCase()
    );
    log("catalog set:", CATALOG.length);
  }

  function getCatalog() {
    return CATALOG.slice();
  }

  /**
   * buildFontList
   * Retourne une liste compatible avec ton font_picker_tools.js:
   * { name, label, scope, href, isDefault }
   *
   * @param {Object} opts
   * @param {String} opts.scope            "global" par défaut
   * @param {String} opts.weightsDefault   ex "400;700" (si une entrée n’a pas weights)
   * @param {Boolean} opts.includeHref     true par défaut
   */
  function buildFontList(opts = {}) {
    const scope = String(opts.scope || "global").toLowerCase();
    const weightsDefault = String(opts.weightsDefault || "").trim(); // ex "400;700"
    const includeHref = opts.includeHref !== false;

    return (CATALOG || []).map((f) => {
      const name = String(f.name || "").trim();
      const label = String(f.label || "") || toLabel(name);

      const weights = String(f.weights || "").trim() || weightsDefault;
      const href = includeHref ? makeCss2Href(name, weights) : null;

      return {
        name,
        label,
        scope,       // "global"
        isDefault: false,
        href,        // ✅ lazy-load via <link> dans font_picker_tools.js
        url: null,
        format: null,
        weight: null,
        style: null,
        origin: "google",
      };
    });
  }

  /**
   * ensureLoadedByName
   * Force l’injection du <link> Google pour une famille (si présente dans le catalog)
   */
  function ensureLoadedByName(name) {
    const n = String(name || "").trim();
    if (!n) return false;
    const f = (CATALOG || []).find((x) => String(x.name).toLowerCase() === n.toLowerCase());
    if (!f) return false;

    const href = makeCss2Href(f.name, f.weights || "");
    injectLinkOnce(href);
    return true;
  }

  /**
   * preloadTop
   * Précharge (CSS + document.fonts.load) les N premières fonts du catalogue.
   * Utile pour éviter le flash au premier choix.
   */
  async function preloadTop(n = 10, sizePx = 16) {
    const list = (CATALOG || []).slice(0, Math.max(0, Number(n || 0)));
    for (const f of list) {
      const href = makeCss2Href(f.name, f.weights || "");
      injectLinkOnce(href);
    }
    // attendre un tout petit peu puis demander au font subsystem
    try {
      await Promise.all(list.map((f) => preloadFontFamily(f.name, sizePx)));
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Export global
  // ---------------------------------------------------------------------------
  global.ZHGoogleFontsTools = global.ZHGoogleFontsTools || {};
  global.ZHGoogleFontsTools.setCatalog = setCatalog;
  global.ZHGoogleFontsTools.getCatalog = getCatalog;
  global.ZHGoogleFontsTools.buildFontList = buildFontList;
  global.ZHGoogleFontsTools.ensureLoadedByName = ensureLoadedByName;
  global.ZHGoogleFontsTools.preloadTop = preloadTop;

  log("ready");
})(window);

import * as FontMod from "../font_picker_tools.js";
import * as ColorMod from "../color_picker_tools.js";

/**
 * Normalise les exports ESM -> un objet global attendu par text_toolbar_tools.js
 * Certains fichiers exportent:
 *   - export function createColorPicker(...)
 *   - export function createColorPickerTools(...)
 *   - export default { ... }
 *   - export const ColorPickerTools = { ... }
 *
 * Et text_toolbar_tools.js peut attendre:
 *   window.ColorPickerTools.createColorPicker(...)
 *   (ou createColorPickerTools)
 */
function normalizePickerModule(mod, globalName) {
  // base candidate
  const candidate =
    mod?.[globalName] ||
    mod?.default ||
    mod;

  // clone léger pour pouvoir ajouter des alias sans muter le module
  const out = { ...(candidate || {}) };

  // copie aussi les exports nommés à plat
  for (const k of Object.keys(mod || {})) {
    if (!(k in out)) out[k] = mod[k];
  }

  // ---- ALIAS “compat” ----
  // Color
  if (!out.createColorPicker && typeof out.createColorPickerTools === "function") {
    out.createColorPicker = out.createColorPickerTools;
  }
  if (!out.createColorPickerTools && typeof out.createColorPicker === "function") {
    out.createColorPickerTools = out.createColorPicker;
  }

  // Font
  if (!out.createFontPicker && typeof out.createFontPickerTools === "function") {
    out.createFontPicker = out.createFontPickerTools;
  }
  if (!out.createFontPickerTools && typeof out.createFontPicker === "function") {
    out.createFontPickerTools = out.createFontPicker;
  }

  return out;
}

const FontPickerTools = normalizePickerModule(FontMod, "FontPickerTools");
const ColorPickerTools = normalizePickerModule(ColorMod, "ColorPickerTools");

// ⚠️ mets sur globalThis (pas seulement window) pour éviter les surprises
globalThis.FontPickerTools = FontPickerTools;
globalThis.ColorPickerTools = ColorPickerTools;

console.log(
  "[sandbox] pickers globals ready",
  !!globalThis.FontPickerTools,
  !!globalThis.ColorPickerTools,
  "api:",
  {
    font: {
      createFontPicker: typeof globalThis.FontPickerTools?.createFontPicker,
      createFontPickerTools: typeof globalThis.FontPickerTools?.createFontPickerTools,
    },
    color: {
      createColorPicker: typeof globalThis.ColorPickerTools?.createColorPicker,
      createColorPickerTools: typeof globalThis.ColorPickerTools?.createColorPickerTools,
    },
  }
);

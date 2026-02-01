// app/static/labo/editor/image_remove_bg.js
// v=2
//
// Toolbox Image: détourage Plan A (backend) + Plan B (canvas)
// ✅ Option B : si une image est sélectionnée dans le PDF => détourage sur l'objet sélectionné
// - Non destructif: conserve original dans obj.src_original (ou state.activeTool.src_original)
// - Plan A: envoie un vrai fichier si dispo, sinon convertit dataURL -> Blob
//
// Dépendances: api.js, state.js, ui_tools.js, draft.js, overlay_render.js

import { API_BASE, TOKEN } from "./api.js?v=12";
import { state, setStatus } from "./state.js?v=12";
import { setActiveTool, handleImagePicked } from "./ui_tools.js?v=12";
import { getObject } from "./draft.js?v=12";
import { renderPageOverlay, rerenderAllExcept } from "./overlay_render.js?v=12";

console.log("[IMAGE_REMOVE_BG] loaded ✅ v=2");

const $id = (id) => document.getElementById(id);

function _setToolboxStatus(msg, kind = "") {
  const el = $id("imageRemoveBgStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.dataset.kind = kind || "";
}

function _busy(on) {
  state.__removeBgBusy = !!on;

  const btnA = $id("btnImageRemoveBg");
  const btnB = $id("btnImageRemoveBgFallback");
  const btnR = $id("btnImageRevert");
  const q = $id("imageRemoveBgQuality");
  const t = $id("imageRemoveBgTolerance");

  [btnA, btnB, btnR, q, t].forEach((x) => {
    if (!x) return;
    x.disabled = !!on;
    x.style.opacity = on ? "0.7" : "1";
    x.style.cursor = on ? "not-allowed" : "pointer";
  });
}

// -----------------------------------------------------
// ✅ Target resolution (Option B)
// -----------------------------------------------------
function _getSelectedImageTarget() {
  const sel = state.selected;
  if (!sel || sel.pageIndex == null || !sel.objectId) return null;

  const obj = getObject(sel.pageIndex, String(sel.objectId));
  if (!obj || obj.type !== "image" || !obj.src) return null;

  return { kind: "selected", pageIndex: sel.pageIndex, obj };
}

function _getActiveToolImageTarget() {
  if (state.activeTool && state.activeTool.type === "image" && state.activeTool.src) {
    return { kind: "tool", pageIndex: null, obj: state.activeTool };
  }
  return null;
}

function _getImageTargetPreferSelected() {
  return _getSelectedImageTarget() || _getActiveToolImageTarget();
}

function _ensureOriginalSavedOnObj(obj) {
  if (!obj) return;
  if (!obj.src_original) obj.src_original = obj.src;
  if (typeof obj.removed_bg !== "boolean") obj.removed_bg = false;
}

function _applyObjSrc(target, newSrc, removed = true) {
  if (!target || !target.obj) return;

  target.obj.src = newSrc;
  target.obj.removed_bg = !!removed;

  // si c'est un objet dans le PDF => rerender
  if (target.kind === "selected" && target.pageIndex != null) {
    renderPageOverlay(target.pageIndex);
    rerenderAllExcept(target.pageIndex);
  }
}

// -----------------------------------------------------
// Plan A – backend
// -----------------------------------------------------
async function _removeBgBackendFromBlob(blobOrFile, quality = "balanced") {
  const fd = new FormData();
  // on donne un nom (utile côté serveur)
  fd.append("image", blobOrFile, blobOrFile?.name || "image.png");
  fd.append("quality", quality);

  const res = await fetch(`${API_BASE}/marketing/images/remove-bg`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: fd,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Erreur détourage (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function _dataUrlToBlob(dataUrl) {
  // fetch(dataURL) marche dans les navigateurs modernes
  const res = await fetch(dataUrl);
  return await res.blob();
}

// -----------------------------------------------------
// Plan B – remove near-white via canvas
// -----------------------------------------------------
function _clamp(n, a, b) {
  return n < a ? a : n > b ? b : n;
}

async function _removeBgCanvasNearWhite(dataUrl, tolerance = 35) {
  tolerance = _clamp(Number(tolerance || 35), 0, 255);

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image invalide (Plan B)"));
    i.src = dataUrl;
  });

  const maxDim = 2200;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  if (Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;

  const tr = 255,
    tg = 255,
    tb = 255;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
    if (dist <= tolerance) d[i + 3] = 0;
  }

  ctx.putImageData(im, 0, 0);
  return canvas.toDataURL("image/png");
}

// -----------------------------------------------------
// Public init – branche toolbox
// -----------------------------------------------------
export function initImageRemoveBgTool() {
  const btnPick = $id("btnPickImage");
  const input = $id("imageFileInput");
  const info = $id("imagePickedInfo");

  const btnRemoveA = $id("btnImageRemoveBg");
  const btnRemoveB = $id("btnImageRemoveBgFallback");
  const btnRevert = $id("btnImageRevert");
  const qualitySel = $id("imageRemoveBgQuality");
  const tolInp = $id("imageRemoveBgTolerance");

  if (!btnPick || !input) {
    console.warn("[IMAGE_REMOVE_BG] Missing DOM nodes (btnPickImage/imageFileInput). Tool disabled.");
    return;
  }

  // 1) bouton "Choisir image"
  btnPick.addEventListener("click", () => input.click());

  // 2) onload image (outil d'insertion)
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;

    _setToolboxStatus("Chargement image…", "loading");
    setStatus("Chargement image…");
    _busy(true);

    try {
      const out = await handleImagePicked(f);
      const { dataUrl, dims } = out;

      setActiveTool({
        type: "image",
        src: dataUrl,
        src_original: dataUrl,
        removed_bg: false,
        name: f.name,
        w0: dims.w,
        h0: dims.h,
        file_original: f, // utile si on veut Plan A direct sur tool
      });

      if (info) info.textContent = `Image prête: ${f.name} (${dims.w}×${dims.h})`;
      _setToolboxStatus("Image prête (clique dans le PDF pour placer)", "ok");
      setStatus("Mode: Ajouter image (clique dans le PDF)");
    } catch (e) {
      console.error(e);
      _setToolboxStatus(e?.message || "Erreur chargement image", "err");
      setStatus(e?.message || "Erreur chargement image");
    } finally {
      _busy(false);
      input.value = "";
    }
  });

  // 3) Plan A (backend) — sur image sélectionnée si possible, sinon sur activeTool
  if (btnRemoveA) {
    btnRemoveA.addEventListener("click", async () => {
      const target = _getImageTargetPreferSelected();
      if (!target) {
        _setToolboxStatus("Sélectionne une image du PDF ou choisis une image d’abord", "warn");
        return;
      }

      _ensureOriginalSavedOnObj(target.obj);

      const q = (qualitySel && qualitySel.value) || "balanced";

      _busy(true);
      _setToolboxStatus("Détourage en cours…", "loading");
      setStatus("Détourage en cours…");

      try {
        // 1) si on est sur activeTool et qu'on a file_original => on l'utilise
        let blobOrFile = null;
        if (target.kind === "tool" && target.obj?.file_original) {
          blobOrFile = target.obj.file_original;
        } else {
          // 2) sinon on convertit le dataUrl en Blob (marche pour image déjà placée)
          const srcForUpload = target.obj.src_original || target.obj.src;
          blobOrFile = await _dataUrlToBlob(srcForUpload);
        }

        const data = await _removeBgBackendFromBlob(blobOrFile, q);
        const pngDataUrl = `data:image/png;base64,${data.png_base64}`;

        _applyObjSrc(target, pngDataUrl, true);

        if (info) {
          const hit = data.cache_hit ? " (cache)" : "";
          const where = target.kind === "selected" ? " (sur image sélectionnée)" : "";
          info.textContent = `Image détourée${hit}${where} – prête`;
        }

        _setToolboxStatus("OK: image détourée (fond transparent)", "ok");
        setStatus("Détourage OK");
      } catch (e) {
        console.error(e);
        _setToolboxStatus(e?.message || "Erreur détourage", "err");
        setStatus(e?.message || "Erreur détourage");
      } finally {
        _busy(false);
      }
    });
  }

  // 4) Plan B (fallback) — idem (sélection > tool)
  if (btnRemoveB) {
    btnRemoveB.addEventListener("click", async () => {
      const target = _getImageTargetPreferSelected();
      if (!target) {
        _setToolboxStatus("Sélectionne une image du PDF ou choisis une image d’abord", "warn");
        return;
      }

      _ensureOriginalSavedOnObj(target.obj);

      const tol = Number(tolInp?.value || 35);

      _busy(true);
      _setToolboxStatus("Détourage (fallback) en cours…", "loading");
      setStatus("Détourage fallback en cours…");

      try {
        const src = target.obj.src_original || target.obj.src;
        const outPng = await _removeBgCanvasNearWhite(src, tol);

        _applyObjSrc(target, outPng, true);

        if (info) {
          const where = target.kind === "selected" ? " (sur image sélectionnée)" : "";
          info.textContent = `Image détourée (fallback)${where} – prête`;
        }

        _setToolboxStatus("OK: image détourée (fallback)", "ok");
        setStatus("Détourage fallback OK");
      } catch (e) {
        console.error(e);
        _setToolboxStatus(e?.message || "Erreur détourage fallback", "err");
        setStatus(e?.message || "Erreur détourage fallback");
      } finally {
        _busy(false);
      }
    });
  }

  // 5) Revenir original — idem (sélection > tool)
  if (btnRevert) {
    btnRevert.addEventListener("click", () => {
      const target = _getImageTargetPreferSelected();
      if (!target) return;

      _ensureOriginalSavedOnObj(target.obj);

      if (!target.obj.src_original) {
        _setToolboxStatus("Original introuvable", "warn");
        return;
      }

      _applyObjSrc(target, target.obj.src_original, false);

      if (info) {
        const where = target.kind === "selected" ? " (sur image sélectionnée)" : "";
        info.textContent = `Image originale${where} – prête`;
      }

      _setToolboxStatus("Retour à l’original", "ok");
      setStatus("Retour à l’original");
    });
  }

  // état initial
  _setToolboxStatus("Aucune image", "muted");
}

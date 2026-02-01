/* app/static/labo/editor/editor_tools_bridge.js
   Bridge outils: stubs d’insertion + registry minimal.
   >>> Ici tu brancheras tes vrais modules (image_block_tools.js, shape_block_tools.js, text tools, etc.)
*/
(function (global) {
  "use strict";

  const EditorApp = (global.EditorApp = global.EditorApp || {});
  const A = EditorApp.actions;

  // Registry minimal (extensible)
  const tools = (EditorApp.tools = EditorApp.tools || {
    list: [],
    registerTool(key, def) {
      const idx = this.list.findIndex(t => t.key === key);
      const tool = { key, ...def };
      if (idx >= 0) this.list[idx] = tool;
      else this.list.push(tool);
      return tool;
    }
  });

  // ---------------------------------------------------------------------------
  // STUBS d’insertion (à remplacer par tes modules existants)
  // ---------------------------------------------------------------------------
  function insertImageBlock() {
    // HOOK FUTUR: ImageTools.insert(...)
    return A.addObjectToPage("image", {
      w: 220, h: 160,
      fill: "#cbd5e1"
    });
  }

  function insertTextBlock(e) {
  if (EditorApp.insertTextLine) return EditorApp.insertTextLine(e);
  console.warn("[tools_bridge] insertTextLine indisponible (editor_text_simple_adapter.js ?)");
}

function insertParagraphBlock(e) {
  if (EditorApp.insertParagraph) return EditorApp.insertParagraph({
    // position simple (tu peux ensuite l’améliorer comme textLine)
    w: 360, h: 140,
    html: "Paragraphe",
    text: "Paragraphe"
  });
  console.warn("[tools_bridge] EditorApp.insertParagraph() manquant (editor_paragraph_adapter.js ?)");
}


function insertShapeBlock(e) {
  console.log("[bridge] shape click e?", !!e, "currentTarget:", e && e.currentTarget);
  if (EditorApp.insertShapeBlock) return EditorApp.insertShapeBlock(e);
  console.warn("[tools_bridge] EditorApp.insertShapeBlock() manquant (adapter shapes pas chargé ?)");
}



  function insertTextCircle() {
    // HOOK FUTUR: TextCircleTools.insert(...)
    return A.addObjectToPage("textCircle", {
      w: 220, h: 220,
      text: "Texte cercle",
      fill: "#d1d5db"
    });
  }

  function insertTextPath() {
    // HOOK FUTUR: TextPathTools.insert(...)
    return A.addObjectToPage("textPath", {
      w: 280, h: 90,
      text: "Texte sur chemin",
      fill: "#d1d5db"
    });
  }

  // Expose pour accès global (debug / sandbox)
  EditorApp.insert = {
    insertImageBlock,
    insertTextBlock,
    insertShapeBlock,
    insertTextCircle,
    insertTextPath
  };
  
  
  
  // ---------------------------------------------------------------------------
// RENDERERS REGISTRY + ShapeRenderer (v1)
// ---------------------------------------------------------------------------
(function initRenderers() {
  const EditorApp = window.EditorApp;
  if (!EditorApp) return;

  const renderers = (EditorApp.renderers = EditorApp.renderers || {
    map: new Map(),
    register(type, renderer) {
      this.map.set(type, renderer);
      return renderer;
    },
    get(type) {
      return this.map.get(type) || null;
    }
  });

  // --- ShapeRenderer: rendu SVG + options -----------------------------------


  // --- helpers UI options (vanilla) -----------------------------------------
  function makeRow(labelText) {
    const row = document.createElement("div");
    row.style.marginBottom = "10px";
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = "12px";
    label.style.color = "#374151";
    label.style.marginBottom = "4px";
    row.appendChild(label);
    return row;
  }

  function makeColorRow(label, value, onChange) {
    const row = makeRow(label);
    const input = document.createElement("input");
    input.type = "color";
    input.value = normalizeHex(value);
    input.style.width = "100%";
    input.style.height = "38px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #d1d5db";
    input.style.background = "#fff";
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);
    return row;
  }

  function makeNumberRow(label, value, min, max, step, onChange) {
    const row = makeRow(label);
    const input = document.createElement("input");
    input.type = "number";
    input.value = Number(value);
    input.min = min;
    input.max = max;
    input.step = step;
    input.style.width = "100%";
    input.style.padding = "9px 10px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #d1d5db";
    input.style.background = "#fff";
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) onChange(v);
    });
    row.appendChild(input);
    return row;
  }

  function normalizeHex(v) {
    const s = String(v || "").trim();
    // si déjà #RRGGBB
    if (/^#([0-9a-f]{6})$/i.test(s)) return s;
    // fallback
    return "#9ca3af";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
})();



  // ---------------------------------------------------------------------------
  // Déclaration des outils affichés dans la tool rail (colonne gauche)
  // ---------------------------------------------------------------------------
  tools.registerTool("image", {
    icon: "🖼",
    tip: "Image",
    insert: insertImageBlock
  });

  tools.registerTool("text", {
    icon: "T",
    tip: "Texte",
    insert: insertTextBlock
  });
  
  tools.registerTool("paragraph", {
  icon: "¶",
  tip: "Paragraphe",
  insert: insertParagraphBlock
});


  tools.registerTool("shape", {
    icon: "⬛",
    tip: "Forme",
    insert: insertShapeBlock
  });

  tools.registerTool("textCircle", {
    icon: "◯T",
    tip: "Texte cercle",
    insert: insertTextCircle
  });

  tools.registerTool("textPath", {
    icon: "〰T",
    tip: "Texte sur chemin",
    insert: insertTextPath
  });

})(window);

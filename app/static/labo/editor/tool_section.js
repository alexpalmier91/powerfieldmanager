// app/static/labo/editor/tool_section.js

import { state } from "./state.js?v=12";

export function initToolSectionCollapsible() {
  const toolSection = document.getElementById("toolSection");
  const toolBody = document.getElementById("toolSectionBody");
  const toolToggle = document.getElementById("toolSectionToggle");

  if (!toolSection || !toolBody || !toolToggle) return;

  function setCollapsed(v) {
    toolSection.setAttribute("data-collapsed", v ? "1" : "0");
    toolBody.style.display = v ? "none" : "block";
    toolToggle.setAttribute("aria-expanded", v ? "false" : "true");
    const icon = toolToggle.querySelector(".mdoc-collapsible-icon");
    if (icon) icon.textContent = v ? "▸" : "▾";
  }

  function isCollapsed() {
    return toolSection.getAttribute("data-collapsed") === "1";
  }

  // ✅ état initial : OUVERT (boutons visibles à l'ouverture)
  setCollapsed(false);

  // toggle manuel
  toolToggle.addEventListener("click", (e) => {
    e.preventDefault();
    setCollapsed(!isCollapsed());
  });

  // ✅ expose dans state pour interactions.js
  state._collapseToolSection = () => setCollapsed(true);
  state._expandToolSection = () => setCollapsed(false);
  state._setToolSectionCollapsed = (v) => setCollapsed(!!v);

  // ✅ quand on clique un bouton outil => on replie automatiquement
  // (tu gardes le titre "Outils" visible)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".mdoc-toggle-tool");
    if (!btn) return;
    // replie uniquement si on a bien une toolbox à ouvrir
    const target = btn.getAttribute("data-target");
    if (target) setCollapsed(true);
  }, true);
}

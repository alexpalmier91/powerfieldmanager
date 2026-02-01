# Dynamic Elements – PDF Editor (LABO/AGENT)

Ce document décrit **comment fonctionnent les éléments dynamiques** dans l’éditeur PDF (mode LABO) et **comment en ajouter un nouveau** proprement, sans casser le rendu AGENT.

---

## Objectif

Un “élément dynamique” est un bloc placé dans le PDF en mode LABO (édition), dont la valeur finale peut dépendre :
- d’un **produit** (EAN, prix, stock, etc.)
- d’un **mode d’affichage** (LABO vs AGENT)
- de **règles métier** (ex: n’afficher la rupture que si stock=0)

---

## Convention principale

### 1) Un élément dynamique est un objet `type: "text"`
Tous les éléments dynamiques sont stockés dans le draft sous forme d’un objet texte :

- `type: "text"`
- un champ `dynamic` contenant au minimum `dynamic.kind`

Exemple minimal :
```json
{
  "id": "txt_...",
  "type": "text",
  "x": 120,
  "y": 240,
  "w": 220,
  "h": 40,
  "text": "placeholder",
  "fontFamily": "helv",
  "fontSize": 18,
  "fontWeight": "700",
  "color": "#111827",
  "dynamic": {
    "kind": "product_ean",
    "product_id": 123
  }
}


2) Les coordonnées relatives sont la source de vérité pour le rendu PDF

Pour garantir un rendu stable quel que soit le scale côté LABO, on stocke aussi :

x_rel, y_rel, w_rel, h_rel (dans [0..1])

et un debug page_box_w/page_box_h ou page_box

La fonction côté front qui fait ça : attachRelToObj(obj, overlayMetrics).

Pipeline global (du clic à la génération PDF)
A) LABO – Ajout

L’utilisateur clique un bouton “Ajouter …”

setActiveTool() passe l’éditeur en mode insertion

Clic sur le PDF → insertToolObjectAt(e, overlay) :

calcule x/y en coords overlay

(optionnel) snap grille

crée l’objet type:"text" + dynamic.kind

calcule *_rel

push dans draft.data_json.pages[pageIndex].objects

renderPageOverlay(pageIndex) affiche le bloc dans l’overlay

B) LABO – Édition

Sélection d’un objet → interactions.js appelle syncPanelsWithSelection(sel)

Si obj.type === "text" et obj.dynamic.kind reconnu :

on affiche le bon panel (prix / stock / ean / …)

C) AGENT – Génération PDF

Le backend renderer lit le draft et :

récupère les objets type:"text" avec dynamic.kind

résout la valeur finale (prix, stock, ean…)

rend le texte avec une police PyMuPDF safe (helv par défaut)

Fichiers impliqués (liste officielle)
Front (éditeur LABO)

Template HTML (page editor)

bouton btnAddProductXxx

panel productXxxToolBox

inputs éventuels

app/static/labo/editor/state.js

ajoute les refs DOM dans state :

btnAddProductXxx

productXxxToolBox

(inputs…)

app/static/labo/editor/interactions.js

gestion affichage panneaux lors de la sélection :

showDynamicPanel(kind)

hidePanels()

syncPanelsWithSelection(sel) (via obj.dynamic.kind)

app/static/labo/editor/ui_tools.js

binding bouton + activation tool (bindDynamicToolsUI)

insertion dans le draft (insertToolObjectAt)

logique de récupération des données (si besoin : cache / fetch)

style preset dynamique (typo, couleur, bg, border…)

(optionnel) app/static/labo/editor/editor_bootstrap.js

idéalement : ne pas dupliquer la logique d’activation tool ici

doit juste appeler bindDynamicToolsUI() et laisser ui_tools.js gérer les boutons

Règle de stabilité : un seul endroit doit poser activeTool pour un bouton donné.
Recommandation : ui_tools.js via bindDynamicToolsUI().

Back (rendu PDF)

app/services/marketing_pdf_renderer.py

lecture des dynamic.kind

résolution des valeurs (EAN/prix/stock)

rendu final (role AGENT / LABO)

(optionnel) route API produits (déjà existante chez toi)

search produits

fetch tiers (paliers)

champs ean/price/stock

Liste des éléments dynamiques existants
dynamic.kind	Description	Données requises	Affichage LABO	Affichage AGENT
product_price	Prix produit (base ou palier)	product_id, price_mode, tier_id?	placeholder/prix	prix final
product_stock_badge	Texte de stock / rupture	product_id, text, mode_labo, mode_agent	stock ou texte	texte si stock=0 (selon règle)
product_ean	Code EAN produit	product_id	EAN	EAN
Ajouter un nouvel élément dynamique (checklist)
1) HTML (template)

Ajouter un bouton :

id: btnAddProductXxx

Ajouter un panel :

id: productXxxToolBox

(facultatif) inputs spécifiques

2) state.js

Ajouter dans state :

btnAddProductXxx: document.getElementById("btnAddProductXxx")

productXxxToolBox: document.getElementById("productXxxToolBox")

3) interactions.js

Dans showDynamicPanel(kind) : gérer kind === "product_xxx"

Dans hidePanels() : cacher productXxxToolBox

Dans syncPanelsWithSelection(sel) :

pour obj.type==="text" :

if (obj.dynamic?.kind === "product_xxx") showDynamicPanel("product_xxx")

4) ui_tools.js
A) bind bouton

Dans bindDynamicToolsUI() :

récupérer les refs DOM si besoin

btnAddProductXxx.addEventListener("click", () => setActiveTool({type:"product_xxx", ...}))

showDynamicToolBoxes("product_xxx")

B) insertion

Dans insertToolObjectAt(e, overlay) :

cas if (state.activeTool.type === "product_xxx") { ... }

valider les prérequis (product_id, etc.)

construire l’objet via makeTextObjAt(...)

attachRelToObj(obj, m)

push dans draft + render overlay

5) backend renderer

Dans marketing_pdf_renderer.py :

gérer dynamic.kind === "product_xxx"

récupérer la valeur réelle

appliquer fontFamily safe fallback (helv)

Debug – Méthode fiable
A) Vérifier l’activation tool

Dans console :

window.__ZENHUB_STATE__.activeTool

Attendu quand tu cliques le bouton :

{ type: "product_ean", product_id: null } (ou autre)

B) Vérifier l’insertion

Ajouter au tout début de insertToolObjectAt :

console.log("[INSERT] tool =", state.activeTool, "page=", overlay?.dataset?.pageIndex);


Puis clic dans le PDF :

tu dois voir le log

si rien : problème de handler overlay / activeTool / overlay click

C) Vérifier la création d’objet juste avant push

Juste avant :

getOrCreatePageModel(pageIndex).objects.push(obj);


ajouter :

console.log("[INSERT] creating obj", obj);

D) Vérifier que l’objet est bien dans le draft

window.__ZENHUB_ALL_OBJS__()

window.__ZENHUB_LAST_OBJ__()

Règles “anti-bug” (à respecter)

Ne pas créer un second système “type: dynamic”

On reste sur : type:"text" + dynamic.kind

Ne pas activer le même bouton à 2 endroits

éviter editor_bootstrap.js + ui_tools.js en parallèle

Toujours fallback font

helv si vide/default pour compat PyMuPDF

Toujours écrire les coords relatives

sinon rendu AGENT instable selon le scale
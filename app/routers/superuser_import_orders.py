# app/routers/superuser_import_orders.py
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import sqlalchemy as sa
import pandas as pd
import io
import math
import unicodedata
import re
from datetime import date

from app.db.session import get_async_session
from app.db.models import (
    # AGENT ORDERS
    Order, OrderItem, OrderStatus,
    # PRODUITS / CLIENTS / LIAISONS
    Product, Client, LaboClient, Agent, labo_agent,
    # NOUVEAU : documents labo
    LaboDocument, LaboDocumentItem, LaboDocumentType
)
from app.core.security import require_role  # exige ["S","U"]

router = APIRouter(
    prefix="/superuser",
    tags=["Superuser - Ventes / Imports"],
    dependencies=[Depends(require_role(["S", "U"]))],
)

# =========================
# Helpers généraux
# =========================
def _normalize_header(h: str) -> str:
    return str(h or "").strip().lower().replace("-", " ").replace("_", " ").replace(".", " ")

def _detect_format(filename: str) -> str:
    n = (filename or "").lower()
    if n.endswith(".xlsx") or n.endswith(".xls"): return "excel"
    if n.endswith(".csv"): return "csv"
    return "unknown"

def _clean(val: Optional[str]) -> Optional[str]:
    """Nettoyage standard cellule -> None/str"""
    try:
        if val is None: return None
        if isinstance(val, float) and math.isnan(val): return None
        if pd.isna(val): return None
    except Exception:
        pass
    s = str(val).strip()
    if not s: return None
    low = s.lower()
    if low in {"nan", "none", "null", "n/a", "na", "-", "--"}:
        return None
    return s

def _to_float(x) -> Optional[float]:
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)): return None
        s = str(x).replace(",", ".").strip()
        if s == "": return None
        return float(s)
    except Exception:
        return None

def _read_file_to_df(file_bytes: bytes, fmt: str) -> pd.DataFrame:
    if fmt == "excel":
        return pd.read_excel(io.BytesIO(file_bytes), dtype=object)
    for enc in ("utf-8-sig", "utf-8", "cp1252", "iso-8859-1"):
        try:
            return pd.read_csv(io.BytesIO(file_bytes), dtype=object, encoding=enc, sep=None, engine="python")
        except Exception:
            continue
    return pd.read_csv(io.BytesIO(file_bytes), dtype=object, encoding="utf-8", sep=",")

# ============== normalisation code client (labo) ==============
def _norm_code(val: Optional[str]) -> Optional[str]:
    """Normalise un code client de labo pour matching robuste."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s or None

# =========================
# Mapping d’en-têtes commun
# =========================
HEADER_MAP_COMMON: Dict[str, str] = {
    # Numéro
    "order number": "order_number",
    "order_number": "order_number",
    "n commande": "order_number",
    "num commande": "order_number",
    "numero commande": "order_number",
    "n° commande": "order_number",
    "commande": "order_number",

    # Dates
    "order date": "order_date",
    "date": "order_date",
    "date commande": "order_date",
    "date de commande": "order_date",

    "delivery date": "delivery_date",
    "date livraison": "delivery_date",
    "date de livraison": "delivery_date",
    "livraison": "delivery_date",

    # Client (code_labo)
    "client code": "client_code",
    "client_code": "client_code",
    "code client": "client_code",
    "code_client": "client_code",
    "codeclient": "client_code",
    "code labo client": "client_code",
    "code labo": "client_code",
    "codelabo": "client_code",

    # Lignes
    "sku": "sku",
    "ean": "ean13",
    "ean13": "ean13",
    "qty": "qty",
    "quantite": "qty",
    "quantité": "qty",
    "qte": "qty",
    "qté": "qty",

    "price ht": "price_ht",
    "prix ht": "price_ht",
    "pu ht": "price_ht",
    "unit ht": "price_ht",

    "total ht": "total_ht",
    "montant ht": "total_ht",
    "ligne ht": "total_ht",

    # Représentant (optionnel)
    "representant": "representant",
    "représentant": "representant",
    "agent": "representant",
    "commercial": "representant",
    "rep": "representant",
    "nom representant": "representant",
    "prénom nom": "representant",
    "prenom nom": "representant",
    "nom": "representant",

    # Type doc labo (optionnel si fourni par la source)
    "type": "doc_type",
    "document type": "doc_type",
    "doc type": "doc_type",
}

REQUIRED_COMMON = {"order_number", "order_date", "client_code", "sku", "qty"}

# =========================
# Normalisation NOM/PRENOM
# =========================
def _strip_accents(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))

def _norm_person_name(raw: Optional[str]) -> Optional[str]:
    """NORMALISE 'Prénom Nom' → 'PRENOM NOM'."""
    if not raw: return None
    s = _strip_accents(str(raw)).upper()
    s = re.sub(r"[^A-Z\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None

ALIASES_RAW: Dict[str, List[str]] = {
    'PASCALE BERNARD': ['PASCALE BERNARD', 'PASCALE BERNARD 2'],
    'CHARLOTTE PERES': ['PERES', 'PERES 2'],
    'DAVID ATTIAS': ['DAVID', 'DAVID2'],
    'CHRISTELLE VIAUD': ['CHRISTELLE VIAUD', 'CHRISTELLE VIAUD 2'],
    'CHARLOTTE LECUYER': ['CHARLOTTE LECUYER', 'CHARLOTTE LECUYER 2'],
    'VERONIQUE CHUPIN': ['CHUPIN', 'CHUPIN VERONIQUE', 'CHUPIN PAUL LOUP'],
    'CHRISTINE JAHN': ['CHRISTINE JAHN', 'CHRISTINE JAHN 2'],
    'ISABELLE BIRE': ['ISABELLE BIRE', 'ISABELLE BIRE 2'],
}

def _build_alias_index(agents: List[Agent]) -> Dict[str, int]:
    """Table nom normalisé -> agent_id (si non ambigu)."""
    name_to_ids: Dict[str, set] = {}

    def add_key(key: Optional[str], agent_id: int):
        if not key: return
        name_to_ids.setdefault(key, set()).add(agent_id)

    # Alias
    canonical_norm: Dict[str, str] = {}
    for canon, aliases in ALIASES_RAW.items():
        cn = _norm_person_name(canon)
        if not cn: continue
        canonical_norm[cn] = cn
        add_key(cn, -1)
        for a in aliases:
            an = _norm_person_name(a)
            if an:
                canonical_norm[an] = cn

    # Agents
    for ag in agents:
        f = _norm_person_name(ag.firstname or "")
        l = _norm_person_name(ag.lastname or "")
        full1 = (" ".join([f or "", l or ""])).strip() or None  # PRENOM NOM
        full2 = (" ".join([l or "", f or ""])).strip() or None  # NOM PRENOM
        for key in (full1, full2):
            if key:
                add_key(key, ag.id)
                if key in canonical_norm:
                    canon_key = canonical_norm[key]
                    for alias, mapped in canonical_norm.items():
                        if mapped == canon_key:
                            add_key(alias, ag.id)
        if l:
            add_key(l, ag.id)

    resolved: Dict[str, int] = {}
    for key, ids in name_to_ids.items():
        if len(ids) == 1:
            resolved[key] = list(ids)[0]
    return resolved

def _resolve_agent_id(repr_name: Optional[str], resolved_index: Dict[str, int], all_agents: List[Agent]) -> Tuple[Optional[int], Optional[str]]:
    """Retourne (agent_id|None, warning|None) à partir d'un nom de représentant."""
    if not repr_name:
        return None, None
    key = _norm_person_name(repr_name)
    if not key:
        return None, None

    if key in resolved_index:
        aid = resolved_index[key]
        return (aid if aid > 0 else None), None

    last_candidates = []
    for ag in all_agents:
        l = _norm_person_name(ag.lastname or "")
        f = _norm_person_name(ag.firstname or "")
        full1 = (" ".join([f or "", l or ""])).strip()
        full2 = (" ".join([l or "", f or ""])).strip()
        if key == (l or "") or key == full1 or key == full2:
            last_candidates.append(ag.id)
    if len(last_candidates) == 1:
        return last_candidates[0], None
    if len(last_candidates) > 1:
        return None, f"Représentant ambigu: '{repr_name}' → plusieurs agents possibles."
    return None, f"Représentant introuvable: '{repr_name}'."

# =========================
# Utils mappages import
# =========================
def _map_doc_type(prefix: str | None, explicit: str | None) -> LaboDocumentType:
    """Détermine le type du document labo."""
    if explicit:
        s = str(explicit).strip().upper()
        if s in ("BC", "BL", "FA"):
            return LaboDocumentType[s]
    p = (prefix or "").strip().upper()[:2]
    if p == "FA":
        return LaboDocumentType.FA
    if p == "BL":
        return LaboDocumentType.BL
    return LaboDocumentType.BC

def _map_order_status_from_prefix(prefix: str | None) -> OrderStatus:
    """Pour import-agent-orders (Order.status depuis n°)."""
    p = (prefix or "").strip().upper()[:2]
    if p == "CO":
        return OrderStatus.pending
    if p in ("AV", "AW"):
        return OrderStatus.canceled
    # sinon brouillon/complété selon ta logique; on choisit pending par défaut
    return OrderStatus.pending

# =========================================================
# ENDPOINT 1 : Import DOCS LABO → labo_document (+ items)
# (ex- /import-sales : désormais strictement pour documents labos)
# =========================================================
@router.post("/import-sales")
async def import_labo_documents(
    file: UploadFile = File(...),
    labo_id: int = Query(1, description="Labo pour lequel on importe"),
    session: AsyncSession = Depends(get_async_session),
):
    # 1) lire fichier
    try:
        raw = await file.read()
        fmt = _detect_format(file.filename)
        df = _read_file_to_df(raw, fmt)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    # 2) mapping colonnes
    renamer: Dict[str, str] = {}
    for col in df.columns:
        tgt = HEADER_MAP_COMMON.get(_normalize_header(col))
        if tgt:
            renamer[col] = tgt
    df = df.rename(columns=renamer)

    # 3) checks requis minimaux
    missing = [c for c in REQUIRED_COMMON if c not in df.columns or df[c].isna().all()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Colonnes manquantes: {', '.join(missing)}")

    # 4) nettoyage colonnes utiles
    for c in [c for c in ["order_number","client_code","sku","ean13","representant","doc_type"] if c in df.columns]:
        df[c] = df[c].map(_clean)

    # Dates
    df["order_date"] = pd.to_datetime(df["order_date"], errors="coerce", dayfirst=True)
    if "delivery_date" in df.columns:
        df["delivery_date"] = pd.to_datetime(df["delivery_date"], errors="coerce", dayfirst=True)
    else:
        df["delivery_date"] = pd.NaT
    df["order_date"] = df["order_date"].dt.date
    df["order_date"] = df["order_date"].where(pd.notna(df["order_date"]), None)
    df["delivery_date"] = df["delivery_date"].dt.date
    df["delivery_date"] = df["delivery_date"].where(pd.notna(df["delivery_date"]), None)

    # quantités/prix
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0).astype(float)
    if "price_ht" in df.columns:
        df["price_ht"] = pd.to_numeric(df["price_ht"], errors="coerce")
    if "total_ht" in df.columns:
        df["total_ht"] = pd.to_numeric(df["total_ht"], errors="coerce")

    if "total_ht" not in df.columns:
        df["total_ht"] = (df["qty"].fillna(0) * df.get("price_ht", 0).fillna(0))

    # normalise code client labo
    if "client_code" in df.columns:
        df["client_code"] = df["client_code"].map(lambda v: _norm_code(_clean(v)))

    # 5) préchargements DB
    # produits du labo
    q_prod = await session.execute(select(Product).where(Product.labo_id == labo_id))
    prods = q_prod.scalars().all()
    by_sku: Dict[str, Product] = { (p.sku or "").strip(): p for p in prods }

    # mapping code_client -> client_id (normalisé)
    q_lc = await session.execute(
        sa.text("""
            SELECT lc.code_client, lc.client_id
            FROM labo_client lc
            WHERE lc.labo_id = :labo_id
        """),
        {"labo_id": labo_id}
    )
    code_to_client: Dict[str, int] = {}
    for code_raw, cid in q_lc.fetchall():
        key = _norm_code(code_raw)
        if key and cid:
            code_to_client[key] = int(cid)

    # agents du labo (pour tracer éventuellement un agent_id sur un doc labo)
    q_agents = await session.execute(
        select(Agent).join(labo_agent, labo_agent.c.agent_id == Agent.id).where(labo_agent.c.labo_id == labo_id)
    )
    agents = q_agents.scalars().all()
    alias_index = _build_alias_index(agents)

    warnings: List[str] = []
    count_docs_inserted = 0
    count_docs_updated = 0
    count_items = 0

    # 6) construction par order_number → upsert LaboDocument
    for onum, sub in df.groupby("order_number"):
        if not onum:
            warnings.append("Ligne sans order_number ignorée.")
            continue

        first = sub.iloc[0]
        order_date: Optional[date] = first.get("order_date")
        delivery_date: Optional[date] = first.get("delivery_date") if "delivery_date" in sub.columns else None
        client_code: Optional[str] = first.get("client_code")  # déjà normalisé

        if client_code is None or client_code not in code_to_client:
            warnings.append(f"[{onum}] code_client introuvable dans labo_client: {first.get('client_code')!r}. Document ignoré.")
            continue

        client_id = code_to_client[client_code]
        client_name = None  # champ optionnel d'affichage

        # Type document (doc_type explicite sinon via préfixe)
        doc_type = _map_doc_type(onum, first.get("doc_type"))

        # Statut : souvent None pour les docs labo; on ne force rien
        status = None

        # agent_id éventuel (rare)
        agent_id: Optional[int] = None
        rep_name: Optional[str] = first.get("representant")
        if rep_name:
            agent_id, warn = _resolve_agent_id(rep_name, alias_index, agents)
            if warn:
                warnings.append(f"[{onum}] {warn}")

        # existe déjà ? (unicité sur (labo_id, order_number))
        q_doc = await session.execute(
            select(LaboDocument).where(LaboDocument.labo_id == labo_id, LaboDocument.order_number == onum)
        )
        doc = q_doc.scalars().first()
        if doc:
            # mise à jour entête
            if order_date: doc.order_date = order_date
            if delivery_date: doc.delivery_date = delivery_date
            if agent_id: doc.agent_id = agent_id
            doc.client_id = client_id
            doc.type = doc_type
            # status laissé tel quel ou None
            if hasattr(doc, "client_name"):
                doc.client_name = client_name or doc.client_name
            count_docs_updated += 1
            # purge items existants (réinsertion complète)
            await session.execute(sa.delete(LaboDocumentItem).where(LaboDocumentItem.document_id == doc.id))
        else:
            doc = LaboDocument(
                labo_id=labo_id,
                agent_id=agent_id,
                client_id=client_id,
                customer_id=None,           # pas de mapping legacy ici
                client_name=client_name,
                order_number=onum,
                order_date=order_date,
                delivery_date=delivery_date,
                currency="EUR",
                payment_method=None,
                type=doc_type,
                status=status,
                total_ht=0,
                total_ttc=0,
            )
            session.add(doc)
            await session.flush()
            count_docs_inserted += 1

        # lignes
        total_ht_doc = 0.0
        for _, row in sub.iterrows():
            sku = _clean(row.get("sku"))
            if not sku:
                warnings.append(f"[{onum}] ligne sans SKU ignorée.")
                continue
            p = by_sku.get(sku)
            if not p:
                warnings.append(f"[{onum}] SKU inconnu pour ce labo: {sku!r}. Ligne ignorée.")
                continue

            qty = _to_float(row.get("qty")) or 0.0
            pu = _to_float(row.get("price_ht"))           # prix unitaire si présent
            total_ligne = _to_float(row.get("total_ht"))  # total ligne si présent

            if total_ligne is None and pu is not None and qty:
                total_ligne = round(pu * qty, 2)
            if pu is None and total_ligne is not None and qty:
                pu = round(total_ligne / qty, 6)

            if pu is None:
                pu = 0.0
            if total_ligne is None:
                total_ligne = round((pu * qty) if qty else 0.0, 2)

            item_kwargs = dict(
                document_id=doc.id,
                product_id=p.id,
                sku=sku,
                ean13=_clean(row.get("ean13")),
                qty=int(qty),
                price_ht=pu,           # compat champs
                total_ht=total_ligne,  # compat champs
            )
            # miroirs avec OrderItem si présents
            if hasattr(LaboDocumentItem, "unit_ht"):
                item_kwargs["unit_ht"] = pu
            if hasattr(LaboDocumentItem, "line_ht"):
                item_kwargs["line_ht"] = total_ligne

            di = LaboDocumentItem(**item_kwargs)
            session.add(di)

            total_ht_doc += float(total_ligne)
            count_items += 1

        # totaux document
        doc.total_ht = round(total_ht_doc, 2)
        doc.total_ttc = doc.total_ht  # TVA plus tard si besoin

    await session.commit()

    return {
        "documents_inserted": count_docs_inserted,
        "documents_updated": count_docs_updated,
        "items_inserted": count_items,
        "warnings": warnings[:200],
        "target": "labo_document"
    }

# =========================================================
# ENDPOINT 2 : Import COMMANDES AGENTS → order (+ items)
# (nouveau fichier logique : pas de /etl, on reste dans routers)
# =========================================================
@router.post("/import-agent-orders")
async def import_agent_orders(
    file: UploadFile = File(...),
    labo_id: int = Query(1, description="Labo pour lequel on importe les commandes AGENT"),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Importe des commandes créées par des agents → Order/OrderItem.
    - Résolution du client via labo_client (code_client)
    - Résolution de l'agent via colonne 'representant' (optionnelle)
    - Statut Order mappé via préfixe (CO → pending, AV/AW → canceled, sinon pending)
    """
    # 1) lire fichier
    try:
        raw = await file.read()
        fmt = _detect_format(file.filename)
        df = _read_file_to_df(raw, fmt)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    # 2) mapping colonnes
    renamer: Dict[str, str] = {}
    for col in df.columns:
        tgt = HEADER_MAP_COMMON.get(_normalize_header(col))
        if tgt:
            renamer[col] = tgt
    df = df.rename(columns=renamer)

    # 3) checks requis minimaux
    missing = [c for c in REQUIRED_COMMON if c not in df.columns or df[c].isna().all()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Colonnes manquantes: {', '.join(missing)}")

    # 4) nettoyage colonnes utiles
    for c in [c for c in ["order_number","client_code","sku","ean13","representant"] if c in df.columns]:
        df[c] = df[c].map(_clean)

    # Dates
    df["order_date"] = pd.to_datetime(df["order_date"], errors="coerce", dayfirst=True)
    if "delivery_date" in df.columns:
        df["delivery_date"] = pd.to_datetime(df["delivery_date"], errors="coerce", dayfirst=True)
    else:
        df["delivery_date"] = pd.NaT
    df["order_date"] = df["order_date"].dt.date
    df["order_date"] = df["order_date"].where(pd.notna(df["order_date"]), None)
    df["delivery_date"] = df["delivery_date"].dt.date
    df["delivery_date"] = df["delivery_date"].where(pd.notna(df["delivery_date"]), None)

    # quantités/prix
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0).astype(float)
    if "price_ht" in df.columns:
        df["price_ht"] = pd.to_numeric(df["price_ht"], errors="coerce")
    if "total_ht" in df.columns:
        df["total_ht"] = pd.to_numeric(df["total_ht"], errors="coerce")

    if "total_ht" not in df.columns:
        df["total_ht"] = (df["qty"].fillna(0) * df.get("price_ht", 0).fillna(0))

    # normalise code client labo
    if "client_code" in df.columns:
        df["client_code"] = df["client_code"].map(lambda v: _norm_code(_clean(v)))

    # 5) préchargements DB
    # produits du labo
    q_prod = await session.execute(select(Product).where(Product.labo_id == labo_id))
    prods = q_prod.scalars().all()
    by_sku: Dict[str, Product] = { (p.sku or "").strip(): p for p in prods }

    # mapping code_client -> client_id (normalisé)
    q_lc = await session.execute(
        sa.text("""
            SELECT lc.code_client, lc.client_id
            FROM labo_client lc
            WHERE lc.labo_id = :labo_id
        """),
        {"labo_id": labo_id}
    )
    code_to_client: Dict[str, int] = {}
    for code_raw, cid in q_lc.fetchall():
        key = _norm_code(code_raw)
        if key and cid:
            code_to_client[key] = int(cid)

    # agents du labo (pour résolution via 'representant')
    q_agents = await session.execute(
        select(Agent).join(labo_agent, labo_agent.c.agent_id == Agent.id).where(labo_agent.c.labo_id == labo_id)
    )
    agents = q_agents.scalars().all()
    alias_index = _build_alias_index(agents)

    warnings: List[str] = []
    count_orders_inserted = 0
    count_orders_updated = 0
    count_items = 0

    # 6) group par order_number et insère/maj Order + OrderItems
    for onum, sub in df.groupby("order_number"):
        if not onum:
            warnings.append("Ligne sans order_number ignorée.")
            continue

        first = sub.iloc[0]
        order_date: Optional[date] = first.get("order_date")
        delivery_date: Optional[date] = first.get("delivery_date") if "delivery_date" in sub.columns else None
        client_code: Optional[str] = first.get("client_code")  # déjà normalisé

        if client_code is None or client_code not in code_to_client:
            warnings.append(f"[{onum}] code_client introuvable dans labo_client: {first.get('client_code')!r}. Commande ignorée.")
            continue

        client_id = code_to_client[client_code]
        client_name = None  # affichage facultatif

        # statut via préfixe
        status = _map_order_status_from_prefix(onum)

        # agent (via 'representant' si fourni)
        agent_id: Optional[int] = None
        rep_name: Optional[str] = first.get("representant")
        if rep_name:
            agent_id, warn = _resolve_agent_id(rep_name, alias_index, agents)
            if warn:
                warnings.append(f"[{onum}] {warn}")

        # existe déjà ?
        q_order = await session.execute(
            select(Order).where(Order.labo_id == labo_id, Order.order_number == onum)
        )
        ord_obj = q_order.scalars().first()
        if ord_obj:
            if order_date: ord_obj.order_date = order_date
            if delivery_date: ord_obj.delivery_date = delivery_date
            ord_obj.status = status
            if agent_id:
                ord_obj.agent_id = agent_id
            ord_obj.client_id = client_id
            if hasattr(ord_obj, "client_name"):
                ord_obj.client_name = client_name or ord_obj.client_name
            count_orders_updated += 1
            await session.execute(sa.delete(OrderItem).where(OrderItem.order_id == ord_obj.id))
        else:
            ord_obj = Order(
                labo_id=labo_id,
                agent_id=agent_id,
                client_id=client_id,
                client_name=client_name,
                order_number=onum,
                order_date=order_date,
                delivery_date=delivery_date,
                currency="EUR",
                payment_method=None,
                status=status,
                total_ht=0,
                total_ttc=0,
            )
            session.add(ord_obj)
            await session.flush()
            count_orders_inserted += 1

        # lignes
        total_ht_order = 0.0
        for _, row in sub.iterrows():
            sku = _clean(row.get("sku"))
            if not sku:
                warnings.append(f"[{onum}] ligne sans SKU ignorée.")
                continue
            p = by_sku.get(sku)
            if not p:
                warnings.append(f"[{onum}] SKU inconnu pour ce labo: {sku!r}. Ligne ignorée.")
                continue

            qty = _to_float(row.get("qty")) or 0.0
            pu = _to_float(row.get("price_ht"))
            total_ligne = _to_float(row.get("total_ht"))

            if total_ligne is None and pu is not None and qty:
                total_ligne = round(pu * qty, 2)
            if pu is None and total_ligne is not None and qty:
                pu = round(total_ligne / qty, 6)

            if pu is None:
                pu = 0.0
            if total_ligne is None:
                total_ligne = round((pu * qty) if qty else 0.0, 2)

            item_kwargs = dict(
                order_id=ord_obj.id,
                product_id=p.id,
                sku=sku,
                ean13=_clean(row.get("ean13")),
                qty=int(qty),
                price_ht=pu,
                total_ht=total_ligne,
            )
            if hasattr(OrderItem, "unit_ht"):
                item_kwargs["unit_ht"] = pu
            if hasattr(OrderItem, "line_ht"):
                item_kwargs["line_ht"] = total_ligne

            oi = OrderItem(**item_kwargs)
            session.add(oi)

            total_ht_order += float(total_ligne)
            count_items += 1

        ord_obj.total_ht = round(total_ht_order, 2)
        ord_obj.total_ttc = ord_obj.total_ht

    await session.commit()

    return {
        "orders_inserted": count_orders_inserted,
        "orders_updated": count_orders_updated,
        "items_inserted": count_items,
        "warnings": warnings[:200],
        "target": "order"
    }

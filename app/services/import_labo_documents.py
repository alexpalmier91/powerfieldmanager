# app/services/import_labo_documents.py
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from datetime import date
import io
import math
import re
import unicodedata

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException  # nécessaire pour les erreurs HTTP

from app.db.models import (
    Product,
    Client,
    LaboClient,
    Agent,
    labo_agent,
    LaboDocument,
    LaboDocumentItem,
    LaboDocumentType,
)

# =========================================================
# Helpers généraux
# =========================================================


def _normalize_header(h: str) -> str:
    return (
        str(h or "")
        .strip()
        .lower()
        .replace("-", " ")
        .replace("_", " ")
        .replace(".", " ")
    )


def _detect_format(filename: str) -> str:
    n = (filename or "").lower()
    if n.endswith(".xlsx") or n.endswith(".xls"):
        return "excel"
    if n.endswith(".csv"):
        return "csv"
    return "unknown"


def _clean(val: Optional[str]) -> Optional[str]:
    """Nettoyage standard cellule -> None/str"""
    try:
        if val is None:
            return None
        if isinstance(val, float) and math.isnan(val):
            return None
        if pd.isna(val):
            return None
    except Exception:
        pass
    s = str(val).strip()
    if not s:
        return None
    low = s.lower()
    if low in {"nan", "none", "null", "n/a", "na", "-", "--"}:
        return None
    return s


def _to_float(x) -> Optional[float]:
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return None
        s = str(x).replace(",", ".").strip()
        if s == "":
            return None
        return float(s)
    except Exception:
        return None


def _to_tax_rate(x) -> Optional[float]:
    """
    Convertit une valeur de TVA en pourcentage "logique".

    Exemples :
      - 20   -> 20.0   (20 %)
      - 5.5  -> 5.5
      - 0.2  -> 20.0   (si stocké en 0.2)
      - '20%' -> 20.0
    """
    if x is None:
        return None

    s = str(x).strip().replace("%", "").replace(",", ".")
    if not s:
        return None

    try:
        v = float(s)
    except ValueError:
        return None

    # Si v <= 1.5, on considère que c'est un taux "0.2" => 20%
    if v <= 1.5:
        return round(v * 100.0, 4)
    return round(v, 4)


def _get_product_tax_rate(product) -> Optional[float]:
    """
    Récupère le taux de TVA d'un produit en testant plusieurs noms de colonnes.

    Priorité :
      - vat_rate
      - tax_rate
      - tva_rate
      - tva
      - vat
    """
    for attr in ("vat_rate", "tax_rate", "tva_rate", "tva", "vat"):
        if hasattr(product, attr):
            raw = getattr(product, attr)
            rate = _to_tax_rate(raw)
            if rate is not None:
                return rate
    return None


def _read_file_to_df(file_bytes: bytes, fmt: str) -> pd.DataFrame:
    """
    Lecture du fichier en DataFrame.

    - Si fmt == "excel", on tente d'abord read_excel(engine='openpyxl')
      Si ça échoue (fichier pas vraiment Excel, ou corrompu), on tente ensuite
      une lecture CSV avec plusieurs encodages/séparateurs.
    - Sinon, on part directement sur la logique CSV.
    """

    # 1) Tentative Excel si le format détecté est "excel"
    if fmt == "excel":
        try:
            return pd.read_excel(
                io.BytesIO(file_bytes),
                dtype=object,
                engine="openpyxl",
            )
        except Exception as e_excel:
            # On downgrade vers CSV plutôt que d'échouer directement
            excel_error = str(e_excel)

            # 2) Tentatives CSV
            last_csv_error = None
            for enc in ("utf-8-sig", "utf-8", "cp1252", "iso-8859-1"):
                try:
                    return pd.read_csv(
                        io.BytesIO(file_bytes),
                        dtype=object,
                        encoding=enc,
                        sep=None,
                        engine="python",
                    )
                except Exception as e_csv:
                    last_csv_error = str(e_csv)
                    continue

            # Si on arrive ici : ni Excel, ni CSV n'ont fonctionné
            raise HTTPException(
                status_code=400,
                detail=(
                    "Impossible de lire le fichier (Excel/CSV).\n"
                    f"- Erreur Excel (openpyxl) : {excel_error}\n"
                    f"- Dernière erreur CSV : {last_csv_error}"
                ),
            )

    # 3) Cas classique : fmt != "excel" → lecture CSV directe
    for enc in ("utf-8-sig", "utf-8", "cp1252", "iso-8859-1"):
        try:
            return pd.read_csv(
                io.BytesIO(file_bytes),
                dtype=object,
                encoding=enc,
                sep=None,
                engine="python",
            )
        except Exception:
            continue

    # 4) Fallback très basique CSV
    return pd.read_csv(
        io.BytesIO(file_bytes),
        dtype=object,
        encoding="utf-8",
        sep=",",
    )


# ============== normalisation code client (labo) ==============


def _norm_code(val: Optional[str]) -> Optional[str]:
    """Normalise un code client de labo pour matching robuste."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s = "".join(
        ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)
    )
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s or None


# =========================
# Mapping d’en-têtes commun
# =========================

HEADER_MAP_COMMON: Dict[str, str] = {
    # =========================
    # Numéro de document
    # =========================
    "order number": "order_number",
    "order_number": "order_number",
    "n commande": "order_number",
    "num commande": "order_number",
    "numero commande": "order_number",
    "n° commande": "order_number",
    "commande": "order_number",
    "num pièce": "order_number",
    "num piece": "order_number",

    # =========================
    # Dates
    # =========================
    "order date": "order_date",
    "date": "order_date",
    "date commande": "order_date",
    "date de commande": "order_date",

    "date_livraison": "delivery_date",
    "delivery date": "delivery_date",
    "date livraison": "delivery_date",
    "date de livraison": "delivery_date",
    "livraison": "delivery_date",

    # =========================
    # Client (code_labo)
    # =========================
    "client code": "client_code",
    "client_code": "client_code",
    "code client": "client_code",
    "code_client": "client_code",
    "codeclient": "client_code",
    "code labo client": "client_code",
    "code labo": "client_code",
    "codelabo": "client_code",

    # =========================
    # Lignes produits
    # =========================
    "sku": "sku",
    "code article": "sku",

    "ean": "ean13",
    "ean13": "ean13",
    "code barre": "ean13",
    "code-barres": "ean13",

    "qty": "qty",
    "quantite": "qty",
    "quantité": "qty",
    "qte": "qty",
    "qté": "qty",

    # Prix unitaire HT
    "price ht": "price_ht",
    "prix ht": "price_ht",
    "pu ht": "price_ht",
    "unit ht": "price_ht",
    "pu": "price_ht",
    "prix achat": "price_ht",
    "prix d'achat": "price_ht",

    # Totaux HT
    "total ht": "total_ht",
    "montant ht": "total_ht",
    "ligne ht": "total_ht",
    "montant total": "total_ht",

    # =========================
    # Représentant (optionnel)
    # =========================
    "representant": "representant",
    "représentant": "representant",
    "agent": "representant",
    "commercial": "representant",
    "rep": "representant",
    "nom representant": "representant",
    "nom représentant": "representant",
    "prénom nom": "representant",
    "prenom nom": "representant",
    "nom": "representant",

    # =========================
    # Type doc labo (optionnel)
    # =========================
    "type": "doc_type",
    "document type": "doc_type",
    "doc type": "doc_type",
}

# colonnes minimales attendues dans le fichier
REQUIRED_COMMON = {"order_number", "order_date", "client_code", "sku", "qty"}

# =========================
# Normalisation NOM/PRENOM
# =========================


def _strip_accents(s: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)
    )


def _norm_person_name(raw: Optional[str]) -> Optional[str]:
    """NORMALISE 'Prénom Nom' → 'PRENOM NOM'."""
    if not raw:
        return None
    s = _strip_accents(str(raw)).upper()
    s = re.sub(r"[^A-Z\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


# tu peux adapter/étendre cette table d’alias avec tes vrais commerciaux
ALIASES_RAW: Dict[str, List[str]] = {
    # 'PASCALE BERNARD': ['PASCALE BERNARD', 'PASCALE BERNARD 2'],
    # 'CHARLOTTE PERES': ['PERES', 'PERES 2'],
}


def _build_alias_index(agents: List[Agent]) -> Dict[str, int]:
    """Table nom normalisé -> agent_id (si non ambigu)."""
    name_to_ids: Dict[str, set] = {}

    def add_key(key: Optional[str], agent_id: int):
        if not key:
            return
        name_to_ids.setdefault(key, set()).add(agent_id)

    # Alias
    canonical_norm: Dict[str, str] = {}
    for canon, aliases in ALIASES_RAW.items():
        cn = _norm_person_name(canon)
        if not cn:
            continue
        canonical_norm[cn] = cn
        add_key(cn, -1)
        for a in aliases:
            an = _norm_person_name(a)
            if an:
                canonical_norm[an] = cn

    # Agents
    for ag in agents:
        f = _norm_person_name(getattr(ag, "firstname", "") or "")
        l = _norm_person_name(getattr(ag, "lastname", "") or "")
        full1 = (" ".join([f or "", l or ""])).strip() or None  # PRENOM NOM
        full2 = (" ".join([l or "", f or ""])).strip() or None  # NOM PRENOM
        for key in (full1, full2):
            if key:
                add_key(key, ag.id)

        if l:
            add_key(l, ag.id)

    resolved: Dict[str, int] = {}
    for key, ids in name_to_ids.items():
        if len(ids) == 1:
            resolved[key] = list(ids)[0]
    return resolved


def _resolve_agent_id(
    repr_name: Optional[str],
    resolved_index: Dict[str, int],
    all_agents: List[Agent],
) -> Tuple[Optional[int], Optional[str]]:
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
        l = _norm_person_name(getattr(ag, "lastname", "") or "")
        f = _norm_person_name(getattr(ag, "firstname", "") or "")
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
    """
    Détermine le type du document labo.
    - si `explicit` est fourni et correspond à une valeur de l'enum, on le prend
    - sinon, on mappe selon le préfixe du numéro:
        FA → FA
        BL → BL
        AV/AW → FA (ou AV si tu as étendu l'enum)
        sinon → BC
    """
    # essai direct sur le code explicite
    if explicit:
        s = str(explicit).strip().upper()
        try:
            return LaboDocumentType[s]
        except KeyError:
            pass

    p = (prefix or "").strip().upper()[:2]

    # mapping simple préfixe -> clé enum
    if p == "FA":
        key = "FA"
    elif p == "BL":
        key = "BL"
    elif p in ("AV", "AW"):
        key = "AV"
    else:
        key = "BC"

    try:
        return LaboDocumentType[key]
    except KeyError:
        # fallback : premier membre de l'enum
        return list(LaboDocumentType)[0]


# =========================================================
# FONCTION PRINCIPALE : run_labo_import
# =========================================================


async def run_labo_import(
    file_bytes: bytes,
    filename: str,
    labo_id: int,
    session: AsyncSession,
) -> Dict:
    """
    Import de documents labo (factures, commandes, avoirs, etc.)
    vers labo_document / labo_document_item pour un labo donné.

    - Groupement par order_number
    - Upsert des entêtes
    - Remplacement complet des lignes à chaque import
    """

    fmt = _detect_format(filename)
    df = _read_file_to_df(file_bytes, fmt)

    # Nouveau comportement : on renvoie un résultat "vide" mais sans erreur 400
    if df is None or df.empty:
        return {
            "target": "labo_document",
            "documents_inserted": 0,
            "documents_updated": 0,
            "items_inserted": 0,
            "warnings": [
                "Fichier vide ou illisible : aucune ligne exploitable détectée. "
                "Vérifie que le fichier contient bien des colonnes et des lignes "
                "(order_number, client_code, sku, qty...)."
            ],
        }

    # 1) Renommage des colonnes
    renamer: Dict[str, str] = {}
    for col in df.columns:
        tgt = HEADER_MAP_COMMON.get(_normalize_header(col))
        if tgt:
            renamer[col] = tgt
    df = df.rename(columns=renamer)

    # 2) Vérification des colonnes obligatoires
    missing = [
        c for c in REQUIRED_COMMON if c not in df.columns or df[c].isna().all()
    ]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes manquantes ou vides: {', '.join(missing)}",
        )

    # 3) Nettoyage colonnes texte
    for c in [
        c
        for c in [
            "order_number",
            "client_code",
            "sku",
            "ean13",
            "representant",
            "doc_type",
        ]
        if c in df.columns
    ]:
        df[c] = df[c].map(_clean)

    # 4) Dates
    df["order_date"] = pd.to_datetime(
        df["order_date"], errors="coerce", dayfirst=True
    )

    if "delivery_date" in df.columns:
        df["delivery_date"] = pd.to_datetime(
            df["delivery_date"], errors="coerce", dayfirst=True
        )
    else:
        df["delivery_date"] = pd.NaT

    df["order_date"] = df["order_date"].dt.date
    df["order_date"] = df["order_date"].where(pd.notna(df["order_date"]), None)
    df["delivery_date"] = df["delivery_date"].dt.date
    df["delivery_date"] = df["delivery_date"].where(
        pd.notna(df["delivery_date"]), None
    )

    # 5) Quantités/prix (HT)
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0).astype(float)

    if "price_ht" in df.columns:
        df["price_ht"] = pd.to_numeric(df["price_ht"], errors="coerce")

    if "total_ht" in df.columns:
        df["total_ht"] = pd.to_numeric(df["total_ht"], errors="coerce")

    if "total_ht" not in df.columns:
        df["total_ht"] = df["qty"].fillna(0) * df.get("price_ht", 0).fillna(0)

    # 6) Normalisation code client labo
    if "client_code" in df.columns:
        df["client_code"] = df["client_code"].map(
            lambda v: _norm_code(_clean(v))
        )

    # ======================================================
    # Préchargements DB
    # ======================================================

    # Produits du labo : mapping SKU -> Product
    q_prod = await session.execute(
        sa.select(Product).where(Product.labo_id == labo_id)
    )
    prods = q_prod.scalars().all()
    by_sku: Dict[str, Product] = {(p.sku or "").strip(): p for p in prods}

    # mapping code_client (normalisé) -> client_id
    q_lc = await session.execute(
        sa.text(
            """
        SELECT lc.code_client, lc.client_id
        FROM labo_client lc
        WHERE lc.labo_id = :labo_id
        """
        ),
        {"labo_id": labo_id},
    )
    code_to_client: Dict[str, int] = {}
    for code_raw, cid in q_lc.fetchall():
        key = _norm_code(code_raw)
        if key and cid:
            code_to_client[key] = int(cid)

    # Agents du labo
    q_agents = await session.execute(
        sa.select(Agent)
        .join(labo_agent, labo_agent.c.agent_id == Agent.id)
        .where(labo_agent.c.labo_id == labo_id)
    )
    agents = q_agents.scalars().all()
    alias_index = _build_alias_index(agents)

    warnings: List[str] = []
    count_docs_inserted = 0
    count_docs_updated = 0
    count_items = 0

    # ======================================================
    # Construction par order_number
    # ======================================================

    for onum, sub in df.groupby("order_number"):
        if not onum:
            warnings.append("Ligne sans order_number ignorée.")
            continue

        first = sub.iloc[0]
        order_date_val: Optional[date] = first.get("order_date")
        delivery_date_val: Optional[date] = (
            first.get("delivery_date")
            if "delivery_date" in sub.columns
            else None
        )

        # =========================
        # Résolution du client
        # =========================
        raw_client_code = None
        norm_client_code = None

        if "client_code" in sub.columns:
            for v in sub["client_code"]:
                if v is not None:
                    norm_client_code = v  # déjà normalisé par _norm_code plus haut
                    raw_client_code = v
                    break

        client_id: Optional[int] = None
        client_name: Optional[str] = None

        if norm_client_code is None or norm_client_code not in code_to_client:
            warnings.append(
                f"[{onum}] code_client introuvable dans labo_client: "
                f"{raw_client_code!r}. Document créé avec client_id = NULL."
            )
        else:
            client_id = code_to_client[norm_client_code]

        # Type de document
        doc_type = _map_doc_type(onum, first.get("doc_type"))

        # Agent relié ?
        agent_id: Optional[int] = None
        rep_name: Optional[str] = first.get("representant")
        if rep_name:
            agent_id, warn = _resolve_agent_id(
                rep_name, alias_index, agents
            )
            if warn:
                warnings.append(f"[{onum}] {warn}")

        # Chercher si le doc existe déjà
        q_doc = await session.execute(
            sa.select(LaboDocument).where(
                LaboDocument.labo_id == labo_id,
                LaboDocument.order_number == onum,
            )
        )
        doc = q_doc.scalars().first()

        if doc:
            # Mise à jour entête
            if order_date_val:
                doc.order_date = order_date_val
            if delivery_date_val:
                doc.delivery_date = delivery_date_val
            doc.client_id = client_id
            doc.type = doc_type
            if agent_id:
                doc.agent_id = agent_id
            if hasattr(doc, "client_name"):
                doc.client_name = client_name or doc.client_name
            count_docs_updated += 1

            # purge des lignes existantes
            await session.execute(
                sa.delete(LaboDocumentItem).where(
                    LaboDocumentItem.document_id == doc.id
                )
            )
        else:
            doc = LaboDocument(
                labo_id=labo_id,
                agent_id=agent_id,
                client_id=client_id,
                customer_id=None,
                client_name=client_name,
                order_number=onum,
                order_date=order_date_val,
                delivery_date=delivery_date_val,
                currency="EUR",
                payment_method=None,
                type=doc_type,
                status=None,
                total_ht=0,
                total_ttc=0,
            )
            session.add(doc)
            await session.flush()
            count_docs_inserted += 1

        # ======================
        # Lignes du document
        # ======================

        # On agrège d'abord par product_id pour respecter la contrainte UNIQUE
        # (document_id, product_id)
        aggregated: Dict[int, Dict[str, float | str | None]] = {}

        for _, row in sub.iterrows():
            sku = _clean(row.get("sku"))
            if not sku:
                warnings.append(f"[{onum}] ligne sans SKU ignorée.")
                continue

            product = by_sku.get(sku)
            if not product:
                warnings.append(
                    f"[{onum}] SKU inconnu pour ce labo: {sku!r}. Ligne ignorée."
                )
                continue

            pid = product.id

            qty_val = _to_float(row.get("qty")) or 0.0
            pu = _to_float(row.get("price_ht"))
            total_ligne_ht = _to_float(row.get("total_ht"))

            if total_ligne_ht is None and pu is not None and qty_val:
                total_ligne_ht = round(pu * qty_val, 2)
            if pu is None and total_ligne_ht is not None and qty_val:
                pu = round(total_ligne_ht / qty_val, 6)

            if pu is None:
                pu = 0.0
            if total_ligne_ht is None:
                total_ligne_ht = round((pu * qty_val) if qty_val else 0.0, 2)

            # TVA : on ne prend PLUS le fichier, uniquement product.vat_rate
            tax_rate = _get_product_tax_rate(product)

            if tax_rate is None:
                total_ligne_ttc = float(total_ligne_ht)
            else:
                total_ligne_ttc = round(
                    float(total_ligne_ht) * (1.0 + tax_rate / 100.0), 2
                )

            agg = aggregated.get(pid)
            if agg is None:
                aggregated[pid] = {
                    "sku": sku,
                    "ean13": _clean(row.get("ean13")),
                    "qty": qty_val,
                    "total_ht": float(total_ligne_ht),
                    "total_ttc": float(total_ligne_ttc),
                    "tax_rate": tax_rate,
                }
            else:
                # on cumule
                agg["qty"] = float(agg.get("qty", 0.0)) + qty_val
                agg["total_ht"] = float(agg.get("total_ht", 0.0)) + float(
                    total_ligne_ht
                )
                agg["total_ttc"] = float(agg.get("total_ttc", 0.0)) + float(
                    total_ligne_ttc
                )
                # on garde le dernier taux non nul si besoin
                if tax_rate is not None:
                    agg["tax_rate"] = tax_rate

        # Maintenant on insère UNE ligne par produit
        total_ht_doc = 0.0
        total_ttc_doc = 0.0

        for pid, data in aggregated.items():
            qty_agg = float(data.get("qty", 0.0))
            total_agg_ht = float(data.get("total_ht", 0.0))
            total_agg_ttc = float(data.get("total_ttc", total_agg_ht))
            tax_rate_agg = data.get("tax_rate")

            # PU moyens
            unit_ht = round(total_agg_ht / qty_agg, 6) if qty_agg else 0.0
            unit_ttc = round(total_agg_ttc / qty_agg, 6) if qty_agg else 0.0

            item_kwargs = dict(
                document_id=doc.id,
                product_id=pid,
                sku=data.get("sku"),
                ean13=data.get("ean13"),
                qty=int(round(qty_agg)),
                unit_ht=unit_ht,
                total_ht=round(total_agg_ht, 2),
            )

            # Champs TVA/TTC optionnels selon le modèle
            if hasattr(LaboDocumentItem, "unit_ttc"):
                item_kwargs["unit_ttc"] = unit_ttc
            if hasattr(LaboDocumentItem, "total_ttc"):
                item_kwargs["total_ttc"] = round(total_agg_ttc, 2)
            if tax_rate_agg is not None and hasattr(LaboDocumentItem, "tax_rate"):
                item_kwargs["tax_rate"] = float(tax_rate_agg)

            item = LaboDocumentItem(**item_kwargs)
            session.add(item)

            total_ht_doc += float(total_agg_ht)
            total_ttc_doc += float(total_agg_ttc)
            count_items += 1

        # Totaux document
        doc.total_ht = round(total_ht_doc, 2)
        # si on a calculé du TTC, on l'utilise, sinon on garde HT
        doc.total_ttc = round(total_ttc_doc, 2) if total_ttc_doc > 0 else doc.total_ht

    await session.commit()

    return {
        "target": "labo_document",
        "documents_inserted": count_docs_inserted,
        "documents_updated": count_docs_updated,
        "items_inserted": count_items,
        "warnings": warnings[:200],
    }

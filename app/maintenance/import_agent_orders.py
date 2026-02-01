# /app/app/maintenance/import_agent_orders.py
import os
import asyncio
from typing import Optional, Dict, List, Tuple
from datetime import date

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.db.models import (
    Product, Client, LaboClient,
    Order, OrderItem, OrderStatus,
    Agent, labo_agent, agent_client,
)

# =========================
#   CONFIG / PARAMS
# =========================
DEFAULT_XLSX_PATH = "/app/app/data/uploads/commande_agent_co.xlsx"
DEFAULT_SHEET     = "merged"
DEFAULT_LABO_ID   = 1

# Colonnes Excel -> noms internes
HEADER_MAP: Dict[str, str] = {
    # Commande
    "numero commande": "order_number",
    "n° commande": "order_number",
    "commande": "order_number",
    "order number": "order_number",

    # Dates
    "date commande": "order_date",
    "date de commande": "order_date",
    "order date": "order_date",
    "date livraison": "delivery_date",
    "date de livraison": "delivery_date",
    "delivery date": "delivery_date",

    # Client labo (code)
    "code client": "client_code",
    "client code": "client_code",
    "code_client": "client_code",
    "codeclient": "client_code",
    "code labo": "client_code",
    "code labo client": "client_code",

    # Produit
    "reference produit": "sku",
    "référence": "sku",
    "reference": "sku",
    "ref": "sku",

    # Qté / Prix
    "quantité": "qty",
    "quantite": "qty",
    "qte": "qty",
    "qté": "qty",
    "prix de vente ht": "price_ht",
    "price ht": "price_ht",
    "pu ht": "price_ht",

    # Agent
    "agent commercial": "representant",
    "representant": "representant",
    "représentant": "representant",
    "commercial": "representant",
}

# Colonnes minimales requises (SKU sans EAN dans ton fichier)
REQUIRED = {"order_number", "client_code", "sku", "qty"}

# =========================
#  AGENTS : alias + e-mails
# =========================

# Normalisation nom → variantes connues
SIMILAR_AGENTS: Dict[str, List[str]] = {
    'PASCALE BERNARD': ['PASCALE BERNARD', 'PASCALE BERNARD 2'],
    'CHARLOTTE PERES': ['PERES', 'PERES 2'],
    'DAVID ATTIAS': ['DAVID', 'DAVID2'],
    'CHRISTELLE VIAUD': ['CHRISTELLE VIAUD', 'CHRISTELLE VIAUD 2'],
    'CHARLOTTE LECUYER': ['CHARLOTTE LECUYER', 'CHARLOTTE LECUYER 2'],
    'VERONIQUE CHUPIN': ['CHUPIN', 'CHUPIN VERONIQUE', 'CHUPIN PAUL LOUP'],
    'CHRISTINE JAHN': ['CHRISTINE JAHN', 'CHRISTINE JAHN 2'],
    'ISABELLE BIRE': ['ISABELLE BIRE', 'ISABELLE BIRE 2'],
    # Corrections supplémentaires demandées
    'JEAN-FRANCOIS CHAUSSOUNET': ['JEAN FRANCOIS CHAUSSOUNET', 'CHAUSSOUNET JEAN FRANCOIS'],
    'SEBASTIEN DEBOUT': ['SEBASTIEN DEBOUT', 'SÉBASTIEN DEBOUT', 'DEBOUT SEBASTIEN'],
}

# Mapping Nom Complet → e-mail (fourni)
AGENT_EMAIL_MAP: Dict[str, Tuple[str, Optional[str], Optional[str], Optional[str]]] = {
    # NAME_UPPER: (email, firstname, lastname, phone)
    'LIONEL CASSE': ('pezsheiindia@gmail.com', 'Lionel', 'Casse', '140390786'),
    'CHARLOTTE PERES': ('email1@gmail.com', 'Charlotte', 'Peres', '1403908786'),
    'ANNICK BORDAS': ('email2@gmail.com', 'Annick', 'Bordas', '140390786'),
    'JEAN-FRANCOIS CHAUSSOUNET': ('email3@gmail.com', 'Jean-Francois', 'Chaussounet', '140390786'),
    'PHILIP ETHERINGTON': ('email4@gmail.com', 'Philip', 'Etherington', '140390786'),
    'CHARLOTTE LECUYER': ('email5@gmail.com', 'Charlotte', 'Lecuyer', '140390786'),
    'SEBASTIEN DEBOUT': ('email6@gmail.com', 'Sébastien', 'Debout', '140390786'),
    'DANIEL POISSON': ('email7@gmail.com', 'Daniel', 'Poisson', '140390786'),
    'THIERRY RENAULT': ('email8@gmail.com', 'Thierry', 'Renault', '140390786'),
    'ISABELLE BRANCHU': ('email9@gmail.com', 'Isabelle', 'Branchu', '140390786'),
    'NATHALIE DEBAENE': ('email10@gmail.com', 'Nathalie', 'Debaene', '140390786'),
    # Ajoutez ici si besoin d’autres agents connus
}

# =========================
#  HELPERS
# =========================
import unicodedata
import re
from decimal import Decimal


def _strip_accents(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


def _norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _norm_name(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    s = _strip_accents(str(raw)).upper()
    s = s.replace("-", " ").replace(".", " ")
    s = re.sub(r"[^A-Z\s]", " ", s)
    s = _norm_space(s)
    return s or None


def _normalize_header(h: str) -> str:
    return _norm_space(_strip_accents(h).lower())


def _clean(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    low = s.lower()
    if low in {"nan", "none", "null", "n/a", "na", "-", "--"}:
        return None
    return s


def _to_decimal(x) -> Decimal:
    if x is None:
        return Decimal("0.00")
    try:
        s = str(x).replace(",", ".").strip()
        if not s:
            return Decimal("0.00")
        return Decimal(s)
    except Exception:
        return Decimal("0.00")


def _to_int(x) -> int:
    try:
        if x is None:
            return 0
        return int(float(str(x).replace(",", ".").strip()))
    except Exception:
        return 0


def _make_async_url(url: str) -> str:
    if not url:
        raise RuntimeError("DATABASE_URL manquant dans l'environnement")
    if "+asyncpg" in url:
        return url
    if "+psycopg2" in url:
        return url.replace("+psycopg2", "+asyncpg")
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


# =========================
#  RÉSOLUTION AGENT
# =========================
async def get_or_create_agent_by_name(
    session: AsyncSession,
    labo_id: int,
    repr_raw: Optional[str],
    warnings: List[str],
) -> Optional[int]:
    """
    Résout l'agent à partir du nom libre 'Agent commercial'.
    1) Normalise le nom, applique SIMILAR_AGENTS -> canonical
    2) Si canonical dans AGENT_EMAIL_MAP :
         - cherche par email; sinon crée avec cet email (et associe au labo)
    3) Sinon, essaie de trouver un agent existant par nom (firstname/lastname)
    4) Sinon, avertit et retourne None (pas de création sans e-mail connu)
    """
    if not repr_raw:
        return None

    key = _norm_name(repr_raw)
    if not key:
        return None

    # Canonicalisation via SIMILAR_AGENTS
    canonical = None
    for canon, alias_list in SIMILAR_AGENTS.items():
        all_forms = {canon} | set(alias_list)
        if key in { _norm_name(x) for x in all_forms }:
            canonical = canon
            break
    if canonical is None:
        canonical = key

    # Tentative via e-mail map
    if canonical in AGENT_EMAIL_MAP:
        email, firstname, lastname, phone = AGENT_EMAIL_MAP[canonical]
        # Existe déjà par email ?
        existing = (await session.execute(
            sa.select(Agent).where(Agent.email == email)
        )).scalars().first()
        if existing:
            # s'assurer du lien labo <-> agent
            await _ensure_labo_agent_link(session, labo_id, existing.id)
            return existing.id
        # Créer l'agent avec cet email connu
        ag = Agent(email=email, firstname=firstname, lastname=lastname, phone=phone)
        session.add(ag)
        await session.flush()
        await _ensure_labo_agent_link(session, labo_id, ag.id)
        return ag.id

    # Pas d'e-mail connu ⇒ essai par nom (firstname/lastname)
    parts = canonical.split(" ")
    if len(parts) >= 2:
        # Grand naïf: dernier token = nom, reste = prénom
        last = parts[-1].title()
        first = " ".join(parts[:-1]).title()
        # Chercher des agents qui matchent (case-insensitive)
        candidates = (await session.execute(
            sa.select(Agent).where(
                sa.func.lower(Agent.lastname) == sa.func.lower(sa.literal(last)),
                sa.func.lower(Agent.firstname) == sa.func.lower(sa.literal(first)),
            )
        )).scalars().all()
        if len(candidates) == 1:
            ag = candidates[0]
            await _ensure_labo_agent_link(session, labo_id, ag.id)
            return ag.id

    # Aucun match fiable, pas de création sans email
    warnings.append(f"[AGENT] Introuvable ou ambigu: {repr_raw!r}. Aucune création (e-mail inconnu).")
    return None


async def _ensure_labo_agent_link(session: AsyncSession, labo_id: int, agent_id: int) -> None:
    # UPSERT style on_conflict_do_nothing (compat)
    try:
        await session.execute(
            sa.text("""
                INSERT INTO labo_agent (labo_id, agent_id)
                VALUES (:labo_id, :agent_id)
                ON CONFLICT (labo_id, agent_id) DO NOTHING
            """),
            {"labo_id": labo_id, "agent_id": agent_id}
        )
    except Exception:
        # fallback très simple : vérifier existe
        exists = (await session.execute(
            sa.select(sa.func.count()).select_from(labo_agent)
            .where(labo_agent.c.labo_id == labo_id, labo_agent.c.agent_id == agent_id)
        )).scalar_one()
        if not exists:
            await session.execute(
                sa.insert(labo_agent).values(labo_id=labo_id, agent_id=agent_id)
            )


async def _ensure_agent_client_link(session: AsyncSession, agent_id: int, client_id: int) -> None:
    try:
        await session.execute(
            sa.text("""
                INSERT INTO agent_client (agent_id, client_id)
                VALUES (:agent_id, :client_id)
                ON CONFLICT (agent_id, client_id) DO NOTHING
            """),
            {"agent_id": agent_id, "client_id": client_id}
        )
    except Exception:
        exists = (await session.execute(
            sa.select(sa.func.count()).select_from(agent_client)
            .where(agent_client.c.agent_id == agent_id, agent_client.c.client_id == client_id)
        )).scalar_one()
        if not exists:
            await session.execute(
                sa.insert(agent_client).values(agent_id=agent_id, client_id=client_id)
            )


# =========================
#  IMPORT PRINCIPAL
# =========================
async def import_orders(
    xlsx_path: str = DEFAULT_XLSX_PATH,
    sheet_name: str = DEFAULT_SHEET,
    labo_id: int = DEFAULT_LABO_ID,
):
    print(f"[INFO] Import commandes agents depuis {xlsx_path} (labo_id={labo_id})")

    # Lecture Excel
    try:
        df = pd.read_excel(xlsx_path, sheet_name=sheet_name, dtype=object)
    except Exception as e:
        raise RuntimeError(f"Lecture Excel impossible: {e}")

    if df is None or df.empty:
        raise RuntimeError("Fichier vide / onglet vide.")

    # Renommage des colonnes
    renamer: Dict[str, str] = {}
    for col in df.columns:
        key = _normalize_header(col)
        if key in HEADER_MAP:
            renamer[col] = HEADER_MAP[key]
    df = df.rename(columns=renamer)

    # Contrôle des colonnes requises
    missing = [c for c in REQUIRED if c not in df.columns or df[c].isna().all()]
    if missing:
        raise RuntimeError(f"Colonnes manquantes: {', '.join(missing)}")

    # Normalisation de base
    for c in ["order_number", "client_code", "sku", "representant"]:
        if c in df.columns:
            df[c] = df[c].map(_clean)

    # Dates
    for c in ["order_date", "delivery_date"]:
        if c in df.columns:
            s = pd.to_datetime(df[c], errors="coerce", dayfirst=True)
            df[c] = s.dt.date.where(pd.notna(s), None)

    # Quantités/prix
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0).astype(float)

    if "price_ht" not in df.columns:
        df["price_ht"] = 0
    df["price_ht"] = pd.to_numeric(df["price_ht"], errors="coerce").fillna(0.0)

    # Préparations DB
    db_url = _make_async_url(os.getenv("DATABASE_URL", ""))
    engine = create_async_engine(db_url, pool_pre_ping=True)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    warnings: List[str] = []
    orders_inserted = 0
    orders_updated = 0
    items_inserted = 0

    async with Session() as session:
        # Produits du labo
        prods = (await session.execute(
            sa.select(Product).where(Product.labo_id == labo_id)
        )).scalars().all()
        by_sku: Dict[str, Product] = { (p.sku or "").strip(): p for p in prods }

        # Mapping code_client → client_id
        rows = (await session.execute(
            sa.select(LaboClient.code_client, LaboClient.client_id)
            .where(LaboClient.labo_id == labo_id)
        )).all()
        code_to_client: Dict[str, int] = {}
        for code_raw, cid in rows:
            key = _norm_name(code_raw or "")
            if key and cid:
                code_to_client[key] = int(cid)

        # Groupement par commande
        for onum, sub in df.groupby("order_number"):
            onum = _clean(onum)
            if not onum:
                warnings.append("Ligne sans numéro de commande ignorée.")
                continue

            first = sub.iloc[0]
            client_code_raw = first.get("client_code")
            client_key = _norm_name(client_code_raw or "")
            if not client_key or client_key not in code_to_client:
                warnings.append(f"[{onum}] code client introuvable dans labo_client: {client_code_raw!r}. Commande ignorée.")
                continue

            client_id = code_to_client[client_key]
            order_date: Optional[date] = first.get("order_date")
            delivery_date: Optional[date] = first.get("delivery_date")

            # Agent
            repr_name: Optional[str] = first.get("representant")
            agent_id: Optional[int] = await get_or_create_agent_by_name(session, labo_id, repr_name, warnings)

            # Existe déjà ?
            existing = (await session.execute(
                sa.select(Order).where(Order.labo_id == labo_id, Order.order_number == onum)
            )).scalars().first()

            if existing:
                ord_obj = existing
                # MAJ champs
                if order_date: ord_obj.order_date = order_date
                if delivery_date: ord_obj.delivery_date = delivery_date
                if agent_id: ord_obj.agent_id = agent_id
                ord_obj.client_id = client_id
                ord_obj.status = OrderStatus.pending
                # purge items
                await session.execute(sa.delete(OrderItem).where(OrderItem.order_id == ord_obj.id))
                orders_updated += 1
            else:
                ord_obj = Order(
                    labo_id=labo_id,
                    agent_id=agent_id,
                    client_id=client_id,
                    order_number=onum,
                    order_date=order_date,
                    delivery_date=delivery_date,
                    currency="EUR",
                    status=OrderStatus.pending,
                    total_ht=Decimal("0.00"),
                    total_ttc=Decimal("0.00"),
                )
                session.add(ord_obj)
                await session.flush()
                orders_inserted += 1

            # Lignes
            total_ht = Decimal("0.00")
            for _, row in sub.iterrows():
                sku = _clean(row.get("sku"))
                if not sku:
                    warnings.append(f"[{onum}] ligne sans SKU ignorée.")
                    continue
                p = by_sku.get(sku)
                if not p:
                    warnings.append(f"[{onum}] SKU inconnu pour ce labo: {sku!r}. Ligne ignorée.")
                    continue

                qty = _to_int(row.get("qty"))
                pu = _to_decimal(row.get("price_ht"))
                line = (Decimal(qty) * pu) if qty else Decimal("0.00")

                session.add(OrderItem(
                    order_id=ord_obj.id,
                    product_id=p.id,
                    sku=p.sku,
                    ean13=p.ean13,
                    qty=qty,
                    unit_ht=pu,
                    price_ht=pu,     # si tu utilises encore price_ht comme PU dans le modèle
                    total_ht=line,   # total de ligne
                    line_ht=line,    # champ miroir si présent dans le modèle
                ))
                total_ht += line
                items_inserted += 1

            ord_obj.total_ht = total_ht
            ord_obj.total_ttc = total_ht

            # Lien agent <-> client si agent connu
            if agent_id:
                await _ensure_agent_client_link(session, agent_id=agent_id, client_id=client_id)

            await session.commit()

    await engine.dispose()

    print("\n======== Résultats import ========")
    print(f"Commandes insérées : {orders_inserted}")
    print(f"Commandes mises à jour : {orders_updated}")
    print(f"Lignes insérées : {items_inserted}")
    print(f"Avertissements (top 200) :")
    for w in warnings[:200]:
        print(" -", w)
    print("==================================\n")


# =========================
#   CLI
# =========================
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Import des commandes agents (Excel) vers order/order_item.")
    parser.add_argument("--file",  default=DEFAULT_XLSX_PATH, help="Chemin du fichier Excel")
    parser.add_argument("--sheet", default=DEFAULT_SHEET, help="Nom de l'onglet Excel")
    parser.add_argument("--labo",  type=int, default=DEFAULT_LABO_ID, help="ID du labo (par défaut 1)")
    args = parser.parse_args()

    asyncio.run(import_orders(xlsx_path=args.file, sheet_name=args.sheet, labo_id=args.labo))

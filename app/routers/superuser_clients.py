# app/routers/superuser_clients.py
from typing import List, Optional, Iterable, Set, Tuple, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.session import get_async_session
from app.core.security import require_role

router = APIRouter(prefix="/api-zenhub/superuser", tags=["superuser"])

# ---------- Schemas ----------
class CustomerOut(BaseModel):
    id: int
    company: Optional[str] = None
    city: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    # bonus (ignorés par ton JS actuel)
    address: Optional[str] = None
    zipcode: Optional[str] = None
    country: Optional[str] = None
    groupement: Optional[str] = None

class ClientsResponse(BaseModel):
    items: List[CustomerOut]
    total: int
    limit: int
    offset: int
    source_table: str

# ---------- Helpers ----------
async def _tables_present(db: AsyncSession) -> List[str]:
    q = text("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('client','customer')
        ORDER BY table_name
    """)
    return [r[0] for r in (await db.execute(q)).all()]

async def _count_table(db: AsyncSession, table: str) -> int:
    return int((await db.execute(text(f"SELECT COUNT(*) FROM public.{table}"))).scalar_one())

async def _list_columns(db: AsyncSession, table: str) -> Set[str]:
    q = text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=:t
    """)
    rows = (await db.execute(q, {"t": table})).all()
    return {r[0] for r in rows}

def _first_present(cols: Set[str], candidates: Iterable[str]) -> Optional[str]:
    for c in candidates:
        if c in cols:
            return c
    return None

def _build_expr(cols: Set[str], candidates: Iterable[str], *, cast: Optional[str] = None, fallback: str = "NULL") -> str:
    col = _first_present(cols, candidates)
    if col:
        return f"CAST({col} AS {cast})" if cast else col
    return fallback

# Choix de la table:
# - si query param `table` fourni: on l’utilise (et on valide)
# - sinon: priorité à 'client' s’il existe et non vide
# - sinon: on prend la table non vide parmi ['client','customer']
# - sinon (toutes vides): on prend 'client' si existe, sinon 'customer'
async def _pick_clients_table(db: AsyncSession, force_table: Optional[str]) -> Tuple[str, Dict[str, int]]:
    present = await _tables_present(db)
    if not present:
        raise HTTPException(status_code=500, detail="Aucune table clients trouvée (public.client / public.customer).")

    # validation force_table
    if force_table:
        ft = force_table.strip().lower()
        if ft not in {"client", "customer"} or ft not in present:
            raise HTTPException(status_code=400, detail=f"Table invalide '{force_table}'. Tables disponibles: {present}")
        # compter quand même pour renvoyer l'info
        counts = {t: (await _count_table(db, t)) if t in present else 0 for t in ("client","customer")}
        return ft, counts

    # compter
    counts = {t: (await _count_table(db, t)) if t in present else 0 for t in ("client","customer")}

    # priorité au 'client' s'il est présent et non vide
    if "client" in present and counts.get("client", 0) > 0:
        return "client", counts

    # sinon table non vide si dispo
    non_empty = [t for t in ("client","customer") if t in present and counts.get(t, 0) > 0]
    if non_empty:
        return non_empty[0], counts

    # sinon toutes vides: priorise 'client' si présent
    if "client" in present:
        return "client", counts
    return "customer", counts  # par défaut

# ---------- Endpoint ----------
@router.get("/clients", response_model=ClientsResponse)
async def list_clients(
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    table: Optional[str] = Query(None, description="Forcer la table: client|customer"),
    _=Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
    db: AsyncSession = Depends(get_async_session),
):
    chosen, counts = await _pick_clients_table(db, table)
    cols = await _list_columns(db, chosen)

    # ID : id/client_id/customer_id → sinon ROW_NUMBER()
    id_expr = _build_expr(cols, ["id", "client_id", "customer_id"], cast="BIGINT", fallback="ROW_NUMBER() OVER ()")

    # Mapping logique → clés front
    company_expr    = _build_expr(cols, ["company", "company_name", "societe", "nom", "raison_sociale"])
    city_expr       = _build_expr(cols, ["city", "ville"])
    email_expr      = _build_expr(cols, ["email", "mail"])
    phone_expr      = _build_expr(cols, ["phone", "telephone", "tel", "phone_number", "mobile"])

    # bonus
    address_expr    = _build_expr(cols, ["address", "address1", "adresse", "adresse1"])
    zipcode_expr    = _build_expr(cols, ["zipcode", "postcode", "code_postal", "cp"])
    country_expr    = _build_expr(cols, ["country", "pays"])
    groupement_expr = _build_expr(cols, ["groupement"])

    select_sql = text(f"""
        SELECT
            {id_expr}        AS id,
            {company_expr}   AS company,
            {city_expr}      AS city,
            {email_expr}     AS email,
            {phone_expr}     AS phone,
            {address_expr}   AS address,
            {zipcode_expr}   AS zipcode,
            {country_expr}   AS country,
            {groupement_expr} AS groupement
        FROM public.{chosen}
        ORDER BY 1 DESC
        LIMIT :limit OFFSET :offset
    """)

    try:
        rows = (await db.execute(select_sql, {"limit": limit, "offset": offset})).mappings().all()
        total = counts.get(chosen, 0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur SQL sur public.{chosen}: {e}")

    items = [
        CustomerOut(
            id=int(r.get("id") or 0),
            company=r.get("company"),
            city=r.get("city"),
            email=r.get("email"),
            phone=r.get("phone"),
            address=r.get("address"),
            zipcode=r.get("zipcode"),
            country=r.get("country"),
            groupement=r.get("groupement"),
        )
        for r in rows
    ]
    return ClientsResponse(items=items, total=total, limit=limit, offset=offset, source_table=chosen)

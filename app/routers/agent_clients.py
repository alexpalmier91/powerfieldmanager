# app/routers/agent_clients.py
from __future__ import annotations

from datetime import datetime
from typing import Optional, Any
import re  # <-- pour gérer la partie numérique de fin

import sqlalchemy as sa
from fastapi import (
    APIRouter,
    Depends,
    Query,
    HTTPException,
    Request,
)
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Client, Agent, agent_client, Order  # <-- ajout Order
from app.core.security import get_current_user

router = APIRouter(prefix="/api-zenhub/agent", tags=["agent"])


# -----------------------------------------------------------
#  Utils
# -----------------------------------------------------------

def parse_pagination(page: int, page_size: int) -> tuple[int, int]:
    page = max(1, page)
    page_size = page_size if page_size in (50, 100) else 50
    return page, page_size


def extract_numeric_suffix(order_number: str) -> tuple[str, int]:
    """
    Sépare un order_number en (préfixe, entier final).

    Exemples :
      "155_483_FA4109"    -> ("155_483_FA", 4109)
      "156_483_MH-4548"   -> ("156_483_MH-", 4548)
      "107_483_TR15458"   -> ("107_483_TR", 15458)

    Si aucune partie numérique n'est trouvée, on renvoie (order_number, 0).
    """
    if not order_number:
        return "", 0
    m = re.match(r"^(.*?)(\d+)$", order_number)
    if not m:
        return order_number, 0
    prefix, num_str = m.groups()
    try:
        return prefix, int(num_str)
    except ValueError:
        return prefix, 0


async def generate_next_order_number(
    session: AsyncSession,
    agent_id: int,
    labo_id: int,
) -> str:
    """
    Génère le prochain order_number pour un agent (et labo) donné.

    - Récupère le dernier order_number de cet agent.
    - Extrait la partie numérique de fin.
    - Incrémente de 1 et reconstruit la chaîne.

    Si l'agent n'a encore aucune commande, on part sur un format de base :
      "<agent_id>_<labo_id>_FA1"
    (à adapter si tu veux un autre préfixe par défaut).
    """
    last_number = await session.scalar(
        select(Order.order_number)
        .where(Order.agent_id == agent_id)
        .order_by(Order.id.desc())
        .limit(1)
    )

    if not last_number:
        # Première commande pour cet agent + labo
        return f"{agent_id}_{labo_id}_FA1"

    prefix, n = extract_numeric_suffix(last_number)
    if not prefix:
        # Cas improbable, mais on évite de crasher
        return f"{agent_id}_{labo_id}_FA1"

    return f"{prefix}{n + 1}"


async def get_current_agent(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> Agent:
    """
    Récupère l'agent courant à partir du user.
    On ne bloque pas sur le rôle : on exige seulement un agent_id.
    """
    if isinstance(current_user, dict):
        role = current_user.get("role")
        agent_id = current_user.get("agent_id")
        email = current_user.get("email")
    else:
        role = getattr(current_user, "role", None)
        agent_id = getattr(current_user, "agent_id", None)
        email = getattr(current_user, "email", None)

    print(f"[get_current_agent] role={role!r} agent_id={agent_id!r} email={email!r}")

    if not agent_id:
        raise HTTPException(
            status_code=403,
            detail="Aucun agent rattaché à cet utilisateur",
        )

    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    return agent


# -----------------------------------------------------------
#  Schéma création client
# -----------------------------------------------------------

class AgentClientCreate(BaseModel):
    company_name: str
    contact: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    email: EmailStr
    groupement: Optional[str] = None
    phone: Optional[str] = None
    iban: Optional[str] = None
    bic: Optional[str] = None
    payment_terms: Optional[str] = None
    credit_limit: Optional[float] = None


# -----------------------------------------------------------
#  /api-zenhub/agent/clients
#   - GET  : liste paginée des clients de l’agent
#   - POST : création d’un nouveau client
# -----------------------------------------------------------

@router.api_route("/clients", methods=["GET", "POST"])
async def agent_clients_endpoint(
    request: Request,
    # Body (POST)
    payload: AgentClientCreate | None = None,
    # Query (GET)
    search: str = Query("", description="Nom/Ville/CP"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1),
    sort: str = Query("company", description="Critère de tri"),
    dir: str = Query("asc", description="asc/desc"),
    # Dépendances communes
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    GET  → liste des clients rattachés à l’agent courant
    POST → création d’un nouveau client + liaison agent_client
    """

    # ======================================================
    #  BRANCHE GET : listing
    # ======================================================
    if request.method == "GET":
        agent_id = agent.id
        page, page_size = parse_pagination(page, page_size)

        base_q = (
            select(Client)
            .join(agent_client, agent_client.c.client_id == Client.id)
            .where(agent_client.c.agent_id == agent_id)
        )

        if search:
            like = f"%{search.strip()}%"
            base_q = base_q.where(
                sa.or_(
                    Client.company_name.ilike(like),
                    Client.city.ilike(like),
                    Client.postcode.ilike(like),
                )
            )

        subq = base_q.with_only_columns(Client.id).subquery()
        total_stmt = select(func.count()).select_from(subq)
        total = (await session.execute(total_stmt)).scalar_one() or 0

        sort_field = {
            "company": Client.company_name,
            "zipcode": Client.postcode,
            "city": Client.city,
        }.get(sort, Client.company_name)
        order_col = sort_field.asc() if dir.lower() == "asc" else sort_field.desc()

        rows = await session.scalars(
            base_q.order_by(order_col, Client.id.asc())
                  .offset((page - 1) * page_size)
                  .limit(page_size)
        )

        items = [
            {
                "id": c.id,
                "company": c.company_name,
                "zipcode": c.postcode,
                "city": c.city,
                "email": c.email,
                "phone": c.phone,
                "groupement": c.groupement,
            }
            for c in rows
        ]

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    # ======================================================
    #  BRANCHE POST : création
    # ======================================================
    if payload is None:
        raise HTTPException(status_code=400, detail="Missing body")

    # 1) Email unique
    existing = await session.execute(
        select(Client).where(Client.email == payload.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="CLIENT_EMAIL_ALREADY_EXISTS",
        )

    # 2) Création du client
    client = Client(
        company_name=payload.company_name.strip(),
        first_name=(payload.contact or "").strip() or None,
        last_name=None,
        address1=(payload.address or "").strip() or None,
        postcode=(payload.postcode or "").strip() or None,
        city=(payload.city or "").strip() or None,
        country=(payload.country or "").strip() or None,
        email=payload.email,
        phone=(payload.phone or "").strip() or None,
        groupement=(payload.groupement or "").strip() or None,
        iban=(payload.iban or "").strip() or None,
        bic=(payload.bic or "").strip() or None,
        payment_terms=(payload.payment_terms or "").strip() or None,
        credit_limit=payload.credit_limit,
        created_at=datetime.utcnow(),
    )

    session.add(client)
    await session.flush()  # pour avoir client.id

    await session.execute(
        sa.insert(agent_client).values(
            agent_id=agent.id,
            client_id=client.id,
        )
    )

    await session.commit()

    return {
        "id": client.id,
        "company": client.company_name,
        "zipcode": client.postcode,
        "city": client.city,
        "email": client.email,
        "phone": client.phone,
        "groupement": client.groupement,
    }

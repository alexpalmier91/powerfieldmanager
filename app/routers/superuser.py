# app/routers/superuser.py
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
import csv, io, re, logging

from app.db.session import get_session
from app.core.roles import require_superadmin
from app.schemas.superuser import (
    PendingResponse, PendingItem,
    ApproveRequest, LinkRequest, UnlinkRequest,
    ImportClientsResult,
)
from app.db.models import (
    Labo, Agent, LaboApplication,
    Customer as Client,  # table clients
)

logger = logging.getLogger("superuser")

router = APIRouter(
    prefix="/superuser",
    tags=["superuser"],
    dependencies=[Depends(require_superadmin)],
)

# -------- Helpers validation --------
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SIRET_RE = re.compile(r"^\d{14}$")
_CP_RE = re.compile(r"^\d{5}$")
_EXPECTED_HEADERS = {
    "nom société", "prenom", "nom", "adresse", "code postal", "ville",
    "numero de siret", "email", "telephone", "groupement", "emplacement rib pdf"
}

def _norm(s: Optional[str]) -> str:
    return (s or "").strip()

@router.get("/ping")
async def ping_superuser(_=Depends(require_superadmin)):
    return {"ok": True}

@router.get("/pending", response_model=PendingResponse)
async def list_pending(db: AsyncSession = Depends(get_session)):
    """
    Renvoie les demandes à valider.
    - Labos: à partir de LaboApplication (approved == False).
    - Agents: si la table Agent possède un booléen is_validated, on l’utilise, sinon on retourne vide.
    Jamais d’HTTP 500: en cas d’erreur SQL, on log et on renvoie des listes vides.
    """
    labos_items: List[PendingItem] = []
    agents_items: List[PendingItem] = []

    try:
        # Labos en attente via LaboApplication.approved == False
        apps = (await db.execute(
            select(LaboApplication).where(LaboApplication.approved == False)  # noqa: E712
        )).scalars().all()

        for a in apps:
            labos_items.append(PendingItem(
                id=getattr(a, "id", None),
                name=getattr(a, "labo_name", None),
                email=getattr(a, "email", None),
            ))

        # Agents en attente (si champ présent)
        try:
            # si la colonne n’existe pas, la requête lèvera une erreur
            q_agents = await db.execute(select(Agent).where(Agent.is_validated == False))  # noqa: E712
            agents = q_agents.scalars().all()
            for ag in agents:
                agents_items.append(PendingItem(
                    id=getattr(ag, "id", None),
                    name=getattr(ag, "name", None),
                    email=getattr(ag, "email", None),
                ))
        except Exception:
            # colonne absente ou table non conforme → on ignore proprement
            logger.warning("Agent.is_validated introuvable, liste agents pendings vide.")

    except SQLAlchemyError as e:
        logger.exception("Erreur SQL sur /superuser/pending: %s", e)

    return PendingResponse(labos=labos_items, agents=agents_items)

@router.post("/validate")
async def approve_entity(
    body: ApproveRequest,
    db: AsyncSession = Depends(get_session),
):
    if body.type == "labo":
        obj = await db.get(Labo, body.id)
        if not obj:
            raise HTTPException(status_code=404, detail="Labo introuvable")
        obj.is_validated = True  # si ce champ n’existe pas chez toi, remplace par ce que tu utilises
    elif body.type == "agent":
        obj = await db.get(Agent, body.id)
        if not obj:
            raise HTTPException(status_code=404, detail="Agent introuvable")
        obj.is_validated = True
    else:
        raise HTTPException(status_code=400, detail="type must be 'labo' or 'agent'")

    await db.commit()
    return {"ok": True}

@router.post("/link")
async def link_labo_agent(
    body: LinkRequest,
    db: AsyncSession = Depends(get_session),
):
    labo = await db.get(Labo, body.labo_id)
    agent = await db.get(Agent, body.agent_id)
    if not labo or not agent:
        raise HTTPException(status_code=404, detail="labo or agent not found")

    if agent not in labo.agents:
        labo.agents.append(agent)
        await db.commit()
    return {"ok": True}

@router.post("/unlink")
async def unlink_labo_agent(
    body: UnlinkRequest,
    db: AsyncSession = Depends(get_session),
):
    labo = await db.get(Labo, body.labo_id)
    agent = await db.get(Agent, body.agent_id)
    if not labo or not agent:
        raise HTTPException(status_code=404, detail="labo or agent not found")

    if agent in labo.agents:
        labo.agents.remove(agent)
        await db.commit()
    return {"ok": True}

@router.post("/import-clients", response_model=ImportClientsResult)
async def import_clients(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Format supporté: .csv")

    raw = await file.read()
    text = raw.decode("utf-8", errors="ignore")

    # Autodétection du séparateur
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0])
        delimiter = dialect.delimiter
    except Exception:
        delimiter = ';' if text.count(';') >= text.count(',') else ','

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    headers = {h.strip().lower() for h in (reader.fieldnames or [])}
    missing = (_EXPECTED_HEADERS - headers)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes manquantes: {', '.join(sorted(missing))}"
        )

    inserted, updated = 0, 0
    errors: List[str] = []

    for i, row in enumerate(reader, start=2):  # 1 = header
        try:
            company = _norm(row.get("nom société"))
            firstname = _norm(row.get("prenom"))
            lastname = _norm(row.get("nom"))
            address = _norm(row.get("adresse"))
            postcode = _norm(row.get("code postal"))
            city = _norm(row.get("ville"))
            siret = re.sub(r"\D+", "", _norm(row.get("numero de siret")))
            email = _norm(row.get("email"))
            phone = _norm(row.get("telephone"))
            group = _norm(row.get("groupement"))
            rib_hint = _norm(row.get("emplacement rib pdf"))

            if not company and not siret and not email:
                errors.append(f"Ligne {i}: champs clés vides (nom société / siret / email)")
                continue

            if email and not _EMAIL_RE.match(email):
                errors.append(f"Ligne {i}: email invalide “{email}”")
                email = ""

            if postcode and not _CP_RE.match(postcode):
                errors.append(f"Ligne {i}: code postal suspect “{postcode}”")

            if siret and not _SIRET_RE.match(siret):
                errors.append(f"Ligne {i}: SIRET invalide “{siret}”")
                siret = ""

            # UPSERT priorité SIRET, sinon email
            client: Optional[Client] = None
            if siret:
                client = (await db.execute(select(Client).where(Client.vat == siret))).scalar_one_or_none()
            if not client and email:
                client = (await db.execute(select(Client).where(Client.email == email))).scalar_one_or_none()

            data = {
                "company": company,
                "first_name": firstname or None,
                "last_name": lastname or None,
                "address1": address or None,
                "postcode": postcode or None,
                "city": city or None,
                "vat": siret or None,
                "email": email or None,
                "phone": phone or None,
                # champs optionnels si tu les as:
                # "groupement": group or None,
                # "rib_pdf_hint": rib_hint or None,
            }

            if client:
                for k, v in data.items():
                    setattr(client, k, v)
                updated += 1
            else:
                db.add(Client(**data))
                inserted += 1

        except Exception as e:
            errors.append(f"Ligne {i}: {e}")

    await db.commit()
    return ImportClientsResult(ok=True, inserted=inserted, updated=updated, errors=errors)

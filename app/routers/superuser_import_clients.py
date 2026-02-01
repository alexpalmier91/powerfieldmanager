# app/routers/superuser_import_clients.py
from __future__ import annotations

from typing import List, Tuple, Optional, Dict
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
import sqlalchemy as sa
import pandas as pd
import io
import math

from app.db.session import get_async_session
from app.db.models import Client, LaboClient
from app.core.security import require_role  # exige ["S","U"] = SUPERUSER / SUPERADMIN

router = APIRouter(
    prefix="/api-zenhub/superuser",
    tags=["Superuser - Clients"],
    dependencies=[Depends(require_role(["S", "U"]))],
)

# =========================================================
# Mapping d'en-têtes (Excel/CSV) -> CHAMPS MODELE Client
# + client_code (code client propre au labo)
# =========================================================
HEADER_MAP = {
    # Société
    "raison sociale": "company_name",
    "raison_sociale": "company_name",
    "société": "company_name",
    "societe": "company_name",
    "company": "company_name",
    "nom": "company_name",
    "company_name": "company_name",

    # Prénom / Nom contact
    "prenom": "first_name",
    "prénom": "first_name",
    "first_name": "first_name",
    "first name": "first_name",
    "contact_prenom": "first_name",
    "contact prénom": "first_name",

    "nom contact": "last_name",
    "contact_nom": "last_name",
    "last_name": "last_name",
    "last name": "last_name",

    # Email
    "email": "email",
    "e-mail": "email",
    "courriel": "email",

    # Ville
    "ville": "city",
    "localite": "city",
    "localité": "city",
    "city": "city",

    # Téléphone
    "téléphone": "phone",
    "telephone": "phone",
    "tel": "phone",
    "tél": "phone",
    "mobile": "phone",
    "gsm": "phone",
    "phone": "phone",

    # Code postal
    "code postal": "postcode",
    "cp": "postcode",
    "zipcode": "postcode",
    "zip": "postcode",
    "postcode": "postcode",

    # Adresse
    "adresse": "address1",
    "address": "address1",
    "adresse 1": "address1",
    "adresse1": "address1",
    "address1": "address1",

    # SIRET
    "siret": "siret",

    # Pays
    "pays": "country",
    "country": "country",

    # Groupement
    "groupement": "groupement",

    # IBAN / BIC
    "iban": "iban",
    "iban client": "iban",
    "bic": "bic",
    "swift": "bic",

    # Conditions de paiement / encours
    "payment_terms": "payment_terms",
    "conditions de paiement": "payment_terms",
    "delai de paiement": "payment_terms",
    "délai de paiement": "payment_terms",

    "credit_limit": "credit_limit",
    "encours": "credit_limit",
    "plafond": "credit_limit",
    "plafond encours": "credit_limit",

    # Mandat SEPA
    "sepa_mandate_ref": "sepa_mandate_ref",
    "sepa": "sepa_mandate_ref",
    "ref mandat sepa": "sepa_mandate_ref",

    # Code client labo
    "code client": "client_code",
    "code_client": "client_code",
    "codeclient": "client_code",
    "code labo": "client_code",
    "codelabo": "client_code",
}

# Colonnes minimales (du point de vue du MODELE) pour l'import "clients"
# -> tu peux adapter si tu veux rendre email ou phone optionnel
REQUIRED_FIELDS = {"company_name", "city"}


# =========================
# Helpers
# =========================
def _normalize_header(h: str) -> str:
    return str(h or "").strip().lower().replace("-", " ").replace("_", " ")


def _detect_format(filename: str) -> str:
    n = (filename or "").lower()
    if n.endswith(".xlsx") or n.endswith(".xls"):
        return "excel"
    if n.endswith(".csv"):
        return "csv"
    return "unknown"


def _clean(val: Optional[str]) -> Optional[str]:
    """
    Nettoyage robuste:
    - None / NaN pandas / float('nan') -> None
    - 'nan', 'null', 'none', 'n/a', '-', '' -> None
    - sinon: str.trim() + suppression zero-width
    """
    try:
        if val is None:
            return None
        if isinstance(val, float) and math.isnan(val):
            return None
        if pd.isna(val):
            return None
    except Exception:
        pass

    s = str(val).replace("\u200b", "").strip()
    if not s:
        return None
    low = s.lower()
    if low in {"nan", "none", "null", "n/a", "na", "-", "--"}:
        return None
    return s


def _to_decimal(val: Optional[str], errors: List[str], line_no: int) -> Optional[Decimal]:
    """
    Convertit une valeur string en Decimal (gestion des virgules).
    En cas d'échec, ajoute un message d'erreur mais ne bloque pas l'import.
    """
    s = _clean(val)
    if s is None:
        return None
    s2 = s.replace(" ", "").replace(",", ".")
    try:
        return Decimal(s2)
    except InvalidOperation:
        errors.append(f"Ligne {line_no}: valeur de credit_limit invalide ('{s}')")
        return None


def _read_file_to_df(file_bytes: bytes, fmt: str) -> pd.DataFrame:
    """Lecture robuste Excel/CSV, sans transformer NaN en 'nan'."""
    if fmt == "excel":
        return pd.read_excel(io.BytesIO(file_bytes), dtype=object)

    # CSV: essais d'encodage + auto-sep
    for enc in ("utf-8-sig", "utf-8", "cp1252", "iso-8859-1"):
        try:
            return pd.read_csv(io.BytesIO(file_bytes), dtype=object, encoding=enc, sep=None, engine="python")
        except Exception:
            continue
    # dernier fallback
    return pd.read_csv(io.BytesIO(file_bytes), dtype=object, encoding="utf-8", sep=",")


def _map_headers_to_model(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """
    Renomme les colonnes source vers les noms du MODELE via HEADER_MAP,
    puis ne conserve que les colonnes d'intérêt. Ne convertit pas en str.
    """
    if df is None or df.empty:
        return pd.DataFrame(), list(REQUIRED_FIELDS)

    renamer: Dict[str, str] = {}
    for col in df.columns:
        target = HEADER_MAP.get(_normalize_header(col))
        if target:
            renamer[col] = target

    df2 = df.rename(columns=renamer)

    desired_cols = [
        "company_name",
        "first_name",
        "last_name",
        "email",
        "phone",
        "city",
        "postcode",
        "address1",
        "siret",
        "country",
        "groupement",
        "iban",
        "bic",
        "payment_terms",
        "credit_limit",
        "sepa_mandate_ref",
        "client_code",
    ]
    present = [c for c in desired_cols if c in df2.columns]
    df2 = df2[present].copy()

    df2 = df2.applymap(_clean)

    missing = [c for c in REQUIRED_FIELDS if c not in df2.columns or df2[c].isna().all()]

    return df2, missing


def _norm_row_model(row: Dict[str, Optional[str]]) -> Dict[str, Optional[str]]:
    """
    Normalise un dict déjà mappé aux champs du modèle.
    (On laisse credit_limit en string; conversion en Decimal dans l'endpoint.)
    """
    return {
        "company_name": _clean(row.get("company_name")),
        "first_name": _clean(row.get("first_name")),
        "last_name": _clean(row.get("last_name")),
        "email": (_clean(row.get("email")) or "").lower() or None,
        "phone": _clean(row.get("phone")),
        "city": _clean(row.get("city")),
        "postcode": _clean(row.get("postcode")),
        "address1": _clean(row.get("address1")),
        "siret": _clean(row.get("siret")),
        "country": _clean(row.get("country")),
        "groupement": _clean(row.get("groupement")),
        "iban": _clean(row.get("iban")),
        "bic": _clean(row.get("bic")),
        "payment_terms": _clean(row.get("payment_terms")),
        "credit_limit": _clean(row.get("credit_limit")),  # string, conversion plus tard
        "sepa_mandate_ref": _clean(row.get("sepa_mandate_ref")),
        "client_code": _clean(row.get("client_code")),
    }


# =========================================================
# SQL upsert robuste labo_client
# - évite UniqueViolation sur PK (labo_id, client_id)
# - garde ta logique de "code_client unique par labo"
# =========================================================
LABO_CLIENT_FREE_CODE_SQL = text("""
DELETE FROM labo_client
WHERE labo_id = :labo_id
  AND code_client = :code_client
  AND client_id <> :client_id
""")

LABO_CLIENT_UPSERT_BY_CLIENT_SQL = text("""
INSERT INTO labo_client (labo_id, client_id, code_client)
VALUES (:labo_id, :client_id, :code_client)
ON CONFLICT (labo_id, client_id)
DO UPDATE SET code_client = EXCLUDED.code_client
""")



# =========================
# Endpoint 1 : Import des clients (+ lien code client labo si fourni)
# =========================
@router.post("/client-import")
@router.post("/import-clients")  # alias / compat
async def import_clients(
    file: UploadFile = File(...),
    labo_id: int = Query(1, description="Labo cible pour éventuel lien code client"),
    session: AsyncSession = Depends(get_async_session),
):
    # 1) lecture brute
    try:
        raw = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire le fichier uploadé.")

    # 2) parse Excel/CSV
    try:
        fmt = _detect_format(file.filename)
        df = _read_file_to_df(raw, fmt)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Format/encodage non reconnu : {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Fichier vide ou non lisible.")

    # 3) mapping vers champs MODELE + check colonnes minimales
    df_map, missing = _map_headers_to_model(df)
    total_rows = len(df_map)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes manquantes: {', '.join(missing)} (requis: {', '.join(sorted(REQUIRED_FIELDS))})"
        )

    # 4) normalisation + filtrage des lignes invalides
    valid_rows: List[Dict[str, Optional[str]]] = []
    invalid_lines: List[int] = []
    error_details: List[str] = []

    for idx, r in df_map.iterrows():
        excel_line = idx + 2  # 1 header + index 0-based
        rr = _norm_row_model(r.to_dict())

        # Règles minimales : company_name + city
        if not rr["company_name"] or not rr["city"]:
            invalid_lines.append(excel_line)
            error_details.append(f"Ligne {excel_line}: company_name/city manquant.")
            continue

        valid_rows.append(rr)

    inserted = 0
    updated = 0
    errors_count = len(invalid_lines)
    warnings: List[str] = []

    if invalid_lines:
        preview = invalid_lines[:20]
        warnings.append(
            f"Lignes invalides ignorées: {preview}{'...' if len(invalid_lines) > 20 else ''}"
        )

    if not valid_rows:
        return {
            "rows_read": total_rows,
            "clients_created": 0,
            "clients_updated": 0,
            "rows_ignored": errors_count,
            "inserted": 0,
            "updated": 0,
            "errors": errors_count,
            "warnings": warnings,
            "missing_columns": [],
            "error_details": error_details,
        }

    # 5) import : recherche par SIRET > (company_name+postcode+city) > email
    for idx, r in enumerate(valid_rows):
        excel_line = idx + 2  # approximatif (mais suffisant pour les messages)
        siret = r.get("siret")
        company_name = r.get("company_name")
        postcode = r.get("postcode")
        city = r.get("city")
        email = r.get("email")

        client_obj: Optional[Client] = None

        # a) SIRET prioritaire
        if siret:
            q = await session.execute(select(Client).where(Client.siret == siret))
            client_obj = q.scalars().first()

        # b) fallback company_name + postcode + city
        if client_obj is None and company_name and postcode and city:
            q = await session.execute(
                select(Client).where(
                    Client.company_name == company_name,
                    Client.postcode == postcode,
                    Client.city == city,
                )
            )
            client_obj = q.scalars().first()

        # c) fallback sur email si dispo
        if client_obj is None and email:
            q = await session.execute(select(Client).where(Client.email == email))
            client_obj = q.scalars().first()

        # ==========================
        # création / mise à jour
        # ==========================
        if client_obj:
            # Mise à jour
            if r.get("company_name"):
                client_obj.company_name = r["company_name"]
            if r.get("first_name") and hasattr(client_obj, "first_name"):
                client_obj.first_name = r["first_name"]
            if r.get("last_name") and hasattr(client_obj, "last_name"):
                client_obj.last_name = r["last_name"]
            if r.get("email"):
                client_obj.email = r["email"]
            if r.get("phone"):
                client_obj.phone = r["phone"]
            if r.get("city"):
                client_obj.city = r["city"]
            if r.get("postcode"):
                client_obj.postcode = r["postcode"]
            if r.get("address1"):
                client_obj.address1 = r["address1"]
            if r.get("siret"):
                client_obj.siret = r["siret"]
            if r.get("country"):
                client_obj.country = r["country"]
            if r.get("groupement") and hasattr(client_obj, "groupement"):
                client_obj.groupement = r["groupement"]
            if r.get("iban") and hasattr(client_obj, "iban"):
                client_obj.iban = r["iban"]
            if r.get("bic") and hasattr(client_obj, "bic"):
                client_obj.bic = r["bic"]
            if r.get("payment_terms") and hasattr(client_obj, "payment_terms"):
                client_obj.payment_terms = r["payment_terms"]
            if hasattr(client_obj, "credit_limit"):
                credit_dec = _to_decimal(r.get("credit_limit"), error_details, excel_line)
                if credit_dec is not None:
                    client_obj.credit_limit = credit_dec
            if r.get("sepa_mandate_ref") and hasattr(client_obj, "sepa_mandate_ref"):
                client_obj.sepa_mandate_ref = r["sepa_mandate_ref"]

            updated += 1
        else:
            # Création
            c_kwargs = {
                "company_name": r["company_name"],
                "email": email,
                "phone": r.get("phone"),
                "city": city,
                "postcode": postcode,
                "address1": r.get("address1"),
                "siret": siret,
                "country": r.get("country"),
            }
            if hasattr(Client, "first_name"):
                c_kwargs["first_name"] = r.get("first_name")
            if hasattr(Client, "last_name"):
                c_kwargs["last_name"] = r.get("last_name")
            if hasattr(Client, "groupement"):
                c_kwargs["groupement"] = r.get("groupement")
            if hasattr(Client, "iban"):
                c_kwargs["iban"] = r.get("iban")
            if hasattr(Client, "bic"):
                c_kwargs["bic"] = r.get("bic")
            if hasattr(Client, "payment_terms"):
                c_kwargs["payment_terms"] = r.get("payment_terms")
            if hasattr(Client, "credit_limit"):
                credit_dec = _to_decimal(r.get("credit_limit"), error_details, excel_line)
                c_kwargs["credit_limit"] = credit_dec
            if hasattr(Client, "sepa_mandate_ref"):
                c_kwargs["sepa_mandate_ref"] = r.get("sepa_mandate_ref")

            client_obj = Client(**c_kwargs)
            session.add(client_obj)
            await session.flush()
            inserted += 1

        # Lien labo_client si un code est fourni sur la ligne
        # ✅ Upsert robuste: d'abord UPDATE sur (labo_id, client_id) puis INSERT/UPSERT sur (labo_id, code_client)
        client_code_val = r.get("client_code")
        if client_code_val:
            params = {"labo_id": labo_id, "client_id": client_obj.id, "code_client": client_code_val}

            # 1) libère le code s’il est déjà pris par un autre client dans ce labo
            await session.execute(LABO_CLIENT_FREE_CODE_SQL, params)

            # 2) upsert idempotent par (labo_id, client_id)
            await session.execute(LABO_CLIENT_UPSERT_BY_CLIENT_SQL, params)


    await session.commit()

    # Fusionner erreurs de type et lignes invalides dans un seul tableau de détails
    if error_details:
        warnings.append(f"Problèmes de conversion détectés sur certaines lignes (voir error_details).")

    return {
        # Nouveau format "verbeux"
        "rows_read": total_rows,
        "clients_created": inserted,
        "clients_updated": updated,
        "rows_ignored": errors_count,

        # Anciennes clés conservées pour compat
        "inserted": inserted,
        "updated": updated,
        "errors": errors_count,
        "warnings": warnings,
        "missing_columns": [],

        # Détail des erreurs
        "error_details": error_details,
    }


# =========================================================
# Endpoint 2 : Import DEDIE des codes clients labo
# (attribuer/mettre à jour code_client sans recréer les clients)
# =========================================================
@router.post("/labo-client-mapping/import")
@router.post("/import-client-codes")  # alias / compat
async def import_client_codes(
    file: UploadFile = File(...),
    labo_id: int = Query(1, description="Labo cible"),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Associe/Met à jour le code client d'un labo pour des clients déjà présents.

    NOUVELLE PRIORITÉ DE MATCH :
      1) email (en premier)
      2) siret
      3) (company_name + postcode + city)
      4) (company_name + city)

    L'idée : on se base d'abord sur l'email, et si on ne l'a pas / ne trouve pas,
    on retombe sur la combinaison raison sociale + CP + ville comme demandé.
    """

    # Lecture
    try:
        raw = await file.read()
        fmt = _detect_format(file.filename)
        df = _read_file_to_df(raw, fmt)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    # Renommage colonnes utiles via HEADER_MAP
    renamer: Dict[str, str] = {}
    for col in df.columns:
        tgt = HEADER_MAP.get(_normalize_header(col))
        if tgt:
            renamer[col] = tgt
    df = df.rename(columns=renamer)

    if "client_code" not in df.columns:
        raise HTTPException(status_code=400, detail="Colonne 'code client' manquante.")

    # Nettoyage des colonnes utilisées pour le matching
    for c in [c for c in ["client_code", "email", "company_name", "postcode", "city", "siret"] if c in df.columns]:
        df[c] = df[c].map(_clean)

    total_rows = len(df)

    updated_links = 0
    not_found: List[int] = []
    skipped_no_code: List[int] = []

    for idx, r in df.iterrows():
        excel_line = idx + 2
        code_client_val = r.get("client_code")
        if not code_client_val:
            skipped_no_code.append(excel_line)
            continue

        # Champs potentiellement présents
        siret = r.get("siret")
        email = (r.get("email") or "").lower() if r.get("email") else None
        company_name = r.get("company_name")
        postcode = r.get("postcode")
        city = r.get("city")

        target: Optional[Client] = None

        # 1) MATCH PAR EMAIL (en premier)
        if email:
            q = await session.execute(select(Client).where(Client.email == email))
            target = q.scalars().first()

        # 2) MATCH PAR SIRET (si pas trouvé et siret dispo)
        if target is None and siret:
            q = await session.execute(select(Client).where(Client.siret == siret))
            target = q.scalars().first()

        # 3) MATCH (company_name + postcode + city)
        if target is None and company_name and postcode and city:
            q = await session.execute(
                select(Client).where(
                    Client.company_name == company_name,
                    Client.postcode == postcode,
                    Client.city == city,
                )
            )
            target = q.scalars().first()

        # 4) MATCH (company_name + city) en dernier recours
        if target is None and company_name and city:
            q = await session.execute(
                select(Client).where(
                    Client.company_name == company_name,
                    Client.city == city,
                )
            )
            target = q.scalars().first()

        if target is None:
            not_found.append(excel_line)
            continue

        client_id = target.id

        # Libérer le code s’il est utilisé ailleurs dans ce labo
        await session.execute(
            sa.text("""
                DELETE FROM labo_client
                WHERE labo_id = :labo_id
                  AND code_client = :code_client
                  AND client_id <> :client_id
            """),
            {"labo_id": labo_id, "code_client": code_client_val, "client_id": client_id},
        )

        # Upsert idempotent par (labo_id, client_id)
        await session.execute(
            sa.text("""
                INSERT INTO labo_client (labo_id, client_id, code_client)
                VALUES (:labo_id, :client_id, :code_client)
                ON CONFLICT (labo_id, client_id)
                DO UPDATE SET code_client = EXCLUDED.code_client
            """),
            {"labo_id": labo_id, "client_id": client_id, "code_client": code_client_val},
        )

        updated_links += 1

    await session.commit()

    warnings: List[str] = []
    if not_found:
        prev = not_found[:20]
        warnings.append(
            f"Clients introuvables pour {len(not_found)} lignes. Exemples (lignes Excel) : {prev}{'...' if len(not_found)>20 else ''}"
        )
    if skipped_no_code:
        prev = skipped_no_code[:20]
        warnings.append(
            f"Lignes sans code client ignorées : {prev}{'...' if len(skipped_no_code)>20 else ''}"
        )

    return {
        "rows_read": total_rows,
        "mappings_created_or_updated": updated_links,
        "rows_client_not_found": len(not_found),
        "rows_without_code": len(skipped_no_code),

        # compat anciennes clés
        "linked_or_updated": updated_links,
        "not_found": len(not_found),
        "skipped_no_code": len(skipped_no_code),
        "warnings": warnings,
    }

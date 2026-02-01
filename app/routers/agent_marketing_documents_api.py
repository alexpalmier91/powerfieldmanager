# app/routers/agent_marketing_documents_api.py
from __future__ import annotations

import time
import re
import copy
from io import BytesIO
from pathlib import Path
from typing import Optional, List, Dict, Any, Set

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse  # ✅ NEW

import traceback
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, exists, literal, func, and_

from app.db.session import get_async_session
from app.db.models import (
    MarketingDocument,
    MarketingDocumentAnnotation,
    MarketingAnnotationStatus,
    MarketingDocumentPublication,
    MarketingPublicationStatus,
    labo_agent,
    Labo,
    Agent,
    Product,
    PriceTier,
    MarketingFont,
)
from app.db.models import GlobalFont

from app.core.security import get_current_user

from app.services.marketing_signed_url import (
    make_marketing_token,
    build_public_url,
)

# ✅ PDF renderer (vectoriel)
from app.services.marketing_pdf_renderer import render_pdf_with_overlays, RenderContext

router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent-marketing-documents"],
)

THUMB_TTL = 300
VIEW_TTL = 300

MEDIA_DIR = Path("/app/media/marketing_documents")


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------
def _media_thumb_url(labo_id: int, thumb_filename: str) -> str:
    return f"/media/marketing_documents/labo_{labo_id}/{thumb_filename}"


def _media_pdf_url(labo_id: int, filename: str) -> str:
    return f"/media/marketing_documents/labo_{labo_id}/{filename}"


def _safe_filename(name: str) -> str:
    s = (name or "document").strip().lower()
    s = re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:80] or "document"


async def _agent_can_access_labo(session: AsyncSession, agent_id: int, labo_id: int) -> bool:
    stmt = select(
        exists().where(
            (labo_agent.c.agent_id == literal(agent_id))
            & (labo_agent.c.labo_id == literal(labo_id))
        )
    )
    res = await session.execute(stmt)
    return bool(res.scalar())


def _collect_product_ids_from_draft(draft: Dict[str, Any]) -> Set[int]:
    ids: Set[int] = set()
    for page in (draft.get("pages") or []):
        if not isinstance(page, dict):
            continue
        for obj in (page.get("objects") or []):
            if not isinstance(obj, dict):
                continue

            dyn = obj.get("dynamic") or {}
            kind = (
                (dyn.get("kind"))
                or obj.get("_dyn_kind")
                or obj.get("type")
                or ""
            ).strip()

            # ✅ ADD product_ean
            if kind not in ("product_price", "product_stock_badge", "product_ean"):
                continue

            pid = (
                dyn.get("product_id")
                or dyn.get("productId")
                or obj.get("product_id")
                or obj.get("productId")
                or obj.get("_dyn_product_id")
            )
            try:
                pid_int = int(pid)
                if pid_int > 0:
                    ids.add(pid_int)
            except Exception:
                continue
    return ids


def _fonts_dir_for_labo(labo_id: int) -> Path:
    return MEDIA_DIR / f"labo_{int(labo_id)}" / "fonts"


def _safe_family_name_from_font_id(font_id: int) -> str:
    # doit matcher le front : LABO_FONT_<id>
    return f"LABO_FONT_{int(font_id)}"


def _normalize_font_key_from_family(family: str, weight: int) -> str:
    fam = (family or "").strip().lower()
    fam = re.sub(r"\s+", " ", fam)
    return f"{fam}__{int(weight)}"


def _guess_weight_from_filename(filename: str) -> int:
    low = (filename or "").lower()
    if "bold" in low or "-bd" in low or "_bd" in low or "700" in low:
        return 700
    return 400


def _build_font_files_from_db(fonts: List["MarketingFont"], fonts_dir: Path) -> Dict[str, str]:
    """
    Mapping attendu par marketing_pdf_renderer:
      key = "<family>__<weight>" (family normalisé)

    IMPORTANT:
      - On ne stocke actuellement que des .woff2 en BDD/disque
      - PyMuPDF a besoin d'un TTF/OTF pour dessiner le texte
      - Donc: on convertit le .woff2 -> .ttf dans un cache local, puis on mappe le .ttf

    Le bon répertoire "source" est /app/media/marketing_fonts/labo_<id>/
    """
    out: Dict[str, str] = {}

    cache_dir = fonts_dir / "_cache_ttf"
    cache_dir.mkdir(parents=True, exist_ok=True)

    def _normalize_family(family: str) -> str:
        return (family or "").strip()

    def _add_family_keys(family_name: str, weight: int, path: Path):
        fam = _normalize_family(family_name)
        if not fam:
            return

        key = _normalize_font_key_from_family(fam, weight)
        out[key] = str(path)

        out[_normalize_font_key_from_family(fam, 0)] = str(path)

        if weight == 400:
            out[_normalize_font_key_from_family(fam, 400)] = str(path)
        if weight == 700:
            out[_normalize_font_key_from_family(fam, 700)] = str(path)

    def _guess_weight(font_obj, filename_for_guess: str) -> int:
        original = (getattr(font_obj, "original_name", None) or "").strip()
        if original:
            w = _guess_weight_from_filename(original)
            if w:
                return w
        nm = (getattr(font_obj, "name", None) or "").strip()
        if nm:
            w = _guess_weight_from_filename(nm)
            if w:
                return w
        return _guess_weight_from_filename(filename_for_guess) or 400

    def _human_family(font_obj, file_stem: str) -> str:
        human = (getattr(font_obj, "name", None) or "").strip()
        if human:
            return human

        base = (file_stem or "").replace("-", " ").replace("_", " ").strip()
        base = re.sub(r"\bRegular\b|\bBold\b|\bItalic\b|\bMedium\b|\bLight\b", "", base, flags=re.I).strip()
        base = re.sub(r"([a-z])([A-Z])", r"\1 \2", base).strip()
        return base

    def _woff2_to_ttf(woff2_path: Path, ttf_path: Path):
        from fontTools.ttLib import TTFont  # type: ignore

        ttf_path.parent.mkdir(parents=True, exist_ok=True)
        font = TTFont(str(woff2_path))
        font.flavor = None
        font.save(str(ttf_path))

    for f in fonts:
        fid = int(getattr(f, "id", 0) or 0)
        if fid <= 0:
            continue

        filename = (getattr(f, "filename", None) or "").strip()
        if not filename:
            continue

        woff2_path = fonts_dir / filename
        if not woff2_path.exists():
            continue

        if woff2_path.suffix.lower() != ".woff2":
            continue

        weight = _guess_weight(f, woff2_path.name)

        sha = (getattr(f, "sha256", None) or "").strip()
        ttf_name = f"{sha}.ttf" if sha else f"{woff2_path.stem}.ttf"
        ttf_path = cache_dir / ttf_name

        if (not ttf_path.exists()) or ttf_path.stat().st_size < 1000:
            try:
                _woff2_to_ttf(woff2_path, ttf_path)
            except Exception:
                continue

        family_labo = _safe_family_name_from_font_id(fid)
        _add_family_keys(family_labo, weight, ttf_path)

        human = _human_family(f, woff2_path.stem)
        if human:
            _add_family_keys(human, weight, ttf_path)

    return out


def _build_labo_fonts_by_id(fonts: List[MarketingFont]) -> Dict[int, Dict[str, Any]]:
    """
    Permet au renderer de résoudre LABO_FONT_<id> => chemin fichier.
    Ici on met seulement filename (relatif), le renderer le join avec fonts_dir si besoin.
    """
    out: Dict[int, Dict[str, Any]] = {}
    for f in fonts:
        fid = int(getattr(f, "id", 0) or 0)
        if fid <= 0:
            continue
        filename = getattr(f, "filename", None) or ""
        if not filename:
            continue
        out[fid] = {"ttf_path": filename, "path": filename}
    return out


def _font_key_variants(family: str, weight: Optional[int]) -> List[str]:
    fam = (family or "").strip()
    w = int(weight) if weight not in (None, "", 0) else 0

    variants = []
    variants.append(_normalize_font_key_from_family(fam, w))
    variants.append(_normalize_font_key_from_family(fam, 0))
    if w and w != 400:
        variants.append(_normalize_font_key_from_family(fam, 400))
    if w and w != 700:
        variants.append(_normalize_font_key_from_family(fam, 700))

    variants.append(f"{fam}__{w}")
    variants.append(f"{fam}__0")
    variants.append(f"{fam.lower()}__{w}")
    variants.append(f"{fam.lower()}__0")
    variants.append(f"{fam.upper()}__{w}")
    variants.append(f"{fam.upper()}__0")

    out = []
    seen = set()
    for k in variants:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _debug_pick_font_path(obj: Dict[str, Any], font_files: Dict[str, str]) -> Dict[str, Any]:
    family = obj.get("fontFamily") or obj.get("font_family") or obj.get("font") or obj.get("family")
    weight = obj.get("fontWeight") or obj.get("font_weight")

    try:
        weight_int = int(weight) if weight not in (None, "", 0) else 0
    except Exception:
        weight_int = 0

    keys = _font_key_variants(str(family or ""), weight_int)

    hit_key = None
    hit_path = None
    if family and font_files:
        for k in keys:
            if k in font_files:
                hit_key = k
                hit_path = font_files[k]
                break

    return {
        "declared_family": family,
        "declared_weight": weight_int or None,
        "try_keys": keys[:10],
        "hit_key": hit_key,
        "hit_path": hit_path,
    }


def _maybe_int(v: Any) -> Optional[int]:
    """
    ✅ IMPORTANT:
    - si stock est NULL en BDD => on renvoie None (inconnu), PAS 0
    - sinon int(stock)
    """
    if v is None:
        return None
    try:
        return int(v)
    except Exception:
        return None


# ---------------------------------------------------------
# ✅ NEW PATCH: normalize + filter overlays for AGENT render
# ---------------------------------------------------------
def _to_int_or_none(v: Any) -> Optional[int]:
    try:
        if v is None or v == "":
            return None
        return int(v)
    except Exception:
        return None


def _camel_to_snake_dyn_keys(dyn: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalise les clés camelCase venant du front vers snake_case attendu backend.
    Ne casse rien: si snake_case existe déjà, il reste prioritaire.
    """
    if not isinstance(dyn, dict):
        return {}
    d = dict(dyn)

    if d.get("product_id") is None and d.get("productId") is not None:
        d["product_id"] = d.get("productId")
    if d.get("tier_id") is None and d.get("tierId") is not None:
        d["tier_id"] = d.get("tierId")
    if d.get("price_mode") is None and d.get("priceMode") is not None:
        d["price_mode"] = d.get("priceMode")
    if d.get("mode_agent") is None and d.get("modeAgent") is not None:
        d["mode_agent"] = d.get("modeAgent")
    if d.get("mode_labo") is None and d.get("modeLabo") is not None:
        d["mode_labo"] = d.get("modeLabo")
    return d


def _normalize_overlay_object_for_renderer(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stabilise le format pour le renderer:
    - obj["dynamic"] toujours présent
    - dyn.kind/product_id/price_mode/tier_id/mode_* recopiés si nécessaire
    - product_id/tier_id convertis en int
    + ✅ support camelCase (productId, modeAgent, etc.)
    """
    o = dict(obj or {})
    dyn = dict(o.get("dynamic") or {})

    # ✅ 1) normalise camelCase dans dynamic
    dyn = _camel_to_snake_dyn_keys(dyn)

    # ✅ 2) normalise camelCase au niveau racine
    if o.get("product_id") is None and o.get("productId") is not None:
        o["product_id"] = o.get("productId")
    if o.get("tier_id") is None and o.get("tierId") is not None:
        o["tier_id"] = o.get("tierId")
    if o.get("price_mode") is None and o.get("priceMode") is not None:
        o["price_mode"] = o.get("priceMode")
    if o.get("mode_agent") is None and o.get("modeAgent") is not None:
        o["mode_agent"] = o.get("modeAgent")
    if o.get("mode_labo") is None and o.get("modeLabo") is not None:
        o["mode_labo"] = o.get("modeLabo")

    kind = dyn.get("kind") or o.get("_dyn_kind") or o.get("type")
    if kind:
        dyn["kind"] = kind

    for k in ("product_id", "price_mode", "tier_id", "mode_agent", "mode_labo", "text"):
        if dyn.get(k) is None and o.get(k) is not None:
            dyn[k] = o.get(k)

    if dyn.get("product_id") is not None:
        dyn["product_id"] = _to_int_or_none(dyn.get("product_id"))
    if dyn.get("tier_id") is not None:
        dyn["tier_id"] = _to_int_or_none(dyn.get("tier_id"))

    o["dynamic"] = dyn
    return o


def _filter_and_normalize_draft_for_agent(
    draft: Dict[str, Any],
    products_by_id: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    ✅ Filtre "rupture" quand mode_agent=only_if_zero et stock > 0
    ✅ Rend robuste le test stock (int/str/etc.)
    ✅ Conserve aussi product_ean (pas filtré ici)
    """
    d = copy.deepcopy(draft or {"pages": [], "_meta": {}})
    pages = d.get("pages") or []
    new_pages = []

    for page in pages:
        if not isinstance(page, dict):
            continue

        objs = page.get("objects") or []
        new_objs = []

        for obj in objs:
            if not isinstance(obj, dict):
                continue

            o = _normalize_overlay_object_for_renderer(obj)
            dyn = o.get("dynamic") or {}
            kind = dyn.get("kind") or o.get("type")

            if kind == "product_stock_badge":
                pid = _to_int_or_none(dyn.get("product_id"))
                mode_agent = (dyn.get("mode_agent") or "only_if_zero").strip().lower()

                stock = None
                if pid and pid in products_by_id:
                    stock = products_by_id[pid].get("stock", None)

                # only_if_zero => on filtre si stock > 0 ; stock None => on filtre (safe)
                if mode_agent in ("only_if_zero", "agent_only_if_zero", ""):
                    if stock is None:
                        continue
                    try:
                        if int(stock) > 0:
                            continue
                    except Exception:
                        continue

                new_objs.append(o)
                continue

            # product_price / product_ean / text / image => pas de filtre ici
            new_objs.append(o)

        new_page = dict(page)
        new_page["objects"] = new_objs
        new_pages.append(new_page)

    d["pages"] = new_pages
    return d


def _debug_resolve_dynamic(
    draft: Dict[str, Any],
    products_by_id: Dict[int, Dict[str, Any]],
    tiers_by_pid: Dict[int, list],
) -> List[Dict[str, Any]]:
    """
    DEBUG: expose ce que le draft demande, côté API.
    (Le rendu final est fait dans marketing_pdf_renderer via RenderContext.)
    """
    out: List[Dict[str, Any]] = []
    pages = draft.get("pages") or []
    for pi, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        for oi, obj in enumerate((page.get("objects") or [])):
            if not isinstance(obj, dict):
                continue
            dyn = obj.get("dynamic") or {}
            kind = dyn.get("kind") or obj.get("type")

            # ✅ inclut product_ean
            if kind not in ("product_price", "product_stock_badge", "product_ean"):
                continue

            pid_raw = dyn.get("product_id") or dyn.get("productId") or obj.get("product_id") or obj.get("productId")
            try:
                pid_int = int(pid_raw)
            except Exception:
                pid_int = None

            p = products_by_id.get(pid_int) if pid_int else None

            item: Dict[str, Any] = {
                "page": pi,
                "idx": oi,
                "object_id": obj.get("id"),
                "kind": kind,
                "product_id": pid_int,
                "product_found": bool(p),
                "product_stock": None if not p else p.get("stock"),
                "product_price_ht": None if not p else p.get("price_ht"),
                "product_ean13": None if not p else p.get("ean13"),
                "dynamic": dyn,
            }

            if kind == "product_stock_badge":
                mode_agent = str(
                    dyn.get("mode_agent")
                    or dyn.get("modeAgent")
                    or obj.get("mode_agent")
                    or obj.get("modeAgent")
                    or "only_if_zero"
                )
                text = str(dyn.get("text") or obj.get("text") or "Rupture de stock")
                item["mode_agent"] = mode_agent
                item["text"] = text

            if kind == "product_price":
                price_mode = str(
                    dyn.get("price_mode")
                    or dyn.get("priceMode")
                    or obj.get("price_mode")
                    or obj.get("priceMode")
                    or "base"
                )
                tier_id_raw = dyn.get("tier_id") if dyn.get("tier_id") is not None else dyn.get("tierId")
                if tier_id_raw is None:
                    tier_id_raw = obj.get("tier_id") if obj.get("tier_id") is not None else obj.get("tierId")
                try:
                    tier_id_int = int(tier_id_raw) if tier_id_raw not in ("", None) else None
                except Exception:
                    tier_id_int = None

                item["price_mode"] = price_mode
                item["tier_id"] = tier_id_int

                tiers = tiers_by_pid.get(pid_int) if pid_int else []
                item["tiers_count"] = len(tiers or [])

                if price_mode == "tier" and tier_id_int:
                    t = next((x for x in (tiers or []) if int(x.get("id") or 0) == tier_id_int), None)
                    item["tier_match"] = t
                else:
                    item["tier_match"] = None

            # product_ean: pas de calcul ici, on expose juste les infos
            out.append(item)
    return out


# ---------------------------------------------------------
# Auth / Agent helper
# ---------------------------------------------------------
async def get_current_agent(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> Agent:
    if isinstance(current_user, dict):
        agent_id = current_user.get("agent_id")
        role = current_user.get("role")
        email = current_user.get("email")
    else:
        agent_id = getattr(current_user, "agent_id", None)
        role = getattr(current_user, "role", None)
        email = getattr(current_user, "email", None)

    print(f"[get_current_agent] role={role!r} agent_id={agent_id!r} email={email!r}")

    if not agent_id:
        raise HTTPException(status_code=403, detail="Aucun agent rattaché à cet utilisateur")

    agent = await session.get(Agent, int(agent_id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    return agent


# ---------------------------------------------------------
# 1) Liste des labos accessibles
# ---------------------------------------------------------
@router.get("/marketing-documents/labos")
async def list_agent_labos_for_marketing_docs(
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    stmt = (
        select(Labo.id, Labo.name)
        .select_from(Labo)
        .join(labo_agent, labo_agent.c.labo_id == Labo.id)
        .where(labo_agent.c.agent_id == agent.id)
        .order_by(Labo.name.asc())
    )
    rows = (await session.execute(stmt)).all()
    return [{"id": r.id, "name": r.name} for r in rows]


# ---------------------------------------------------------
# 2) Liste docs d’un labo + miniature + info publication
# ---------------------------------------------------------
@router.get("/labos/{labo_id}/marketing-documents")
async def list_marketing_documents_for_labo(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    if not await _agent_can_access_labo(session, agent.id, labo_id):
        raise HTTPException(status_code=403, detail="Accès refusé")

    sub_latest_ready_ver = (
        select(
            MarketingDocumentPublication.document_id.label("doc_id"),
            func.max(MarketingDocumentPublication.version).label("max_ver"),
        )
        .where(
            MarketingDocumentPublication.status == MarketingPublicationStatus.READY,
            MarketingDocumentPublication.published_pdf_filename.isnot(None),
        )
        .group_by(MarketingDocumentPublication.document_id)
        .subquery()
    )

    pub_alias = MarketingDocumentPublication

    stmt = (
        select(
            MarketingDocument,
            pub_alias.version,
            pub_alias.published_pdf_filename,
            pub_alias.updated_at,
        )
        .select_from(MarketingDocument)
        .outerjoin(
            sub_latest_ready_ver,
            sub_latest_ready_ver.c.doc_id == MarketingDocument.id,
        )
        .outerjoin(
            pub_alias,
            and_(
                pub_alias.document_id == MarketingDocument.id,
                pub_alias.version == sub_latest_ready_ver.c.max_ver,
            ),
        )
        .where(MarketingDocument.labo_id == labo_id)
        .order_by(MarketingDocument.created_at.desc())
    )

    rows = (await session.execute(stmt)).all()

    now = int(time.time())
    out = []

    for (d, pub_ver, pub_filename, pub_updated_at) in rows:
        thumb_url: Optional[str] = None
        thumb_signed_url: Optional[str] = None

        if getattr(d, "thumb_filename", None):
            thumb_url = _media_thumb_url(d.labo_id, d.thumb_filename)
            try:
                token = make_marketing_token(doc_id=d.id, kind="thumb", exp_ts=now + THUMB_TTL)
                thumb_signed_url = build_public_url(token)
            except Exception:
                thumb_signed_url = None

        has_published = bool(pub_ver and pub_filename)

        out.append(
            {
                "id": d.id,
                "title": d.title,
                "doc_type": d.doc_type,
                "comment": d.comment,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "original_name": d.original_name,
                "thumb_url": thumb_url,
                "thumb_signed_url": thumb_signed_url,
                "has_published": has_published,
                "published_version": int(pub_ver) if has_published else None,
                "published_pdf_filename": str(pub_filename) if has_published else None,
                "published_at": pub_updated_at.isoformat() if has_published and pub_updated_at else None,
            }
        )

    return out


# ---------------------------------------------------------
# 3) URL PDF : publication READY si dispo sinon source
# ---------------------------------------------------------
@router.get("/marketing-documents/{doc_id}/view-url")
async def get_marketing_document_view_url(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    doc = await session.get(MarketingDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    if not await _agent_can_access_labo(session, agent.id, doc.labo_id):
        raise HTTPException(status_code=403, detail="Accès refusé")

    stmt_pub = (
        select(MarketingDocumentPublication)
        .where(
            MarketingDocumentPublication.document_id == doc_id,
            MarketingDocumentPublication.status == MarketingPublicationStatus.READY,
            MarketingDocumentPublication.published_pdf_filename.isnot(None),
        )
        .order_by(MarketingDocumentPublication.version.desc())
        .limit(1)
    )
    pub = (await session.execute(stmt_pub)).scalars().first()

    if pub:
        url = _media_pdf_url(doc.labo_id, pub.published_pdf_filename)
        return {"url": url, "mode": "published", "is_published": True, "published_version": int(pub.version)}

    url = _media_pdf_url(doc.labo_id, doc.filename)
    return {"url": url, "mode": "source", "is_published": False, "published_version": None}


# ---------------------------------------------------------
# 4) ✅ draft: si doc publié => retourne LOCKED lié à la dernière pub READY
# ---------------------------------------------------------
@router.get("/marketing-documents/{doc_id}/draft")
async def get_marketing_document_draft(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    AGENT = lecture seule.
    Règle:
      - Si une publication READY existe => on retourne UNIQUEMENT le draft LOCKED lié à cette publication.
      - Sinon (pas publié) => on peut retourner le DRAFT (preview) ou un draft vide.
    """
    doc = await session.get(MarketingDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    if not await _agent_can_access_labo(session, agent.id, doc.labo_id):
        raise HTTPException(status_code=403, detail="Accès refusé")

    stmt_pub = (
        select(MarketingDocumentPublication)
        .where(
            MarketingDocumentPublication.document_id == doc_id,
            MarketingDocumentPublication.status == MarketingPublicationStatus.READY,
        )
        .order_by(MarketingDocumentPublication.version.desc())
        .limit(1)
    )
    pub = (await session.execute(stmt_pub)).scalars().first()

    if pub:
        if not pub.annotation_locked_id:
            raise HTTPException(
                status_code=500,
                detail="Publication READY sans annotation_locked_id (incohérence: republish requis)",
            )

        locked = await session.get(MarketingDocumentAnnotation, int(pub.annotation_locked_id))
        if not locked or locked.status != MarketingAnnotationStatus.LOCKED:
            raise HTTPException(
                status_code=500,
                detail="Publication READY avec annotation_locked_id mais annotation LOCKED introuvable",
            )

        return {
            "draft": locked.data_json or {"pages": [], "_meta": {}},
            "draft_version": int(locked.draft_version or 1),
            "source": "locked",
            "published_version": int(pub.version or 0),
            "published_pdf_filename": str(pub.published_pdf_filename) if pub.published_pdf_filename else None,
            "published_at": pub.updated_at.isoformat() if pub.updated_at else None,
        }

    stmt_d = (
        select(MarketingDocumentAnnotation)
        .where(
            MarketingDocumentAnnotation.document_id == doc_id,
            MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
        )
        .limit(1)
    )
    anno = (await session.execute(stmt_d)).scalars().first()

    return {
        "draft": (anno.data_json if anno else {"pages": [], "_meta": {}}) or {"pages": [], "_meta": {}},
        "draft_version": int(anno.draft_version or 1) if anno else 1,
        "source": "draft",
        "published_version": None,
        "published_pdf_filename": None,
        "published_at": None,
    }


# ---------------------------------------------------------
# 5) bulk-info produits (prix/stock/tiers)
# ---------------------------------------------------------
class BulkInfoPayload(BaseModel):
    product_ids: List[int] = Field(default_factory=list)
    role: Optional[str] = None


def _to_product_item(p: Product) -> Dict[str, Any]:
    return {
        "id": int(p.id),
        "sku": p.sku,
        "name": p.name,
        "ean13": p.ean13,
        "price_ht": float(p.price_ht or 0),
        "stock": _maybe_int(getattr(p, "stock", None)),
        "is_active": bool(p.is_active),
        "image_url": p.image_url,
        "labo_id": int(p.labo_id or 0),
    }


@router.post("/marketing/products/bulk-info")
async def agent_bulk_info_products(
    payload: BulkInfoPayload,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    ids = [int(x) for x in (payload.product_ids or []) if int(x) > 0]
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {"products": [], "tiers": {}}

    stmt = (
        select(Product)
        .select_from(Product)
        .join(labo_agent, labo_agent.c.labo_id == Product.labo_id)
        .where(labo_agent.c.agent_id == agent.id)
        .where(Product.id.in_(ids))
    )
    products = (await session.execute(stmt)).scalars().all()

    products_by_id = {int(p.id): p for p in products}
    ok_ids = list(products_by_id.keys())

    tiers_map: Dict[int, list] = {}
    if ok_ids:
        stmt_t = (
            select(PriceTier)
            .where(PriceTier.product_id.in_(ok_ids))
            .order_by(PriceTier.product_id.asc(), PriceTier.qty_min.asc())
        )
        tiers = (await session.execute(stmt_t)).scalars().all()

        for t in tiers:
            pid = int(t.product_id)
            tiers_map.setdefault(pid, []).append(
                {"id": int(t.id), "qty_min": int(t.qty_min), "price_ht": float(t.price_ht or 0)}
            )

    return {
        "products": [_to_product_item(products_by_id[i]) for i in ok_ids],
        "tiers": tiers_map,
    }


# ---------------------------------------------------------
# 6) ✅ Download PDF modifié (vectoriel) pour l'agent
# ---------------------------------------------------------
@router.get("/marketing-documents/{doc_id}/download-rendered")
async def download_marketing_document_rendered_pdf(
    doc_id: int,
    debug: int = 0,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    Renvoie un PDF FINAL:
    - base = PDF publié READY si dispo, sinon PDF source
    - overlays = draft LOCKED si publié, sinon draft DRAFT
    - textes = vectoriels (sélectionnables) via PyMuPDF
    - typos = embarquées (TTF/OTF) depuis /app/media/marketing_documents/labo_{id}/fonts
    - coords = supporte x_rel/y_rel/w_rel/h_rel (prioritaire) + fallback px

    DEBUG:
      - ajouter ?debug=1 pour obtenir un JSON de diagnostic
    """
    try:
        doc = await session.get(MarketingDocument, doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document introuvable")

        if not await _agent_can_access_labo(session, agent.id, doc.labo_id):
            raise HTTPException(status_code=403, detail="Accès refusé")

        stmt_pub = (
            select(MarketingDocumentPublication)
            .where(
                MarketingDocumentPublication.document_id == doc_id,
                MarketingDocumentPublication.status == MarketingPublicationStatus.READY,
            )
            .order_by(MarketingDocumentPublication.version.desc())
            .limit(1)
        )
        pub = (await session.execute(stmt_pub)).scalars().first()

        is_published = False
        published_version: Optional[int] = None

        if pub and pub.status == MarketingPublicationStatus.READY and pub.published_pdf_filename:
            pdf_path = MEDIA_DIR / f"labo_{doc.labo_id}" / str(pub.published_pdf_filename)
            is_published = True
            published_version = int(pub.version or 0)
        else:
            pdf_path = MEDIA_DIR / f"labo_{doc.labo_id}" / str(doc.filename)

        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail=f"PDF introuvable: {pdf_path}")

        input_pdf_bytes = pdf_path.read_bytes()

        # 2) draft (LOCKED si publié, sinon DRAFT)
        draft: Dict[str, Any] = {"pages": [], "_meta": {}}

        if pub and getattr(pub, "annotation_locked_id", None):
            locked = await session.get(MarketingDocumentAnnotation, int(pub.annotation_locked_id))
            if locked and locked.status == MarketingAnnotationStatus.LOCKED:
                draft = (locked.data_json or {"pages": [], "_meta": {}}) or {"pages": [], "_meta": {}}
            else:
                stmt_d = select(MarketingDocumentAnnotation).where(
                    MarketingDocumentAnnotation.document_id == doc_id,
                    MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
                )
                anno = (await session.execute(stmt_d)).scalars().first()
                draft = (anno.data_json if anno else {"pages": [], "_meta": {}}) or {"pages": [], "_meta": {}}
        else:
            stmt_d = select(MarketingDocumentAnnotation).where(
                MarketingDocumentAnnotation.document_id == doc_id,
                MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
            )
            anno = (await session.execute(stmt_d)).scalars().first()
            draft = (anno.data_json if anno else {"pages": [], "_meta": {}}) or {"pages": [], "_meta": {}}

        # 3) produits + tiers
        product_ids = _collect_product_ids_from_draft(draft)

        products_by_id: Dict[int, Dict[str, Any]] = {}
        tiers_by_pid: Dict[int, list] = {}

        if product_ids:
            stmt_p = (
                select(Product)
                .select_from(Product)
                .join(labo_agent, labo_agent.c.labo_id == Product.labo_id)
                .where(labo_agent.c.agent_id == agent.id)
                .where(Product.id.in_(list(product_ids)))
            )
            products = (await session.execute(stmt_p)).scalars().all()

            for p in products:
                stock_val = _maybe_int(getattr(p, "stock", None))
                products_by_id[int(p.id)] = {
                    "id": int(p.id),
                    "sku": p.sku,
                    "name": p.name,
                    "ean13": p.ean13,
                    "price_ht": float(p.price_ht or 0),
                    "stock": stock_val,  # ✅ None allowed
                    "labo_id": int(p.labo_id or 0),
                }

            ok_ids = list(products_by_id.keys())
            if ok_ids:
                stmt_t = (
                    select(PriceTier)
                    .where(PriceTier.product_id.in_(ok_ids))
                    .order_by(PriceTier.product_id.asc(), PriceTier.qty_min.asc())
                )
                tiers = (await session.execute(stmt_t)).scalars().all()
                for t in tiers:
                    pid = int(t.product_id)
                    tiers_by_pid.setdefault(pid, []).append(
                        {"id": int(t.id), "qty_min": int(t.qty_min), "price_ht": float(t.price_ht or 0)}
                    )

        # ✅ PATCH: normalise + filtre badges rupture pour l’agent
        draft_for_render = _filter_and_normalize_draft_for_agent(draft, products_by_id)

        # 4) fonts du labo
        fonts_dir = Path(f"/app/media/marketing_fonts/labo_{int(doc.labo_id)}")

        stmt_fonts = (
            select(MarketingFont)
            .where(MarketingFont.labo_id == int(doc.labo_id))
            .order_by(MarketingFont.id.asc())
        )
        fonts = (await session.execute(stmt_fonts)).scalars().all()

        font_files = _build_font_files_from_db(list(fonts), fonts_dir)
        labo_fonts_by_id = _build_labo_fonts_by_id(list(fonts))

        # 4bis) ✅ global fonts
        stmt_gf = (
            select(GlobalFont)
            .where(GlobalFont.enabled == True)
            .order_by(GlobalFont.display_name.asc())
        )
        gfonts = (await session.execute(stmt_gf)).scalars().all()

        global_fonts_by_family = {}
        for gf in gfonts:
            fam_key = (getattr(gf, "family_key", None) or "").strip()
            fp = (getattr(gf, "file_path", None) or "").strip()
            if not fp:
                continue

            item = {"file_path": fp}

            if fam_key:
                global_fonts_by_family[fam_key] = item

            gid = int(getattr(gf, "id", 0) or 0)
            if gid > 0:
                global_fonts_by_family[f"GLOBAL_FONT_{gid}"] = item

        ctx = RenderContext(
            products_by_id=products_by_id,
            tiers_by_product_id=tiers_by_pid,
            font_files=font_files or None,
            fonts_dir=str(fonts_dir),
            labo_fonts_by_id=labo_fonts_by_id or None,
            global_fonts_by_family=global_fonts_by_family or None,
            is_agent=True,  # ✅ renderer force aussi is_agent=True, mais on le garde cohérent
        )

        # ✅ DEBUG: return JSON instead of PDF
        if debug:
            def pick_font_family(o: dict) -> Optional[str]:
                return (
                    o.get("fontFamily")
                    or o.get("font_family")
                    or o.get("font")
                    or o.get("family")
                    or (o.get("dynamic") or {}).get("fontFamily")
                    or (o.get("dynamic") or {}).get("font_family")
                )

            def pick_font_weight(o: dict) -> Optional[int]:
                w = (
                    o.get("fontWeight")
                    or o.get("font_weight")
                    or (o.get("dynamic") or {}).get("fontWeight")
                    or (o.get("dynamic") or {}).get("font_weight")
                )
                try:
                    return int(w) if w is not None and w != "" else None
                except Exception:
                    return None

            def extract_dynamic_overlays(d: dict) -> list:
                overlays = []
                for pi, page in enumerate(d.get("pages") or []):
                    if not isinstance(page, dict):
                        continue
                    for obj in (page.get("objects") or []):
                        if not isinstance(obj, dict):
                            continue
                        dyn = obj.get("dynamic") or {}
                        kind = dyn.get("kind") or obj.get("type")
                        dyn_kind = (obj.get("dynamic") or {}).get("kind") or obj.get("_dyn_kind")

                        # ✅ inclut product_ean
                        if kind in ("product_price", "product_stock_badge", "product_ean") or dyn_kind in (
                            "product_price",
                            "product_stock_badge",
                            "product_ean",
                        ):
                            overlays.append(
                                {
                                    "page": pi,
                                    "obj_id": obj.get("id"),
                                    "kind": kind,
                                    "product_id": dyn.get("product_id") or obj.get("product_id"),
                                    "price_mode": dyn.get("price_mode") or obj.get("price_mode"),
                                    "tier_id": dyn.get("tier_id") or obj.get("tier_id"),
                                    "mode_agent": dyn.get("mode_agent") or obj.get("mode_agent"),
                                    "mode_labo": dyn.get("mode_labo") or obj.get("mode_labo"),
                                    "text": dyn.get("text") or obj.get("text"),
                                    "obj_text": obj.get("text"),
                                    "fontFamily": pick_font_family(obj),
                                    "fontWeight": pick_font_weight(obj),
                                    "font_resolve": _debug_pick_font_path(obj, font_files or {}),
                                    "_dyn_kind": obj.get("_dyn_kind"),
                                }
                            )
                return overlays

            raw_overlays = extract_dynamic_overlays(draft)
            filtered_overlays = extract_dynamic_overlays(draft_for_render)

            resolved_raw = _debug_resolve_dynamic(draft, products_by_id, tiers_by_pid)
            resolved_filtered = _debug_resolve_dynamic(draft_for_render, products_by_id, tiers_by_pid)

            raw_pages = len(draft.get("pages") or [])
            raw_objs = sum(len((p.get("objects") or [])) for p in (draft.get("pages") or []) if isinstance(p, dict))
            fil_pages = len(draft_for_render.get("pages") or [])
            fil_objs = sum(
                len((p.get("objects") or [])) for p in (draft_for_render.get("pages") or []) if isinstance(p, dict)
            )

            def extract_stock_badges(d: dict) -> list:
                out = []
                for pi, page in enumerate(d.get("pages") or []):
                    if not isinstance(page, dict):
                        continue
                    for obj in (page.get("objects") or []):
                        if not isinstance(obj, dict):
                            continue

                        dyn = obj.get("dynamic") or {}
                        kind = dyn.get("kind") or obj.get("type")
                        if kind != "product_stock_badge":
                            continue

                        out.append(
                            {
                                "page": pi,
                                "obj_id": obj.get("id"),
                                "product_id": dyn.get("product_id") or obj.get("product_id"),
                                "text": dyn.get("text") or obj.get("text"),
                                "color": obj.get("color"),
                                "fontFamily": (obj.get("fontFamily") or obj.get("font_family") or dyn.get("fontFamily")),
                                "fontWeight": (
                                    obj.get("fontWeight") or obj.get("font_weight") or dyn.get("fontWeight")
                                ),
                                "bgEnabled": obj.get("bgEnabled"),
                                "bgMode": obj.get("bgMode"),
                                "bgColor": obj.get("bgColor"),
                                "borderEnabled": obj.get("borderEnabled"),
                                "borderColor": obj.get("borderColor"),
                                "borderWidth": obj.get("borderWidth"),
                                "rect_rel": {
                                    "x_rel": obj.get("x_rel"),
                                    "y_rel": obj.get("y_rel"),
                                    "w_rel": obj.get("w_rel"),
                                    "h_rel": obj.get("h_rel"),
                                },
                            }
                        )
                return out

            return JSONResponse(
                {
                    "doc_id": doc_id,
                    "labo_id": int(doc.labo_id),
                    "is_published": bool(is_published),
                    "published_version": published_version,
                    "pdf_path": str(pdf_path),
                    "product_ids_in_draft": sorted(list(product_ids)),
                    "counts": {
                        "raw_pages": raw_pages,
                        "raw_objects": raw_objs,
                        "filtered_pages": fil_pages,
                        "filtered_objects": fil_objs,
                        "raw_dynamic_overlays": len(raw_overlays),
                        "filtered_dynamic_overlays": len(filtered_overlays),
                    },
                    "products_by_id": products_by_id,
                    "tiers_by_pid": tiers_by_pid,
                    "dynamic_overlays_raw": raw_overlays,
                    "dynamic_overlays_filtered": filtered_overlays,
                    "resolved_raw": resolved_raw,
                    "resolved_filtered": resolved_filtered,
                    "font_files_sample_keys": sorted(list((font_files or {}).keys()))[:40],
                    "font_files_count": len(font_files or {}),
                    "stock_badges_raw": extract_stock_badges(draft),
                    "stock_badges_filtered": extract_stock_badges(draft_for_render),
                }
            )

        # ✅ render normal (avec draft_for_render)
        out_bytes = render_pdf_with_overlays(input_pdf_bytes, draft_for_render, ctx)

        base = _safe_filename(doc.title or doc.original_name or "document")
        suffix = f"v{published_version}" if is_published and published_version else "preview"
        filename = f"{base}_{suffix}.pdf"

        return StreamingResponse(
            BytesIO(out_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except HTTPException:
        raise
    except Exception as e:
        if debug:
            return JSONResponse(
                {
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                },
                status_code=500,
            )
        raise HTTPException(status_code=500, detail=f"Erreur génération PDF: {e}")

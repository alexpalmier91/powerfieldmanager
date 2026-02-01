# app/routers/labo_marketing_documents_api.py
from __future__ import annotations

from pathlib import Path
import uuid
import hashlib
import fitz  # PyMuPDF

import copy
import re
import traceback
from io import BytesIO
from typing import Any, Dict, Optional, Set, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import (
    MarketingDocument,
    MarketingDocumentAnnotation,
    MarketingAnnotationStatus,
    MarketingDocumentPublication,
    MarketingPublicationStatus,
    Product,
    PriceTier,
    MarketingFont,
)
from app.db.models import GlobalFont
from app.core.security import require_role

from app.services.storage import (
    store_temp_file,
    store_marketing_document,
    get_marketing_document_path,
    delete_marketing_document,
)

# ✅ PDF renderer (vectoriel)
from app.services.marketing_pdf_renderer import render_pdf_with_overlays, RenderContext

router = APIRouter(
    prefix="/api-zenhub/labo/marketing-documents",
    tags=["labo-marketing-documents"],
)

MAX_PDF_SIZE = 10 * 1024 * 1024  # 10MB

MEDIA_DIR = Path("/app/media/marketing_documents")


# ---------------------------------------------------------
# Helpers auth/context
# ---------------------------------------------------------
def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")

    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")

    try:
        return int(labo_id)
    except Exception:
        raise HTTPException(status_code=403, detail="Contexte labo invalide")


# ---------------------------------------------------------
# Helpers media url (comme agent)
# ---------------------------------------------------------
def _media_thumb_url(labo_id: int, thumb_filename: str) -> str:
    return f"/media/marketing_documents/labo_{labo_id}/{thumb_filename}"


def _media_pdf_url(labo_id: int, filename: str) -> str:
    return f"/media/marketing_documents/labo_{labo_id}/{filename}"


# ---------------------------------------------------------
# Thumb generator
# ---------------------------------------------------------
def _make_thumb_for_pdf(pdf_path: Path, out_png_path: Path, max_width: int = 320) -> int:
    """
    Génère une miniature PNG (page 1) avec PyMuPDF.
    Retourne page_count.
    """
    out_png_path.parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    try:
        page_count = int(doc.page_count or 0)
        if page_count <= 0:
            raise RuntimeError("PDF sans page")

        page = doc.load_page(0)

        pix0 = page.get_pixmap(alpha=False)
        w0 = pix0.width
        h0 = pix0.height
        if w0 <= 0:
            raise RuntimeError("Largeur pixmap invalide")

        scale = min(1.0, float(max_width) / float(w0))
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        print(
            f"[marketing_documents] thumb: base={w0}x{h0} -> final={pix.width}x{pix.height} (scale={scale:.4f})"
        )
        pix.save(str(out_png_path))
        return page_count
    finally:
        doc.close()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------
# Helpers (render LABO, aligné AGENT)
# ---------------------------------------------------------
def _to_int_or_none(v: Any) -> Optional[int]:
    try:
        if v is None or v == "":
            return None
        return int(v)
    except Exception:
        return None


def _maybe_int(v: Any) -> Optional[int]:
    """
    - si stock est NULL en BDD => None (inconnu), PAS 0
    """
    if v is None:
        return None
    try:
        return int(v)
    except Exception:
        return None


def _safe_filename(name: str) -> str:
    s = (name or "document").strip().lower()
    s = re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:80] or "document"


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



def _guess_weight_from_filename(filename: str) -> int:
    low = (filename or "").lower()
    if "bold" in low or "-bd" in low or "_bd" in low or "700" in low:
        return 700
    return 400


def _safe_family_name_from_font_id(font_id: int) -> str:
    return f"LABO_FONT_{int(font_id)}"


def _normalize_font_key_from_family(family: str, weight: int) -> str:
    fam = (family or "").strip().lower()
    fam = re.sub(r"\s+", " ", fam)
    return f"{fam}__{int(weight)}"


def _build_font_files_from_db(fonts: List["MarketingFont"], fonts_dir: Path) -> Dict[str, str]:
    """
    Mapping attendu par marketing_pdf_renderer:
      key = "<family>__<weight>" (family normalisé)
    On convertit woff2 -> ttf en cache local.
    """
    out: Dict[str, str] = {}

    cache_dir = fonts_dir / "_cache_ttf"
    cache_dir.mkdir(parents=True, exist_ok=True)

    def _add_family_keys(family_name: str, weight: int, path: Path):
        fam = (family_name or "").strip()
        if not fam:
            return

        out[_normalize_font_key_from_family(fam, weight)] = str(path)
        out[_normalize_font_key_from_family(fam, 0)] = str(path)

        # alias classiques
        out[_normalize_font_key_from_family(fam, 400)] = str(path)
        out[_normalize_font_key_from_family(fam, 700)] = str(path)

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

        original = (getattr(f, "original_name", None) or "").strip()
        nm = (getattr(f, "name", None) or "").strip()
        weight = _guess_weight_from_filename(original or nm or woff2_path.name)

        sha = (getattr(f, "sha256", None) or "").strip()
        ttf_name = f"{sha}.ttf" if sha else f"{woff2_path.stem}.ttf"
        ttf_path = cache_dir / ttf_name

        if (not ttf_path.exists()) or ttf_path.stat().st_size < 1000:
            try:
                _woff2_to_ttf(woff2_path, ttf_path)
            except Exception:
                continue

        # clé stable utilisée par le front: LABO_FONT_<id>
        family_labo = _safe_family_name_from_font_id(fid)
        _add_family_keys(family_labo, weight, ttf_path)

        # alias humain (optionnel)
        if nm:
            _add_family_keys(nm, weight, ttf_path)

    return out


def _build_labo_fonts_by_id(fonts: List["MarketingFont"]) -> Dict[int, Dict[str, Any]]:
    """
    Permet au renderer de résoudre LABO_FONT_<id> => chemin fichier.
    """
    out: Dict[int, Dict[str, Any]] = {}
    for f in fonts:
        fid = int(getattr(f, "id", 0) or 0)
        if fid <= 0:
            continue
        filename = (getattr(f, "filename", None) or "").strip()
        if not filename:
            continue
        out[fid] = {"ttf_path": filename, "path": filename}
    return out


def _camel_to_snake_dyn_keys(dyn: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalise les clés camelCase venant du front vers snake_case attendu backend.
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
    - support camelCase
    - product_id/tier_id en int
    """
    o = dict(obj or {})
    dyn = dict(o.get("dynamic") or {})

    dyn = _camel_to_snake_dyn_keys(dyn)

    # normalise camelCase au niveau racine (best effort)
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


def _normalize_draft_for_labo(draft: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(draft or {"pages": [], "_meta": {}})
    for page in (d.get("pages") or []):
        if not isinstance(page, dict):
            continue
        objs = page.get("objects") or []
        new_objs = []
        for obj in objs:
            if not isinstance(obj, dict):
                continue
            new_objs.append(_normalize_overlay_object_for_renderer(obj))
        page["objects"] = new_objs
    return d
    
    
def _filter_and_normalize_draft_for_labo(
    draft: Dict[str, Any],
    products_by_id: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Labo: on garde les overlays, MAIS on filtre les badges de stock quand ils sont
    configurés pour n'apparaître que si stock==0 (aligné agent).

    Règle:
      - mode = mode_labo si présent, sinon mode_agent, sinon "only_if_zero"
      - si mode in ("only_if_zero", "labo_only_if_zero", "agent_only_if_zero"):
            - stock None => on n'affiche pas (évite faux positifs)
            - stock > 0 => on n'affiche pas
    """
    d = copy.deepcopy(draft or {"pages": [], "_meta": {}})
    for page in (d.get("pages") or []):
        if not isinstance(page, dict):
            continue

        new_objs = []
        for obj in (page.get("objects") or []):
            if not isinstance(obj, dict):
                continue

            o = _normalize_overlay_object_for_renderer(obj)
            dyn = o.get("dynamic") or {}
            kind = (dyn.get("kind") or o.get("type") or "").strip()

            if kind == "product_stock_badge":
                pid = _to_int_or_none(dyn.get("product_id"))

                mode_labo = (dyn.get("mode_labo") or "").strip().lower()
                mode_agent = (dyn.get("mode_agent") or "").strip().lower()
                mode = mode_labo or mode_agent or "only_if_zero"

                if mode in ("only_if_zero", "labo_only_if_zero", "agent_only_if_zero"):
                    stock = None
                    if pid and pid in products_by_id:
                        stock = products_by_id[pid].get("stock", None)

                    # stock inconnu => on masque (évite "rupture" à tort)
                    if stock is None:
                        continue

                    try:
                        if int(stock) > 0:
                            continue
                    except Exception:
                        continue

                new_objs.append(o)
                continue

            new_objs.append(o)

        page["objects"] = new_objs
    return d
    


# ---------------------------------------------------------
# 1) LIST
#   ✅ renvoie thumb_url + pdf_url (comme agent)
# ---------------------------------------------------------
@router.get("")
async def list_marketing_documents(
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    stmt = (
        select(MarketingDocument)
        .where(MarketingDocument.labo_id == labo_id)
        .order_by(MarketingDocument.created_at.desc())
    )
    res = await session.execute(stmt)
    docs = res.scalars().all()

    out = []
    for d in docs:
        thumb_url = (
            _media_thumb_url(d.labo_id, d.thumb_filename)
            if getattr(d, "thumb_filename", None)
            else None
        )
        pdf_url = _media_pdf_url(d.labo_id, d.filename)

        out.append(
            {
                "id": d.id,
                "title": d.title,
                "doc_type": d.doc_type,
                "comment": d.comment,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "original_name": d.original_name,
                "thumb_filename": getattr(d, "thumb_filename", None),
                "page_count": getattr(d, "page_count", None),
                "source_sha256": getattr(d, "source_sha256", None),
                "thumb_url": thumb_url,
                "pdf_url": pdf_url,
            }
        )

    return out


# ---------------------------------------------------------
# 2) UPLOAD
# ---------------------------------------------------------
@router.post("")
async def upload_marketing_document(
    title: str = Form(...),
    comment: str = Form(""),
    doc_type: str = Form(None),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF uniquement (.pdf)")

    if file.content_type and file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="PDF uniquement")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > MAX_PDF_SIZE:
        raise HTTPException(status_code=400, detail="PDF trop volumineux (10 Mo max)")

    temp_path = store_temp_file(filename, content)

    try:
        stored_filename = store_marketing_document(
            labo_id=labo_id,
            original_filename=filename,
            temp_path=temp_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    doc = MarketingDocument(
        labo_id=labo_id,
        filename=stored_filename,
        original_name=filename,
        title=title.strip(),
        comment=(comment or "").strip() or None,
        doc_type=(doc_type or "").strip() or None,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    try:
        pdf_path = get_marketing_document_path(labo_id, stored_filename)

        thumb_filename = f"thumb_{uuid.uuid4().hex}.png"
        thumb_path = pdf_path.parent / thumb_filename

        page_count = _make_thumb_for_pdf(pdf_path, thumb_path, max_width=320)
        sha256 = _sha256_file(pdf_path)

        if hasattr(doc, "thumb_filename"):
            doc.thumb_filename = thumb_filename
        if hasattr(doc, "page_count"):
            doc.page_count = page_count
        if hasattr(doc, "source_sha256"):
            doc.source_sha256 = sha256

        session.add(doc)
        await session.commit()
        await session.refresh(doc)

    except Exception as e:
        print(f"[marketing_documents] thumbnail/meta failed: {repr(e)}")

    return {
        "ok": True,
        "id": doc.id,
        "thumb_filename": getattr(doc, "thumb_filename", None),
        "page_count": getattr(doc, "page_count", None),
        "source_sha256": getattr(doc, "source_sha256", None),
        "pdf_url": _media_pdf_url(labo_id, doc.filename),
        "thumb_url": _media_thumb_url(labo_id, doc.thumb_filename) if getattr(doc, "thumb_filename", None) else None,
    }


# ---------------------------------------------------------
# 3) VIEW-URL (comme agent) -> URL /media directe
# ---------------------------------------------------------
@router.get("/{doc_id}/view-url")
async def get_marketing_document_view_url_labo(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    doc = await session.get(MarketingDocument, doc_id)
    if not doc or doc.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")

    url = _media_pdf_url(doc.labo_id, doc.filename)
    return {"url": url}


# ---------------------------------------------------------
# 4) DOWNLOAD (PDF source)
# ---------------------------------------------------------
@router.get("/{doc_id}/download")
async def download_marketing_document_labo(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    doc = await session.get(MarketingDocument, doc_id)
    if not doc or doc.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")

    path = get_marketing_document_path(doc.labo_id, doc.filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    return FileResponse(path, media_type="application/pdf", filename=doc.original_name)


# ---------------------------------------------------------
# 5) DELETE
# ---------------------------------------------------------
@router.delete("/{doc_id}")
async def delete_marketing_document_labo(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    doc = await session.get(MarketingDocument, doc_id)
    if not doc or doc.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")

    # delete thumb (best effort)
    try:
        thumb = getattr(doc, "thumb_filename", None)
        if thumb:
            pdf_path = get_marketing_document_path(doc.labo_id, doc.filename)
            thumb_path = pdf_path.parent / thumb
            if thumb_path.exists():
                thumb_path.unlink()
    except Exception:
        pass

    # delete pdf (best effort)
    delete_marketing_document(doc.labo_id, doc.filename)

    await session.delete(doc)
    await session.commit()
    return {"ok": True}


# ---------------------------------------------------------
# 6) ✅ Download PDF rendu (vectoriel) pour le LABO
#    - base = PDF publié READY si dispo, sinon PDF source
#    - overlays = draft DRAFT (édition)
#    - typos LABO + GLOBAL embarquées
#    - dyn (prix/rupture) résolus via RenderContext (is_agent=False)
#    - DEBUG: ?debug=1 retourne JSON au lieu du PDF
# ---------------------------------------------------------
@router.get("/{doc_id}/download-rendered")
async def download_marketing_document_rendered_labo(
    doc_id: int,
    debug: int = 0,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    try:
        labo_id = _get_labo_id(user)

        doc = await session.get(MarketingDocument, doc_id)
        if not doc or int(doc.labo_id) != int(labo_id):
            raise HTTPException(status_code=404, detail="Document introuvable")

        # 1) base PDF : publié READY si dispo sinon source
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

        is_published = False
        published_version: Optional[int] = None

        if pub and pub.published_pdf_filename:
            pdf_path = MEDIA_DIR / f"labo_{doc.labo_id}" / str(pub.published_pdf_filename)
            is_published = True
            published_version = int(pub.version or 0)
        else:
            pdf_path = get_marketing_document_path(doc.labo_id, doc.filename)

        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail=f"PDF introuvable: {pdf_path}")

        input_pdf_bytes = pdf_path.read_bytes()

        # 2) draft (DRAFT)
        stmt_d = (
            select(MarketingDocumentAnnotation)
            .where(
                MarketingDocumentAnnotation.document_id == doc_id,
                MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
            )
            .limit(1)
        )
        anno = (await session.execute(stmt_d)).scalars().first()
        draft: Dict[str, Any] = (anno.data_json if anno else {"pages": [], "_meta": {}}) or {"pages": [], "_meta": {}}

        draft_norm = _normalize_draft_for_labo(draft)

# 3) produits + tiers (LABO)
        product_ids = _collect_product_ids_from_draft(draft_norm)

        products_by_id: Dict[int, Dict[str, Any]] = {}
        tiers_by_pid: Dict[int, list] = {}

        if product_ids:
            stmt_p = (
                select(Product)
                .where(Product.labo_id == int(labo_id))
                .where(Product.id.in_(list(product_ids)))
            )
            products = (await session.execute(stmt_p)).scalars().all()

            for p in products:
                products_by_id[int(p.id)] = {
                    "id": int(p.id),
                    "sku": p.sku,
                    "name": p.name,
                    "ean13": p.ean13,
                    "price_ht": float(p.price_ht or 0),
                    "stock": _maybe_int(getattr(p, "stock", None)),
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

        # ✅ filtre rupture aligné agent (stock>0 => masque)
        draft_for_render = _filter_and_normalize_draft_for_labo(draft_norm, products_by_id)





        # 4) fonts LABO
        fonts_dir = Path(f"/app/media/marketing_fonts/labo_{int(doc.labo_id)}")

        stmt_fonts = (
            select(MarketingFont)
            .where(MarketingFont.labo_id == int(doc.labo_id))
            .order_by(MarketingFont.id.asc())
        )
        fonts = (await session.execute(stmt_fonts)).scalars().all()

        font_files = _build_font_files_from_db(list(fonts), fonts_dir)
        labo_fonts_by_id = _build_labo_fonts_by_id(list(fonts))

        # 4bis) global fonts
        stmt_gf = (
            select(GlobalFont)
            .where(GlobalFont.enabled == True)
            .order_by(GlobalFont.display_name.asc())
        )
        gfonts = (await session.execute(stmt_gf)).scalars().all()

        global_fonts_by_family: Dict[str, Dict[str, Any]] = {}
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
            is_agent=False,  # ✅ LABO
        )
        ctx.is_agent = False

        if debug:
            return JSONResponse(
                {
                    "doc_id": doc_id,
                    "labo_id": int(labo_id),
                    "pdf_path": str(pdf_path),
                    "is_published": bool(is_published),
                    "published_version": published_version,
                    "product_ids_in_draft": sorted(list(product_ids)),
                    "products_count": len(products_by_id),
                    "tiers_count": sum(len(v) for v in tiers_by_pid.values()),
                    "font_files_count": len(font_files or {}),
                    "fonts_dir": str(fonts_dir),
                }
            )

        # 5) render
        out_bytes = render_pdf_with_overlays(input_pdf_bytes, draft_for_render, ctx)

        base = _safe_filename(doc.title or doc.original_name or "document")
        suffix = f"v{published_version}" if is_published and published_version else "preview"
        filename = f"{base}_{suffix}_labo.pdf"

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
                {"error": str(e), "traceback": traceback.format_exc()},
                status_code=500,
            )
        raise HTTPException(status_code=500, detail=f"Erreur génération PDF: {e}")

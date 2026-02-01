# app/services/marketing_pdf_renderer.py
from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover
    fitz = None

try:
    from PIL import Image
except Exception:
    Image = None

from urllib.parse import urlparse

import os
import requests

MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "/app/media")).resolve()
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")  # ex: https://zenhub.mondomaine.com

# ------------------------------------------------------------
# Colors
# ------------------------------------------------------------
def _clamp01(x: float) -> float:
    try:
        x = float(x)
    except Exception:
        return 1.0
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def _parse_css_color(color: str) -> Tuple[Tuple[float, float, float], float]:
    s = (color or "").strip()
    if not s:
        return (0.07, 0.09, 0.11), 1.0  # ~#111827

    low = s.lower()
    if low.startswith("rgba"):
        nums = re.findall(r"([0-9]*\.?[0-9]+)", s)
        if len(nums) >= 4:
            r = max(0, min(255, int(float(nums[0]))))
            g = max(0, min(255, int(float(nums[1]))))
            b = max(0, min(255, int(float(nums[2]))))
            a = _clamp01(float(nums[3]))
            return (r / 255.0, g / 255.0, b / 255.0), a
        return (0.07, 0.09, 0.11), 1.0

    if low.startswith("rgb"):
        nums = re.findall(r"([0-9]*\.?[0-9]+)", s)
        if len(nums) >= 3:
            r = max(0, min(255, int(float(nums[0]))))
            g = max(0, min(255, int(float(nums[1]))))
            b = max(0, min(255, int(float(nums[2]))))
            return (r / 255.0, g / 255.0, b / 255.0), 1.0
        return (0.07, 0.09, 0.11), 1.0

    if s.startswith("#"):
        s = s[1:]
    if len(s) == 3:
        s = "".join([c * 2 for c in s])
    if len(s) != 6:
        return (0.07, 0.09, 0.11), 1.0

    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (r / 255.0, g / 255.0, b / 255.0), 1.0
    except Exception:
        return (0.07, 0.09, 0.11), 1.0


# ------------------------------------------------------------
# Safe casts
# ------------------------------------------------------------
def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        v = float(x)
        if v != v:
            return default
        return v
    except Exception:
        return default


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except Exception:
        return default


# ------------------------------------------------------------
# Images
# ------------------------------------------------------------



def _iter_image_sources(obj: Dict[str, Any]) -> List[str]:
    """
    Retourne une liste ordonnée de sources à tester.
    """
    out: List[str] = []
    src = obj.get("src")
    if src:
        out.append(str(src))

    cands = obj.get("src_candidates") or obj.get("srcCandidates") or []
    if isinstance(cands, list):
        for u in cands:
            if u:
                out.append(str(u))

    # dedupe
    seen = set()
    uniq: List[str] = []
    for u in out:
        uu = str(u).strip()
        if not uu or uu in seen:
            continue
        seen.add(uu)
        uniq.append(uu)
    return uniq


def _bytes_looks_webp(b: bytes) -> bool:
    if not b or len(b) < 12:
        return False
    return b[:4] == b"RIFF" and b[8:12] == b"WEBP"


def _webp_to_png_bytes(webp_bytes: bytes) -> Optional[bytes]:
    if Image is None:
        return None
    try:
        from io import BytesIO
        im = Image.open(BytesIO(webp_bytes))
        im = im.convert("RGBA") if im.mode not in ("RGB", "RGBA") else im
        buf = BytesIO()
        im.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    except Exception:
        return None


def _sniff_image_kind(b: bytes) -> str:
    if not b or len(b) < 16:
        return ""
    head = b[:32]
    if head.startswith(b"\xFF\xD8\xFF"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return ""

def _try_webp_to_png(b: bytes) -> Optional[bytes]:
    # nécessite pillow avec support webp
    if Image is None:
        return None
    try:
        from io import BytesIO
        im = Image.open(BytesIO(b))
        im.load()
        im = im.convert("RGBA") if im.mode not in ("RGB", "RGBA") else im
        out = BytesIO()
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception:
        return None

def _bytes_is_definitely_image(b: bytes) -> bool:
    return _sniff_image_kind(b) in ("jpg", "png", "gif", "webp")



def _resolve_image_to_bytes(src: str, timeout_s: int = 12) -> bytes | None:
    """
    Résout une image depuis :
      - un chemin local (/app/... ou MEDIA_ROOT/...)
      - une URL relative /media/... (mappée vers MEDIA_ROOT)
      - une URL absolue https://TON_DOMAINE/media/... (mappée vers MEDIA_ROOT) ✅
      - une URL relative /... + PUBLIC_BASE_URL
      - une URL http(s) distante (avec headers + garde-fous)

    Retourne les bytes de l'image, sinon None.
    """
    if not src:
        return None

    s = str(src).strip()
    if not s:
        return None

    # ------------------------------------------------------------
    # 1) chemin local direct
    # ------------------------------------------------------------
    try:
        if s.startswith("/app/") or s.startswith(str(MEDIA_ROOT)):
            p = Path(s).resolve()
            if p.exists() and p.is_file():
                return p.read_bytes()
    except Exception:
        pass

    # ------------------------------------------------------------
    # 2) URL relative /media/... -> MEDIA_ROOT
    # ------------------------------------------------------------
    try:
        if s.startswith("/media/"):
            p = (MEDIA_ROOT / s[len("/media/"):]).resolve()
            # sécurité: empêche ../ de sortir du MEDIA_ROOT
            if str(p).startswith(str(MEDIA_ROOT)) and p.exists() and p.is_file():
                return p.read_bytes()
    except Exception:
        pass

    # ------------------------------------------------------------
    # ✅ 2bis) URL ABSOLUE vers NOTRE domaine + /media/... -> MEDIA_ROOT
    # (évite requests.get(https://...) et donc les timeouts Cloudflare)
    # ------------------------------------------------------------
    try:
        if s.startswith("http://") or s.startswith("https://"):
            u = urlparse(s)
            path = u.path or ""
            host = (u.netloc or "").lower()

            local_hosts = set()
            # PUBLIC_BASE_URL si défini
            if PUBLIC_BASE_URL:
                try:
                    local_hosts.add(urlparse(PUBLIC_BASE_URL).netloc.lower())
                except Exception:
                    pass

            # fallback domaines connus (au cas où)
            local_hosts.update({"www.powerfieldmanager.com", "powerfieldmanager.com"})

            if host in local_hosts and path.startswith("/media/"):
                p = (MEDIA_ROOT / path[len("/media/"):]).resolve()
                if str(p).startswith(str(MEDIA_ROOT)) and p.exists() and p.is_file():
                    return p.read_bytes()
    except Exception:
        pass

    # ------------------------------------------------------------
    # 3) URL relative /... + PUBLIC_BASE_URL -> URL absolue
    # ------------------------------------------------------------
    if s.startswith("/") and PUBLIC_BASE_URL:
        s = f"{PUBLIC_BASE_URL}{s}"

    # ------------------------------------------------------------
    # 4) fetch http(s)
    # ------------------------------------------------------------
    if s.startswith("http://") or s.startswith("https://"):
        try:
            r = requests.get(
                s,
                timeout=timeout_s,
                allow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (ZenHub PDF Renderer)",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": PUBLIC_BASE_URL or "https://www.powerfieldmanager.com",
                },
            )

            ctype = (r.headers.get("Content-Type") or "").lower().strip()
            content = r.content or b""
            clen = len(content)
            head = content[:24]

            print(
                "[PDF_RENDER][FETCH]",
                "url=", s,
                "status=", r.status_code,
                "ctype=", ctype,
                "len=", clen,
                "head=", head,
            )

            if r.status_code != 200 or not content:
                return None

            # signature
            head16 = content[:16]
            is_jpg = head16.startswith(b"\xFF\xD8\xFF")
            is_png = head16.startswith(b"\x89PNG\r\n\x1a\n")
            is_gif = head16.startswith(b"GIF87a") or head16.startswith(b"GIF89a")
            is_webp = head16.startswith(b"RIFF") and b"WEBP" in head16

            if is_jpg or is_png or is_gif or is_webp:
                return content

            # fallback via content-type uniquement si c'est bien image/*
            if ctype.startswith("image/"):
                return content

            # sinon => probablement HTML cloudflare / texte
            return None

        except Exception as e:
            print("[PDF_RENDER][FETCH] FAILED", "url=", s, "err=", type(e).__name__, str(e))
            return None

    return None







def _convert_webp_to_png_bytes(webp_bytes: bytes) -> Optional[bytes]:
    """
    Convertit WEBP -> PNG (bytes) si Pillow est dispo.
    Retourne None si conversion impossible.
    """
    try:
        from PIL import Image  # type: ignore
        from io import BytesIO
    except Exception:
        return None

    try:
        inp = BytesIO(webp_bytes)
        im = Image.open(inp)
        im.load()
        out = BytesIO()
        # PNG = support ultra-safe pour PyMuPDF
        im.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return None


def _pick_first_image_bytes_from_candidates(src_candidates: Any) -> Optional[bytes]:
    """
    src_candidates: list[str] (webp, jpg, thumb...)
    Retourne les bytes du premier qui marche.
    """
    if not isinstance(src_candidates, list):
        return None
    for u in src_candidates:
        b = _resolve_image_to_bytes(str(u or "").strip())
        if b:
            return b
    return None




def _parse_data_url(data_url: str) -> Optional[bytes]:
    """
    Accepte :
      - data:image/...;base64,XXXX
      - base64 pur (mais uniquement si ça ressemble VRAIMENT à du base64)
    Refuse :
      - URLs http(s)
      - chemins /media/...
      - strings trop courts / non base64
    """
    if not data_url:
        return None

    s = str(data_url).strip()
    if not s:
        return None

    # ✅ Cas data:...;base64,...
    if s.startswith("data:"):
        m = re.match(r"^data:.*?;base64,(.*)$", s, re.IGNORECASE | re.DOTALL)
        if not m:
            return None
        b64 = m.group(1).strip()
        try:
            return base64.b64decode(b64, validate=True)
        except Exception:
            return None

    # ✅ Si ça ressemble à une URL / chemin, on REFUSE ici
    low = s.lower()
    if low.startswith("http://") or low.startswith("https://") or s.startswith("/") or s.startswith("file:"):
        return None

    # ✅ Base64 pur : uniquement si ça ressemble à du base64
    ss = s.strip()
    if not re.match(r"^[A-Za-z0-9+/=\s]+$", ss):
        return None
    if len(ss) < 64:  # trop court => probablement pas une image
        return None

    try:
        return base64.b64decode(ss, validate=True)
    except Exception:
        return None




# ------------------------------------------------------------
# Price format
# ------------------------------------------------------------
def _format_eur_fr(value: Any) -> str:
    """
    ⚠️ Important: renvoie du vrai Unicode (NBSP + €) pour éviter le "Â" / "â¬".
    """
    n = _safe_float(value, default=float("nan"))
    if n != n:
        return "—"
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ") + " €"


def _normalize_price_text(s: str) -> str:
    """
    Corrige les dégâts d'encodage typiques :
      - "Â " (Â + NBSP) -> " "
      - "â¬" / "â‚¬" -> "€"
      - NBSP -> espace
    """
    if not s:
        return ""
    t = str(s)

    # NBSP -> espace
    t = t.replace("\u00A0", " ")

    # cas classique "Â " (Â + espace/NBSP déjà remplacé)
    t = t.replace("Â ", " ")
    t = t.replace("Â", "")

    # euro mal décodé
    t = t.replace("â‚¬", "€")
    t = t.replace("â¬", "€")

    # clean espaces
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _draw_textbox_fit_single_line(
    page: "fitz.Page",
    rect: "fitz.Rect",
    text: str,
    fontname: str,
    fontfile: Optional[str],
    fontsize_pt: float,
    color: Tuple[float, float, float],
    align: int = None,
) -> None:
    """
    Dessine une seule ligne dans rect en réduisant la taille jusqu'à ce que ça rentre.
    """
    if fitz is None:
        return

    txt = _normalize_price_text(text)
    if not txt:
        return

    # align par défaut centré
    if align is None:
        align = fitz.TEXT_ALIGN_CENTER

    fs = max(4.0, float(fontsize_pt or 12.0))
    # cap hauteur (sinon clipping vertical)
    fs = min(fs, max(4.0, rect.height * 0.80))

    # boucle auto-fit largeur
    for _ in range(18):
        w = _text_width_pt(txt, fs, fontname or "helv", fontfile)
        if w <= rect.width * 0.98:
            break
        fs = max(4.0, fs * 0.92)
        if fs <= 4.01:
            break

    kwargs: Dict[str, Any] = {
        "fontsize": fs,
        "color": color,
        "align": align,
    }
    if fontfile:
        kwargs["fontfile"] = fontfile
        if fontname:
            kwargs["fontname"] = fontname
    else:
        kwargs["fontname"] = fontname or "helv"

    page.insert_textbox(rect, txt, **kwargs)


# ------------------------------------------------------------
# Fonts (embedding)
# ------------------------------------------------------------
def _sanitize_font_family(f: Any) -> str:
    if not f:
        return ""
    return str(f).replace('"', "").replace("'", "").strip()


def _is_builtin_font_family(fam: str) -> bool:
    f = (fam or "").strip().lower()
    return f in ("", "default", "helv", "helvetica", "times", "times-roman", "cour", "courier")


def _normalize_builtin_fontname(fam: str) -> str:
    f = (fam or "").strip().lower()
    # On mappe tout ce qui est "par défaut" vers helv (safe PyMuPDF)
    if f in ("", "default", "helv", "helvetica"):
        return "helv"
    if f in ("times", "times-roman"):
        return "times"
    if f in ("cour", "courier"):
        return "cour"
    return "helv"


def _normalize_font_key(family: str, weight: int) -> str:
    fam = re.sub(r"\s+", " ", (family or "").strip().lower())
    return f"{fam}__{int(weight)}" if weight else f"{fam}__0"


def _find_euro_fallback_ttf() -> Optional[str]:
    """
    Cherche une police système quasi toujours présente en Linux et qui contient le glyph €.
    (DejaVu Sans est le meilleur choix par défaut).
    """
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for p in candidates:
        try:
            pp = Path(p)
            if pp.exists() and pp.is_file():
                return str(pp)
        except Exception:
            pass
    return None


def _register_font_by_file(page: "fitz.Page", doc: "fitz.Document", fontfile: str, cache: Dict[str, str]) -> str:
    """
    Enregistre un TTF/OTF dans le PDF et renvoie le fontname interne à réutiliser.
    """
    if fitz is None:
        return "helv"
    if not fontfile:
        return "helv"

    cache_key = f"FILE::{fontfile}"
    if cache_key in cache:
        return cache[cache_key]

    safe_name = re.sub(r"[^a-z0-9]+", "_", Path(fontfile).stem.lower())[:40] or "font"
    internal_name = f"zh_{safe_name}_euro"
    if internal_name in cache.values():
        internal_name = f"{internal_name}_{len(cache) + 1}"

    try:
        page.insert_font(fontname=internal_name, fontfile=fontfile)
        cache[cache_key] = internal_name
        return internal_name
    except Exception:
        try:
            if hasattr(doc, "insert_font"):
                doc.insert_font(fontname=internal_name, fontfile=fontfile)
                cache[cache_key] = internal_name
                return internal_name
        except Exception:
            pass

    return "helv"


def _y_baseline_for_rect(rect: "fitz.Rect") -> float:
    # baseline stable (évite clipping vertical). 0.72 marche bien en pratique.
    return rect.y0 + rect.height * 0.72


def _insert_text_single_line(
    page: "fitz.Page",
    x: float,
    y: float,
    text: str,
    fontname: str,
    fontsize: float,
    color: Tuple[float, float, float],
    fontfile: Optional[str] = None,
) -> None:
    if fitz is None or not text:
        return

    kwargs: Dict[str, Any] = {
        "fontsize": float(fontsize),
        "color": color,
    }
    if fontfile:
        kwargs["fontfile"] = fontfile
        if fontname:
            kwargs["fontname"] = fontname
    else:
        kwargs["fontname"] = fontname or "helv"

    page.insert_text((float(x), float(y)), text, **kwargs)


def _weight_bucket(font_weight: Any) -> int:
    w = str(font_weight or "").strip().lower()
    if w in ("bold", "bolder"):
        return 700
    if w in ("normal", "regular", ""):
        return 400
    try:
        n = int(float(w))
        return 700 if n >= 600 else 400
    except Exception:
        return 400


def _extract_labo_font_id(family: str) -> Optional[int]:
    fam = _sanitize_font_family(family)
    if not fam:
        return None
    m = re.match(r"^LABO_FONT_(\d+)$", fam.strip(), re.IGNORECASE)
    if not m:
        return None
    try:
        fid = int(m.group(1))
        return fid if fid > 0 else None
    except Exception:
        return None


def _is_global_family(family: str) -> bool:
    fam = _sanitize_font_family(family)
    return bool(re.match(r"^GLOBAL_FONT_[a-zA-Z0-9]+$", fam))


def _resolve_global_fontfile_path(family: str, ctx: "RenderContext") -> Optional[str]:
    fam = _sanitize_font_family(family)
    if not fam or not getattr(ctx, "global_fonts_by_family", None):
        return None

    info = (ctx.global_fonts_by_family or {}).get(fam) or {}
    p = info.get("file_path") or info.get("path")
    if not p:
        return None

    try:
        pp = Path(str(p))
        if pp.exists() and pp.is_file() and pp.suffix.lower() in (".ttf", ".otf"):
            return str(pp)
    except Exception:
        return None

    return None


def _guess_font_weight_from_path(path: str) -> int:
    low = (path or "").lower()
    if "bold" in low or "700" in low or "-bd" in low:
        return 700
    return 400


def _resolve_fontfile_path(family: str, weight: int, ctx: "RenderContext") -> Optional[str]:
    if fitz is None:
        return None

    fam = _sanitize_font_family(family)
    if not fam:
        return None

    # ✅ 1) GLOBAL fonts (superuser)
    gp = _resolve_global_fontfile_path(fam, ctx)
    if gp:
        return gp

    labo_font_id = _extract_labo_font_id(fam)
    if labo_font_id and ctx.labo_fonts_by_id:
        info = ctx.labo_fonts_by_id.get(int(labo_font_id)) or {}
        font_path = (
            info.get("ttf_path")
            or info.get("otf_path")
            or info.get("path")
            or info.get("file_path")
            or info.get("filename")
        )
        if font_path:
            try:
                p = Path(str(font_path))
                if not p.is_absolute() and ctx.fonts_dir:
                    p = Path(ctx.fonts_dir) / p
                if p.exists() and p.suffix.lower() in (".ttf", ".otf"):
                    return str(p)
            except Exception:
                pass

    if ctx.font_files:
        key = _normalize_font_key(fam, int(weight or 0))
        key_any = _normalize_font_key(fam, 0)
        p = ctx.font_files.get(key) or ctx.font_files.get(key_any)
        if p:
            try:
                pp = Path(str(p))
                if pp.exists() and pp.suffix.lower() in (".ttf", ".otf"):
                    return str(pp)
            except Exception:
                return None

    return None


def _register_font_if_needed(
    page: "fitz.Page",
    doc: "fitz.Document",
    family: str,
    weight: int,
    ctx: "RenderContext",
    cache: Dict[str, str],
) -> str:
    if fitz is None:
        return "helv"

    fam = _sanitize_font_family(family)
    if not fam:
        return "helv"

    fontfile = _resolve_fontfile_path(fam, weight, ctx)
    if not fontfile:
        return "helv"

    eff_weight = weight or _guess_font_weight_from_path(fontfile)
    cache_key = f"{fontfile}::{eff_weight}"
    if cache_key in cache:
        return cache[cache_key]

    safe_name = re.sub(r"[^a-z0-9]+", "_", fam.lower())[:40] or "font"
    internal_name = f"zh_{safe_name}_{eff_weight}"
    if internal_name in cache.values():
        internal_name = f"{internal_name}_{len(cache) + 1}"

    try:
        page.insert_font(fontname=internal_name, fontfile=fontfile)
        cache[cache_key] = internal_name
        return internal_name
    except Exception:
        try:
            if hasattr(doc, "insert_font"):
                doc.insert_font(fontname=internal_name, fontfile=fontfile)
                cache[cache_key] = internal_name
                return internal_name
        except Exception:
            pass
        return "helv"


# ------------------------------------------------------------
# Context
# ------------------------------------------------------------
@dataclass
class RenderContext:
    products_by_id: Dict[int, Dict[str, Any]]
    tiers_by_product_id: Dict[int, List[Dict[str, Any]]]
    font_files: Optional[Dict[str, str]] = None
    fonts_dir: Optional[str] = None
    labo_fonts_by_id: Optional[Dict[int, Dict[str, Any]]] = None

    # ✅ NEW : global fonts (family_key -> file_path)
    global_fonts_by_family: Optional[Dict[str, Dict[str, Any]]] = None

    is_agent: bool = False


def _resolve_dynamic_text(obj: Dict[str, Any], ctx: RenderContext) -> Optional[str]:
    dyn = obj.get("dynamic") or {}
    kind = (dyn.get("kind") or obj.get("type") or "").strip()

    # ✅ accepte aussi camelCase du front (productId, tierId, priceMode, modeAgent, modeLabo)
    def _dyn_get(*keys):
        for k in keys:
            if isinstance(dyn, dict) and k in dyn and dyn.get(k) is not None:
                return dyn.get(k)
        for k in keys:
            if k in obj and obj.get(k) is not None:
                return obj.get(k)
        return None

    # ------------------------------------------------------------
    # PRICE
    # ------------------------------------------------------------
    if kind == "product_price":
        pid = _safe_int(_dyn_get("product_id", "productId"), 0)
        if pid <= 0:
            return None

        price_mode = str(_dyn_get("price_mode", "priceMode") or "base").strip().lower()
        tier_id = _dyn_get("tier_id", "tierId")
        tier_id = _safe_int(tier_id, 0) if tier_id is not None else 0

        p = (ctx.products_by_id or {}).get(pid) or {}
        price_value = None

        if price_mode == "tier" and tier_id > 0:
            tiers = (ctx.tiers_by_product_id or {}).get(pid) or []
            t = next((x for x in tiers if _safe_int(x.get("id"), 0) == tier_id), None)
            if t and t.get("price_ht") is not None:
                price_value = t.get("price_ht")
        else:
            if p.get("price_ht") is not None:
                price_value = p.get("price_ht")

        return _format_eur_fr(price_value) if price_value is not None else "—"

    # ------------------------------------------------------------
    # STOCK BADGE
    # ------------------------------------------------------------
    if kind == "product_stock_badge":
        pid = _safe_int(_dyn_get("product_id", "productId"), 0)
        if pid <= 0:
            return None

        p = (ctx.products_by_id or {}).get(pid) or {}

        raw_stock = p.get("stock", None)
        stock: Optional[int] = None
        try:
            stock = int(raw_stock) if raw_stock is not None else None
        except Exception:
            stock = None

        text = str(_dyn_get("text") or "Rupture de stock")
        mode_agent = str(_dyn_get("mode_agent", "modeAgent") or "only_if_zero").strip().lower()

        # ✅ AGENT ONLY : ne rien afficher si stock > 0
        if getattr(ctx, "is_agent", False):
            if mode_agent == "never":
                return None
            if mode_agent == "always":
                return text

            if stock is None:
                return None
            return text if stock == 0 else None

        # ✅ LABO / autres : on ne change rien (affiche le texte)
        return text

    # ------------------------------------------------------------
    # PRODUCT EAN (ean13)
    # ------------------------------------------------------------
    if kind == "product_ean":
        pid = _safe_int(_dyn_get("product_id", "productId"), 0)
        if pid <= 0:
            return None

        p = (ctx.products_by_id or {}).get(pid) or {}

        ean = None
        if isinstance(p, dict):
            ean = p.get("ean13") or p.get("ean") or p.get("barcode") or p.get("ean_code")

        ean_str = str(ean).strip() if ean is not None else ""
        if not ean_str or ean_str.lower() in ("none", "null", "—", "-"):
            return None
        return ean_str


# ------------------------------------------------------------
# Prix: rendu "entiers +2pt vs décimales" + € toujours OK
# ------------------------------------------------------------
def _split_price_fr(price_txt: str) -> Tuple[str, str]:
    s = (price_txt or "").strip()
    if not s:
        return "", ""
    if "," in s:
        a, b = s.split(",", 1)
        return a.strip(), "," + b.strip()
    return s, ""


def _split_price_fr_parts(price_txt: str) -> Tuple[str, str, str]:
    s = (price_txt or "").strip()
    if not s:
        return "", "", ""

    if "," not in s:
        return s, "", ""

    a, rest = s.split(",", 1)
    a = a.strip()
    rest = rest.strip()

    idx = rest.find("€")
    if idx >= 0:
        left = rest[:idx].strip()
        eur = rest[idx:].strip()
        eur = (" " + eur) if not eur.startswith(" ") else eur
        b_num = "," + left
        b_eur = eur
        return a, b_num, b_eur

    return a, "," + rest, ""


def _text_width_pt(text: str, fontsize: float, fontname: str, fontfile: Optional[str]) -> float:
    if fitz is None:
        return 0.0
    txt = text or ""
    if not txt:
        return 0.0

    if fontfile:
        try:
            f = fitz.Font(fontfile=fontfile)
            return float(f.text_length(txt, fontsize=fontsize))
        except Exception:
            pass

    try:
        return float(fitz.get_text_length(txt, fontname=fontname or "helv", fontsize=fontsize))
    except Exception:
        try:
            return float(fitz.get_text_length(txt, fontname="helv", fontsize=fontsize))
        except Exception:
            return 0.0


def _draw_text_centered_line(
    page: "fitz.Page",
    rect: "fitz.Rect",
    text: str,
    fontname: str,
    fontsize: float,
    color: Tuple[float, float, float],
    align: int,
    fontfile: Optional[str] = None,
) -> None:
    kwargs: Dict[str, Any] = {
        "fontsize": fontsize,
        "color": color,
        "align": align,
    }

    if fontfile:
        kwargs["fontfile"] = fontfile
        if fontname:
            kwargs["fontname"] = fontname
    else:
        kwargs["fontname"] = fontname or "helv"

    page.insert_textbox(rect, text, **kwargs)


def _draw_price_mixed_sizes(
    page: "fitz.Page",
    rect: "fitz.Rect",
    price_txt: str,
    fontname_main: str,
    fontfile_main: Optional[str],
    fontname_safe: str,
    font_size_pt: float,
    color: Tuple[float, float, float],
    euros_plus_pt: float = 2.0,
) -> None:
    if fitz is None:
        return

    s = (price_txt or "").strip()
    if not s:
        return

    EURO_FONTFILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    euro_fontfile = EURO_FONTFILE if Path(EURO_FONTFILE).exists() else None
    euro_fontname = "dejavu" if euro_fontfile else (fontname_safe or "helv")

    if "," not in s:
        _insert_text_single_line(
            page=page,
            x=rect.x0 + 1.0,
            y=_y_baseline_for_rect(rect),
            text=s,
            fontname=fontname_main or "helv",
            fontsize=max(4.0, float(font_size_pt)),
            color=color,
            fontfile=fontfile_main,
        )
        return

    a, rest = s.split(",", 1)
    a = a.strip()
    rest = rest.strip()

    euro_idx = rest.find("€")
    if euro_idx >= 0:
        dec_part = rest[:euro_idx].strip()
        b_num = "," + dec_part if dec_part else ""
        b_eur = " €"
    else:
        b_num = "," + rest if rest else ""
        b_eur = ""

    if not a and not b_num and not b_eur:
        return

    fs_big = max(4.0, float(font_size_pt) + float(euros_plus_pt))
    fs_small = max(4.0, float(font_size_pt))

    max_fs_by_h = max(4.0, rect.height * 0.80)
    if fs_big > max_fs_by_h:
        ratio = max_fs_by_h / fs_big
        fs_big = max_fs_by_h
        fs_small = max(4.0, fs_small * ratio)

    for _ in range(18):
        w_a = _text_width_pt(a, fs_big, fontname_main or "helv", fontfile_main) if a else 0.0
        w_bn = _text_width_pt(b_num, fs_small, fontname_main or "helv", fontfile_main) if b_num else 0.0
        w_be = _text_width_pt(b_eur, fs_small, euro_fontname or "helv", euro_fontfile) if b_eur else 0.0

        total = w_a + w_bn + w_be
        if total > 0 and total <= rect.width * 0.98:
            break

        fs_big = max(4.0, fs_big * 0.92)
        fs_small = max(4.0, fs_small * 0.92)
        if fs_big <= 4.01 and fs_small <= 4.01:
            break

    w_a = _text_width_pt(a, fs_big, fontname_main or "helv", fontfile_main) if a else 0.0
    w_bn = _text_width_pt(b_num, fs_small, fontname_main or "helv", fontfile_main) if b_num else 0.0
    w_be = _text_width_pt(b_eur, fs_small, euro_fontname or "helv", euro_fontfile) if b_eur else 0.0
    total = w_a + w_bn + w_be

    if total <= 0:
        _insert_text_single_line(
            page=page,
            x=rect.x0 + 1.0,
            y=_y_baseline_for_rect(rect),
            text=s,
            fontname="helv",
            fontsize=fs_small,
            color=color,
            fontfile=None,
        )
        return

    x0 = rect.x0 + (rect.width - total) / 2.0
    y0 = _y_baseline_for_rect(rect)

    if a:
        _insert_text_single_line(
            page=page,
            x=x0,
            y=y0,
            text=a,
            fontname=fontname_main or "helv",
            fontsize=fs_big,
            color=color,
            fontfile=fontfile_main,
        )

    if b_num:
        _insert_text_single_line(
            page=page,
            x=x0 + w_a,
            y=y0,
            text=b_num,
            fontname=fontname_main or "helv",
            fontsize=fs_small,
            color=color,
            fontfile=fontfile_main,
        )

    if b_eur:
        _insert_text_single_line(
            page=page,
            x=x0 + w_a + w_bn,
            y=y0,
            text=b_eur,
            fontname=euro_fontname or "helv",
            fontsize=fs_small,
            color=color,
            fontfile=euro_fontfile,
        )


# ------------------------------------------------------------
# Robust coord mapping:
# ------------------------------------------------------------
def _get_viewport_base_px_and_scale(draft: Dict[str, Any]) -> Tuple[float, float, float]:
    meta = (draft.get("_meta") or {}) if isinstance(draft, dict) else {}
    s = _safe_float(meta.get("pdf_scale"), 1.0)
    if s <= 0:
        s = 1.0
    bw = _safe_float(meta.get("pdf_base_width"), 0.0)
    bh = _safe_float(meta.get("pdf_base_height"), 0.0)
    return bw, bh, s


def _has_rel(obj: Dict[str, Any]) -> bool:
    try:
        return (
            obj.get("x_rel") is not None
            and obj.get("y_rel") is not None
            and obj.get("w_rel") is not None
            and obj.get("h_rel") is not None
        )
    except Exception:
        return False


def _map_rect_rel_to_page_pt(
    x_rel: float,
    y_rel: float,
    w_rel: float,
    h_rel: float,
    page_w_pt: float,
    page_h_pt: float,
) -> Optional["fitz.Rect"]:
    if w_rel <= 0 or h_rel <= 0:
        return None

    xr = max(0.0, min(1.0, float(x_rel)))
    yr = max(0.0, min(1.0, float(y_rel)))
    wr = max(0.0, min(1.0, float(w_rel)))
    hr = max(0.0, min(1.0, float(h_rel)))

    x_pt = xr * page_w_pt
    y_pt = yr * page_h_pt
    w_pt = wr * page_w_pt
    h_pt = hr * page_h_pt

    if w_pt <= 0 or h_pt <= 0:
        return None
    return fitz.Rect(x_pt, y_pt, x_pt + w_pt, y_pt + h_pt)


def _get_obj_page_box_px(obj: Dict[str, Any]) -> Tuple[float, float]:
    pb = obj.get("page_box") if isinstance(obj, dict) else None
    if isinstance(pb, dict):
        ow = _safe_float(pb.get("w"), 0.0)
        oh = _safe_float(pb.get("h"), 0.0)
        if ow > 0 and oh > 0:
            return ow, oh

    ow2 = _safe_float(obj.get("page_box_w"), 0.0)
    oh2 = _safe_float(obj.get("page_box_h"), 0.0)
    if ow2 > 0 and oh2 > 0:
        return ow2, oh2

    return 0.0, 0.0


def _map_rect_px_to_page_pt(
    x_px: float,
    y_px: float,
    w_px: float,
    h_px: float,
    page_w_pt: float,
    page_h_pt: float,
    base_w_px: float,
    base_h_px: float,
    pdfjs_scale: float,
) -> Optional["fitz.Rect"]:
    if w_px <= 0 or h_px <= 0:
        return None

    if base_w_px > 0 and base_h_px > 0:
        vp_w_px = base_w_px * pdfjs_scale
        vp_h_px = base_h_px * pdfjs_scale
        if vp_w_px <= 0 or vp_h_px <= 0:
            return None

        rx = page_w_pt / vp_w_px
        ry = page_h_pt / vp_h_px

        x_pt = x_px * rx
        y_pt = y_px * ry
        w_pt = w_px * rx
        h_pt = h_px * ry

        return fitz.Rect(x_pt, y_pt, x_pt + w_pt, y_pt + h_pt)

    CSS_PX_TO_PT = 72.0 / 96.0
    s = max(pdfjs_scale, 1e-6)
    x_pt = (x_px * CSS_PX_TO_PT) / s
    y_pt = (y_px * CSS_PX_TO_PT) / s
    w_pt = (w_px * CSS_PX_TO_PT) / s
    h_pt = (h_px * CSS_PX_TO_PT) / s
    return fitz.Rect(x_pt, y_pt, x_pt + w_pt, y_pt + h_pt)


def _font_px_to_pt(
    font_size_px: float,
    page_h_pt: float,
    obj_page_box_h_px: float,
    base_h_px: float,
    pdfjs_scale: float,
) -> float:
    fs_px = max(1.0, float(font_size_px or 16.0))

    if obj_page_box_h_px > 0:
        ry = page_h_pt / max(obj_page_box_h_px, 1e-6)
        return max(4.0, fs_px * ry)

    if base_h_px > 0:
        vp_h_px = base_h_px * pdfjs_scale
        ry = page_h_pt / max(vp_h_px, 1e-6)
        return max(4.0, fs_px * ry)

    return max(4.0, (fs_px * (72.0 / 96.0)) / max(pdfjs_scale, 1e-6))


def _border_px_to_pt(
    bw_px: float,
    page_w_pt: float,
    obj_page_box_w_px: float,
    base_w_px: float,
    pdfjs_scale: float,
) -> float:
    bw = max(0.0, float(bw_px or 1.0))

    if obj_page_box_w_px > 0:
        rx = page_w_pt / max(obj_page_box_w_px, 1e-6)
        return max(0.25, bw * rx)

    if base_w_px > 0:
        vp_w_px = base_w_px * pdfjs_scale
        rx = page_w_pt / max(vp_w_px, 1e-6)
        return max(0.25, bw * rx)

    return max(0.25, (bw * (72.0 / 96.0)) / max(pdfjs_scale, 1e-6))


# ------------------------------------------------------------
# Text rendering helpers
# ------------------------------------------------------------
def _is_text_like_type(t: Any) -> bool:
    low = str(t or "").strip().lower()
    return low in (
        "text",
        "textbox",
        "i-text",
        "itext",
        "i_text",
        "fabrictextbox",
        "fabric_textbox",
        "product_price",
        "product_stock_badge",
    )


def _insert_textbox_autofit(
    page: "fitz.Page",
    rect: "fitz.Rect",
    text: str,
    kwargs: Dict[str, Any],
    min_fs: float = 4.0,
    max_iter: int = 12,
) -> None:
    if fitz is None:
        return

    fs = float(kwargs.get("fontsize") or 12.0)
    fs = max(min_fs, fs)

    for _ in range(max_iter):
        kwargs["fontsize"] = fs
        try:
            rc = page.insert_textbox(rect, text, **kwargs)
        except Exception:
            rc = 0
        try:
            if isinstance(rc, (int, float)) and rc >= 0:
                return
            if not isinstance(rc, (int, float)):
                return
        except Exception:
            return

        fs = fs * 0.9
        if fs < min_fs:
            break

    kwargs["fontsize"] = max(min_fs, fs)
    try:
        page.insert_textbox(rect, text, **kwargs)
    except Exception:
        pass


def _append_blank_pages_from_draft(doc: "fitz.Document", draft: Dict[str, Any]) -> int:
    """
    Crée dans le PDF des pages blanches correspondant à draft["appended_pages"].
    """
    if fitz is None:
        return 0

    appended = draft.get("appended_pages") or []
    if not isinstance(appended, list) or not appended:
        return 0

    added = 0
    for meta in appended:
        if not isinstance(meta, dict):
            continue

        w = _safe_float(meta.get("width"), 595.28)
        h = _safe_float(meta.get("height"), 841.89)
        rot = _safe_int(meta.get("rotate"), 0) % 360

        try:
            p = doc.new_page(-1, width=float(w), height=float(h))
            if rot:
                try:
                    p.set_rotation(rot)
                except Exception:
                    pass
            added += 1
        except Exception:
            continue

    return added
    
    
# ------------------------------------------------------------
# Shapes rendering helpers (rect / roundrect / line + gradient)
# ------------------------------------------------------------

# ------------------------------------------------------------
# Clip-mask helpers
# ------------------------------------------------------------
def _is_clip_shape(obj: Dict[str, Any]) -> bool:
    """
    Détecte un "shape clip mask" (rectangle/roundrect avec image à l'intérieur).
    Supporte plusieurs conventions de front.
    """
    if not isinstance(obj, dict):
        return False

    # champs explicites
    if obj.get("isClip") is True or obj.get("clipMask") is True or obj.get("clip_mask") is True:
        return True

    # "kind/type" spécifiques
    t = str(obj.get("type") or "").strip().lower()
    k = str(obj.get("kind") or obj.get("shape") or "").strip().lower()
    if t in ("clip", "clipshape", "clip_shape", "shape_clip", "mask") or k in ("clip", "mask", "clipshape"):
        return True

    # payload "clip" avec une image
    clip = obj.get("clip") or obj.get("mask") or obj.get("clipData") or obj.get("clip_data")
    if isinstance(clip, dict):
        if clip.get("src") or clip.get("image") or clip.get("url"):
            return True
        cands = clip.get("src_candidates") or clip.get("srcCandidates") or clip.get("candidates")
        if isinstance(cands, list) and any(str(x or "").strip() for x in cands):
            return True

    # fallback: propriétés dédiées "clipSrc"
    if obj.get("clipSrc") or obj.get("clip_src") or obj.get("maskSrc") or obj.get("mask_src"):
        return True

    return False


def _clip_image_sources(obj: Dict[str, Any]) -> List[str]:
    """
    Retourne la liste ordonnée de sources (src + candidates) pour l'image du clip.
    Priorise les champs "clip" si présents.
    """
    out: List[str] = []
    if not isinstance(obj, dict):
        return out

    clip = obj.get("clip") or obj.get("mask") or obj.get("clipData") or obj.get("clip_data")
    if isinstance(clip, dict):
        for k in ("src", "image", "url"):
            v = clip.get(k)
            if v:
                out.append(str(v))

        cands = clip.get("src_candidates") or clip.get("srcCandidates") or clip.get("candidates") or []
        if isinstance(cands, list):
            for u in cands:
                if u:
                    out.append(str(u))

    # champs plats fallback
    for k in ("clipSrc", "clip_src", "maskSrc", "mask_src"):
        v = obj.get(k)
        if v:
            out.append(str(v))

    # compat: réutilise les mêmes champs que les images normales si ton front les remplit
    for u in _iter_image_sources(obj):
        out.append(u)

    # dedupe
    seen = set()
    uniq: List[str] = []
    for u in out:
        s = str(u or "").strip()
        if not s or s in seen:
            continue
        seen.add(s)
        uniq.append(s)
    return uniq


def _clip_transform(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Récupère scale + offsets pour déplacer/redimensionner l'image dans le masque.
    - scale: multiplicateur utilisateur (1.0 = cover de base)
    - offsetX / offsetY: translation en pixels (dans l'espace du raster final)
    """
    if not isinstance(obj, dict):
        return {"scale": 1.0, "offsetX": 0.0, "offsetY": 0.0}

    clip = obj.get("clip") or obj.get("mask") or obj.get("clipData") or obj.get("clip_data")
    tr = None
    if isinstance(clip, dict):
        tr = clip.get("transform") or clip.get("tr") or clip.get("view") or clip.get("viewport")

    if not isinstance(tr, dict):
        tr = obj.get("clipTransform") or obj.get("clip_transform") or obj.get("transform") or {}

    if not isinstance(tr, dict):
        tr = {}

    scale = _safe_float(tr.get("scale") or tr.get("zoom") or obj.get("clipScale") or obj.get("clip_scale") or 1.0, 1.0)
    offx = _safe_float(tr.get("offsetX") or tr.get("x") or obj.get("clipOffsetX") or obj.get("clip_offset_x") or 0.0, 0.0)
    offy = _safe_float(tr.get("offsetY") or tr.get("y") or obj.get("clipOffsetY") or obj.get("clip_offset_y") or 0.0, 0.0)

    # garde-fous (évite les valeurs absurdes)
    if scale <= 0:
        scale = 1.0
    scale = max(0.05, min(scale, 20.0))
    offx = max(-50000.0, min(offx, 50000.0))
    offy = max(-50000.0, min(offy, 50000.0))

    return {"scale": float(scale), "offsetX": float(offx), "offsetY": float(offy)}


def _render_clip_mask_image_png(
    img_bytes: bytes,
    out_w_px: int,
    out_h_px: int,
    scale: float = 1.0,
    offset_x_px: float = 0.0,
    offset_y_px: float = 0.0,
    radius_px: int = 0,
) -> Optional[bytes]:
    """
    Rend une image "cover" + transform (scale/offset) dans un canvas out_w/out_h.
    Retourne un PNG RGBA (bytes). Utilise Pillow.
    """
    if Image is None:
        return None

    try:
        from io import BytesIO
        from PIL import ImageDraw  # type: ignore
    except Exception:
        return None

    if not img_bytes or out_w_px <= 1 or out_h_px <= 1:
        return None

    out_w_px = int(max(2, out_w_px))
    out_h_px = int(max(2, out_h_px))
    scale = float(scale if scale else 1.0)
    scale = max(0.05, min(scale, 20.0))

    try:
        im = Image.open(BytesIO(img_bytes))
        im.load()
        im = im.convert("RGBA") if im.mode != "RGBA" else im
    except Exception:
        return None

    iw, ih = im.size
    if iw <= 1 or ih <= 1:
        return None

    # --- base "cover" scale pour remplir le masque
    base = max(out_w_px / float(iw), out_h_px / float(ih))
    s = base * scale

    new_w = int(max(1, round(iw * s)))
    new_h = int(max(1, round(ih * s)))

    # resize
    try:
        im2 = im.resize((new_w, new_h), resample=getattr(Image, "LANCZOS", 1))
    except Exception:
        im2 = im.resize((new_w, new_h))

    # canvas de sortie
    canvas = Image.new("RGBA", (out_w_px, out_h_px), (0, 0, 0, 0))

    # position: centrée + offsets user
    # offsets exprimés en px du canvas final (tu les multiplies déjà par raster_scale côté appelant)
    x = int(round((out_w_px - new_w) / 2.0 + float(offset_x_px or 0.0)))
    y = int(round((out_h_px - new_h) / 2.0 + float(offset_y_px or 0.0)))

    # paste
    try:
        canvas.alpha_composite(im2, dest=(x, y))
    except Exception:
        # vieux Pillow: fallback paste avec masque alpha
        canvas.paste(im2, (x, y), im2)

    # arrondis (alpha mask)
    if radius_px and radius_px > 0:
        rad = int(max(0, min(int(radius_px), min(out_w_px, out_h_px) // 2)))
        mask = Image.new("L", (out_w_px, out_h_px), 0)
        draw = ImageDraw.Draw(mask)
        try:
            draw.rounded_rectangle([0, 0, out_w_px - 1, out_h_px - 1], radius=rad, fill=255)
        except Exception:
            draw.rectangle([0, 0, out_w_px - 1, out_h_px - 1], fill=255)
        canvas.putalpha(mask)

    # encode PNG
    try:
        buf = BytesIO()
        canvas.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    except Exception:
        return None



def _is_shape_like(obj: Dict[str, Any]) -> bool:
    t = str(obj.get("type") or "").strip().lower()
    if t in ("rect", "roundrect", "roundedrect", "line", "shape"):
        return True
    # certains drafts stockent "kind" ou "shape"
    k = str(obj.get("kind") or obj.get("shape") or "").strip().lower()
    return k in ("rect", "roundrect", "roundedrect", "line", "shape")


def _shape_kind(obj: Dict[str, Any]) -> str:
    t = str(obj.get("type") or "").strip().lower()
    k = str(obj.get("kind") or obj.get("shape") or "").strip().lower()

    # priorité aux champs explicites
    for v in (t, k):
        if v in ("line",):
            return "line"
        if v in ("roundrect", "roundedrect"):
            return "roundrect"
        if v in ("rect",):
            return "rect"

    # fallback : si "shape" => rect
    if t == "shape" or k == "shape":
        return "rect"

    return "rect"


def _safe_color_and_opacity(css: Any, default: str) -> Tuple[Tuple[float, float, float], float]:
    rgb, a = _parse_css_color(str(css or default))
    return rgb, _clamp01(a)


def _get_shape_layer(obj: Dict[str, Any]) -> str:
    # layer peut venir du front sous plusieurs formes
    v = obj.get("layer") or obj.get("z") or obj.get("plane") or obj.get("plan") or obj.get("layerName")
    s = str(v or "").strip().lower()
    return "back" if s in ("back", "background", "arriere", "arrière") else "front"


def _get_shape_fill_mode(obj: Dict[str, Any]) -> str:
    # compat : fillType / bgType / shapeFillType
    v = obj.get("fillType") or obj.get("shapeFillType") or obj.get("bgType") or obj.get("fill_mode")
    s = str(v or "solid").strip().lower()
    return "gradient" if s == "gradient" else "solid"


def _get_shape_radius_px(obj: Dict[str, Any]) -> float:
    # compat : radius / borderRadius / rx
    return _safe_float(obj.get("radius") or obj.get("borderRadius") or obj.get("rx") or 0.0, 0.0)


def _get_shape_stroke_width_px(obj: Dict[str, Any]) -> float:
    return _safe_float(obj.get("strokeWidth") or obj.get("borderWidth") or obj.get("shapeStrokeWidth") or 0.0, 0.0)


def _get_shape_stroke_color(obj: Dict[str, Any]) -> str:
    return str(obj.get("stroke") or obj.get("strokeColor") or obj.get("borderColor") or obj.get("shapeStroke") or "#111827")


def _get_shape_fill_color(obj: Dict[str, Any]) -> str:
    return str(obj.get("fill") or obj.get("fillColor") or obj.get("shapeFill") or "#ffffff")


def _get_shape_gradient(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalise un gradient venant du front.
    On supporte:
      - obj["gradient"] = {type, angle, color1, pos1, color2, pos2}
      - ou champs plats: gradType/shapeGradType, gradAngle, gradColor1/2, gradPos1/2
    """
    g = obj.get("gradient")
    if isinstance(g, dict):
        out = dict(g)
    else:
        out = {}

    def _get(*keys, default=None):
        for k in keys:
            if k in obj and obj.get(k) is not None:
                return obj.get(k)
        for k in keys:
            if isinstance(g, dict) and k in g and g.get(k) is not None:
                return g.get(k)
        return default

    out["type"] = str(_get("gradType", "shapeGradType", "shapeGradientType", default="linear") or "linear").strip().lower()
    out["angle"] = _safe_float(_get("gradAngle", "shapeGradAngle", default=0), 0.0)

    out["color1"] = str(_get("gradColor1", "shapeGradColor1", default="#ff0000"))
    out["pos1"] = _safe_int(_get("gradPos1", "shapeGradPos1", default=0), 0)

    out["color2"] = str(_get("gradColor2", "shapeGradColor2", default="#0000ff"))
    out["pos2"] = _safe_int(_get("gradPos2", "shapeGradPos2", default=100), 100)

    # ⚠️ volontairement ignoré : 3e couleur (tu ne la veux plus)
    return out


def _rgba255_from_css(css: str) -> Tuple[int, int, int, int]:
    (r, g, b), a = _parse_css_color(css)
    return (int(r * 255), int(g * 255), int(b * 255), int(_clamp01(a) * 255))


def _make_gradient_png(
    w_px: int,
    h_px: int,
    g: Dict[str, Any],
    radius_px: int = 0,
) -> Optional[bytes]:
    """
    Génère un PNG RGBA (2 couleurs) avec Pillow.
    - linear: angle supporté (rotation)
    - radial: cercle du centre
    - radius_px: arrondis via masque alpha
    """
    if Image is None:
        return None

    try:
        from io import BytesIO
        from PIL import ImageDraw  # type: ignore
    except Exception:
        return None

    w_px = max(2, int(w_px))
    h_px = max(2, int(h_px))

    c1 = _rgba255_from_css(str(g.get("color1") or "#ff0000"))
    c2 = _rgba255_from_css(str(g.get("color2") or "#0000ff"))
    typ = str(g.get("type") or "linear").lower()
    angle = float(g.get("angle") or 0.0)

    # base gradient image
    if typ == "radial":
        img = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))
        cx, cy = w_px / 2.0, h_px / 2.0
        maxd = (cx * cx + cy * cy) ** 0.5
        px = img.load()
        for y in range(h_px):
            for x in range(w_px):
                dx = x - cx
                dy = y - cy
                t = min(1.0, ((dx * dx + dy * dy) ** 0.5) / maxd)
                r = int(c1[0] + (c2[0] - c1[0]) * t)
                g_ = int(c1[1] + (c2[1] - c1[1]) * t)
                b = int(c1[2] + (c2[2] - c1[2]) * t)
                a = int(c1[3] + (c2[3] - c1[3]) * t)
                px[x, y] = (r, g_, b, a)
    else:
        # linear : on crée un gradient horizontal puis on pivote
        base = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))
        px = base.load()
        for x in range(w_px):
            t = 0.0 if w_px <= 1 else (x / float(w_px - 1))
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g_ = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            a = int(c1[3] + (c2[3] - c1[3]) * t)
            for y in range(h_px):
                px[x, y] = (r, g_, b, a)

        # rotate autour du centre
        img = base.rotate(-angle, resample=getattr(Image, "BICUBIC", 3), expand=False)

    # rounded corners mask
    if radius_px and radius_px > 0:
        rad = int(max(0, min(radius_px, min(w_px, h_px) // 2)))
        mask = Image.new("L", (w_px, h_px), 0)
        draw = ImageDraw.Draw(mask)
        try:
            draw.rounded_rectangle([0, 0, w_px - 1, h_px - 1], radius=rad, fill=255)
        except Exception:
            # vieux pillow : fallback rect
            draw.rectangle([0, 0, w_px - 1, h_px - 1], fill=255)
        img.putalpha(mask)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
    


def render_pdf_with_overlays(
    input_pdf_bytes: bytes,
    draft: Dict[str, Any],
    ctx: RenderContext,
) -> bytes:
    """
    Applique les objects du draft sur le PDF (y compris pages ajoutées) et renvoie un nouveau PDF.
    ⚠️ Tu veux un rendu STRICTEMENT "agent": on force ctx.is_agent=True ici.
    """
    # ✅ demandé: rendu identique agent, même en labo
    ctx.is_agent = True

    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) non installé. Installe 'pymupdf' dans l'image Docker.")

    doc = fitz.open(stream=input_pdf_bytes, filetype="pdf")

    # ✅ ajoute physiquement les pages blanches AVANT rendu
    _append_blank_pages_from_draft(doc, draft)

    pages = draft.get("pages") or []
    font_cache: Dict[str, str] = {}

    meta = (draft.get("_meta") or {}) if isinstance(draft, dict) else {}
    debug_render = False
    meta["debug_render"] = False

    base_w_px, base_h_px, pdfjs_scale = _get_viewport_base_px_and_scale(draft)

    # ------------------------------------------------------------
    # Helpers locaux (robustes)
    # ------------------------------------------------------------
    def _normalize_price_text_local(s: Any) -> str:
        if s is None:
            return ""
        t = str(s)
        t = t.replace("\u00A0", " ")
        t = t.replace("Â ", " ").replace("Â", "")
        t = t.replace("â‚¬", "€").replace("â¬", "€")
        t = re.sub(r"\s+", " ", t).strip()
        return t

    def _draw_textbox_fit_single_line_local(
        page: "fitz.Page",
        rect: "fitz.Rect",
        text: str,
        fontname: str,
        fontfile: Optional[str],
        fontsize_pt: float,
        color: Tuple[float, float, float],
        align: int,
    ) -> None:
        if fitz is None:
            return

        txt = _normalize_price_text_local(text)
        if not txt:
            return

        fs = max(4.0, float(fontsize_pt or 12.0))
        fs = min(fs, max(4.0, rect.height * 0.80))

        for _ in range(18):
            w = _text_width_pt(txt, fs, fontname or "helv", fontfile)
            if w <= rect.width * 0.98:
                break
            fs = max(4.0, fs * 0.92)
            if fs <= 4.01:
                break

        kwargs: Dict[str, Any] = {"fontsize": fs, "color": color, "align": align}
        if fontfile:
            kwargs["fontfile"] = fontfile
            if fontname:
                kwargs["fontname"] = fontname
        else:
            kwargs["fontname"] = fontname or "helv"

        page.insert_textbox(rect, txt, **kwargs)

    # ------------------------------------------------------------
    # Render loop: ALL pages (incluant pages ajoutées)
    # ------------------------------------------------------------
    total_pages = int(doc.page_count or 0)
    for page_index in range(total_pages):
        page = doc.load_page(page_index)
        page_w_pt = float(page.rect.width)
        page_h_pt = float(page.rect.height)

        pm = pages[page_index] if (isinstance(pages, list) and page_index < len(pages)) else {}
        objects = (pm or {}).get("objects") if isinstance(pm, dict) else None
        if not isinstance(objects, list):
            objects = []

        # ✅ Respect du "layer": back d'abord puis front
        try:
            objects = sorted(objects, key=lambda o: 0 if _get_shape_layer(o) == "back" else 1)
        except Exception:
            pass

        for obj in objects:
            if not isinstance(obj, dict):
                continue

            obj_type = obj.get("type")

            rect = None
            if _has_rel(obj):
                rect = _map_rect_rel_to_page_pt(
                    _safe_float(obj.get("x_rel"), 0.0),
                    _safe_float(obj.get("y_rel"), 0.0),
                    _safe_float(obj.get("w_rel"), 0.0),
                    _safe_float(obj.get("h_rel"), 0.0),
                    page_w_pt,
                    page_h_pt,
                )
            else:
                x_px = _safe_float(obj.get("x"), 0)
                y_px = _safe_float(obj.get("y"), 0)
                w_px = _safe_float(obj.get("w"), 0)
                h_px = _safe_float(obj.get("h"), 0)

                rect = _map_rect_px_to_page_pt(
                    x_px,
                    y_px,
                    w_px,
                    h_px,
                    page_w_pt,
                    page_h_pt,
                    base_w_px,
                    base_h_px,
                    pdfjs_scale,
                )

            if rect is None:
                continue

            if debug_render:
                page.draw_rect(rect, color=(1, 0, 0), width=0.8)

            # ------------------------------------------------------------
            # ✅ SHAPES (rect / roundrect / line) + gradient
            # ------------------------------------------------------------
            if _is_shape_like(obj) and not _is_clip_shape(obj):
                kind = _shape_kind(obj)
                pb_w_px, pb_h_px = _get_obj_page_box_px(obj)

                # stroke
                stroke_w_px = _get_shape_stroke_width_px(obj)
                stroke_w_pt = 0.0
                if stroke_w_px > 0:
                    stroke_w_pt = _border_px_to_pt(stroke_w_px, page_w_pt, pb_w_px, base_w_px, pdfjs_scale)

                stroke_rgb, stroke_a = _safe_color_and_opacity(_get_shape_stroke_color(obj), "#111827")

                # radius
                radius_px = _get_shape_radius_px(obj)
                radius_pt = 0.0
                if radius_px > 0:
                    radius_pt = _border_px_to_pt(radius_px, page_w_pt, pb_w_px, base_w_px, pdfjs_scale)

                fill_mode = _get_shape_fill_mode(obj)

                # ---- LINE
                if kind == "line":
                    if stroke_w_pt <= 0:
                        stroke_w_pt = max(0.25, _border_px_to_pt(1, page_w_pt, pb_w_px, base_w_px, pdfjs_scale))
                    try:
                        page.draw_line(
                            (rect.x0, rect.y0),
                            (rect.x1, rect.y1),
                            color=stroke_rgb,
                            width=stroke_w_pt,
                            stroke_opacity=_clamp01(stroke_a),
                        )
                    except Exception:
                        pass
                    continue

                # ---- RECT / ROUNDRECT
                if fill_mode == "gradient":
                    g = _get_shape_gradient(obj)

                    scale = 2.0
                    w_img = int(max(2.0, rect.width * scale))
                    h_img = int(max(2.0, rect.height * scale))

                    rad_img = 0
                    if kind == "roundrect" and radius_px > 0:
                        rad_img = int(max(0, min(radius_px * scale, min(w_img, h_img) / 2)))

                    png_bytes = _make_gradient_png(w_img, h_img, g, radius_px=rad_img)
                    if png_bytes:
                        try:
                            page.insert_image(rect, stream=png_bytes, keep_proportion=False)
                        except Exception:
                            pass

                    # stroke par-dessus
                    if stroke_w_pt > 0:
                        try:
                            sh = page.new_shape()
                            try:
                                if kind == "roundrect" and radius_pt > 0:
                                    sh.draw_rect(rect, radius=radius_pt)
                                else:
                                    sh.draw_rect(rect)
                            except Exception:
                                sh.draw_rect(rect)

                            sh.finish(
                                color=stroke_rgb,
                                fill=None,
                                width=stroke_w_pt,
                                stroke_opacity=_clamp01(stroke_a),
                            )
                            sh.commit()
                        except Exception:
                            try:
                                page.draw_rect(rect, color=stroke_rgb, width=stroke_w_pt, stroke_opacity=_clamp01(stroke_a))
                            except Exception:
                                pass

                    continue

                # fill uni (vector)
                fill_rgb, fill_a = _safe_color_and_opacity(_get_shape_fill_color(obj), "#ffffff")

                try:
                    sh = page.new_shape()
                    try:
                        if kind == "roundrect" and radius_pt > 0:
                            sh.draw_rect(rect, radius=radius_pt)
                        else:
                            sh.draw_rect(rect)
                    except Exception:
                        sh.draw_rect(rect)

                    sh.finish(
                        color=(stroke_rgb if stroke_w_pt > 0 else None),
                        fill=fill_rgb,
                        width=(stroke_w_pt if stroke_w_pt > 0 else 0),
                        fill_opacity=_clamp01(fill_a),
                        stroke_opacity=_clamp01(stroke_a),
                    )
                    sh.commit()
                except Exception:
                    try:
                        page.draw_rect(
                            rect,
                            color=(stroke_rgb if stroke_w_pt > 0 else None),
                            fill=fill_rgb,
                            width=(stroke_w_pt if stroke_w_pt > 0 else 0),
                            fill_opacity=_clamp01(fill_a),
                            stroke_opacity=_clamp01(stroke_a),
                        )
                    except Exception:
                        pass

                continue

            # ------------------------------------------------------------
            # ✅ CLIP-MASK SHAPE (image inside rect/roundrect)
            # ------------------------------------------------------------
                       # ------------------------------------------------------------
            # ✅ CLIP-MASK SHAPE (image inside rect/roundrect)
            # ------------------------------------------------------------
            if _is_clip_shape(obj):
                pb_w_px, pb_h_px = _get_obj_page_box_px(obj)

                kind = _shape_kind(obj)  # "rect" / "roundrect"
                radius_px = _get_shape_radius_px(obj)

                # stroke
                stroke_w_px = _get_shape_stroke_width_px(obj)
                stroke_w_pt = 0.0
                if stroke_w_px > 0:
                    stroke_w_pt = _border_px_to_pt(stroke_w_px, page_w_pt, pb_w_px, base_w_px, pdfjs_scale)

                stroke_rgb, stroke_a = _safe_color_and_opacity(_get_shape_stroke_color(obj), "#111827")

                # radius pt (utile pour placeholder + stroke)
                radius_pt = 0.0
                if kind == "roundrect" and radius_px > 0:
                    radius_pt = _border_px_to_pt(radius_px, page_w_pt, pb_w_px, base_w_px, pdfjs_scale)

                # skip si rect minuscule ou hors page
                try:
                    if rect.width < 2 or rect.height < 2:
                        continue
                    if rect.x1 <= 0 or rect.y1 <= 0 or rect.x0 >= page_w_pt or rect.y0 >= page_h_pt:
                        continue
                except Exception:
                    pass

                candidates = _clip_image_sources(obj)

                # Placeholder si pas d'image
                if not candidates:
                    try:
                        sh = page.new_shape()
                        try:
                            if kind == "roundrect" and radius_pt > 0:
                                sh.draw_rect(rect, radius=radius_pt)
                            else:
                                sh.draw_rect(rect)
                        except Exception:
                            sh.draw_rect(rect)

                        sh.finish(
                            color=stroke_rgb,
                            fill=None,
                            width=max(0.25, stroke_w_pt or 0.8),
                            stroke_opacity=_clamp01(stroke_a),
                        )
                        sh.commit()

                        # diagonale
                        page.draw_line(
                            (rect.x1, rect.y0),
                            (rect.x0, rect.y1),
                            color=stroke_rgb,
                            width=max(0.25, stroke_w_pt or 0.8),
                            stroke_opacity=_clamp01(stroke_a),
                        )
                    except Exception:
                        pass
                    continue

                # cache global images (avec "miss cache" sentinel b"")
                if not hasattr(render_pdf_with_overlays, "_img_cache"):
                    render_pdf_with_overlays._img_cache = {}  # type: ignore[attr-defined]
                _IMG_CACHE: Dict[str, bytes] = render_pdf_with_overlays._img_cache  # type: ignore[attr-defined]

                img_bytes: Optional[bytes] = None

                max_tries = min(5, len(candidates))
                for cand in candidates[:max_tries]:
                    cand = str(cand or "").strip()
                    if not cand:
                        continue

                    # ✅ cache qui retient aussi les échecs
                    if cand not in _IMG_CACHE:
                        b = _parse_data_url(cand)
                        if not b:
                            b = _resolve_image_to_bytes(cand, timeout_s=8) or None
                        _IMG_CACHE[cand] = b if b else b""  # sentinel

                    b = _IMG_CACHE.get(cand) or b""
                    if b == b"":
                        continue

                    if not _bytes_is_definitely_image(b):
                        continue

                    kimg = _sniff_image_kind(b)
                    if kimg == "webp":
                        pngb = _try_webp_to_png(b)
                        if not pngb:
                            # mémorise l'échec conversion si besoin
                            continue
                        b = pngb

                    img_bytes = b
                    break

                if not img_bytes:
                    # placeholder si on n'a rien pu charger
                    try:
                        sh = page.new_shape()
                        try:
                            if kind == "roundrect" and radius_pt > 0:
                                sh.draw_rect(rect, radius=radius_pt)
                            else:
                                sh.draw_rect(rect)
                        except Exception:
                            sh.draw_rect(rect)

                        sh.finish(
                            color=stroke_rgb,
                            fill=None,
                            width=max(0.25, stroke_w_pt or 0.8),
                            stroke_opacity=_clamp01(stroke_a),
                        )
                        sh.commit()

                        page.draw_line(
                            (rect.x1, rect.y0),
                            (rect.x0, rect.y1),
                            color=stroke_rgb,
                            width=max(0.25, stroke_w_pt or 0.8),
                            stroke_opacity=_clamp01(stroke_a),
                        )
                    except Exception:
                        pass
                    continue

                tr = _clip_transform(obj)
                scale = float(tr.get("scale", 1.0))
                offx = float(tr.get("offsetX", 0.0))
                offy = float(tr.get("offsetY", 0.0))

                raster_scale = 2.0
                out_w = int(max(2.0, rect.width * raster_scale))
                out_h = int(max(2.0, rect.height * raster_scale))

                # (optionnel mais conseillé) plafond pour éviter des PNG énormes
                MAX_RASTER = 2200
                if out_w > MAX_RASTER or out_h > MAX_RASTER:
                    ratio = min(MAX_RASTER / max(out_w, 1), MAX_RASTER / max(out_h, 1))
                    ratio = max(0.25, ratio)
                    out_w = int(max(2, out_w * ratio))
                    out_h = int(max(2, out_h * ratio))
                    raster_scale = raster_scale * ratio  # ajuste cohérence offsets

                rad_img = 0
                if kind == "roundrect" and radius_px > 0:
                    rad_img = int(max(0, min(radius_px * raster_scale, min(out_w, out_h) / 2)))

                png_stream = _render_clip_mask_image_png(
                    img_bytes=img_bytes,
                    out_w_px=out_w,
                    out_h_px=out_h,
                    scale=scale,
                    offset_x_px=offx * raster_scale,
                    offset_y_px=offy * raster_scale,
                    radius_px=rad_img,
                )

                if png_stream:
                    try:
                        page.insert_image(rect, stream=png_stream, keep_proportion=False)
                    except Exception:
                        try:
                            page.insert_image(rect, stream=img_bytes, keep_proportion=True)
                        except Exception:
                            pass
                else:
                    # fallback direct si rendu pillow échoue
                    try:
                        page.insert_image(rect, stream=img_bytes, keep_proportion=True)
                    except Exception:
                        pass

                # stroke au-dessus (optionnel)
                if stroke_w_pt > 0:
                    try:
                        sh = page.new_shape()
                        try:
                            if kind == "roundrect" and radius_pt > 0:
                                sh.draw_rect(rect, radius=radius_pt)
                            else:
                                sh.draw_rect(rect)
                        except Exception:
                            sh.draw_rect(rect)

                        sh.finish(
                            color=stroke_rgb,
                            fill=None,
                            width=stroke_w_pt,
                            stroke_opacity=_clamp01(stroke_a),
                        )
                        sh.commit()
                    except Exception:
                        try:
                            page.draw_rect(rect, color=stroke_rgb, width=stroke_w_pt, stroke_opacity=_clamp01(stroke_a))
                        except Exception:
                            pass

                continue


            # ---- IMAGE
                        # ---- IMAGE
            if str(obj_type or "").strip().lower() == "image":
                src0 = (obj.get("src") or "").strip()
                cands = obj.get("src_candidates") or obj.get("srcCandidates") or []
                if not isinstance(cands, list):
                    cands = []

                candidates: List[str] = []

                def _push(u: Any):
                    ss = str(u or "").strip()
                    if ss and ss not in candidates:
                        candidates.append(ss)

                _push(src0)
                for u in cands:
                    _push(u)

                if not candidates:
                    continue

                # skip si rect minuscule ou hors page
                try:
                    if rect.width < 2 or rect.height < 2:
                        continue
                    if rect.x1 <= 0 or rect.y1 <= 0 or rect.x0 >= page_w_pt or rect.y0 >= page_h_pt:
                        continue
                except Exception:
                    pass

                # cache global images (avec "miss cache" sentinel b"")
                if not hasattr(render_pdf_with_overlays, "_img_cache"):
                    render_pdf_with_overlays._img_cache = {}  # type: ignore[attr-defined]
                _IMG_CACHE: Dict[str, bytes] = render_pdf_with_overlays._img_cache  # type: ignore[attr-defined]

                img_bytes: Optional[bytes] = None
                chosen: Optional[str] = None

                max_tries = min(5, len(candidates))
                for cand in candidates[:max_tries]:
                    chosen = cand

                    if cand not in _IMG_CACHE:
                        b = _parse_data_url(cand)
                        if not b:
                            b = _resolve_image_to_bytes(cand, timeout_s=8) or None
                        _IMG_CACHE[cand] = b if b else b""  # sentinel

                    b = _IMG_CACHE.get(cand) or b""
                    if b == b"":
                        continue

                    if not _bytes_is_definitely_image(b):
                        print("[PDF_RENDER][IMG] not image bytes, skip:", cand, "head=", b[:24])
                        continue

                    kind_img = _sniff_image_kind(b)
                    if kind_img == "webp":
                        pngb = _try_webp_to_png(b)
                        if not pngb:
                            print("[PDF_RENDER][IMG] webp->png FAILED, next cand:", cand)
                            continue
                        b = pngb
                        kind_img = _sniff_image_kind(b)
                        if kind_img != "png":
                            print("[PDF_RENDER][IMG] webp->png produced non-png, next cand:", cand)
                            continue

                    img_bytes = b
                    break

                if not img_bytes:
                    print("[PDF_RENDER][IMG] bytes NONE for src/candidates=", candidates[:max_tries])
                    continue

                try:
                    page.insert_image(rect, stream=img_bytes, keep_proportion=True)
                except Exception as e:
                    print(
                        "[PDF_RENDER][IMG] insert_image FAILED:",
                        type(e).__name__,
                        str(e),
                        "chosen=", chosen,
                        "rect=", rect,
                        "kind=", _sniff_image_kind(img_bytes),
                        "len=", len(img_bytes or b""),
                    )

                continue


            # ---- TEXT (statique ou dynamique)
            dyn_kind = (obj.get("dynamic") or {}).get("kind") or obj.get("_dyn_kind") or ""
            is_dynamic = str(dyn_kind).strip() in ("product_price", "product_stock_badge", "product_ean")
            is_textish = _is_text_like_type(obj_type) or _is_text_like_type(obj.get("type"))

            if is_dynamic or is_textish:
                dyn_text = _resolve_dynamic_text(obj, ctx)

                if is_dynamic and dyn_text is None:
                    continue

                if dyn_text is None:
                    dyn_text = str(obj.get("text") or "")

                font_size_px = _safe_float(obj.get("fontSize"), 16)
                pb_w_px, pb_h_px = _get_obj_page_box_px(obj)
                font_size_pt = _font_px_to_pt(font_size_px, page_h_pt, pb_h_px, base_h_px, pdfjs_scale)

                rgb, _a = _parse_css_color(obj.get("color") or "#111827")

                dyn_kind_eff = str(dyn_kind or obj.get("type") or "").strip()
                fam = _sanitize_font_family(obj.get("fontFamily") or "")
                weight = _weight_bucket(obj.get("fontWeight"))

                if _is_builtin_font_family(fam):
                    fontfile = None
                    fontname = _normalize_builtin_fontname(fam)
                else:
                    fontfile = _resolve_fontfile_path(fam, weight, ctx)
                    fontname = _register_font_if_needed(page, doc, fam, weight, ctx, font_cache)

                if dyn_kind_eff == "product_stock_badge" and getattr(ctx, "is_agent", False):
                    if dyn_text:
                        _draw_textbox_fit_single_line_local(
                            page=page,
                            rect=rect,
                            text=dyn_text,
                            fontname=fontname or "helv",
                            fontfile=fontfile,
                            fontsize_pt=font_size_pt,
                            color=rgb,
                            align=fitz.TEXT_ALIGN_CENTER,
                        )
                    continue

                # background
                bg_enabled = obj.get("bgEnabled")
                bg_mode = str(obj.get("bgMode") or "").strip()
                if bg_enabled is not False and bg_mode != "transparent":
                    bg_color = obj.get("bgColor") or "rgba(255,255,255,0.72)"
                    fill_rgb, fill_a = _parse_css_color(str(bg_color))
                    if bg_mode != "color" and "rgba" not in str(bg_color).lower():
                        fill_a = 0.72
                    page.draw_rect(rect, color=None, fill=fill_rgb, fill_opacity=_clamp01(fill_a))

                # border
                if obj.get("borderEnabled"):
                    bw_px = _safe_float(obj.get("borderWidth"), 1)
                    bw_pt = _border_px_to_pt(bw_px, page_w_pt, pb_w_px, base_w_px, pdfjs_scale)
                    bc_rgb, bc_a = _parse_css_color(obj.get("borderColor") or "#111827")
                    page.draw_rect(rect, color=bc_rgb, width=bw_pt, stroke_opacity=_clamp01(bc_a))

                # product_price special render
                if dyn_kind_eff == "product_price":
                    dyn = obj.get("dynamic") or {}
                    ps = dyn.get("priceStyle") if isinstance(dyn, dict) else None
                    ps_kind = (ps.get("kind") if isinstance(ps, dict) else "") or ""

                    if ps_kind == "int_plus_1pt":
                        euros_plus_pt = _safe_float((ps or {}).get("euros_plus_pt"), 7.0)
                        if euros_plus_pt < 7.0:
                            euros_plus_pt = 7.0

                        _draw_price_mixed_sizes(
                            page=page,
                            rect=rect,
                            price_txt=dyn_text,
                            fontname_main=(fontname or "helv"),
                            fontfile_main=fontfile,
                            fontname_safe="helv",
                            font_size_pt=font_size_pt,
                            color=rgb,
                            euros_plus_pt=euros_plus_pt,
                        )
                    else:
                        _draw_textbox_fit_single_line_local(
                            page=page,
                            rect=rect,
                            text=dyn_text,
                            fontname=fontname or "helv",
                            fontfile=fontfile,
                            fontsize_pt=font_size_pt,
                            color=rgb,
                            align=fitz.TEXT_ALIGN_CENTER,
                        )

                elif dyn_kind_eff == "product_ean":
                    _draw_textbox_fit_single_line_local(
                        page=page,
                        rect=rect,
                        text=dyn_text,
                        fontname=fontname or "helv",
                        fontfile=fontfile,
                        fontsize_pt=font_size_pt,
                        color=rgb,
                        align=fitz.TEXT_ALIGN_CENTER,
                    )

                else:
                    kwargs: Dict[str, Any] = {
                        "fontsize": font_size_pt,
                        "color": rgb,
                        "align": fitz.TEXT_ALIGN_CENTER,
                    }
                    if fontfile:
                        kwargs["fontfile"] = fontfile
                        if fontname:
                            kwargs["fontname"] = fontname
                    else:
                        kwargs["fontname"] = fontname or "helv"

                    _insert_textbox_autofit(page, rect, dyn_text, kwargs)

                continue

    out = doc.tobytes(deflate=True, garbage=4)
    doc.close()
    return out

    
    

  

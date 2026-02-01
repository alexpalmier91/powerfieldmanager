# app/routers/labo_marketing_remove_bg.py
from __future__ import annotations

import base64
import hashlib
import io
import os
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

try:
    from rembg import remove as rembg_remove
except Exception:  # pragma: no cover
    rembg_remove = None


router = APIRouter(
    prefix="/api-zenhub/marketing",
    tags=["marketing"],
)

# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
CACHE_DIR = Path(os.getenv("ZENHUB_REMOVEBG_CACHE_DIR", "/app/media/removed_bg_cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

MAX_BYTES = int(os.getenv("ZENHUB_REMOVEBG_MAX_BYTES", str(12 * 1024 * 1024)))  # 12MB
ALLOWED_CT = {"image/png", "image/jpeg", "image/webp"}
QUALITY_PRESETS = {"fast", "balanced", "best"}

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    data = upload.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {max_bytes} bytes)",
        )
    return data


def _encode_png_base64(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode("ascii")


# ------------------------------------------------------------
# Endpoint
# ------------------------------------------------------------
@router.post("/images/remove-bg")
async def remove_bg(
    image: UploadFile = File(...),
    quality: str = Form("balanced"),
):
    """
    Détourage d'image (fond transparent)
    Input : multipart/form-data { image, quality }
    Output : { png_base64, width, height, cache_hit, sha256 }
    """
    if rembg_remove is None:
        raise HTTPException(
            status_code=500,
            detail="rembg non installé côté serveur",
        )

    if image.content_type not in ALLOWED_CT:
        raise HTTPException(
            status_code=415,
            detail="Type non supporté (png / jpg / webp)",
        )

    if quality not in QUALITY_PRESETS:
        quality = "balanced"

    raw = _read_limited(image, MAX_BYTES)
    sha = _sha256(raw)

    cache_key = f"{sha}_{quality}"
    cache_path = CACHE_DIR / f"{cache_key}.png"

    # --------------------------------------------------------
    # Cache HIT
    # --------------------------------------------------------
    if cache_path.exists():
        png_bytes = cache_path.read_bytes()
        with Image.open(io.BytesIO(png_bytes)) as im:
            w, h = im.size

        return JSONResponse(
            {
                "png_base64": _encode_png_base64(png_bytes),
                "width": w,
                "height": h,
                "cache_hit": True,
                "sha256": sha,
            }
        )

    # --------------------------------------------------------
    # Open + optional resize
    # --------------------------------------------------------
    try:
        with Image.open(io.BytesIO(raw)) as im:
            im = im.convert("RGBA")

            if quality == "fast":
                max_dim = 1600
            elif quality == "balanced":
                max_dim = 2200
            else:
                max_dim = None  # best

            if max_dim and max(im.size) > max_dim:
                ratio = max_dim / max(im.size)
                im = im.resize(
                    (int(im.size[0] * ratio), int(im.size[1] * ratio)),
                    Image.LANCZOS,
                )

            buf = io.BytesIO()
            im.save(buf, format="PNG")
            input_png = buf.getvalue()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Image invalide ou corrompue",
        )

    # --------------------------------------------------------
    # Remove background (ML)
    # --------------------------------------------------------
    try:
        out = rembg_remove(input_png)
        if not isinstance(out, (bytes, bytearray)):
            raise RuntimeError("Sortie rembg invalide")
        png_bytes = bytes(out)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Erreur lors du détourage (modèle ML)",
        )

    # --------------------------------------------------------
    # Validate PNG + optimize
    # --------------------------------------------------------
    try:
        with Image.open(io.BytesIO(png_bytes)) as im2:
            im2 = im2.convert("RGBA")
            w, h = im2.size

            buf = io.BytesIO()
            im2.save(buf, format="PNG", optimize=True)
            png_bytes = buf.getvalue()
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de la génération du PNG final",
        )

    # --------------------------------------------------------
    # Cache write (non bloquant)
    # --------------------------------------------------------
    try:
        cache_path.write_bytes(png_bytes)
    except Exception:
        pass

    return JSONResponse(
        {
            "png_base64": _encode_png_base64(png_bytes),
            "width": w,
            "height": h,
            "cache_hit": False,
            "sha256": sha,
        }
    )

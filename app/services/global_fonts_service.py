# app/services/global_fonts_service.py
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional, Tuple, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GlobalFont

FONTS_DIR = Path("/app/app/assets/fonts_global")
ALLOWED_EXT = {".ttf", ".otf"}


# ---------------------------------------------------------
# Keys / naming
# ---------------------------------------------------------
def _sha1_bytes(b: bytes) -> str:
    return hashlib.sha1(b).hexdigest()


def _stable_family_key_from_file(path: Path) -> str:
    """
    ✅ Stable même si on renomme le fichier.
    Basé sur le contenu => pas de casse des drafts/annotations.
    """
    try:
        b = path.read_bytes()
    except Exception:
        # fallback ultra-safe si lecture impossible
        b = str(path).encode("utf-8")
    h = _sha1_bytes(b)[:10]
    return f"GLOBAL_FONT_{h}"


def _display_name_from_filename(filename: str) -> str:
    base = Path(filename).stem
    return base.replace("_", " ").replace("-", " ").strip()


def _guess_weight_style(filename: str) -> Tuple[Optional[int], Optional[str]]:
    """
    ⚠️ Ordre important: 'semibold' contient 'bold' => tester semibold AVANT bold.
    """
    s = filename.lower()
    style = "italic" if ("italic" in s or "oblique" in s) else "normal"

    if "extrabold" in s or "ultrabold" in s or "800" in s:
        weight = 800
    elif "semibold" in s or "demibold" in s or "600" in s:
        weight = 600
    elif "bold" in s or "700" in s:
        weight = 700
    elif "medium" in s or "500" in s:
        weight = 500
    elif "light" in s or "300" in s:
        weight = 300
    else:
        weight = 400

    return weight, style


# ---------------------------------------------------------
# Import
# ---------------------------------------------------------
async def import_global_fonts(session: AsyncSession, dry_run: bool = False) -> Dict[str, int]:
    """
    Scan /app/app/assets/fonts_global/*.ttf|*.otf
    ✅ Upsert par family_key (unique)
    ✅ Met à jour file_path si le fichier a été déplacé
    ✅ Désactive les fonts absentes du dossier (par family_key)
    """
    if not FONTS_DIR.exists():
        raise RuntimeError(f"Dossier introuvable: {FONTS_DIR}")

    files: List[Path] = sorted(
        [p for p in FONTS_DIR.iterdir() if p.is_file() and p.suffix.lower() in ALLOWED_EXT]
    )

    existing = (await session.execute(select(GlobalFont))).scalars().all()
    existing_by_family = {str(gf.family_key): gf for gf in existing if gf.family_key}
    existing_by_path = {str(gf.file_path): gf for gf in existing if gf.file_path}

    created = 0
    updated = 0
    disabled_missing = 0

    seen_family_keys = set()

    for fp in files:
        abs_path = str(fp.resolve())
        display_name = _display_name_from_filename(fp.name)
        family_key = _stable_family_key_from_file(fp)
        weight, style = _guess_weight_style(fp.name)

        seen_family_keys.add(family_key)

        gf = existing_by_family.get(family_key)

        # 🧯 Migration / compat: si on a un ancien enregistrement basé sur file_path,
        # on le "rattache" au nouveau family_key
        if gf is None:
            old = existing_by_path.get(abs_path)
            if old is not None and (not old.family_key or old.family_key != family_key):
                gf = old
                gf.family_key = family_key  # ⚠️ unique, OK tant que pas déjà pris
                # On met aussi à jour l'index local pour éviter doublons
                existing_by_family[family_key] = gf

        if gf:
            changed = False

            if gf.display_name != display_name:
                gf.display_name = display_name
                changed = True

            # file_path peut changer si tu remplaces le fichier par un nouveau build
            if gf.file_path != abs_path:
                gf.file_path = abs_path
                changed = True

            if gf.weight != weight:
                gf.weight = weight
                changed = True

            if gf.style != style:
                gf.style = style
                changed = True

            if gf.enabled is not True:
                gf.enabled = True
                changed = True

            if changed:
                updated += 1

        else:
            session.add(
                GlobalFont(
                    display_name=display_name,
                    family_key=family_key,
                    weight=weight,
                    style=style,
                    file_path=abs_path,
                    enabled=True,
                )
            )
            created += 1

    # Désactiver celles qui ne sont plus dans le dossier (par family_key)
    for gf in existing:
        if gf.family_key and gf.family_key not in seen_family_keys and gf.enabled:
            gf.enabled = False
            disabled_missing += 1

    if dry_run:
        await session.rollback()
    else:
        await session.commit()

    return {
        "created": created,
        "updated": updated,
        "disabled_missing": disabled_missing,
        "count_scanned": len(files),
    }

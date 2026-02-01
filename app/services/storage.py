# app/services/storage.py

import os
import uuid
import shutil
from pathlib import Path

# =========================================================
# TEMP STORAGE (EXISTANT)
# =========================================================

TMP_DIR = Path("/tmp/zenhub_uploads")
TMP_DIR.mkdir(parents=True, exist_ok=True)


def store_temp_file(filename: str, content: bytes) -> str:
    """
    Stockage temporaire d'un fichier uploadé.
    Retourne le chemin du fichier temporaire.
    """
    ext = os.path.splitext(filename)[1].lower()
    name = f"{uuid.uuid4().hex}{ext}"
    path = TMP_DIR / name
    with open(path, "wb") as f:
        f.write(content)
    return str(path)


# =========================================================
# LABO DOCUMENTS (VENTES : BC / BL / FA)
# =========================================================

LABO_DOCS_DIR = Path("media/labo_documents")


def store_labo_document(
    *,
    labo_id: int,
    original_filename: str,
    temp_path: str,
) -> str:
    """
    Déplace un fichier temporaire vers le stockage définitif
    des documents de vente labo (BC / BL / FA).
    Retourne le filename stocké (clé DB).
    """
    ext = os.path.splitext(original_filename)[1].lower()
    if ext != ".pdf":
        raise ValueError("Seuls les PDF sont autorisés")

    filename = f"{uuid.uuid4().hex}{ext}"

    labo_dir = LABO_DOCS_DIR / f"labo_{labo_id}"
    labo_dir.mkdir(parents=True, exist_ok=True)

    final_path = labo_dir / filename
    shutil.move(temp_path, final_path)

    return filename


def get_labo_document_path(labo_id: int, filename: str) -> Path:
    return LABO_DOCS_DIR / f"labo_{labo_id}" / filename


def delete_labo_document(labo_id: int, filename: str) -> None:
    path = get_labo_document_path(labo_id, filename)
    if path.exists():
        path.unlink()


# =========================================================
# MARKETING DOCUMENTS (CATALOGUES / PROMOS PDF)
# =========================================================

MARKETING_DOCS_DIR = Path("media/marketing_documents")


def store_marketing_document(
    *,
    labo_id: int,
    original_filename: str,
    temp_path: str,
) -> str:
    ext = os.path.splitext(original_filename)[1].lower()
    if ext != ".pdf":
        raise ValueError("Seuls les PDF sont autorisés")

    filename = f"{uuid.uuid4().hex}.pdf"
    labo_dir = MARKETING_DOCS_DIR / f"labo_{labo_id}"
    labo_dir.mkdir(parents=True, exist_ok=True)

    final_path = labo_dir / filename
    shutil.move(temp_path, final_path)
    return filename


def get_marketing_document_path(labo_id: int, filename: str) -> Path:
    return MARKETING_DOCS_DIR / f"labo_{labo_id}" / filename


def delete_marketing_document(labo_id: int, filename: str) -> None:
    """
    Supprime le PDF marketing (best effort)
    """
    path = get_marketing_document_path(labo_id, filename)
    if path.exists():
        path.unlink()


# ---------------------------------------------------------
# MINIATURE PDF (PAGE 1) — petite et légère
# ---------------------------------------------------------

def generate_marketing_document_thumb(
    *,
    labo_id: int,
    pdf_filename: str,
    max_width: int = 320,
    max_height: int = 420,
) -> str:
    """
    Génère une miniature PNG de la page 1 du PDF (PyMuPDF),
    en contraignant la taille (max_width / max_height).
    """
    import fitz  # PyMuPDF

    pdf_path = get_marketing_document_path(labo_id, pdf_filename)
    if not pdf_path.exists():
        raise ValueError("PDF introuvable")

    thumb_filename = f"thumb_{uuid.uuid4().hex}.png"
    thumb_path = MARKETING_DOCS_DIR / f"labo_{labo_id}" / thumb_filename
    thumb_path.parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(pdf_path))
    try:
        page = doc.load_page(0)

        pw = float(page.rect.width)
        ph = float(page.rect.height)

        sx = max_width / pw if pw else 1.0
        sy = max_height / ph if ph else 1.0
        scale = min(sx, sy, 1.0)  # jamais agrandir

        mat = fitz.Matrix(scale, scale)

        pix = page.get_pixmap(matrix=mat, alpha=False)
        print("[THUMB] generate_marketing_document_thumb CALLED", labo_id, pdf_filename, "->", thumb_path)
        pix.save(str(thumb_path))
    finally:
        doc.close()

    return thumb_filename


def delete_marketing_document_thumb(labo_id: int, thumb_filename: str | None) -> None:
    if not thumb_filename:
        return
    path = MARKETING_DOCS_DIR / f"labo_{labo_id}" / thumb_filename
    if path.exists():
        path.unlink()



# =========================================================
# MARKETING FONTS (WOFF2)
# =========================================================

# =========================================================
# MARKETING FONTS (WOFF2)
# =========================================================

MARKETING_FONTS_DIR = Path("media/marketing_fonts")


def store_marketing_font(
    *,
    labo_id: int,
    original_filename: str,
    temp_path: str,
) -> str:
    """
    Déplace un fichier temporaire vers le stockage définitif
    des polices (WOFF2) du labo.
    Retourne le filename stocké (clé DB).
    """
    ext = os.path.splitext(original_filename)[1].lower()
    if ext != ".woff2":
        raise ValueError("Seuls les fichiers .woff2 sont autorisés")

    filename = f"{uuid.uuid4().hex}{ext}"

    labo_dir = MARKETING_FONTS_DIR / f"labo_{labo_id}"
    labo_dir.mkdir(parents=True, exist_ok=True)

    final_path = labo_dir / filename
    shutil.move(temp_path, final_path)

    return filename


def get_marketing_font_path(labo_id: int, filename: str) -> Path:
    return MARKETING_FONTS_DIR / f"labo_{labo_id}" / filename


def delete_marketing_font_file(labo_id: int, filename: str) -> None:
    """
    Supprime une police (best effort)
    """
    path = get_marketing_font_path(labo_id, filename)
    if path.exists():
        path.unlink()

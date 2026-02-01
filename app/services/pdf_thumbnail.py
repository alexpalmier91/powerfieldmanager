import fitz  # PyMuPDF
from pathlib import Path


def generate_pdf_thumbnail(
    pdf_path: Path,
    output_path: Path,
    target_width: int = 240,
    page_number: int = 0,
):
    """
    Génère une miniature PNG à partir de la première page du PDF.
    - target_width: largeur finale en pixels
    """

    doc = fitz.open(pdf_path)
    page = doc.load_page(page_number)

    # Taille originale de la page
    rect = page.rect
    original_width = rect.width

    # Calcul du scale pour atteindre la largeur cible
    scale = target_width / original_width

    matrix = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=matrix, alpha=False)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(output_path))

    doc.close()

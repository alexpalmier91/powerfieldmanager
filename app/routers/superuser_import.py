# app/routers/superuser_import.py
from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import shutil, os, uuid
from pathlib import Path
from loguru import logger

from app.db.session import get_async_session
from app.db.models import ImportJob
from app.routers.auth import require_superuser
from app.tasks.imports import task_import_orders, task_import_agents

router = APIRouter(prefix="/api-zenhub/superuser", tags=["superuser"])

LABO_A_ID = 1  # utilisé pour passer au worker Celery
UPLOAD_DIR = Path("/data/uploads")  # ✅ volume partagé API <-> worker
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def _save_upload_temp(upload: UploadFile) -> str:
    """
    Sauvegarde le fichier uploadé dans le volume partagé (/data/uploads)
    pour qu'il soit visible par le worker Celery.
    """
    ext = (Path(upload.filename or "").suffix or ".bin").lower()
    fname = f"import_{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(upload.file, out)
    logger.info(f"[upload] Fichier sauvegardé → {dest}")
    return str(dest)

# ------------------------------------------------------------
# Import des commandes (ventes)
# ------------------------------------------------------------
@router.post("/import_orders")
async def import_orders(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    _=Depends(require_superuser),
):
    """
    Lancement de l'import des commandes (CSV/XLSX).
    Colonnes minimales attendues :
    order_number, order_date, client_name, line_sku, line_qty, (line_price_ht ou line_total_ht), agent_name|agent_email
    """
    tmp_path = _save_upload_temp(file)

    job = ImportJob(
        task_id=f"PENDING-{uuid.uuid4().hex}",
        filename=os.path.basename(tmp_path),
        total_rows=0,
        inserted=0,
        updated=0,
        errors=[],
        status="PENDING",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    task_import_orders.delay(job_id=job.id, tmp_path=tmp_path, labo_id=LABO_A_ID)
    logger.info(f"[import_orders] Job {job.id} lancé → {tmp_path}")

    return {"job_id": job.id, "message": "Import commandes lancé."}

# ------------------------------------------------------------
# Import des agents commerciaux
# ------------------------------------------------------------
@router.post("/import_agents")
async def import_agents(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    _=Depends(require_superuser),
):
    """
    Import des agents commerciaux (CSV/XLSX).
    Colonnes minimales : first_name / last_name / email
    Optionnelles : phone, departements
    """
    tmp_path = _save_upload_temp(file)

    job = ImportJob(
        task_id=f"PENDING-{uuid.uuid4().hex}",
        filename=os.path.basename(tmp_path),
        total_rows=0,
        inserted=0,
        updated=0,
        errors=[],
        status="PENDING",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    task_import_agents.delay(job_id=job.id, tmp_path=tmp_path, labo_id=LABO_A_ID)
    logger.info(f"[import_agents] Job {job.id} lancé → {tmp_path}")

    return {"job_id": job.id, "message": "Import agents lancé."}

# ------------------------------------------------------------
# Journalisation (liste des imports récents)
# ------------------------------------------------------------
@router.get("/import_jobs/latest")
async def get_latest_jobs(
    limit: int = 30,
    session: AsyncSession = Depends(get_async_session),
    _=Depends(require_superuser),
):
    """Renvoie les derniers jobs d'import exécutés."""
    q = select(ImportJob).order_by(ImportJob.created_at.desc()).limit(limit)
    rows = (await session.execute(q)).scalars().all()

    def as_dict(j: ImportJob):
        return {
            "id": j.id,
            "status": j.status,
            "created_at": j.created_at,
            "finished_at": j.finished_at,
            "filename": j.filename,
            "total_rows": j.total_rows,
            "inserted": j.inserted,
            "updated": j.updated,
            "errors": j.errors,
            "task_id": j.task_id,
        }

    return {"jobs": [as_dict(r) for r in rows]}

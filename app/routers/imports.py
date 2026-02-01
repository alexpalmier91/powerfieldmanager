from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import StreamingResponse
import os, uuid, aiofiles, logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_subject
from app.db.session import get_async_session
from app.db.models import ImportJob
from app.schemas import ImportStatus


from app.tasks.celery_app import celery
import logging

from app.tasks.imports import import_products as import_products_task  # ✅ tâche Celery réelle

router = APIRouter(prefix="/imports", tags=["imports"])

logger = logging.getLogger(__name__)

UPLOAD_DIR = "/data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/products", response_model=ImportStatus)
async def import_products_upload(
    file: UploadFile = File(...),
    subject = Depends(get_current_subject),
    db: AsyncSession = Depends(get_async_session),
):
    if not subject.labo_id:
        raise HTTPException(status_code=403, detail="No labo context")

    filename = file.filename or f"import_{uuid.uuid4().hex}.xlsx"
    filepath = os.path.join(UPLOAD_DIR, filename)

    # 1) Sauvegarde du fichier uploadé
    try:
        async with aiofiles.open(filepath, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                await f.write(chunk)
        logger.info("[imports] Saved upload to %s (labo_id=%s)", filepath, subject.labo_id)
    except Exception as e:
        logger.exception("[imports] Upload save failed")
        raise HTTPException(status_code=500, detail=f"Upload save failed: {e}")

    # 2) Envoi explicite de la tâche Celery (nom + queue)
    try:
        # IMPORTANT : le nom doit correspondre au décorateur de la tâche :
        # @celery.task(name="import_products", queue="default")
        task = celery.send_task(
            "import_products",
            kwargs={"filepath": filepath, "labo_id": subject.labo_id},
            queue="default",
        )
        logger.info("[imports] Import task queued id=%s file=%s labo=%s",
                    task.id, filepath, subject.labo_id)
    except Exception as e:
        logger.exception("[imports] Celery send_task failed")
        raise HTTPException(status_code=500, detail=f"Celery dispatch failed: {e}")

    # 3) Pré-créer la ligne ImportJob pour éviter le 404 pendant le polling
    try:
        job = ImportJob(
            task_id=task.id,
            filename=os.path.basename(filename),
            total_rows=0,
            inserted=0,
            updated=0,
            errors=[],
            status="PENDING",
        )
        db.add(job)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.warning("[imports] Failed to pre-create ImportJob row; will rely on worker writer")

    return ImportStatus(
        task_id=task.id, status="PENDING",
        total_rows=0, inserted=0, updated=0, errors=[]
    )


@router.get("/{task_id}", response_model=ImportStatus)
async def import_status(task_id: str, db: AsyncSession = Depends(get_async_session)):
    row = (await db.execute(select(ImportJob).where(ImportJob.task_id == task_id))).scalar_one_or_none()
    if not row:
        # 👇 au lieu de 404, renvoyer PENDING pour que le front continue à poller
        return ImportStatus(task_id=task_id, status="PENDING", total_rows=0, inserted=0, updated=0, errors=[])
    return ImportStatus(
        task_id=row.task_id, status=row.status,
        total_rows=row.total_rows, inserted=row.inserted, updated=row.updated,
        errors=row.errors or [],
    )


@router.get("/products/template")
async def products_template():
    # modèle CSV simple : compatible avec l’import CSV
    csv = "sku,name,price_ht,stock,ean13,description,category,image_url\n"
    return StreamingResponse(
        iter([csv]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="products_template.csv"'},
    )

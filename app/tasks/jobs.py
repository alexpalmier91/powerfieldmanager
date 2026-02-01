# app/tasks/jobs.py
from __future__ import annotations

import os
import random
import string
from datetime import datetime, timedelta, timezone

from loguru import logger
from sqlalchemy import create_engine, insert
from sqlalchemy.orm import sessionmaker

from app.tasks.celery_app import celery
from app.services.storage import store_temp_file
from app.services.prestashop_bridge import push_products_to_presta
from app.db.models import AuthCode
from app.services.mailer import send_mail


# ============================================================
#  DB SYNC (IMPORTANT : pas d'async dans un worker Celery)
# ============================================================
DATABASE_URL_SYNC = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
engine = create_engine(DATABASE_URL_SYNC, future=True, pool_pre_ping=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)


# ============================================================
#  Utils
# ============================================================
def _rand_code(n: int = 6) -> str:
    # Code numérique sur 6 chiffres
    return "".join(random.choices(string.digits, k=n))


# ============================================================
#  File queue helpers (appelés côté API)
# ============================================================
def queue_import_file(filename: str, content: bytes, uploaded_by: str | None, labo_id: int):
    """
    Côté API : sauvegarde temporaire, puis enqueue la tâche d'import PRODUITS.
    """
    path = store_temp_file(filename, content)
    celery.send_task(
        "import_products",
        kwargs={"filepath": path, "labo_id": labo_id},
    )
    logger.info(f"[queue_import_file] queued import_products path={path} labo_id={labo_id} uploaded_by={uploaded_by}")


def queue_sync_presta(requested_by: str | None = None):
    celery.send_task("tasks.sync_presta", kwargs={"requested_by": requested_by})
    logger.info(f"[queue_sync_presta] queued by={requested_by}")


# ============================================================
#  Tâche : sync Presta
# ============================================================
@celery.task(name="tasks.sync_presta")
def sync_presta(requested_by: str | None = None):
    logger.info(f"[sync_presta] triggered by={requested_by}")
    push_products_to_presta()
    logger.info("[sync_presta] OK")


# ============================================================
#  Tâche : envoi du code de connexion (OTP)
# ============================================================
@celery.task(name="app.tasks.jobs.send_login_code")
def send_login_code(email: str):
    """
    Génère et stocke un code OTP, puis envoie l'email (valable 10 minutes).
    """
    s = Session()
    try:
        code = _rand_code(6)
        expires = datetime.now(timezone.utc) + timedelta(minutes=10)

        logger.info(f"[OTP] Génération code pour {email} → {code}")

        s.execute(
            insert(AuthCode).values(email=email.strip().lower(), code=code, expires_at=expires, used=False)
        )
        s.commit()

        html = (
            f"<p>Votre code de connexion Zentro : <b>{code}</b></p>"
            f"<p>Valable 10 minutes.</p>"
        )
        try:
            send_mail(email, "Votre code de connexion", html)
            logger.info(f"[OTP] Code envoyé à {email} (exp {expires.isoformat()})")
        except Exception as mail_err:
            logger.exception(f"[OTP] Envoi mail KO pour {email}: {mail_err}")

        return {"ok": True, "email": email, "expires_at": expires.isoformat()}

    except Exception as e:
        s.rollback()
        logger.exception(f"[OTP] ERREUR envoi/sauvegarde code pour {email}: {e}")
        return {"ok": False, "email": email, "error": str(e)}
    finally:
        s.close()

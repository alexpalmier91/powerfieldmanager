# app/core/celery_app.py

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

# ------------------------------------------------------------------------------
# 1. Configuration broker & backend
# ------------------------------------------------------------------------------

# À adapter si besoin (en Docker, souvent: redis://redis:6379/0)
CELERY_BROKER_URL = "redis://localhost:6379/0"
CELERY_RESULT_BACKEND = "redis://localhost:6379/1"

# ------------------------------------------------------------------------------
# 2. Création de l’app Celery
# ------------------------------------------------------------------------------

celery_app = Celery(
    "zenhub",  # nom de l'application
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

# ------------------------------------------------------------------------------
# 3. Configuration générale
# ------------------------------------------------------------------------------

celery_app.conf.update(
    timezone="Europe/Paris",
    enable_utc=True,
    task_ignore_result=True,  # sauf si tu veux garder les résultats
    broker_connection_retry_on_startup=True,
)

# ------------------------------------------------------------------------------
# 4. Auto-discovery des tasks
# ------------------------------------------------------------------------------

celery_app.autodiscover_tasks(
    packages=[
        "app.celery_tasks",
    ]
)

# ------------------------------------------------------------------------------
# 5. Import "forcé" pour être certain que Celery voit les tasks
# ------------------------------------------------------------------------------

try:
    import app.celery_tasks.labo_stock_sync  # noqa: F401
except Exception:
    pass

try:
    import app.celery_tasks.labo_sales_import_sync  # noqa: F401
except Exception:
    pass

# ------------------------------------------------------------------------------
# 6. Planification Celery Beat (tâches quotidiennes)
# ------------------------------------------------------------------------------

celery_app.conf.beat_schedule = {
    # Synchronisation des stocks labos
    "labo_stock_sync_all_daily": {
        "task": "labo_stock_sync.sync_all",
        "schedule": crontab(minute=0, hour="3"),  # tous les jours à 03:00
    },
    # Import automatique des ventes labos (fichiers Excel)
    "labo_sales_import_sync_all_daily": {
        "task": "labo_sales_import.sync_all",
        "schedule": crontab(minute=30, hour="3"),  # tous les jours à 03:30
    },
}

# ------------------------------------------------------------------------------
# 7. Tâche simple pour tester Celery
# ------------------------------------------------------------------------------

@celery_app.task(name="ping")
def ping():
    return "pong"

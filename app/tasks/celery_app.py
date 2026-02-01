# app/tasks/celery_app.py
import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery = Celery(
    "zentro",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.tasks.imports",   # ✅ tâches d’import (agents, commandes, produits)
        "app.tasks.jobs",      # ✅ décommenté pour activer send_login_code()
    ],
)

celery.conf.update(
    timezone="Europe/Paris",
    task_track_started=True,
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    task_default_queue="default",
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
)

# Autodiscovery (optionnel)
celery.autodiscover_tasks(["app.tasks"])

try:
    import app.tasks.imports
    import app.tasks.jobs      # ✅ aussi ici pour forcer l'import manuel
except Exception as e:
    import traceback
    print("⚠️  Erreur import Celery :", e)
    traceback.print_exc()

import app.celery_tasks.labo_stock_sync       # noqa: E402,F401
import app.celery_tasks.labo_sales_import_sync  # noqa: E402,F401
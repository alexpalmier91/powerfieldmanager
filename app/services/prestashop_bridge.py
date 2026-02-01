import httpx
from app.core.config import settings
from loguru import logger

def push_products_to_presta():
    # Exemple : appeler un endpoint de ton module Presta (zenbridge) avec une clé API
    url = f"{settings.PRESTA_BASE_URL}/module/zenbridge/import"
    headers = {"X-Presta-Key": settings.PRESTA_API_KEY}
    payload = {"shop_id": settings.PRESTA_SHOP_ID, "sync": "products"}
    try:
        r = httpx.post(url, headers=headers, json=payload, timeout=60.0, verify=True)
        r.raise_for_status()
        logger.info("Presta sync response: {}", r.json())
    except Exception as e:
        logger.error(f"Presta sync failed: {e}")

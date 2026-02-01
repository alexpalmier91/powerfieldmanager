# app/services/agent_orders_auto_import_service.py
from __future__ import annotations

from datetime import datetime, date
from typing import Dict, Any, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.labo_agent_orders_auto_import_config import (
    LaboAgentOrdersAutoImportConfig,
)
from app.services.google_drive_agent_orders import (
    list_csv_files_in_folder,
    download_file_content,
)
from app.services.agent_orders_csv_import import import_agent_orders_from_csv_bytes


def _parse_drive_modified_date(raw: str | None) -> date | None:
    """
    Convertit un modifiedTime Google Drive (RFC3339) en date (UTC).

    Ex : "2025-12-03T09:28:00.123Z" → date(2025, 12, 03)
    """
    if not raw:
        return None
    try:
        # Drive renvoie du RFC3339 avec un 'Z' final → on le remplace par +00:00
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.date()
    except Exception:
        return None


async def run_auto_import_for_labo(
    session: AsyncSession,
    config: LaboAgentOrdersAutoImportConfig,
    target_date: date | None = None,
) -> Dict[str, Any]:
    """
    Import auto des commandes agents pour un labo donné et une date donnée.

    ⚠️ IMPORTANT :
      - aucune purge globale de la table des commandes agents
      - uniquement INSERT / UPDATE par numéro de commande,
        gérés par import_agent_orders_from_csv_bytes(...)
    """
    from datetime import date as date_cls

    if not config.drive_folder_id:
        raise RuntimeError(f"Labo {config.labo_id}: drive_folder_id non configuré")

    if target_date is None:
        target_date = date_cls.today()

    # 1) On liste TOUS les CSV du dossier (sans filtre de date ici)
    all_files: List[dict[str, Any]] = list_csv_files_in_folder(config.drive_folder_id)

    # 2) On filtre sur la date de modification Drive == target_date
    files_for_date: List[dict[str, Any]] = []
    for f in all_files:
        modified_raw = f.get("modifiedTime")
        modified_d = _parse_drive_modified_date(modified_raw)
        if modified_d == target_date:
            files_for_date.append(f)

    global_summary: Dict[str, Any] = {
        "labo_id": config.labo_id,
        "target_date": target_date.isoformat(),
        "files_found": [
            {
                "file_id": f.get("id"),
                "filename": f.get("name"),
                "modifiedTime": f.get("modifiedTime"),
            }
            for f in all_files
        ],
        "files_processed": [],
        "total_inserted_orders": 0,
        "total_updated_orders": 0,
        "total_rows": 0,
        "errors": [],
    }

    for f in files_for_date:
        file_id = f["id"]
        filename = f.get("name", "<sans nom>")
        try:
            csv_bytes = download_file_content(file_id)
            file_summary = await import_agent_orders_from_csv_bytes(
                session=session,
                labo_id=config.labo_id,
                csv_bytes=csv_bytes,
                filename=filename,
            )

            global_summary["files_processed"].append(
                {
                    "file_id": file_id,
                    "filename": filename,
                    "inserted_orders": file_summary["created_orders"],
                    "updated_orders": file_summary["updated_orders"],
                    "total_rows": file_summary["total_rows"],
                    "errors": file_summary["errors"] or [],
                }
            )
            global_summary["total_inserted_orders"] += file_summary["created_orders"]
            global_summary["total_updated_orders"] += file_summary["updated_orders"]
            global_summary["total_rows"] += file_summary["total_rows"]
            if file_summary["errors"]:
                global_summary["errors"].extend(
                    [f"{filename}: {err}" for err in (file_summary["errors"] or [])]
                )
        except Exception as exc:
            global_summary["errors"].append(
                f"Erreur sur le fichier {filename} ({file_id}): {exc}"
            )

    # Maj config
    config.last_run_at = datetime.utcnow()
    if global_summary["errors"]:
        config.last_status = "error"
        config.last_error = "\n".join(global_summary["errors"])[:4000]
    else:
        config.last_status = "success"
        config.last_error = None

    config.last_summary = global_summary

    await session.commit()

    return global_summary

# app/services/google_drive_agent_orders.py
from __future__ import annotations

import io
import os
import logging
from typing import List, Dict, Any, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

_drive_service = None


def get_drive_service():
    """
    Client Google Drive initialisé à partir de GOOGLE_SERVICE_ACCOUNT_FILE.
    """
    global _drive_service
    if _drive_service is not None:
        return _drive_service

    sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
    if not sa_file:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_FILE n'est pas défini dans l'environnement "
            "(chemin vers le JSON du compte de service Google)."
        )

    if not os.path.exists(sa_file):
        raise RuntimeError(f"Fichier de compte de service introuvable : {sa_file}")

    logger.info("Initialisation du client Google Drive avec %s", sa_file)

    creds = service_account.Credentials.from_service_account_file(
        sa_file,
        scopes=SCOPES,
    )
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    _drive_service = service
    return service


def list_csv_files_in_folder(folder_id: str) -> List[Dict[str, Any]]:
    """
    Liste tous les fichiers CSV (mimeType text/csv) d'un dossier Drive.

    Ne filtre PAS sur la date ici : on récupère id, name, modifiedTime, size.

    :param folder_id: ID du dossier Drive (pas l'URL).
    :return: liste de dicts {id, name, mimeType, modifiedTime, size}
    """
    service = get_drive_service()

    query = (
        f"'{folder_id}' in parents "
        f"and mimeType = 'text/csv' "
        f"and trashed = false"
    )

    logger.info(
        "[google_drive_agent_orders] Listing CSV dans dossier %s", folder_id
    )

    files: List[Dict[str, Any]] = []
    page_token: Optional[str] = None

    while True:
        resp = (
            service.files()
            .list(
                q=query,
                spaces="drive",
                fields=(
                    "nextPageToken, files(id, name, mimeType, modifiedTime, size)"
                ),
                pageToken=page_token,
            )
            .execute()
        )

        batch = resp.get("files", []) or []
        files.extend(batch)

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    logger.info(
        "[google_drive_agent_orders] %d fichier(s) CSV trouvés dans le dossier %s",
        len(files),
        folder_id,
    )
    return files


def download_file_content(file_id: str) -> bytes:
    """
    Télécharge le contenu brut d'un fichier Drive (par id) et le retourne en bytes.
    """
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)

    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            logger.debug(
                "[google_drive_agent_orders] Téléchargement %s : %d%%",
                file_id,
                int(status.progress() * 100),
            )

    fh.seek(0)
    content = fh.read()
    logger.info(
        "[google_drive_agent_orders] Téléchargement terminé pour file_id=%s (%d octets)",
        file_id,
        len(content),
    )
    return content

# app/services/google_drive_client.py
from __future__ import annotations

import io
import os
import logging
from dataclasses import dataclass
from datetime import date
from typing import List, Optional, Tuple

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

# Portée minimale : lecture seule sur Drive
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Cache simple du client Drive
_drive_service = None


@dataclass
class DriveFile:
    """Représente un fichier Drive utile pour l'import."""
    id: str
    name: str
    mime_type: str
    modified_time: Optional[str] = None
    size: Optional[int] = None


def get_drive_service():
    """
    Retourne un client Google Drive v3 initialisé à partir de la variable
    d'environnement GOOGLE_SERVICE_ACCOUNT_FILE.

    Lève un RuntimeError si la variable n'est pas définie ou si le fichier manque.
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
        raise RuntimeError(
            f"Fichier de compte de service introuvable : {sa_file}"
        )

    logger.info("Initialisation du client Google Drive avec %s", sa_file)

    creds = service_account.Credentials.from_service_account_file(
        sa_file,
        scopes=SCOPES,
    )
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    _drive_service = service
    return service


def list_csv_files_for_date(
    folder_id: str,
    target_date: Optional[date] = None,
) -> List[DriveFile]:
    """
    Liste les fichiers CSV dans un dossier Google Drive pour une date donnée.

    Hypothèse de nommage : commandes_YYYYMMDD_1.csv, commandes_YYYYMMDD_2.csv, etc.
    -> on filtre sur 'name contains YYYYMMDD'.

    :param folder_id: ID du dossier Drive (pas l'URL, uniquement l'ID).
    :param target_date: date visée; par défaut, date du jour (UTC/app).
    :return: liste de DriveFile
    """
    from datetime import date as _date_cls  # pour éviter shadowing
    if target_date is None:
        target_date = _date_cls.today()

    service = get_drive_service()

    date_token = target_date.strftime("%Y%m%d")
    # Requête Drive :
    #   - dans ce dossier
    #   - fichier non supprimé
    #   - mimeType CSV
    #   - nom contenant le pattern 'YYYYMMDD'
    query = (
        f"'{folder_id}' in parents "
        f"and mimeType = 'text/csv' "
        f"and name contains '{date_token}' "
        f"and trashed = false"
    )

    logger.info(
        "Listing des CSV dans dossier %s pour la date %s (token=%s)",
        folder_id,
        target_date.isoformat(),
        date_token,
    )

    files: List[DriveFile] = []
    page_token: Optional[str] = None

    while True:
        resp = service.files().list(
            q=query,
            spaces="drive",
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
            pageToken=page_token,
        ).execute()

        for f in resp.get("files", []):
            files.append(
                DriveFile(
                    id=f["id"],
                    name=f.get("name", ""),
                    mime_type=f.get("mimeType", ""),
                    modified_time=f.get("modifiedTime"),
                    size=int(f["size"]) if "size" in f else None,
                )
            )

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    logger.info("Trouvé %d fichier(s) CSV pour la date %s", len(files), target_date.isoformat())
    return files


def download_file_bytes(file_id: str) -> bytes:
    """
    Télécharge le contenu brut d'un fichier Drive (par id) et le retourne en bytes.
    Idéal pour passer ensuite à un parser CSV (io.BytesIO, pandas, etc.).
    """
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)

    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            logger.debug("Téléchargement Drive %s : %d%%", file_id, int(status.progress() * 100))

    fh.seek(0)
    content = fh.read()
    logger.info("Téléchargement terminé pour file_id=%s (%d octets)", file_id, len(content))
    return content


def download_csv_files_for_date(
    folder_id: str,
    target_date: Optional[date] = None,
) -> List[Tuple[DriveFile, bytes]]:
    """
    Combine listage + téléchargement :
    - liste les CSV du dossier pour la date donnée
    - télécharge chaque fichier
    - retourne une liste de (DriveFile, bytes)

    :param folder_id: id du dossier Drive
    :param target_date: date visée; par défaut, aujourd'hui
    """
    files = list_csv_files_for_date(folder_id, target_date=target_date)
    results: List[Tuple[DriveFile, bytes]] = []

    for f in files:
        try:
            content = download_file_bytes(f.id)
            results.append((f, content))
        except Exception as exc:
            logger.exception("Erreur lors du téléchargement du fichier %s (%s)", f.id, f.name)
            # À toi de voir : soit tu continues, soit tu relèves l'exception.
            # Ici on continue en loggant.
            continue

    return results

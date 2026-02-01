# app/services/product_image_pipeline.py
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, Dict

import httpx
from PIL import Image, ImageOps, ImageFile

SAFE_RE = re.compile(r"[^a-zA-Z0-9_\-\.]+")

# ✅ évite des crash sur certaines sources tronquées / mal encodées
ImageFile.LOAD_TRUNCATED_IMAGES = True


@dataclass
class ImagePipelineResult:
    thumb_url: str
    hd_jpg_url: str
    hd_webp_url: str

    checksum_sha1: str
    source_bytes: int

    source_mime: Optional[str] = None
    source_etag: Optional[str] = None
    source_last_modified: Optional[str] = None
    source_size: Optional[int] = None  # content-length (si dispo)


class ProductImagePipeline:
    """
    Pipeline images :
      - download source_url (streaming + max bytes + retries)
      - checksum sha1
      - generate:
          thumb.webp (<= thumb_max_px)
          hd.jpg
          hd.webp
      - stocke dans /app/media/products/labo_{labo_id}/{sku}/
      - nommage stable:
          sku_{SKU}_{idx}_{sha[:12]}_thumb.webp
          sku_{SKU}_{idx}_{sha[:12]}_hd.jpg
          sku_{SKU}_{idx}_{sha[:12]}_hd.webp

    Cache anti-redownload :
      - si existing_checksum fourni ET fichiers déjà présents -> skip download/convert
    """

    def __init__(
        self,
        *,
        media_root: str = "/app/media",
        media_base_url: str = "/media",
        max_download_bytes: int = 15 * 1024 * 1024,  # 15MB
        connect_timeout: float = 5.0,
        read_timeout: float = 25.0,
        retries: int = 2,
        retry_backoff_s: float = 0.6,
        thumb_max_px: int = 400,
        jpg_quality: int = 85,
        webp_quality: int = 82,
    ):
        self.media_root = Path(media_root)
        self.media_base_url = media_base_url.rstrip("/")
        self.max_download_bytes = int(max_download_bytes)
        self.connect_timeout = float(connect_timeout)
        self.read_timeout = float(read_timeout)
        self.retries = int(retries)
        self.retry_backoff_s = float(retry_backoff_s)
        self.thumb_max_px = int(thumb_max_px)
        self.jpg_quality = int(jpg_quality)
        self.webp_quality = int(webp_quality)

    async def ensure_image_set(
        self,
        *,
        labo_id: int,
        sku: str,
        image_index: int,
        source_url: str,
        existing_checksum: Optional[str] = None,
    ) -> Optional[ImagePipelineResult]:
        """
        Retourne None si échec (sans lever) : import continue.

        Cache:
          - si existing_checksum non vide et les fichiers correspondants existent -> skip
        """
        sku_safe = self._safe(sku or "sku")
        (self.media_root / "products" / f"labo_{labo_id}" / sku_safe).mkdir(
            parents=True, exist_ok=True
        )

        if existing_checksum:
            build = self._build_urls_and_paths(labo_id, sku_safe, image_index, existing_checksum)
            if self._all_files_exist(build["paths"]):
                return ImagePipelineResult(
                    thumb_url=build["urls"]["thumb"],
                    hd_jpg_url=build["urls"]["hd_jpg"],
                    hd_webp_url=build["urls"]["hd_webp"],
                    checksum_sha1=existing_checksum,
                    source_bytes=0,  # 0 => cache hit
                )

        downloaded = await self._download_with_retries(source_url)
        if not downloaded:
            return None

        content, mime, etag, last_mod, clen = downloaded
        sha1 = hashlib.sha1(content).hexdigest()

        build = self._build_urls_and_paths(labo_id, sku_safe, image_index, sha1)

        # si les fichiers existent déjà (cas rare : même image re-importée)
        if self._all_files_exist(build["paths"]):
            return ImagePipelineResult(
                thumb_url=build["urls"]["thumb"],
                hd_jpg_url=build["urls"]["hd_jpg"],
                hd_webp_url=build["urls"]["hd_webp"],
                checksum_sha1=sha1,
                source_bytes=len(content),
                source_mime=mime,
                source_etag=etag,
                source_last_modified=last_mod,
                source_size=clen,
            )

        try:
            self._generate_all(
                content_bytes=content,
                out_thumb_path=build["paths"]["thumb"],
                out_hd_jpg_path=build["paths"]["hd_jpg"],
                out_hd_webp_path=build["paths"]["hd_webp"],
            )
        except Exception as e:
            print(f"[IMG_PIPELINE] generate failed sku={sku_safe} idx={image_index} err={e}")
            return None

        return ImagePipelineResult(
            thumb_url=build["urls"]["thumb"],
            hd_jpg_url=build["urls"]["hd_jpg"],
            hd_webp_url=build["urls"]["hd_webp"],
            checksum_sha1=sha1,
            source_bytes=len(content),
            source_mime=mime,
            source_etag=etag,
            source_last_modified=last_mod,
            source_size=clen,
        )

    # ---------------- internals ----------------

    def _safe(self, s: str) -> str:
        s = (s or "").strip()
        s = SAFE_RE.sub("_", s)
        return s[:180] if len(s) > 180 else s

    def _build_urls_and_paths(
        self,
        labo_id: int,
        sku_safe: str,
        image_index: int,
        checksum_sha1: str,
    ) -> Dict[str, Dict]:
        rel_dir = Path("products") / f"labo_{labo_id}" / sku_safe
        base_name = f"sku_{sku_safe}_{int(image_index)}_{checksum_sha1[:12]}"

        rel_thumb = rel_dir / f"{base_name}_thumb.webp"
        rel_hd_jpg = rel_dir / f"{base_name}_hd.jpg"
        rel_hd_webp = rel_dir / f"{base_name}_hd.webp"

        abs_thumb = self.media_root / rel_thumb
        abs_hd_jpg = self.media_root / rel_hd_jpg
        abs_hd_webp = self.media_root / rel_hd_webp

        urls = {
            "thumb": f"{self.media_base_url}/{rel_thumb.as_posix()}",
            "hd_jpg": f"{self.media_base_url}/{rel_hd_jpg.as_posix()}",
            "hd_webp": f"{self.media_base_url}/{rel_hd_webp.as_posix()}",
        }
        paths = {
            "thumb": abs_thumb,
            "hd_jpg": abs_hd_jpg,
            "hd_webp": abs_hd_webp,
        }
        return {"urls": urls, "paths": paths}

    def _all_files_exist(self, paths: Dict[str, Path]) -> bool:
        return all(Path(p).exists() for p in paths.values())

    async def _download_with_retries(
        self, url: str
    ) -> Optional[Tuple[bytes, Optional[str], Optional[str], Optional[str], Optional[int]]]:
        timeout = httpx.Timeout(
            connect=self.connect_timeout,
            read=self.read_timeout,
            write=10.0,
            pool=5.0,
        )
        last_err = None

        for attempt in range(self.retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    # HEAD size guard (best-effort)
                    try:
                        head = await client.head(url)
                        cl = head.headers.get("content-length")
                        if cl and cl.isdigit() and int(cl) > self.max_download_bytes:
                            print(f"[IMG_PIPELINE] skip too large url={url} bytes={cl}")
                            return None
                    except Exception:
                        pass

                    async with client.stream("GET", url) as resp:
                        resp.raise_for_status()

                        mime = resp.headers.get("content-type")
                        etag = resp.headers.get("etag")
                        last_mod = resp.headers.get("last-modified")
                        cl = resp.headers.get("content-length")
                        clen = int(cl) if (cl and cl.isdigit()) else None

                        buf = bytearray()
                        async for chunk in resp.aiter_bytes():
                            buf.extend(chunk)
                            if len(buf) > self.max_download_bytes:
                                print(
                                    f"[IMG_PIPELINE] abort too large url={url} max={self.max_download_bytes}"
                                )
                                return None

                        return bytes(buf), mime, etag, last_mod, clen

            except Exception as e:
                last_err = e
                if attempt < self.retries:
                    await asyncio.sleep(self.retry_backoff_s * (attempt + 1))
                    continue
                break

        print(f"[IMG_PIPELINE] download failed url={url} err={last_err}")
        return None

    # ✅ helpers robustes WEBP/JPG (modes + alpha + CMYK + palette)
    def _has_alpha(self, im: Image.Image) -> bool:
        if im.mode in ("RGBA", "LA"):
            return True
        if im.mode == "P":
            return "transparency" in (im.info or {})
        return False

    def _to_rgb_for_jpeg(self, im: Image.Image) -> Image.Image:
        im = ImageOps.exif_transpose(im)

        if im.mode == "P":
            # palette -> RGB/RGBA
            if "transparency" in (im.info or {}):
                im = im.convert("RGBA")
            else:
                im = im.convert("RGB")

        if im.mode == "CMYK":
            im = im.convert("RGB")

        if im.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            rgba = im.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
            return bg

        if im.mode != "RGB":
            return im.convert("RGB")
        return im

    def _to_mode_for_webp(self, im: Image.Image) -> Image.Image:
        im = ImageOps.exif_transpose(im)

        if im.mode == "P":
            # webp supporte alpha, donc on garde RGBA si transparence
            if "transparency" in (im.info or {}):
                return im.convert("RGBA")
            return im.convert("RGB")

        if im.mode == "CMYK":
            return im.convert("RGB")

        if self._has_alpha(im):
            return im.convert("RGBA") if im.mode != "RGBA" else im

        return im.convert("RGB") if im.mode != "RGB" else im

    def _bytes_to_tempfile(self, b: bytes) -> str:
        fd, path = tempfile.mkstemp(prefix="imgsrc_", suffix=".bin")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(b)
        return path

    def _save_atomic_bytes(self, data: bytes, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)

    def _encode_jpg(self, im: Image.Image, *, quality: int) -> bytes:
        out = tempfile.SpooledTemporaryFile(max_size=5 * 1024 * 1024)
        rgb = self._to_rgb_for_jpeg(im)
        rgb.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
        out.seek(0)
        return out.read()

    def _encode_webp(self, im: Image.Image, *, quality: int) -> bytes:
        out = tempfile.SpooledTemporaryFile(max_size=5 * 1024 * 1024)
        wim = self._to_mode_for_webp(im)
        # method=6 : meilleure compression
        wim.save(out, format="WEBP", quality=quality, method=6)
        out.seek(0)
        return out.read()

    def _generate_all(
        self,
        *,
        content_bytes: bytes,
        out_thumb_path: Path,
        out_hd_jpg_path: Path,
        out_hd_webp_path: Path,
    ) -> None:
        src_path = self._bytes_to_tempfile(content_bytes)
        try:
            with Image.open(src_path) as im:
                im = ImageOps.exif_transpose(im)

                # HD: on part de l'image d'origine telle quelle (pas forcément RGB)
                # -> encodeurs gèrent le mode
                jpg_bytes = self._encode_jpg(im, quality=self.jpg_quality)
                webp_bytes = self._encode_webp(im, quality=self.webp_quality)

                self._save_atomic_bytes(jpg_bytes, out_hd_jpg_path)
                self._save_atomic_bytes(webp_bytes, out_hd_webp_path)

                # Thumb: on fait la miniature sur une version “webp-safe” (RGB/RGBA)
                thumb_src = self._to_mode_for_webp(im).copy()
                thumb_src.thumbnail(
                    (self.thumb_max_px, self.thumb_max_px),
                    Image.Resampling.LANCZOS,
                )
                thumb_webp = self._encode_webp(thumb_src, quality=self.webp_quality)
                self._save_atomic_bytes(thumb_webp, out_thumb_path)

        finally:
            try:
                os.remove(src_path)
            except Exception:
                pass

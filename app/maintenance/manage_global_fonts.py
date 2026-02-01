# app/maintenance/manage_global_fonts.py
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.services.global_fonts_service import import_global_fonts


async def _run(dry_run: bool) -> None:
    async with AsyncSessionLocal() as session:  # type: AsyncSession
        res = await import_global_fonts(session, dry_run=dry_run)
        print(res)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(_run(dry_run=args.dry_run))


if __name__ == "__main__":
    main()

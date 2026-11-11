"""Deletes art objects that no card or origin references, run by hand (backend_plan §10.3).

From backend/:   python -m scripts.sweep_art [--delete] [--grace-hours N] [--max-deletes N]
In the image:    docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art

A dry run unless --delete is passed: it logs each key it would delete and deletes nothing. It
ignores ART_SWEEP_ENABLED and uses the database and bucket from the settings (.env or the
environment), so check that the two belong together first. Exits with 1 when the sweep was
aborted or a delete failed.
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta

from app.core.config import Settings, get_settings
from app.core.db import create_engine, create_session_factory
from app.core.logging_config import configure_logging, get_logger
from app.services import art_cleanup_service
from app.storage.client import create_s3_client

# Under "app.", so LOG_LEVEL applies to it like to the app's own lines.
log = get_logger("app.scripts.sweep_art")


def _parse_args(settings: Settings) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.sweep_art",
        description="Delete art objects that no card or origin references.",
    )
    parser.add_argument(
        "--delete", action="store_true", help="delete the objects (without it, only list them)"
    )
    parser.add_argument(
        "--grace-hours",
        type=float,
        default=settings.art_sweep_grace_h,
        help="keep objects younger than this (default: ART_SWEEP_GRACE_H, %(default)s)",
    )
    parser.add_argument(
        "--max-deletes",
        type=int,
        default=settings.art_sweep_max_deletes,
        help="delete nothing above this many (default: ART_SWEEP_MAX_DELETES, %(default)s)",
    )
    args = parser.parse_args()
    if args.grace_hours < 0:
        parser.error("--grace-hours can't be negative")
    if args.max_deletes < 1:
        parser.error("--max-deletes must be at least 1")
    return args


async def _sweep(settings: Settings, args: argparse.Namespace) -> int:
    dry_run = not args.delete
    log.info(
        "art.sweep_started",
        bucket=settings.r2_bucket,
        dry_run=dry_run,
        grace_hours=args.grace_hours,
        max_deletes=args.max_deletes,
    )
    engine = create_engine(settings)
    try:
        async with create_s3_client(settings) as s3, create_session_factory(engine)() as db:
            result = await art_cleanup_service.sweep(
                db,
                s3,
                settings.r2_bucket,
                older_than=datetime.now(UTC) - timedelta(hours=args.grace_hours),
                max_deletes=args.max_deletes,
                dry_run=dry_run,
            )
    finally:
        await engine.dispose()
    return 1 if result.aborted or result.failed else 0


def main() -> None:
    settings = get_settings()
    configure_logging(settings)
    args = _parse_args(settings)
    sys.exit(asyncio.run(_sweep(settings, args)))


if __name__ == "__main__":
    main()

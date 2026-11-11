"""Deletes art objects that no card or origin references (backend_plan §10.3).

Imported copies keep the author's art key, so one object can be used by rows of many users, and
only a look at every row can tell that it is unused. An upload whose card or origin isn't saved
yet has no row either, so objects younger than the grace period are always kept.
"""

import asyncio
import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from botocore.exceptions import BotoCoreError, ClientError
from redis.asyncio import Redis
from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging_config import elapsed_ms, get_logger
from app.models.card import Card
from app.models.origin import Origin
from app.services import upload_service
from app.storage.client import ArtKind, S3Client, delete_object, list_objects

log = get_logger(__name__)

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# Set for one interval by the check that runs the sweep, so restarts and an instance overlapping
# a deploy don't run it again.
LAST_RUN_KEY = "art_sweep:last_run"
# The first check waits a little, so it doesn't compete with a cold start's first requests.
_FIRST_CHECK_DELAY_S = 60
# A check is one Redis command; the key decides whether a sweep is due.
_CHECK_EVERY_S = 3600


@dataclass(frozen=True)
class SweepResult:
    """`listed` art objects were found. Of these, `too_new` were younger than the grace period,
    `referenced` were old but in use, and `candidates` were old and unused. `aborted` means there
    were more candidates than `max_deletes`, so nothing was deleted."""

    listed: int
    too_new: int
    referenced: int
    candidates: int
    deleted: int
    failed: int
    dry_run: bool
    aborted: bool


async def referenced_art_keys(db: AsyncSession) -> set[str]:
    """Every art key a row uses, whoever owns it.

    The one list of art-key columns: a new column that holds an art key belongs here. Game deck
    snapshots (M6, M7) are left out on purpose, so a finished game doesn't keep art alive.
    """
    stmt = union(
        select(Card.art_key).where(Card.art_key.is_not(None)),
        select(Origin.background_art_key).where(Origin.background_art_key.is_not(None)),
    )
    return {key for key in await db.scalars(stmt) if key is not None}


async def sweep(
    db: AsyncSession,
    s3: S3Client,
    bucket: str,
    *,
    older_than: datetime,
    max_deletes: int,
    dry_run: bool = False,
) -> SweepResult:
    """Deletes the art objects last written before `older_than` that no row references.

    Only keys with the art-key shape count, so nothing else in the bucket is ever touched. With
    more than `max_deletes` candidates it deletes nothing: a database paired with the wrong bucket
    would see every object as unused.
    """
    started = time.perf_counter()
    listed = 0
    old: list[str] = []
    for kind in ArtKind:
        async for stored in list_objects(s3, bucket, f"{kind}/"):
            if not upload_service.is_art_key(stored.key):
                continue
            listed += 1
            if stored.last_modified < older_than:
                old.append(stored.key)
    # Read after the listing, so a row committed while it ran (an import) is still seen.
    referenced = await referenced_art_keys(db)
    candidates = [key for key in old if key not in referenced]

    def result(deleted: int = 0, failed: int = 0, aborted: bool = False) -> SweepResult:
        return SweepResult(
            listed=listed,
            too_new=listed - len(old),
            referenced=len(old) - len(candidates),
            candidates=len(candidates),
            deleted=deleted,
            failed=failed,
            dry_run=dry_run,
            aborted=aborted,
        )

    if len(candidates) > max_deletes:
        log.warning(
            "art.sweep_aborted",
            listed=listed,
            candidates=len(candidates),
            max_deletes=max_deletes,
        )
        return result(aborted=True)

    deleted = failed = 0
    for key in candidates:
        if dry_run:
            log.info("art.would_delete", art_key=key)
            continue
        try:
            await delete_object(s3, bucket, key)
        except (ClientError, BotoCoreError):
            # The key stays unused, so the next sweep tries it again.
            failed += 1
            log.warning("art.delete_failed", art_key=key, exc_info=True)
            continue
        deleted += 1
        log.info("art.deleted", art_key=key)

    swept = result(deleted=deleted, failed=failed)
    log.info(
        "art.swept",
        listed=swept.listed,
        too_new=swept.too_new,
        referenced=swept.referenced,
        candidates=swept.candidates,
        deleted=swept.deleted,
        failed=swept.failed,
        dry_run=dry_run,
        duration_ms=elapsed_ms(started),
    )
    return swept


async def run_if_due(
    session_factory: SessionFactory,
    redis: Redis,
    s3: S3Client,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> SweepResult | None:
    """Sweeps unless a sweep already ran within the interval; None when it was skipped.

    The Redis key is claimed before the sweep, so two instances overlapping in a deploy can't
    both run it. A sweep that fails waits for the next interval.
    """
    now = now or datetime.now(UTC)
    claimed = await redis.set(
        LAST_RUN_KEY, now.isoformat(), nx=True, ex=settings.art_sweep_interval_h * 3600
    )
    if not claimed:
        log.debug("art.sweep_skipped")
        return None
    async with session_factory() as db:
        return await sweep(
            db,
            s3,
            settings.r2_bucket,
            older_than=now - timedelta(hours=settings.art_sweep_grace_h),
            max_deletes=settings.art_sweep_max_deletes,
        )


async def sweep_forever(
    session_factory: SessionFactory, redis: Redis, s3: S3Client, settings: Settings
) -> None:
    """The app's background task: checks once an hour whether a sweep is due, until cancelled.

    The app is started with this in an empty log context (backend_plan §10.2).
    """
    await asyncio.sleep(_FIRST_CHECK_DELAY_S)
    while True:
        try:
            await run_if_due(session_factory, redis, s3, settings)
        except Exception:
            # Nothing else would report a background task's failure; the next check retries.
            log.exception("art.sweep_failed")
        await asyncio.sleep(_CHECK_EVERY_S)

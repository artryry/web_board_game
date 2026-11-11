# Current feature: Art cleanup — delete art that nothing references

**Status:** built 2026-11-11 on branch `art-cleanup` (from `master` at `54c2a5e`), not committed yet. Backend checks pass, and it was checked by hand against the dev bucket. Still to do: deploy, then check Render's logs (see Open questions). See [sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md).
**Plan reference:** [backend_plan.md §1, §3, §4, §10.2](backend_plan.md) and a new §10.3 Art cleanup, [frontend_plan.md](frontend_plan.md) (F5 and F6 notes), [deployment.md](deployment.md)
**Depends on:** M2 (art upload), M3 (imports that share art keys) and the deployment (all done).
**Unblocks:** nothing directly. It keeps the R2 buckets from filling up with art no one can see.

The previous feature (logging) still has two unchecked items, the e2e run and the checks by hand. They are listed under "Next steps" in [sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md).

## Goal
Once a day, the app deletes every art object in R2 that no `cards` or `origins` row references and that is older than 24 hours.

None of the backend milestones (M0–M7) covered this. backend_plan §4 said "art objects are never deleted", because imported copies keep the author's `art_key`. Orphans pile up from:
- deleted cards and origins
- art that is replaced or cleared
- deleted accounts: one SQL `DELETE FROM users` cascades, so no app code sees which keys went
- abandoned uploads: each file pick uploads at once (`useArtField.ts`), so a replaced pick or a closed editor leaves an object that no row ever pointed to

## How it works

### The sweep
`art_cleanup_service.sweep(db, s3, bucket, *, older_than, max_deletes, dry_run)`:
1. **List** the objects under `card-art/` and `origin-art/` (`ListObjectsV2`, page by page).
   - Only keys that match the full art-key shape `{kind}/{user uuid}/{uuid}.{png|jpg|webp}` are considered. Nothing else in the bucket is ever touched.
2. **Skip young objects:** an R2 `LastModified` newer than `older_than` (now minus 24 h). This protects uploads whose card or origin hasn't been saved yet.
3. **Read the references after listing:** every non-null `cards.art_key` and `origins.background_art_key`, from every user.
   - Reading after the listing means an import that commits while the bucket is listed is still seen.
   - An imported copy keeps the author's object alive, even after the author deletes their card or account.
4. **Candidates** = old objects − referenced keys.
5. **Guard:** with more candidates than `max_deletes`, delete nothing and log `art.sweep_aborted` (WARNING).
   - A database paired with the wrong bucket (a dev DB against the prod bucket) would see every object as unreferenced. The guard stops that from emptying the bucket.
6. **Delete each candidate** with a single `DeleteObject`.
   - The volume is small, and single deletes avoid the request checksum that the multi-delete API requires.
   - A failed delete logs `art.delete_failed` (WARNING), and the sweep moves on. The next run retries it.

`referenced_art_keys(db)` is the one place that lists the art-key columns. A new column that holds an art key must be added there.

### When it runs
- **Production:** `ART_SWEEP_ENABLED=true` (from `render.yaml`). The lifespan starts one background task:
  - It starts with an empty log context, as backend_plan §10.2 asks of background tasks.
  - It waits 60 s after startup, then checks once an hour.
  - Each check is `SET art_sweep:last_run <now> NX EX <interval>` in Redis. Only the check that sets the key runs the sweep, so it runs at most once per `ART_SWEEP_INTERVAL_H` (24 h). Two instances that overlap during a deploy can't both run it.
  - It opens its own database session.
  - An exception is logged as `art.sweep_failed` (ERROR, with the traceback), and the loop goes on.
  - It is cancelled when the app stops.
- **Render's free plan sleeps** after 15 minutes without traffic, so the sweep runs only while the app is awake.
  - It never wakes Neon by itself.
  - It costs one Upstash command per hour awake, a list request per 1000 objects, and one request per delete.
- **Development and tests:** off by default (`ART_SWEEP_ENABLED=false`).
- **By hand:** `python -m scripts.sweep_art` (from `backend/`).
  - It is a dry run unless `--delete` is passed: it logs `art.would_delete` for each key and deletes nothing.
  - `--grace-hours N` and `--max-deletes N` override the settings.
  - It ignores `ART_SWEEP_ENABLED`.
  - It ships in the image, so `docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art` checks production.

### Settings
| Variable | Default | Meaning |
|---|---|---|
| `ART_SWEEP_ENABLED` | `false` | Start the daily sweep in the app. Turn it on only where the database and the bucket belong together. |
| `ART_SWEEP_INTERVAL_H` | `24` | At most one sweep per this many hours |
| `ART_SWEEP_GRACE_H` | `24` | Objects younger than this are never deleted (at least 1, which is longer than any upload URL lives) |
| `ART_SWEEP_MAX_DELETES` | `200` | Above this many candidates, the sweep deletes nothing and warns |

### Log events
| Event | Level | Fields |
|---|---|---|
| `art.swept` | INFO | `listed`, `too_new`, `referenced`, `candidates`, `deleted`, `failed`, `dry_run`, `duration_ms` |
| `art.deleted` | INFO | `art_key`: a record of what was removed |
| `art.would_delete` | INFO | `art_key` (dry run) |
| `art.sweep_started` | INFO | `bucket`, `dry_run`, `grace_hours`, `max_deletes` (the script only) |
| `art.sweep_aborted` | WARNING | `listed`, `candidates`, `max_deletes` |
| `art.delete_failed` | WARNING | `art_key`, with the exception |
| `art.sweep_failed` | ERROR | the traceback |
| `art.sweep_skipped` | DEBUG | the sweep already ran within the interval |

### Known limits
- **Import race.** Suppose a share import is mid-transaction while the author deletes the source card, and the sweep reads the references in that same few-millisecond window. Then the copy loses its art. The sweep runs once a day, and the owner can upload the art again.
- **An editor left open for more than 24 h** after a file pick gets `invalid_art_key` on Save. The user picks the file again.
- **Games (M6 and M7) don't keep art alive.** Deck snapshots hold art keys, but the sweep doesn't count them. A card deleted mid-game, or replayed after it was deleted, shows the no-art look. F5 and F6 must fall back to it when an image fails to load.

## Done when
- [x] **The sweep:**
  - deletes old, unreferenced art (abandoned uploads, replaced or cleared art, deleted cards, origins and accounts)
  - keeps referenced art, including art that only an imported copy uses
  - keeps young objects
  - never touches keys outside the art-key shape
- [x] **Safety:**
  - off unless `ART_SWEEP_ENABLED` is set
  - deletes nothing above `ART_SWEEP_MAX_DELETES`
  - the script is a dry run unless `--delete` is passed
- [x] **In the app:** at most one sweep per interval through the Redis key. A failure is logged and doesn't stop the loop.
- [x] **Logs:** the events in the table above, with tests.
- [x] **Checked by hand** against the dev bucket (see Notes):
  - the dry run lists only unused objects
  - `--delete` removes them
  - the app sweeps once and skips after a restart
- [x] **Checks pass:** `pytest` (476 passed), `ruff check .`, `ruff format --check .` and `mypy app tests` (plus `scripts/sweep_art.py`).
- [ ] **In production:** after the deploy, `app.started` shows `"art_sweep":true`, and an `art.swept` line follows.

## Decisions
Confirmed with the user on 2026-11-11:
- **A daily sweep only.** Nothing is deleted inline when a card or origin is deleted. One code path covers every kind of orphan, forks included.
- **Started in the app and gated by Redis,** plus a script for manual runs.
- **Game snapshots don't keep art alive.** The board and replays fall back to the no-art look.
- **Production has its own bucket** (`card-art-prod`), separate from the dev bucket. The `max_deletes` guard stays as a second line of defence.

Changed or added while implementing (2026-11-11), all in the plans now:
- **`SweepResult`** also has `candidates` and `aborted`, and `art.swept` carries `candidates`. In a dry run, `deleted` stays 0.
- **The script logs `art.sweep_started`** with the bucket name, so every manual run shows which bucket it works on.
- **`app.started`** gains `art_sweep` (true or false).
- **Delete errors:** only `ClientError` and `BotoCoreError` are caught per key, as `art.delete_failed`. Anything else ends the sweep, as `art.sweep_failed`.
- **The loop logs its own failures.** The generic background-task wrapper of backend_plan §10.2 waits for M6, which has several tasks.
- **`FakeRedis` lives in `test_art_cleanup.py`**, not in `helpers.py`, since only that file uses it (`test_health.py` keeps its own, which has `ping`).
- **`upload_service._art_key_pattern`** builds both the per-user check of `verify_art_key` and `is_art_key`, so the key shape is written once.

## Tasks
Order: storage helpers, service, settings and lifespan, script, tests, docs. Each step comes with its tests.

### Backend
- [x] `storage/client.py`: `StoredObject(key, last_modified)`, `list_objects(s3, bucket, prefix)` (a loop on `NextContinuationToken`) and `delete_object(s3, bucket, key)`.
- [x] `upload_service.is_art_key(key)`, built from the existing key patterns.
- [x] `services/art_cleanup_service.py`: `referenced_art_keys`, `sweep` (with `SweepResult`), `run_if_due` (the Redis gate) and `sweep_forever` (the hourly loop).
- [x] `core/config.py`: the four `art_sweep_*` settings, all with defaults.
- [x] `main.py`: the lifespan starts the loop when it is enabled, and cancels it on shutdown.
- [x] `scripts/sweep_art.py`: `--delete`, `--grace-hours` and `--max-deletes`.
- [x] Reword the "art is never deleted" comments in `share_service._copy_cards` and `test_user_deletion.py`.

### Config
- [x] `.env.example`: the four `ART_SWEEP_*` variables, with the sweep off.
- [x] `render.yaml`: `ART_SWEEP_ENABLED` with `value: "true"`.

### Tests
- [x] `tests/helpers.py`:
  - `FakeS3` gets `last_modified` on `put()` (a fixed `UPLOADED_AT` by default), a paged `list_objects_v2`, `delete_object` and failing deletes
- [x] `tests/test_art_cleanup.py` (15 tests, with its own small `FakeRedis`):
  - an abandoned upload is deleted, and a young one is kept
  - card art and origin backgrounds in use are kept
  - art that is replaced through PATCH or cleared is deleted
  - an imported copy keeps the author's art after the author deletes the card, and after the account is deleted
  - a deleted account's art is deleted when nothing imported it
  - keys outside the art-key shape are ignored
  - a dry run deletes nothing
  - the `max_deletes` guard
  - a failed delete is logged, and the rest still go
  - listing across pages
  - `run_if_due` runs once, then skips, and keeps uploads within the grace period
  - the loop logs `art.sweep_failed` and goes on
  - the fields of `art.swept`
- [x] **By hand** against the dev bucket (see Notes).

### Docs
- [x] [backend_plan.md](backend_plan.md):
  - §1: art cleanup is built
  - §3: the new service and script
  - §4: the forks note ("kept while any row references it") and the games note
  - §10.2: the `art.*` events
  - a new §10.3 Art cleanup
  - §11: a line saying which cross-cutting features were built between milestones
- [x] [frontend_plan.md](frontend_plan.md): in F5 and F6, card art falls back to the no-art look when the image fails to load.
- [x] [deployment.md](deployment.md):
  - the `ART_SWEEP_*` variables
  - running the dry run against production
  - troubleshooting `art.sweep_aborted` and `art.sweep_failed`
  - R2 in the free-tier table
- [x] Update this file, and write the session file.

## Out of scope
- **Deleting inline** when a card or origin is deleted or its art changes.
- **Keeping art alive for finished games** (see Decisions).
- **An admin endpoint** or a GitHub Actions schedule for the sweep.
- **A trash prefix** with an R2 lifecycle rule, to make deletes recoverable.
- **Account deletion endpoint:** still none. The sweep already covers the art of an account deleted in SQL.

## Notes
- **Checked by hand on 2026-11-11** against the local Postgres and Redis and the dev bucket `web-board-game`:
  - **Dry run:** listed 3 objects. 1 was younger than 24 h. 2 were unused: the two test images that the F1 browser check left behind ([session_2026-11-10_f1.md](sessions/session_2026-11-10_f1.md)), one under `card-art/` and one under `origin-art/`.
  - **`--delete`:** deleted both, with `failed: 0`. So the existing R2 token allows single deletes. A second dry run listed 1 object.
  - **The app with `ART_SWEEP_ENABLED=true`:**
    - `app.started` showed `"art_sweep":true`, and `art.swept` followed after about 60 s, with no request id on the line
    - a restart logged `art.sweep_skipped`
    - the `art_sweep:last_run` key was removed from local Redis afterwards
  - **The production image** builds, and `python -m scripts.sweep_art --help` runs in it.
- **R2 listing** returns a timezone-aware `LastModified`, so it compares directly with `datetime.now(UTC)`.

## Open questions
- **After merging and deploying:**
  - check that Render's Environment shows `ART_SWEEP_ENABLED=true` from the Blueprint (add it by hand if not)
  - check that `app.started` shows `"art_sweep":true`
  - consider a dry run against production first: `docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art`

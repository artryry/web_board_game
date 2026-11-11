# Session 2026-11-11: Art cleanup (delete art that nothing references)

## Summary
We planned and built a daily sweep that deletes art objects in R2 that no card or origin references, on the `art-cleanup` branch. Nothing is committed yet.
- **Before:** art was never deleted (backend_plan §4), and none of the milestones M0–M7 covered it.
  - Orphans came from deleted cards, origins and accounts, replaced or cleared art, and abandoned uploads.
  - Imported copies share the author's key, so only a look at every row can tell an object is unused.
- **Now:**
  - Once a day, the app deletes art objects that no `cards.art_key` or `origins.background_art_key` references and that are older than 24 h.
  - A Redis key keeps it to one sweep a day, across restarts.
  - It is off by default, and on in production through `render.yaml`.
- **By hand:** `python -m scripts.sweep_art`, a dry run unless `--delete` is passed.

## How it went
1. **Plan.** The user asked for a plan, if art cleanup wasn't in a milestone. It wasn't.
   - The user chose a daily sweep only (nothing deleted inline), started in the app and gated by Redis, and no art kept alive for game snapshots.
   - The user then said production already has its own bucket, and to implement.
2. **current-feature.md** was rewritten for this feature first, as the user asked. The logging feature's leftovers stay in its session file.
3. **Code:**
   - storage helpers (`list_objects`, `delete_object`)
   - `upload_service.is_art_key`
   - `art_cleanup_service` (`referenced_art_keys`, `sweep`, `run_if_due`, `sweep_forever`)
   - the settings, the lifespan task, and the script
4. **Tests:** `FakeS3` paging and deletes, and 15 tests in `test_art_cleanup.py`.
5. **Checks:**
   - ruff, format and mypy
   - the full pytest run (476 passed)
   - by hand against the dev bucket (dry run, `--delete`, the app loop twice)
   - the production image build
6. **Docs:** backend_plan (§1, §3, §4, §10.2, a new §10.3, §11), frontend_plan (missing art in F5 and F6), deployment.md and current-feature.md.

## Decisions made
| Topic | Decision |
|---|---|
| When | A daily sweep only. One code path covers every kind of orphan, forks included. Deleting inline was set aside: more code paths, a race with imports, and abandoned uploads would still need the sweep. |
| Trigger | A task in the app. It checks 60 s after startup, then hourly; `SET art_sweep:last_run NX EX <interval>` decides. No extra Render wake-ups and no new secrets. Admin endpoints and GitHub Actions cron were set aside. |
| Game snapshots | They don't keep art alive. The board and replays fall back to the no-art look (frontend_plan, F5 and F6). |
| Safety | Off by default (`ART_SWEEP_ENABLED`). Only keys with the art-key shape are touched. Objects younger than 24 h are kept. More than 200 candidates at once deletes nothing (`art.sweep_aborted`). The script is a dry run unless `--delete` is passed. |
| Deletes | One `DeleteObject` per key. The multi-delete call needs a request checksum, and the volume is small. |
| Order | List the bucket first, then read the references, so an import that commits during the listing is seen. |

## Files changed
- **New:**
  - `backend/app/services/art_cleanup_service.py`
  - `backend/scripts/sweep_art.py`
  - `backend/tests/test_art_cleanup.py`
  - this file
- **Backend:**
  - `app/storage/client.py`: `StoredObject`, `list_objects` and `delete_object`
  - `app/services/upload_service.py`: `_art_key_pattern` and `is_art_key`
  - `app/core/config.py`: `art_sweep_enabled`, `art_sweep_interval_h`, `art_sweep_grace_h` and `art_sweep_max_deletes`
  - `app/main.py`: the sweep task in the lifespan, and `art_sweep` on `app.started`
  - `app/services/share_service.py`: the `_copy_cards` docstring
- **Tests:**
  - `tests/helpers.py`: `UPLOADED_AT`, and `FakeS3` with `last_modified`, `list_objects_v2`, `delete_object` and `failing_deletes`
  - `tests/test_user_deletion.py`: a comment
- **Config:**
  - `.env.example`: the `ART_SWEEP_*` variables
  - `render.yaml`: `ART_SWEEP_ENABLED: "true"`
- **Docs:** `context/backend_plan.md`, `context/frontend_plan.md`, `context/deployment.md` and `context/current-feature.md`

## Verification
- `ruff check .`, `ruff format --check .`, and `mypy app tests scripts/sweep_art.py`: pass.
- `pytest`: 476 passed (15 new).
- **By hand,** against the local Postgres and Redis and the dev bucket `web-board-game`:
  - **The dry run** listed 3 objects: 1 younger than 24 h, and 2 unused. Those 2 were the test images the F1 browser check left behind ([session_2026-11-10_f1.md](session_2026-11-10_f1.md)).
  - **`--delete`** removed both (`deleted: 2, failed: 0`). A second dry run listed 1 object.
  - **The API with `ART_SWEEP_ENABLED=true`:** `art.swept` came about 60 s after `app.started`, and a restart logged `art.sweep_skipped`. Afterwards the `art_sweep:last_run` key was deleted from local Redis.
- **The production image** builds, and `python -m scripts.sweep_art --help` runs in it.
- **Not verified yet:** anything on Render or against `card-art-prod` (nothing is deployed).

## Notes
- **The local `.env`** now points at the local Postgres and Redis and at the dev bucket. The open question from the logging session about `.env` pointing at production is resolved.
- **The docker stack** was started for the tests (`docker compose up -d`) and is still running.

## Next steps
1. Review, commit and merge `art-cleanup`.
2. After the deploy:
   - check Render's Environment for `ART_SWEEP_ENABLED=true`
   - check that `app.started` shows `"art_sweep":true`
   - optionally, run a dry run against production first: `docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art`
3. The logging feature's leftovers (e2e and the checks by hand) are in [session_2026-11-11_logging.md](session_2026-11-11_logging.md), under Next steps.

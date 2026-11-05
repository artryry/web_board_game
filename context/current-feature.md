# Current feature: M3 — Decks, share codes and import (decks and card groups)

**Status:** implemented 2026-11-04 on branch `m3-decks`, not committed yet. See [sessions/session_2026-11-04.md](sessions/session_2026-11-04.md).
**Plan reference:** [backend_plan.md §4 (`decks`, `deck_cards`, `share_codes`), §8 (decks, sharing, 409s), §11 (M3) and §13 ("copy content when an import starts")](backend_plan.md)
**Previous milestone:** M2 (content) is done. See [sessions/session_2026-11-01.md](sessions/session_2026-11-01.md).
**Unblocks:** F2 in [frontend_plan.md](frontend_plan.md) (deck builder, share dialog for decks and card groups, import page `/share/:code`).

## Goal
Users can build **decks** from their cards, and **share** a deck or a card group with a code. Another user who opens the code sees a preview and can **import** it. An import **forks** a full copy into their own library, so later edits by the author never change it.

A deck has **one origin**. Its cards have that origin or are `neutral`. Size, copy limits and whether neutral cards are allowed come from the **ruleset**, which arrives in M4. So M3 checks only the structural deck rules and the hard bounds. The ruleset check happens when a deck is selected for a room (M6), and on the client for display (F2).

## Done when
- [x] **Decks CRUD** works: list (mine, paginated), get (with its cards and counts), create, patch, delete.
  - the deck origin is one of the user's origins or a system origin
  - every card is the user's own, and has the deck's origin or is `neutral`
  - copy counts and the total stay within the hard bounds (see "Decisions")
  - changing the origin while cards of the old origin remain gives 422 (the frontend removes them first, after a warning)
- [x] **Cards and origins used by decks are protected:**
  - deleting a card used in a deck gives 409 `card_in_use` with `decks: [{id, name}]`
  - deleting an origin gives 409 `origin_in_use` when cards **or decks** use it (the body lists both)
  - changing a card's origin so it no longer fits a deck it is in gives 409 `card_in_use`
- [x] **Share codes:** `POST /api/decks/{id}/share` and `POST /api/card-groups/{id}/share` return `{share_code}`. Calling it again returns the same code. Only the owner can share.
- [x] **Preview:** `GET /api/share/{code}` shows any logged-in user what the code holds (kind, name, author, origin, cards with counts and art URLs). An unknown code gives 404 `share_not_found`.
- [x] **Import:** `POST /api/share/{code}/import` forks a copy into the caller's library in one transaction:
  - **deck:** copies its cards, and its origin if it is a custom one, then creates a new deck that uses the copies
  - **card group:** copies its cards and their custom origins into a new group
  - system origins are never copied; the copies use them directly
  - each source origin is copied once per import, even when many cards use it
  - copies keep the original `art_key` (art is never deleted, M2)
  - the response is the new deck or group
- [x] Changing or deleting the original after an import doesn't change the copy, and the reverse.
- [x] Another user's decks give 404, and only the owner can share them. Single cards have no share code.
- [x] Migrations run up and down cleanly. `pytest` (358 passed), `ruff check`, `ruff format --check` and `mypy app tests` pass.
- [x] Deleting a user (one `DELETE FROM users`) removes all their content, and copies others imported from them stay (added 2026-11-04).

## Decisions (confirmed 2026-11-04)
- **Deck limits without a ruleset:** a copy count is 1–4, and the total is at most 60 (the largest `deck.size` in backend_plan §6). An unfinished deck can be saved, so there is no minimum size. M4 then bounds `deck.max_copies` to 1–4 as well (`MAX_COPIES`, `MAX_DECK_SIZE` in `schemas/deck.py`).
- **Neutral cards are always allowed in a stored deck.** `allow_neutral` is a ruleset option, so it is checked with the ruleset (M6, F2), not on save.
- **A neutral deck** (origin `neutral`) is allowed and holds only neutral cards.
- **Deck PATCH replaces the whole card list** when `cards: [{card_id, count}]` is sent. The service diffs the rows: kept rows are updated in place, because one flush can't delete and insert the same primary key.
- **`deck_cards.card_id` is a deferred FK** (NO ACTION, `DEFERRABLE INITIALLY DEFERRED`), not `RESTRICT` as first proposed:
  - the database still refuses to delete a card a deck holds, which backs up the `card_in_use` 409
  - but it checks at COMMIT, after every cascade, so deleting a user works
  - `deck_cards.deck_id` is `ON DELETE CASCADE`
  - `cards.origin_id` and `decks.origin_id` stay `RESTRICT`; they don't block user deletion (see "Notes")
- **The cost suggestion has no upper cap** (confirmed 2026-11-04): `suggest_mana_cost` keeps its floor of 0. A card worth more than 10 mana is labelled `under` even at 10. The card's own `mana_cost` stays 0–10. The tests, `cost_cases.json` and backend_plan §7.8 follow.
- **Share codes live in one `share_codes` table with one FK column per kind** (changed from the proposed polymorphic `target_id`):
  - `code` PK, `deck_id` and `card_group_id`, each nullable, UNIQUE and `ON DELETE CASCADE`, plus `created_at`
  - a check makes exactly one target set; M4 adds `ruleset_id`
  - deleting the deck, the group or the user deletes the code in the database
  - there is no `owner_id`, since the target's owner is the code's owner
- **Share code format:** 10 characters from `core/codes.py`'s no-look-alike alphabet: `2–9` plus `A–Z` without `I`, `L` and `O`, so 31 characters and about 50 bits. Generated with `secrets`, inside a savepoint, retried on a collision or on a concurrent share. Lookups upper-case the input.
- **Revoking:** `DELETE /api/decks/{id}/share` and `/api/card-groups/{id}/share` remove the code (204, even if there is none), so an old link stops working. Sharing again gives a new code.
- **`share_code` is on deck and group responses** (null when not shared), so the share dialog can show the code and offer revoke.
- **The preview and the import use the current content**, not a snapshot taken when the code was made.
- **Preview and import responses are discriminated by `kind`** (`deck` / `card_group`), so M4 can add `ruleset`. A group preview uses the same `cards: [{card, count}]` shape, with count 1.
- **Importing your own code is allowed.** It works as "duplicate".
- **Where imported deck cards go:** into a new card group named after the deck, so the library stays tidy. An empty deck creates no group.
- **Name collisions on import:** a new group whose name is taken gets the first free suffix (`Forest (2)`), with the base cut to fit 40 characters. Decks and origins have no unique names, so they keep theirs.
- **Imports bypass `card_service._apply`.** The content was checked when it was saved, and `verify_art_key` would reject the author's key prefix.
- **`is_public` stays deferred.** A share code is an unlisted link, and nothing needs a public flag until a public gallery exists.
- **Pylance `get_owned` fix:**
  - `OwnedMixin` (in `models/mixins.py`) declares `owner_id`, and `Card`, `CardGroup` and `Deck` use it
  - `get_owned[M: OwnedMixin]` replaces the `Owned` Protocol, and takes loader `options`
  - there is no schema change (`alembic check` is clean)

## Tasks
Order: decks → in-use protection → share codes → preview → import.

### Decks
- [x] `models/deck.py`: `decks` (`TimestampMixin`, FK RESTRICT to origins, index on `(owner_id, origin_id)`) and `deck_cards` (`PK(deck_id, card_id)`, deferred FK and index on `card_id`, check `count >= 1`), plus a migration. Both relationships are `lazy="raise"`, and `cards` uses `passive_deletes`.
- [x] `schemas/deck.py`: `DeckCreate`, `DeckUpdate`, `DeckCardIn`, `DeckSummaryOut` (for the list: `origin_id`, `card_count`, `share_code`) and `DeckOut` (with `cards: [{card: CardOut, count}]`).
- [x] `services/deck_service.py`: validate the origin, the card ownership and origin fit, no repeated `card_id`, and the bounds. PATCH merges and re-validates the whole deck, like cards. After a write the deck is re-loaded (`populate_existing`); a cards-only change bumps `updated_at`.
- [x] `api/decks.py`: `GET/POST /api/decks`, `GET/PATCH/DELETE /api/decks/{id}`.

### In-use protection
- [x] `card_service.delete_card` → 409 `card_in_use` with the decks; the RESTRICT race re-runs the check. A card PATCH that changes `origin_id` checks the decks that hold the card (neutral always fits).
- [x] `origin_service.delete_origin` → `origin_in_use` lists `cards` and `decks`.

### Share codes
- [x] `models/share_code.py` and the migration (one migration `0ea15a74de55` adds decks, deck cards and share codes); `services/share_service.py` (create or reuse, revoke, resolve).
- [x] `POST`/`DELETE /api/decks/{id}/share` and `/api/card-groups/{id}/share`.

### Preview and import
- [x] `schemas/share.py`: `DeckPreview` / `CardGroupPreview` (kind, code, name, author username, origin(s), cards with counts), `DeckImported` / `CardGroupImported`.
- [x] `api/share.py`: `GET /api/share/{code}` and `POST /api/share/{code}/import`.
- [x] Forking in `share_service.py`: copy origins (custom only, once each), copy cards with remapped `origin_id`, then create the deck or group. One transaction, with explicit flushes so origins and the group are inserted before the rows that point at them.

### Tests
- [x] `test_decks.py`: CRUD, origin rules, neutral cards, bounds, PATCH replacing cards, changing the origin.
- [x] In-use 409s in `test_cards.py` and `test_origins.py`; `share_code` in `test_card_groups.py`.
- [x] `test_user_deletion.py`: a user's content goes with them, and imported copies outlive the author. `test_decks.py` checks that the deferred FK still refuses a held card.
- [x] `test_share.py`: idempotent share, revoke, preview, deck and group import, system vs custom origins, the copy is independent of the original, importing your own code, unknown and revoked codes, other users can't share your content.

### Docs
- [x] [backend_plan.md](backend_plan.md) §1, §3, §4 (decks, `share_codes`), §8 (endpoints, error codes, preview shape), §11.
- [x] [frontend_plan.md](frontend_plan.md) §4.2 (share dialog with revoke) and §4.2a (import page).
- [x] Decisions recorded above; session file written.

## Out of scope (later milestones)
- Rulesets, their share codes and `/rulesets/validate` (M4)
- Checking a deck against a ruleset's `deck` rules, and offering only valid decks for a room (M6, with a client-side check in F2)
- `scripts/seed.py` with starter cards, two starter decks and the default ruleset (M4)
- A public gallery of shared decks, and `is_public`
- Tracking where an import came from, or updating a copy when the original changes (imports are forks)
- Deleting R2 art objects that no card uses any more (backend_plan §13)
- Frontend work (F2)

## Carried over
- **R2 CORS rule (manual, from M2):** browser uploads in F1 fail until the bucket allows `PUT` and `GET` from `http://localhost` with the `Content-Type` header. The JSON is in [session_2026-11-01.md](sessions/session_2026-11-01.md) and backend_plan §10.

## Notes and decisions
- **Carried over from M1 and M2:**
  - every route except register and login takes `CurrentUser`; ids are UUIDs
  - errors use `{"detail": {"code", "message"}}`, with extra fields through `AppError(extra=...)`; 422 keeps FastAPI's default body for malformed input
  - another user's rows give **404** (`get_owned`); system origins are readable by all and read-only (403)
  - PATCH merges and re-validates the whole object; null clears optional fields
  - list endpoints use `limit`/`offset` and return `{items, total}`
  - content timestamps use `clock_timestamp()`
- **Deck rule** (confirmed 2026-10-31): a deck has exactly one origin, plus neutral cards (found by `system_key = 'neutral'`, `NEUTRAL_KEY`).
- **Sharing** (decided 2026-10-31): card content is shared only as a deck or a card group. Single cards are never shared.
- **Imports fork** (backend_plan §13): rooms and imports copy content, so later edits never break anyone's game or library.
- **Art objects are never deleted.** Imported cards share the original's `art_key`. The key is checked only when it changes, so the copy saves without a `HEAD`, even though the key is under another user's prefix.
- **Deleting a user** (found and fixed 2026-11-04):
  - With `deck_cards.card_id` as `RESTRICT`, `DELETE FROM users` failed for a user whose cards were in decks. Postgres runs the `users` → `cards` cascade before `users` → `decks` → `deck_cards`, and the immediate check fired in between.
  - The deferred FK fixes it.
  - Cards on custom origins were never affected: cards are a direct cascade from `users`, so they are gone before the origin's `RESTRICT` check runs. `test_user_deletion.py` covers both.
  - There is still no account-deletion endpoint; one plain `DELETE` on `users` is all it needs.
- **Forks outlive their source.** An import copies the custom origins, so the author deleting the original origin, deck, group or account never touches the copy. The copy keeps the author's `art_key`, which works because art is never deleted. Tested in `test_share.py::test_the_copy_is_independent_of_the_original` and `test_user_deletion.py::test_imported_copies_outlive_the_author`.

## Open questions
- **From M1: should refresh tokens be revocable** (logout, "log out everywhere")? That needs a `jti` allowlist in Redis. Revisit before the frontend auth pages (F0), which include logout.

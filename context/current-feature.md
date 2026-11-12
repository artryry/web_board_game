# Current feature: F2 — Deck builder, share dialog and import page

**Status:** built 2026-11-12 on the `f2-decks` branch, not committed yet. The checks by hand with art are still to do (see "Done when").
**Plan reference:** [frontend_plan.md §3, §4.2, §4.2a and §7](frontend_plan.md), [backend_plan.md §4, §6 and §8](backend_plan.md) (decks, rulesets, sharing, the error codes), [coding-standards.md](coding-standards.md)
**Depends on:** M3 (decks, share and import), F1 and M4 (rulesets and the seeded default ruleset). All three are done.
**Unblocks:** F4, whose lobby deck selector reuses the deck list and the validity check. F2 also covers use cases UC2 (create a deck) and UC8 (share a deck).

Earlier features still have follow-ups:
- **M4:** `c8cf578` is on `master` locally (and on `m4-rulesets`), but not pushed yet. Its two migrations run on deploy ([sessions/session_2026-11-12_m4-rulesets.md](sessions/session_2026-11-12_m4-rulesets.md)).
- **Art cleanup:** deploy it, then check Render ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the e2e run and the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
A logged-in user can:
- build decks: pick an origin, add cards by clicking or dragging, set copy counts, and see the mana curve and whether the deck fits a ruleset
- share a deck or a card group with a code and a link, and revoke it
- open someone's link, preview what they shared, and import a copy into their own library

Done when (frontend_plan §7): **a deck or a card group can be shared by code and imported by another user.**

## How it works

### Pages and routes
| Route | Page | New in F2 |
|---|---|---|
| `/decks` | `DeckListPage` | the deck list, plus a box to open a share code |
| `/decks/new` | `DeckBuilderPage` | a new deck; nothing is created until Save |
| `/decks/:id` | `DeckBuilderPage` | an existing deck |
| `/share/:code` | `ImportPage` | the preview and **Import to my library** |

- The main nav gets **Decks**, after Cards: Dashboard, Cards, Decks, Origins.
- A logged-out visitor who opens a share link logs in first, then comes back to it. `ProtectedRoute` already remembers the page.

### Deck list (`/decks`)
- Newest first, as the server orders them, with **Load more**, like the card library.
- **Each row shows:**
  - the name, linked to the builder
  - the origin (`OriginBadge`)
  - the card count against the default ruleset's size, for example "24 / 30 cards"
  - a "Shared" mark while it has a share code
- **Row actions:**
  - **Share** opens the share dialog
  - **Delete** asks first. When the deck is shared, the dialog says its link will stop working.
- The list shows only the size check. The summaries have no card lists, and the full check would cost one request per deck, so it lives in the builder.
- **New deck** goes to `/decks/new`.
- **"Have a share code?"** is a small form that opens `/share/<code>`. Case and spaces don't matter, and the server decides whether the code exists.
- **Empty state:** "No decks yet", with New deck and the code form.

### Deck builder (`/decks/new`, `/decks/:id`)
```
┌ Name [____________]  Origin [Forest ▾]           [Share] [Delete] [Save] ┐
├──────────── Library (Forest + Neutral) ───────┬──────── Deck · 24 cards ──┤
│ [Kind: All ▾] [Search name____]               │ 1  Sprout        − 2 +    │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │ 2  Wolf          − 2 +    │
│ │card│ │card│ │card│ │card│  click or drag →  │ 3  Bear          − 1 +    │
│ │2 in│ │    │ │    │ │4 in│  (4 in = full)    │ …                         │
│ └────┘ └────┘ └────┘ └────┘                   │ Mana curve  ▁▃▆█▅▂▁▁      │
│                                               │ Rules: [Default ▾]        │
│                                               │ ✓ 30 / 30 cards  ✗ copies │
└───────────────────────────────────────────────┴───────────────────────────┘
```
- **Header:**
  - name (required, at most 40 characters, `NAME_MAX_LENGTH`)
  - origin, from the same select the card editor uses (`OriginOptions`: templates, then my origins)
  - **Save**
  - **Share** and **Delete**, for a saved deck only
- **A new deck** starts with no origin. Until one is picked, the library says "Pick an origin to see its cards".
- **Library (left):**
  - the cards of the deck's origin plus neutral cards: two `GET /api/cards?origin_id=…` lists, loaded in full with `fetchAllPages`, or one list when the origin is neutral
  - filters on the client: kind, and a name search
  - each card shows how many copies the deck holds ("2 in deck")
  - **clicking a card adds one copy.** It is disabled at 4 copies, or when the deck has 60 cards (the server's hard bounds).
- **Drag-and-drop:**
  - Dragging a library card onto the deck panel adds one copy.
  - The deck panel lights up while a card is dragged over it.
  - A small pointer move is needed before a drag starts, so a click still adds.
  - Keyboard users add with Enter or Space on the card button, so they don't need the drag.
- **Deck (right):**
  - rows by mana cost, then name (the server's order)
  - each row shows the cost, the name and the origin icon, plus **−** and **+** buttons ("Remove one Wolf", "Add one Wolf"). **+** stops at 4, and **−** at 1 removes the row.
  - the total: "24 cards"
- **Changing the origin:**
  - The cards that won't fit are those neither of the new origin nor neutral. A neutral deck holds only neutral cards.
  - If there are any, a confirm dialog lists them ("These 6 cards will be removed"). Confirming changes the origin and drops them; Cancel keeps the old origin.
  - The next Save sends the new `origin_id` and the trimmed `cards` together, since the server rejects an origin change while old cards remain (`card_origin_mismatch`).
- **Save:**
  - **a new deck:** `POST /api/decks {name, origin_id, cards}`, then the address becomes `/decks/:id` (replace, with no unsaved-changes prompt)
  - **an existing deck:** `PATCH /api/decks/{id} {name, origin_id, cards}`. `cards` is always the whole list.
  - **server errors:**
    - `card_origin_mismatch`: lists the cards
    - `deck_too_large`
    - `invalid_deck_cards`: a card was deleted elsewhere. The message asks the user to reload.
    - `invalid_origin`
    - `deck_not_found`: the deck was deleted elsewhere; the page shows not-found
    - a name error goes on the name field (`showServerError`)
- **Unsaved changes:** the deck is dirty while its name, origin or cards differ from the last save.
  - Leaving the page then asks "Leave without saving?" (react-router's `useBlocker`, with `ConfirmDialog`).
  - Closing or reloading the tab gets the browser's own prompt (`beforeunload`).
- **Delete** asks first, goes to `/decks`, and says the share link stops working if there is one.
- **Mana curve** (`ManaCurveChart`):
  - one bar per cost from 0 to 6, plus "7+", counting every copy
  - each bar has its count, and screen readers get the same numbers as a list
  - built from the authors' own costs, as information only
- **Validity panel** (`DeckValidityPanel`, information only):
  - a ruleset select: the default ruleset, preselected, then the user's own rulesets
  - **checks the deck against that ruleset's `deck` rules:**
    - **size:** exactly `deck.size` cards, for example "24 / 30 cards"
    - **copies:** the cards over `max_copies`, by name
    - **neutral:** when `allow_neutral` is false, the neutral cards in a deck of another origin. A neutral deck's cards are its own origin, so a neutral deck still passes.
  - a pure function, `deckProblems(entries, rules)`, with unit tests. F4's lobby reuses it.
  - it says that the server checks the deck when it's picked for a room (M6). Saving is never blocked by it.

### Share dialog (decks and card groups)
- **`features/share/ShareDialog.tsx`**, one dialog for both kinds. It is opened from:
  - the deck list
  - the builder (a saved deck)
  - each group in the card library's group panel. The panel also marks shared groups.
- **Not shared yet:**
  - It explains: "Anyone with the link can preview it and import a copy. Your later edits show up in new imports."
  - **Create link** sends `POST /api/decks/{id}/share` (or `/api/card-groups/{id}/share`).
- **Shared:**
  - the code, large and monospaced, plus the full link (`<origin>/share/<code>`)
  - **Copy link** (`navigator.clipboard`, showing "Copied"). If the clipboard fails, the link text is selected, so the user can copy it by hand, and `share.copy_failed` is logged (warn).
  - **Revoke** asks first: "The link stops working. Sharing again makes a new code." Then it sends `DELETE .../share`.
- After create and revoke, the deck and group queries are refreshed, so `share_code` shows everywhere.
- **In the builder with unsaved changes,** the dialog notes that the saved version is what gets shared.

### Import page (`/share/:code`)
- **`GET /api/share/{code}`** gives the preview, depending on `kind`:
  - **`deck`:** the name, "Deck by <author>", the origin (`OriginBadge` and `OriginPreview`), the card count, the cards with their counts (`CardView`, with ×n), and the mana curve
  - **`card_group`:** the name, "Card group by <author>", the origins its cards use, and the cards
  - **`ruleset`:** the name and the author, plus "Rule sets can be imported once the rules editor is ready (F3)". There is no import button yet. The preview also carries the full `definition`, which F2 doesn't show.
- **Before importing,** it says what the import does: "Copies the cards (and N custom origins) into your library. Your copy won't change when the author edits theirs."
  - When the author is the current user, it adds: "This is yours: importing makes a copy."
- **Import to my library** sends `POST /api/share/{code}/import`.
  - It refreshes the decks, cards, card groups, origins and counts.
  - Then it goes to `/decks/:id` for a deck, or `/cards?group=<id>` for a group (`libraryParams` already reads `group`).
- **`share_not_found`,** on the preview or the import, shows "This link doesn't work any more. It may have been revoked, or the deck or group deleted", with a link to the dashboard.

### Changes to F1 pages
- **Delete dialogs:** in `DeleteCardDialog` and `DeleteOriginDialog`, deck names in the 409 lists become links to `/decks/:id` (`InUseList`'s `linkTo`). So does the card editor's `card_in_use` on an origin change.
- **`CardGroupPanel`:** a Share action per group, and the shared mark.
- **Stale comments** go, in `MoveToGroupDialog` ("Drag-and-drop arrives in F2") and `test/handlers.ts` ("Decks arrive in F2"). Moving cards between groups keeps the dialog.

### API hooks
- **`api/hooks/useDecks.ts`:**
  - the list (infinite, newest first) and one deck
  - create, update and delete, which also refresh the counts
- **`api/hooks/useShare.ts`:**
  - share and revoke, for a deck or a group
  - the preview (`["share", code]`, never retried on 404) and the import
- **`api/hooks/useRulesets.ts`:** `GET /api/rulesets`, the default ruleset first, then the user's own (see "From M4").
- **Types** come from `schema.d.ts`; run `npm run gen:api` first (see Setup).

### Fake API for tests (MSW)
- **`test/contentStore.ts`:**
  - decks get `cards: {cardId, count}[]` and a `shareCode`
  - groups get a `shareCode`
  - a rulesets fixture with the default ruleset
- **`test/contentHandlers.ts`** handles:
  - `/api/decks` (list, get, create, PATCH, delete), with the hard bounds and `card_origin_mismatch`
  - `.../share` (create and revoke), for decks and groups
  - `/api/share/{code}` and its import (a simplified fork)
  - `/api/rulesets`

### Drag-and-drop library
- **dnd-kit** (frontend_plan §1). Check the newest release and its React 19 support before installing, since dnd-kit also ships a newer `@dnd-kit/react` package. Pin the exact version.
- F2 needs only the core package; sortable lists come with F3's phase pipeline.

### Logging
- **No new events, apart from `share.copy_failed`.** The server already logs `share.created`, `share.revoked` and `share.imported`, and API failures go through `api.request_failed`.

### From M4
The validity panel and the import page use these (backend_plan §4, §6 and §8):
- **Listing:** `GET /api/rulesets` (paginated, `{items, total}`) lists the seeded default ruleset first, then the user's own by name. Each item is a full `RulesetOut`, so `definition.deck` (`size`, `max_copies`, `allow_neutral`) needs no second request. `GET /api/rulesets/{id}` returns one.
- **Finding the default:** it is a read-only system ruleset, `is_system: true` and `system_key: "default"`, named "Default". Code finds it by `system_key`.
- **The share preview's `ruleset` kind:** `{kind: "ruleset", code, name, author, definition}`.

## Done when
- [x] **Deck list:**
  - the user's decks, newest first, with origin, card count against the default size, and the shared mark
  - share and delete from the list
  - a share code can be typed in and opened
- [x] **Deck builder:**
  - a new deck is created on Save
  - cards are added by click and by drag; **−** and **+** set the copies within 1–4, at most 60 in total
  - an origin change lists the cards it removes, and Save sends both together
  - server errors show where they belong
  - leaving with unsaved changes asks first
- [x] **Mana curve and validity panel:**
  - the curve shows bars from 0 to 7+
  - the panel checks size, copies and neutral against the default ruleset, or a chosen one, as information only
- [x] **Share dialog:**
  - for decks and groups: create, show the code and link, copy, and revoke
  - an existing code shows on open
- [x] **Import page:**
  - previews of a deck, a group and a ruleset (preview only)
  - importing lands on the new deck, or on the card library filtered to the new group
  - a revoked or unknown code shows the "doesn't work any more" message
- [x] **F1 pages:** deck names in the 409 lists are links, and groups can be shared from the card library.
- [x] **Checks pass:** `npm run lint`, `format:check`, `typecheck`, `test` and `build`. `npm run e2e` passes with the new share spec, run with `--workers=1` (see Notes: the dev nginx stalls under parallel load).
- [ ] **Checked by hand** through nginx (the first two are covered by `e2e/share.spec.ts` through nginx; the art and a look in two real browsers are still to do):
  - one user builds a deck by dragging and shares it
  - another user, in a second browser, imports it
  - the same for a card group
  - the copied art shows

## Decisions
Confirmed with the user on 2026-11-11:
- **Build M4 before F2.** The validity panel uses real rulesets, with the seeded default, and no deck rules are copied onto the client. (M4 is built.)
- **New decks use `/decks/new`,** like the card and origin editors. Nothing is created until Save, so no empty decks are left behind.
- **No drag-and-drop in the card library.** F2 drags only from the library into a deck. Moving cards between groups keeps the dialog.
- **Leaving the builder with unsaved changes asks first** (in-app navigation and the tab's `beforeunload`).
- **`deck.size` is exact:** a deck needs exactly that many cards for a room. The panel shows "24 / 30 cards" as a problem until it is 30.
- **`allow_neutral: false` still allows a neutral deck.** It only flags neutral cards in a deck of another origin.

Confirmed with the user on 2026-11-12 (proposed by the plan, all kept):
- **The deck list checks only the size.** The full check (copies, neutral) is in the builder, since the list's summaries have no cards.
- **The share dialog lives in `features/share/`**, not `features/decks/` as frontend_plan §2 has it, since groups use it too.
- **The share code form is on `/decks`.** The dashboard's "Join by code" (F4) is for rooms, and a second code box there would be confusing.
- **The mana curve** has bars for 0–6 and 7+, built with CSS (no chart library).
- **The builder's library** loads the origin's cards and the neutral cards in full, and filters on the client. The card library's paging isn't needed for one origin's cards.
- **Shared rulesets are previewed only.** M4's server import works, but F3 adds the rulesets page an import would land on.

## Decided while building (2026-11-12)
- **dnd-kit:** `@dnd-kit/core` 6.3.1 (confirmed with the user). `@dnd-kit/react` was 0.5.3, pre-1.0. Only the pointer drags (5 px to start); there is no keyboard sensor, so Enter and Space press the card's own button.
- **The ruleset schema (backend):** `RulesetDefinition` sets `json_schema_serialization_defaults_required`, so the generated types mark `deck`, `board` and the other sections required. Without it they came out optional, since `default_factory` writes no default into the schema. Backend checks pass (564 tests).
- **`OriginPreview` takes props;** `OriginFormPreview` feeds it the origin form's values, and the import page uses it directly.
- **`ui/IconButton`** is `CardGroupPanel`'s old private icon button, shared with the deck list and the deck rows (now with `disabled`).
- **The builder's state:** React Hook Form holds the name and origin; the cards are local state. Dirty means the form is dirty, or the cards differ from the last save. A save after an origin change sends both. A `deck_not_found` on Save reloads the deck, so the page shows not-found.
- **Copy:** "Rule sets can be imported once the rules editor is ready." (no "F3" in the UI). A deck import's note adds "in a new card group named after the deck".
- **Card edits refresh open decks** (`["decks", "detail"]`), since a deck shows its cards' names and costs.
- **The fake API** for decks, rulesets and sharing lives in `test/deckHandlers.ts` and `test/shareHandlers.ts`, with shared helpers in `test/handlerUtils.ts`. The mock's `card_group_not_found` is now the server's `group_not_found`.

## Tasks
Order:
1. `npm run gen:api` and dnd-kit
2. hooks and the fake API
3. share dialog
4. deck list
5. builder
6. import page
7. F1 page changes
8. e2e
9. docs

Each step comes with its tests.

### Setup
- [x] `npm run gen:api` with the API running on M4's code, and check that only the ruleset and share types change.
- [x] Check dnd-kit's newest release and its React 19 support, then install it with an exact version.
- [x] Routes: `/decks`, `/decks/new`, `/decks/:id` and `/share/:code`. Add Decks to the nav.

### Hooks and fake API
- [x] `useDecks.ts`, `useShare.ts` and `useRulesets.ts`.
- [x] The fake API: decks with counts and share codes, group share codes, share preview and import, and rulesets.

### Decks
- [x] Pure helpers, with unit tests:
  - `deckEntries`: add, remove, the 1–4 and 60 bounds, and trimming on an origin change
  - `manaCurve`
  - `deckProblems`
- [x] `DeckListPage`, with the share code form.
- [x] `DeckBuilderPage`:
  - the header, the library panel (the origin's and neutral cards, with filters), the deck panel and the origin-change dialog
  - save and its errors, the unsaved-changes guard, and delete
- [x] Dragging library cards into the deck (dnd-kit), with click and keyboard to add as well.
- [x] `ManaCurveChart` and `DeckValidityPanel`.

### Sharing
- [x] `ShareDialog`: create, copy (with the fallback), revoke, and an existing code.
- [x] `ImportPage`: the deck, group and ruleset previews, the own-content note, import and where it goes, and `share_not_found`.

### F1 pages
- [x] Deck links in `DeleteCardDialog`, `DeleteOriginDialog` and the card editor's `card_in_use`.
- [x] `CardGroupPanel`: Share, and the shared mark.
- [x] Remove the stale F2 comments.

### Tests
- [x] **Unit:** `deckEntries`, `manaCurve` and `deckProblems`.
- [x] **Pages (Vitest and MSW):**
  - **`DeckListPage`:** the list, the size check, delete, and the code form
  - **`DeckBuilderPage`:**
    - a new deck, and an existing deck
    - adding by click, the bounds, and **−**/**+**
    - an origin change, with its dialog
    - the Save payload, `card_origin_mismatch` and `deck_too_large`
    - the unsaved-changes prompt
  - **`ShareDialog`:** create, copy, revoke, and an existing code
  - **`ImportPage`:**
    - a deck, a group, your own content, and a ruleset (no import button)
    - an import, and where it lands
    - not found
  - **F1 pages:** the deck links in the delete dialogs, and sharing from `CardGroupPanel`
- [x] **e2e** (`e2e/share.spec.ts`, two browser contexts):
  - Alice makes cards and builds a deck, with one card dragged and one clicked, saves and shares it.
  - Bob opens the link, sees the preview, imports, and lands on his copy.
  - The same for a card group, landing on the filtered card library.

### Docs
- [x] [frontend_plan.md](frontend_plan.md):
  - §1: dnd-kit (core in F2, sortable in F3)
  - §2: the `decks/` and `share/` files, and the new hooks
  - §3: `/decks/new`, and the size check in the deck list
  - §4.2: creating a deck, the unsaved-changes guard, the validity panel and where the share dialog opens from
  - §4.2a: the code form, the own-content note and the `ruleset` kind
  - §7: F2 done
- [x] Update this file, and write the session file.

## Out of scope
- **Drag-and-drop in the card library** (decided above).
- **Importing rulesets:** F3. The import page only previews them (confirmed 2026-11-12).
- **Duplicating a deck in place.** Importing your own code already makes a copy.
- **A deck's own art or cover, and deck notes.**
- **Validity in the deck list beyond the size.**
- **Starter decks:** `scripts/seed.py` (backend_plan §10).

## Notes
- **The dev nginx stalls under parallel load (found in F2, not caused by it).** `host.docker.internal` resolves to an IPv6 address that nginx can't reach (`Network unreachable`, logged since 2026-10-23), and nginx → host is slow for many small requests (8 parallel page loads: ~2.5 s straight from Vite, 7–10 s or a timeout through nginx). With 4 Playwright workers and two-user specs, page loads time out. `--workers=1` passes. A possible fix, not applied: map `host.docker.internal` to the IPv4 host gateway only, and/or limit Playwright's workers.
- **Bundle size:** the production bundle is 559 kB (F1: 480 kB), over Vite's 500 kB warning. It's a warning only; splitting by route was already planned for when F5 adds the board.
- **Things F1 left ready for F2:**
  - `libraryParams` reads `?group=<id>`, the address the group import goes to
  - `InUseList` takes `linkTo`
  - `useLibraryCounts` already counts decks
  - the dashboard has a Decks tile
- **`useBlocker` works here:** it needs a data router, and `App.tsx` uses `createBrowserRouter` while the tests' `renderApp` uses `createMemoryRouter` (react-router 8.5.1, checked 2026-11-12).
- **The backend's deck shapes** (`schemas/deck.py`):
  - the list returns `DeckSummaryOut` (`origin_id`, `card_count`, `share_code`)
  - `GET /api/decks/{id}` returns `DeckOut`, which adds `cards: [{card: CardOut, count}]`, sorted by mana, then name
  - the hard bounds are `MAX_COPIES = 4` and `MAX_DECK_SIZE = 60`. They will be copied into `api/bounds.ts`.

## Open questions
None at the moment.

# Current feature: F1 — Catalog, SchemaForm, origin and card editors, card library, art upload

**Status:** done, not committed yet. Spec written, planned and implemented 2026-11-10, on branch `f1-catalog` (from `master` at `d78c24f`, F0). See [sessions/session_2026-11-10.md](sessions/session_2026-11-10.md).
**Plan reference:** [frontend_plan.md §0, §3 (origins and cards), §4.0, §4.1, §7 (F1) and §8](frontend_plan.md); [backend_plan.md §4 (origins, cards, card groups), §5 (catalog and the SchemaForm contract), §7.8 (cost suggestion) and §8 (endpoints, errors, PATCH rules, paging)](backend_plan.md); [coding-standards.md §3](coding-standards.md)
**Depends on:** F0 (done, merged into `master`) and M2 (done). M3 is done too.
**Unblocks:** F2 (deck builder, share dialog for decks and card groups, import page).

## Goal
A logged-in user can build the content of their game:
- **origins**: create, edit, duplicate and delete them, with a colour, an icon, an optional background image and up to 3 field effects
- **cards**: create, edit and delete creatures and spells, with abilities or an effect, art, and a cost suggestion that updates as they type
- **card library**: sort cards into groups, filter them, and see each card's balance label

F1 also builds what F2–F5 reuse:
- `useCatalog` and `SchemaForm`
- `ui/CardFrame` (how a card looks, on the board too)
- the origin colour and icon helpers
- `ArtUpload`
- `ui/Modal`
- the cost formula

## Done when
- [x] **Catalog:**
  - `useCatalog` loads `GET /api/catalog` once per session
  - every module settings form is built from it by `SchemaForm`, with no form written for one module
- [x] **`SchemaForm`** renders:
  - integers (with min/max), numbers, booleans and string enums
  - arrays of enums: checkboxes with `uniqueItems`, otherwise a list of selects
  - labels from `title`, defaults from `default`
  - a schema with no properties renders nothing, and an unsupported property shows a visible error instead of being skipped
- [x] **Origin list (`/origins`):**
  - the system origins appear as read-only templates with **Duplicate**
  - the user's own origins can be edited, duplicated and deleted
- [x] **Origin editor (`/origins/new`, `/origins/:id`):**
  - fields: name, colour, icon, an optional background image, and up to 3 field effects with no repeats, each set up with `SchemaForm`
  - `OriginPreview` updates live
  - a system origin's page is read-only
  - deleting an origin in use shows the server's `origin_in_use` lists of cards and decks
- [x] **Card editor (`/cards/new`, `/cards/:id`):**
  - fields:
    - kind, name and mana cost
    - origin: the user's own and the system origins. **+ New origin** opens the origin editor in a modal and selects the new origin.
    - HP and DMG
    - abilities (creatures, at most 2, no repeats) or one effect (spells), set up with `SchemaForm`
    - group and art
  - a spell's DMG follows its effect's `dmg_use` (see Decisions)
  - changing the kind sends the right nulls, for example `hp: null` for a spell
  - `CardPreview` shows the card in `CardFrame`
  - deleting a card that a deck holds, or moving it to an origin that doesn't fit one, shows the server's `card_in_use` list of decks
- [x] **Cost suggestion:**
  - `CostSuggestion` updates as the stats and the ability params change
  - **Use suggested** fills in the suggestion, capped at 10. Above 10, the hint says the card is stronger than any legal cost.
  - Save is never blocked by the formula, and the editor shows no balance label
- [x] **Card library (`/cards`):**
  - a group panel lists **All cards**, **Ungrouped**, and each group with its card count
  - groups can be created, renamed and deleted. `group_name_taken` shows on the name field. Deleting asks first and keeps the cards.
  - a grid of cards in `CardFrame`, each with its balance label (*under-costed / balanced / over-costed*, in words and not by colour alone)
  - filters for origin and kind, with the group and the filters kept in the URL
  - **Load more** paging
  - a card can be moved to another group from the grid and from the editor
- [x] **Art upload** (card art and origin backgrounds):
  - the browser checks the type (png, jpeg, webp) and the size (2 MiB or less) before any request
  - flow: `POST /api/uploads/{card-art|origin-art}`, then `PUT` the file to `upload_url` with the same `Content-Type`, then save `art_key` with the card or origin
  - the preview shows the picked file at once, cropped by CSS to the art frame
  - **Remove** sends `null`
  - errors (`unsupported_art_type`, `art_too_large`, a failed `PUT`, `invalid_art_key`) show at the uploader
  - a real upload through R2 is checked by hand in the browser: card art and an origin background, both shown from the public URL
- [x] **Nav:** Dashboard, Cards, Origins.
- [x] **Checks pass:**
  - `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and `npm run build`
  - `npm run e2e`, with the auth spec plus the new content spec
  - `npm run gen:api` gives no diff (F1 doesn't change the API)

## Decisions
Confirmed with the user on 2026-11-10:
- **Art is cropped by CSS only:** `object-fit: cover` in the art frame, and the original file is uploaded unchanged. There is no crop tool. (frontend_plan §4.1 updated.)
- **No cost filter in F1.** `GET /api/cards` filters only by origin, kind and group. A cost filter needs a backend change and waits. (frontend_plan §3 updated.)
- **Art upload tests are mocked:**
  - MSW fakes the presign and the R2 `PUT` in component tests
  - the e2e spec doesn't upload art, so it doesn't depend on R2 and leaves nothing in the bucket
  - one real upload is checked by hand
- **The R2 CORS rule is in place** (the user, 2026-11-10), so browser uploads can reach the bucket.

Confirmed with the plan on 2026-11-10, with these changes to the proposals below:
- **`features/origins/OriginIcon.tsx`** replaces `originIcons.tsx`. The file exports a component, so the standards want PascalCase, and `react-refresh/only-export-components` rejects a `.tsx` that also exports the key → icon map. The map stays private inside it.
- **A spell's effect is a required Effect select** plus `SchemaForm` (`SpellEffectField.tsx`), not a `ModuleListField`, since a spell needs exactly one.
- **Modals render outside the editor's `<form>`**, because the **+ New origin** modal holds its own form and nested forms are invalid HTML.
- **The test setup also stubs `URL.createObjectURL` and `revokeObjectURL`**, which jsdom 29 lacks.
- **Two extra shared files:** `ui/ConfirmDialog.tsx` (the three delete flows) and `api/inUse.ts` (narrows a 409's `cards`/`decks` lists).
- **Group panel counts:**
  - **All cards** shares the dashboard's `['cards', 'count']` query
  - **Ungrouped** adds `['cards', 'count', 'ungrouped']`
- **A new card starts as** a creature with HP 1, DMG 1 and mana 1, the origin from `?origin=` (or Neutral) and the group from `?group=`.
- **Cards are deleted from the editor.** The grid has Edit and **Move to group…**.
- **`lucide-react` 1.71.0**, the newest release, with all 16 origin icons checked.

The proposals, as confirmed:
- **Icons:**
  - use `lucide-react`, pinned exactly and checked with `npm view`. The catalog's 16 `origin_icons` keys are all Lucide icon names.
  - `features/origins/originIcons.tsx` maps each key to its component, imported one by one so the bundle holds only those 16
  - an unknown key (from a newer backend) falls back to `circle`
- **Origin colours:**
  - they come from `catalog.origin_colors` (key → hex) and are set inline (coding-standards §3)
  - swatches and section tiles get a `border-strong` outline, so `black` (`#000000`) stays visible on the charcoal table
  - colour is never the only signal: the icon and the name always come with it
  - the colour and icon pickers are radio groups with names, so they work with the keyboard and screen readers
- **The catalog is cached for the whole session:**
  - query key `['catalog']`, `staleTime: Infinity`
  - logout clears it with the rest of the cache
  - it changes only when the backend is deployed
- **`SchemaForm`:**
  - it lives in `catalog/SchemaForm.tsx` and works inside the editor's React Hook Form (`useFormContext`) under a name prefix (for example `abilities.0.params`), so the params are part of the editor's form state
  - the client checks only the schema's bounds; the server's `invalid_params` 422 is still shown
  - adding a module fills its params from the schema defaults
- **`catalog/ModuleListField.tsx`** is the list of chosen modules, used by creature abilities (at most 2) and origin field effects (at most 3):
  - an **Add** select that hides the modules already chosen and is disabled at the limit
  - each chosen module shows its name, its description, its `SchemaForm` and **Remove**
  - F3's phase lists need ordering and repeats, so they will be built separately
- **Cost formula:**
  - `features/cards/cost.ts` mirrors `card_points` and `suggest_mana_cost` from `engine/cost.py`, plus an ability's cost: `base + Σ weight × params[name]` from the catalog's `cost`
  - its test runs every case in `backend/tests/fixtures/cost_cases.json`
  - the balance label always comes from the server's `balance`, so the client doesn't copy that function
  - the editor computes locally and doesn't call `POST /api/cards/suggest-cost`, so typing sends no requests
  - empty or invalid inputs count as 0, like the server's `hp or 0`
- **Spell DMG by `dmg_use`:**
  - `damage`: a "Damage" field, 1–99
  - `heal`: a "Heal" field, typed as 1–99 and sent as a negative number (a stored −3 shows as 3)
  - `none`: hidden, and sent as `null`
- **Changing the kind** clears the abilities, because features and spell effects are different modules. A spell sends `hp: null`.
- **Input bounds:**
  - `api/bounds.ts` copies the server's content limits, the way `auth/bounds.ts` does: names 1–40, mana 0–10, HP 1–99, creature DMG 0–99, spell damage or heal 1–99, at most 2 abilities and 3 field effects, the art types and 2 MiB
  - a comment points at the backend schemas
  - the server's 422s are still shown
- **Art upload:**
  - the upload starts as soon as a file is picked, so Save stays quick and an upload error shows at once
  - an upload that is never saved leaves an unused object in R2. Art objects are never deleted anyway (backend_plan §4).
  - the preview uses `URL.createObjectURL` (revoked when it changes or unmounts) until the saved item's `art_url` or `background_art_url` takes over
  - Save waits while an upload runs. This isn't a formula block.
  - the R2 `PUT` uses plain `fetch` in `api/uploadArt.ts`, without the bearer header, since R2 is another origin. Components never call `fetch` themselves.
  - `ArtUpload` lives in `features/cards/` (frontend_plan §2), and the origin editor imports it from there
- **Saving:**
  - the editors send the whole editable form on PATCH, not only the changed fields. The server re-checks the merged card anyway, and switching the kind then always sends its nulls.
  - `art_key` is checked by the server only when it changes, so resending it is free
  - Save and Cancel go back to the list the user came from, with its filters
- **Duplicate** opens `/origins/new?from=<id>` filled in from the source, with the name "<name> copy" (cut to 40 characters). Nothing is created until Save, which `POST`s a new origin. Own origins can be duplicated too.
- **URLs:**
  - the library keeps its state in the query string: `group` (a group id or `ungrouped`), `origin` and `kind`
  - F2's import can then link to `/cards?group=<id>`
  - **New card** passes the current group and origin on to `/cards/new?group=…&origin=…` as starting values
- **Lists and paging:**
  - origins and card groups are short lists. `useOrigins` and `useCardGroups` load every page (100 per request) until they have `total`.
  - the card grid uses `useInfiniteQuery` with 50 per page and **Load more**
  - the origin picker groups the system origins and the user's own (`<optgroup>`)
- **Data hooks and cache keys:**
  - the hooks live in `api/hooks/`: `useOrigins`, `useOrigin`, `useCards`, `useCard`, `useCardGroups`, their mutations, and `useArtUpload`
  - the keys start with `['origins']`, `['cards']` or `['card-groups']`, so the dashboard's count keys are refreshed by prefix
  - a card change refreshes `cards` and `card-groups`, because the group counts change
  - a group change refreshes both too, because deleting a group moves its cards to ungrouped
  - an origin change refreshes `origins`
- **Moving a card** to another group: **Move to group…** on a grid card opens a modal listing the groups and "No group". There is no drag-and-drop yet; dnd-kit arrives in F2.
- **Deleting** asks for confirmation in a modal. A 409 shows its `[{id, name}]` lists in the same modal, with cards linked to their editors. Decks have no page until F2, so they show as names.
- **`ui/Modal`:**
  - it is built on the native `<dialog>` with `showModal()`, which gives focus handling, Esc to close and an inert background
  - jsdom 29 has `HTMLDialogElement` but no `showModal`/`close`, so `src/test/setup.ts` adds a small stub
- **`ui/CardFrame`:**
  - it only displays, with no domain logic
  - props: name, cost, HP, DMG, the art URL, the origin's hex and icon, and the ability names
  - two sizes: `sm` for the library (and later the hand) and `md` for the editor preview
  - F5 reuses it on the board
- **`OriginPreview`** shows a section tile:
  - the background image (or the colour), the icon and the name
  - one badge per field effect: the module name, with its params as "Title value" in the badge's description
- **Server errors on forms:** `auth/showServerError.ts` moves to `api/showServerError.ts` and takes a code → field map. Auth passes its current map. Content forms map:
  - `group_name_taken` → name
  - `invalid_art_key` → art
  - anything else (`invalid_stats`, `invalid_params`, `invalid_abilities`, ...) → the form's message
- **New dependency:** only `lucide-react`.
- **New files the plan's layout (frontend_plan §2) doesn't list yet:**
  - `catalog/ModuleListField.tsx`
  - `features/origins/OriginForm.tsx` (the form, shared by the page and the **+ New origin** modal)
  - `features/origins/originIcons.tsx`
  - `features/cards/cost.ts`
  - `api/bounds.ts`, `api/uploadArt.ts`, `api/showServerError.ts` (moved)
  - `ui/SelectField.tsx` (a labelled select, like `TextField`)

Changed or added while implementing (2026-11-10), all now in frontend_plan §2:
- **`originValues.ts` and `cardValues.ts`** hold the pure form ↔ API code. Names like `originForm.ts` clash with `OriginForm.tsx` on Windows, which ignores case in file names.
- **More small files**, to keep each one doing one thing and under about 200 lines:
  - `catalog/`: `schemaFields.ts` (the pure schema parser, tested on its own), `EnumArrayParams.tsx`, `useFieldError.ts`, `humanize.ts`
  - `ui/`: `ButtonLink`, `ErrorAlert`, `InUseList`, `LoadingState`, `buttonStyles.ts`, and a `danger` button variant
  - `features/origins/`: `OriginListItem`, `OriginLookFields`, `originLook.ts`, `DeleteOriginDialog`
  - `features/cards/`: the editor's field groups, `CardView`, `LibraryCard`, `LibraryFilters`, the group, move and delete dialogs, `libraryParams.ts` and `useArtField.ts`
- **`ui/Modal`:**
  - it focuses an element marked `data-autofocus` once open, because React's `autoFocus` runs before `showModal()`
  - it gives focus back to the control that opened it (checked in the browser)
- **A deleted card's own query isn't refetched**, so its editor doesn't flash a 404 while it closes.
- **A spell's "Choose an effect." error** is read from `errors.abilities.root` too. React Hook Form files it there once the creature ability list has been shown.
- **The file input** keeps the picked file's name, and is cleared after an error or a removal, so the same file can be picked again.
- **Test setup:**
  - Vitest may read `backend/tests/fixtures`, through `server.fs.allow` set only while Vitest runs. `cost.test.ts` imports `cost_cases.json` with `?raw`.
  - `testTimeout` is 15 s, and Testing Library waits up to 3 s. The defaults failed when the whole suite ran next to the dev stack.
- **Data hooks:** the dashboard's card count is a `useQuery(cardCountQuery())` of its own, because `useQueries` rejected the shared query's key type.

## Tasks
Order: dependency and `ui/` → catalog and `SchemaForm` → shared hooks and helpers → origins → art upload → card editor and cost → library and groups → routes and nav → e2e → docs. Each step comes with its tests.

### Dependency and `ui/`
- [x] Add `lucide-react`, pinned exactly.
- [x] `ui/Modal.tsx` (native `<dialog>`, with a title, Esc and close) and the `showModal`/`close` stub in `src/test/setup.ts`.
- [x] `ui/SelectField.tsx` and `ui/CardFrame.tsx` (`sm` and `md`).

### Catalog and `SchemaForm`
- [x] `catalog/useCatalog.ts`: key `['catalog']`, `staleTime: Infinity`, plus a helper that finds a module by key.
- [x] `catalog/SchemaForm.tsx`: integer, number, boolean, string enum, an array of enums (checkboxes with `uniqueItems`, otherwise a list of selects within `minItems`/`maxItems`), no properties, and an unsupported property shown as an error.
- [x] `catalog/ModuleListField.tsx`: add, remove, the limit, no repeats, and defaults from the schema.

### Shared hooks and helpers
- [x] `api/bounds.ts` (the content limits), and `api/showServerError.ts` moved from `auth/`, with a code → field map. Update the auth pages.
- [x] `api/hooks/useOrigins.ts` (all pages, `useOrigin`, create, update, delete), `useCardGroups.ts` (all pages, create, rename, delete), `useCards.ts` (infinite list with filters, `useCard`, create, update, delete), with the cache refreshes above.
- [x] `features/origins/originIcons.tsx`, and an `OriginBadge` (swatch, icon and name) for the pickers, filters and cards.

### Origins
- [x] `features/origins/OriginListPage.tsx`: the system templates (**Duplicate**), then the user's own (edit, **Duplicate**, delete with the `origin_in_use` lists).
- [x] `features/origins/OriginForm.tsx`: the name, the colour and icon radio groups, `ArtUpload` for the background, and `ModuleListField` with field effects (at most 3).
- [x] `features/origins/OriginEditorPage.tsx`: new, edit, read-only for system origins, and the `?from=` prefill. `OriginPreview.tsx` beside the form.

### Art upload
- [x] `api/uploadArt.ts`: request the ticket, then `PUT` to R2 with the `Content-Type`. `api/hooks/useArtUpload.ts` as a mutation.
- [x] `features/cards/ArtUpload.tsx`: `kind` is `card` or `origin`; the browser checks the type and size; the local preview cropped by CSS; **Remove**; the errors.

### Card editor and cost
- [x] `features/cards/cost.ts`, and its test over `cost_cases.json`.
- [x] `features/cards/CardEditorPage.tsx`:
  - kind, name, origin (with **+ New origin** in a modal), HP and DMG by kind and `dmg_use`
  - mana, abilities or effect, group, art, and delete with `card_in_use`
  - split the page into smaller components when it grows past about 200 lines
- [x] `features/cards/CostSuggestion.tsx` (live, **Use suggested** capped at 10, the hint above 10) and `CardPreview.tsx`.

### Library and groups
- [x] `features/cards/CardLibraryPage.tsx`: the grid, the origin and kind filters in the URL, **Load more**, **New card** with the starting values, and **Move to group…**.
- [x] `features/cards/CardGroupPanel.tsx`: All, Ungrouped, the groups with counts, and create, rename and delete.
- [x] `features/cards/BalanceLabel.tsx`.

### Routes and nav
- [x] `routes.tsx`: `/origins`, `/origins/new`, `/origins/:id`, `/cards`, `/cards/new` and `/cards/:id`, inside the protected `AppShell` layout. The nav gets Cards and Origins.

### Tests
- [x] The fake API:
  - a hand-written catalog fixture typed as `CatalogOut`, covering every `SchemaForm` type and every `dmg_use`
  - MSW handlers for origins, cards, card groups and uploads, backed by a small in-memory store that is reset after each test
  - a fake R2 `PUT` URL
- [x] `SchemaForm` and `ModuleListField`: each type, the bounds, the defaults, the limit, no repeats, and the unsupported-property error.
- [x] `cost.ts`: every case in `cost_cases.json`, plus an ability's cost from a catalog spec.
- [x] Origin editor:
  - create with a field effect; the preview updates
  - at most 3 effects, with no repeats
  - a system origin is read-only; **Duplicate** fills in the editor
  - the `origin_in_use` lists
- [x] Card editor:
  - a creature with an ability; the suggestion follows the stats and the params
  - **Use suggested** caps at 10 and shows the hint
  - saving a cost that differs from the suggestion
  - the spell DMG for `damage`, `heal` (sent negative) and `none` (hidden, `null`)
  - switching the kind sends `hp: null`
  - **+ New origin** selects the new origin
  - the `card_in_use` list
- [x] Library:
  - the group panel and its counts
  - the filters in the URL
  - create, rename (`group_name_taken`) and delete a group
  - **Move to group…**, the balance labels, **Load more**
- [x] Art upload:
  - a wrong type and too large a file are refused before any request
  - the presign, then the `PUT` with the `Content-Type`, then `art_key` in the saved body
  - a failed `PUT` shows a message
  - **Remove** sends `null`
- [x] Playwright `e2e/content.spec.ts`, as an `e2e_<random>` user:
  - register
  - create an origin with a field effect
  - create a creature with an ability, and check the suggestion changes with HP
  - create a group and move the card into it
  - the library shows the card in that group with its balance label
  - delete the card and the origin
- [x] By hand in the browser through nginx: card art and an origin background uploaded to the real R2 and shown from the public URL.

### Docs
- [x] [frontend_plan.md](frontend_plan.md):
  - §1: `lucide-react`
  - §2: the new files
  - §4.0 and §4.1: Duplicate fills in the editor, the heal sign, the upload starting when a file is picked
  - §7: F1 done
- [x] [coding-standards.md](coding-standards.md) §3, if a new rule comes up (for example the origin swatch outline).
- [x] Record the decisions here and write the session file.

## Out of scope (later milestones)
- Sharing a card group and the share dialog, the deck builder, and the import page (F2)
- Drag-and-drop between groups (dnd-kit comes in F2); moving uses a menu
- Selecting several cards to move or delete at once
- A cost filter in the library: it needs a backend filter (dropped 2026-11-10)
- A crop tool (art is cropped by CSS only)
- A warning about unsaved changes when leaving an editor
- The dashboard's "most recent" lists and an origin count (frontend_plan §3)
- Deleting art objects from R2 (they are never deleted, backend_plan §4)
- The rules editor (F3), rooms and the lobby (F4), the game board (F5)

## Notes
- **F1 needs no backend change.** It relies on M2 and M3 as they are:
  - `GET /api/catalog`:
    - `features` and `spells` carry `cost: {base, per_param}`, and spells also `dmg_use`
    - `field_effects` have params only
    - `origin_colors` is a list of `{key, hex}`, and `origin_icons` a list of keys
  - `OriginOut`:
    - fields: `id`, `name`, `color`, `icon`, `field_effects: [{key, params}]`, `background_art_key`, `background_art_url`, `is_system`, `system_key` and the timestamps
    - the list puts system origins first, then the user's own, each by name
    - a PATCH or DELETE on a system origin gives 403 `system_origin_read_only`
  - `CardOut`:
    - fields: `id`, `kind`, `name`, `origin_id`, `mana_cost`, `hp`, `dmg`, `abilities`, `group_id`, `art_key`, `art_url`, `suggested_mana_cost`, `balance` and the timestamps
    - the list is newest first, filtered by `origin_id`, `kind`, and `group_id` or `ungrouped=true` (sending both gives 422)
  - `CardGroupOut`: `id`, `name`, `card_count`, `share_code` and the timestamps. The list is sorted by name.
  - uploads take `{content_type, size}` and return `{upload_url, art_key, expires_in}`. The presigned `PUT` signs the `Content-Type`.
  - PATCH changes only the fields sent. `null` clears `hp`, `dmg`, `group_id`, `art_key` and `background_art_key`, and is refused for required fields.
  - lists take `limit` (1–100) and `offset`, and return `{items, total}`
  - error codes: `origin_in_use` (`cards`, `decks`), `card_in_use` (`decks`), `group_name_taken`, `unknown_module`, `invalid_params`, `invalid_field_effects`, `invalid_stats`, `invalid_abilities`, `invalid_origin`, `invalid_group`, `unsupported_art_type`, `art_too_large`, `invalid_art_key`, and the `*_not_found` 404s
- **Module params in use today:**
  - features, spells and field effects use only bounded integers and string enums
  - an array of enums with `uniqueItems` appears only in `action_phase` (F3)
  - no module uses numbers or booleans yet
  - `SchemaForm` still supports and tests every type in the backend's contract (`tests/engine/test_modules.py`)
- **The server is authoritative** (frontend_plan §0). F1 copies only the input bounds and the cost formula, which is advice that frontend_plan §4.1 asks for.
- **Seeded system origins:** `neutral` (no effects), `forest`, `volcano`, `ocean` and `mountain`.

## Open questions
- None right now.

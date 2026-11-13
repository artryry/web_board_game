# Current feature: F3 — Rules editor

**Status:** built 2026-11-13 on `f3-rules-editor`, not committed. Every check passes, and so does the new e2e spec (see the session file for the dev nginx stalls). The look by hand is partly done (see Done when).
**Plan reference:** [frontend_plan.md §3, §4.2a, §4.3, §7 and §10](frontend_plan.md), [backend_plan.md §5, §6 and §8](backend_plan.md) (the phase modules, the rules JSON and its errors, the ruleset API), [coding-standards.md](coding-standards.md)
**Depends on:** M4 (rulesets, `/validate`, sharing) and F2 (the share dialog, the import page, dnd-kit core, the leave guard). Both are done.
**Unblocks:** F4, whose Create room page picks a ruleset. F3 also covers use cases UC4 (create turn-flow rules), UC5 (load saved rules), UC9 (share rules) and UC12 (save rules).

Earlier features still have follow-ups:
- **F2:** committed on `f2-decks` (`716a793`), not merged or pushed. Still to check by hand: the copied art on imported cards, and a look in two real browsers ([sessions/session_2026-11-12_f2-decks.md](sessions/session_2026-11-12_f2-decks.md)).
- **M4:** `c8cf578` is on `master` locally, not pushed yet. Its two migrations run on deploy ([sessions/session_2026-11-12_m4-rulesets.md](sessions/session_2026-11-12_m4-rulesets.md)).
- **Dev nginx:** it stalls under parallel load (an unreachable IPv6 `host.docker.internal`, and slow proxying to the host), so `npm run e2e` passes only with `--workers=1`. On 2026-11-13 even `--workers=1` hit stalled page loads (the auth and F2 share specs too); with `--retries=2` everything passed. Not fixed; see the F2 and F3 session files.
- **Art cleanup:** deploy it, then check Render ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
A logged-in user can:
- see the default rule set and their own, and start a new one from the default or from any of them (Duplicate)
- edit a rule set: the board, deck, mana and hand settings, and the Setup and Turn phase pipelines (add, set up, reorder, remove)
- see every problem inline while editing, as the server reports it, and save
- share a rule set by code, and import someone's shared rule set

Done when (frontend_plan §7): **the default ruleset can be loaded, edited, validated and saved.**

## How it works

### Pages and routes
| Route | Page | New in F3 |
|---|---|---|
| `/rules` | `RulesListPage` | the default rule set, then the user's own |
| `/rules/new` | `RulesEditorPage` | a new rule set, from the default; nothing is created until Save |
| `/rules/new?from=<id>` | `RulesEditorPage` | a copy of that rule set, named "<name> copy" (cut to 40 characters) |
| `/rules/:id` | `RulesEditorPage` | the user's own rule set; the default one is read-only |

- The main nav gets **Rules**, after Decks: Dashboard, Cards, Decks, Rules, Origins.
- In the UI the thing is a "rule set" (the deck builder and the import page already say so); in code it stays `ruleset`.

### Rules list (`/rules`)
- **Built like the origins page:** a "Default" section, then "My rule sets". The server already lists the default first, then the user's own by name (`useRulesets`, in full).
- **Each rule set shows:**
  - its name, linked to the editor
  - a one-line summary: lanes, deck size, and the number of turn phases (for example "3 lanes · 30-card decks · 4 turn phases")
  - a "Shared" mark while it has a share code (own rule sets only)
- **Actions:**
  - the default: **View** and **Duplicate**
  - own rule sets: **Edit**, **Duplicate**, **Share** and **Delete**. Delete asks first, and says when a share link will stop working.
- **New rule set** goes to `/rules/new`.
- **Empty state** for own rule sets: "No rule sets yet. Duplicate the default, or start a new one."

### Rules editor (`/rules/new`, `/rules/:id`)
```
┌ ← Rule sets ──────────────────────────────────────────────────────────────┐
│ Name [______________]                    [Duplicate] [Share] [Delete] [Save] │
│ ✓ No problems  (or: ✗ 2 problems: Turn needs an End turn · Lanes ≤ 5)     │
├─────────── Settings ─────────────────┬─────────── Phases ──────────────────┤
│ Board  Lanes [3] Slots [3] HP [20]   │ Setup · runs once before turn 1     │
│   ┌──┬──┬──┐  thumbnail: lanes × 2   │  ⠿ Draw · 3 cards        ↑ ↓ ▾ ✕   │
│   ├──┼──┼──┤  sections, with slots   │ Turn                                │
│   └──┴──┴──┘                         │  ⠿ Gain mana              ↑ ↓ ▾ ✕   │
│ Deck   Size [30] Copies [2] ☑ Neutral│  ⠿ Draw · 1 card          ↑ ↓ ▾ ✕   │
│ Mana   Start [1] Per turn [1] Max [10]│  ⠿ Action phase ⏱ 90 s   ↑ ↓ ▾ ✕   │
│ Hand   Max [10] ☑ Bonus card, 2nd    │  ⠿ End turn               ↑ ↓ ▾ ✕   │
│                                      │ Phases: Draw [+Setup] [+Turn] …     │
│                                      │ Turn order: Gain mana → Draw → …    │
└──────────────────────────────────────┴─────────────────────────────────────┘
```
- **Header:**
  - name (required, at most 40 characters, `NAME_MAX_LENGTH`; names need not be unique)
  - **Save**
  - **Duplicate**, **Share** and **Delete** for a saved rule set of the user's own
  - the validation status (see Validation)
- **Starting values:**
  - `/rules/new`: the default rule set's definition, with an empty name
  - `/rules/new?from=<id>`: that rule set's definition, named "<name> copy" (like the origin editor's `?from=`)
  - `/rules/:id`: the saved rule set
- **Settings (a plain form):**
  - **Board:** lanes, slots per section, section HP. A small **board thumbnail** draws `lanes` columns × 2 rows of sections (one row per player, as on the board in §5.1), each with its slots, and updates as the values change.
  - **Deck:** size (exact), maximum copies, and a checkbox for neutral cards in a deck of another origin.
  - **Mana:** start, per turn, maximum.
  - **Hand:** maximum hand size, and a checkbox for the second player's bonus card. A hint says the starting hand is whatever the Setup phases draw.
  - Whole numbers only. **The bounds aren't copied to the client** (proposed): `/validate` reports them at the field ("Input should be less than or equal to 5").
- **Phase pipelines:** two lists, **Setup** ("runs once, before the first turn") and **Turn**.
  - **Each phase (`PhaseItem`):**
    - a drag handle, the module's name, and a short summary of its params (`describeParams`, for example "Draw · 1 card")
    - an interactive phase shows its time limit on the collapsed item ("⏱ 90 s"), from its `time_limit_s` param
    - **▾** expands it to edit its params with `SchemaForm` (name `turn.<i>.params`); a module with no params has nothing to expand
    - **Move up** / **Move down** buttons (the keyboard way to reorder), and **Remove**
    - a module the catalog doesn't know any more shows as "Unknown phase “<key>”" and can only be removed (like `ModuleListField`)
  - **Reorder by drag** within one pipeline (`@dnd-kit/sortable`, pointer only, a small move to start). Phases don't move between Setup and Turn (confirmed 2026-11-12).
  - **Adding (`ModulePalette`):** every catalog phase with its name, description and an "interactive" badge, and two buttons, **Add to Setup** and **Add to Turn**. It adds the phase with its default params (`defaultParams`) at the end; in Turn, before a final `end_turn` (confirmed 2026-11-12). The client doesn't hide modules that don't belong in Setup: the server's error says why.
  - **Turn order:** a read-only strip under the pipelines that lists the turn's phases in order, as the in-game phase tracker (F5) will.
- **Validation:**
  - After each change, debounced (500 ms), `POST /api/rulesets/validate {definition}` with the form's current definition. A newer change cancels the older request.
  - The header shows "Checking…", "No problems", or "N problems" with the list of messages.
  - **Each error goes where its `path` points:**
    - a setting (`["board", "lanes"]`) → under that field
    - a phase param (`["turn", 2, "params", "time_limit_s"]`) → under that field in the phase's `SchemaForm`; the collapsed phase shows an error mark
    - a phase or its key (`["turn", 2]`, `["turn", 2, "key"]`) → on the phase item
    - a pipeline rule (`["turn"]`, `["setup"]`) → under the pipeline's heading
    - anything else (`["schema_version"]`) → only in the header list
  - The messages are the server's (`RuleError.message`). The client checks nothing about the rules itself.
- **Save:**
  - **a new rule set:** `POST /api/rulesets {name, definition}`, then the address becomes `/rules/:id` (replace, with no unsaved-changes prompt)
  - **an existing one:** `PATCH /api/rulesets/{id} {name, definition}`. The definition is always the whole one.
  - Save is never disabled by the validation (proposed): the server decides.
  - **server errors:**
    - `invalid_ruleset` (422, with `errors`): shown exactly like the `/validate` errors
    - a name error goes on the name field (`showServerError`)
    - `ruleset_not_found`: deleted elsewhere; the page shows not-found
  - After a save, the form takes the server's normalized definition (defaults filled in).
- **The default rule set** (`/rules/:id` of the system one) is read-only, like an origin template: every field disabled, no palette, no reordering or removing, the phases still expandable to read their params. It says "This is the default rule set. Duplicate it to make your own." with **Duplicate**.
- **Unsaved changes:** the rule set is dirty while its name or definition differs from the last save. Leaving asks first (`useBlocker`), and closing the tab gets the browser's prompt, as in the deck builder.
- **Delete** asks first, goes to `/rules`, and says when the share link stops working.

### Sharing and import
- **`ShareDialog`** gets a third kind, `ruleset` (`POST`/`DELETE /api/rulesets/{id}/share`). It opens from the rules list and the editor, for the user's own saved rule sets. The default can't be shared (the server answers 403), so it has no Share button.
- **Import page (`/share/:code`), `kind: "ruleset"`:**
  - the preview shows a read-only summary: the settings and both pipelines (`RulesetSummary`, the same pieces as the editor's read-only mode)
  - **Import to my library** is now offered: "Copies the rule set into your library. Your copy won't change when the author edits theirs." It goes to `/rules/:id`.
  - This removes F2's "Rule sets can be imported once the rules editor is ready."

### Changes to F2 code
- **`useLeaveGuard` and `LeaveGuardDialog`** move from `features/decks/` to `ui/`, since both editors use them. The dialog's text becomes a prop ("Your changes to this deck will be lost." / "… to this rule set …").
- **`ShareKind`** in `useShare.ts` adds `"ruleset"`, and its refresh covers `["rulesets"]`.
- **The import page** handles the ruleset import (above), and `useImportShare` caches the imported ruleset like a deck.
- **The deck builder's validity panel** lists new rule sets automatically, since every ruleset change refreshes `["rulesets"]`.

### API hooks
- **`api/hooks/useRulesets.ts`** (it has `useRulesets` and `findDefaultRuleset`) adds:
  - `useRuleset(id)` (`["rulesets", "detail", id]`)
  - `useCreateRuleset`, `useUpdateRuleset` and `useDeleteRuleset`, which refresh `["rulesets"]`
  - `useRulesetValidation(definition)`: the debounced `/validate` call (a query keyed by the definition, so it cancels and caches)
- **Types** come from `schema.d.ts` (`RulesetOut`, `RulesetDefinition`, `RuleError`, `RulesetValidation`, `PhaseOut`); no regeneration is expected, since M4's types arrived in F2.

### Fake API for tests (MSW)
- **`test/deckHandlers.ts`** (or a new `test/rulesetHandlers.ts`): `/api/rulesets` create, get, PATCH (403 on the default) and delete, and `POST /api/rulesets/validate` with a few of the server's rules, enough for the UI's flows: an out-of-bounds `board.lanes`, `end_turn_missing`, `end_turn_not_last`, `turn_needs_interactive_phase`, `setup_phase_not_allowed`, `unknown_module` and one `invalid_params`.
- **`test/shareHandlers.ts`:** share and revoke for rulesets.
- **`test/catalogFixture.ts`:** check that it lists all six phases with their params schemas.

### Drag-and-drop
- **`@dnd-kit/sortable` 10.0.0** (frontend_plan §1), exact; it needs `@dnd-kit/core` ^6.3.0, and 6.3.1 is installed. Check for a newer release before installing.
- Pointer sensor only, like F2: the Move up/down buttons are the keyboard path.

### Logging
- **No new events.** API failures go through `api.request_failed`, and the server logs ruleset changes and shares.

### From M4 (what the server gives)
- **Phases in the catalog** (`GET /api/catalog` → `phases: [{key, name, description, params_schema, interactive}]`):
  - `action_phase` (interactive): `actor` (active/both), `allow` (play, move, attack: checkboxes), `time_limit_s` (10–600, default 90)
  - `draw`: `count` (1–5)
  - `gain_mana`, `lane_combat`, `discard_to_hand_limit` and `end_turn`: no params
- **`RulesetDefinition`:** `schema_version`, `board`, `deck`, `mana`, `hand`, `setup`, `turn`; every section is required in responses (F2's schema fix). Bounds and pipeline rules: backend_plan §6.
- **`POST /api/rulesets/validate`** always answers 200 `{valid, errors: [{path, code, message}], definition}`; `definition` is the normalized one when valid, else null. A save with errors gets 422 `invalid_ruleset` with the same `errors`.
- **The default** (`system_key: "default"`) is read-only: PATCH, DELETE, share and revoke answer 403 `system_ruleset_read_only`.

## Done when
- [x] **Rules list:** the default, then the user's own, with summaries and the shared mark; View/Edit, Duplicate, Share and Delete.
- [x] **Rules editor:**
  - a new rule set starts from the default, or from any rule set with Duplicate, and is created on Save
  - every setting can be edited, and the board thumbnail follows lanes and slots
  - phases can be added from the palette, set up, reordered by drag and by Move up/down, and removed
  - `/validate` problems show inline at their path, and in the header list
  - Save shows `invalid_ruleset` errors the same way; leaving with unsaved changes asks first
  - the default is read-only, with Duplicate
- [x] **Sharing:** own rule sets can be shared and revoked; a shared rule set's preview shows its settings and phases, and importing lands on the copy in the editor.
- [x] **Checks pass:** `npm run lint`, `format:check`, `typecheck`, `test` and `build`. `npm run e2e` (with `--workers=1` until the dev nginx is fixed) passes with the new rules spec. Some runs needed `--retries` for the nginx stalls.
- [ ] **Checked by hand** through nginx: duplicate the default, change the lanes, break and fix the turn (remove End turn, add it back), reorder by drag, save, reload; share it and import it as another user. Done in a scripted browser on 2026-11-13: duplicate, lanes, the broken and fixed turn, save, share, the list and the read-only default. The e2e spec covers the drag, the reload and the import. Still to do: a look by hand in a real browser.

## Decisions
Confirmed with the user on 2026-11-12:
- **"Load" is Duplicate from the list.** Each rule set, the default too, has Duplicate (`/rules/new?from=<id>`). There is no Load button in the editor; frontend_plan §10 (UC5) is updated.
- **Click to add, drag to reorder.** The palette's buttons add a phase to Setup or Turn (in Turn, before a final `end_turn`). Dragging only reorders within one pipeline; Move up/down buttons do the same from the keyboard.

Proposed by this spec, confirmed with the user on 2026-11-13:
- **`/rules/new` starts from the default definition** with an empty name, and the default's own page is read-only with Duplicate (like origin templates).
- **No rule bounds on the client.** The debounced `/validate` reports every bound at its field, so the bounds aren't copied into `bounds.ts`. Phase params keep `SchemaForm`'s catalog checks ("Use 600 or less."), as in the card editor (confirmed 2026-11-13).
- **Save is never disabled by the validation.** The server decides, and a 422 shows the same inline errors.
- **The validation runs debounced (500 ms)** after every change, as a query keyed by the definition.
- **The leave guard moves to `ui/`**, shared by the deck builder and the rules editor.
- **Shared rule sets become importable** (F2 left them preview only), landing on `/rules/:id`.
- **The turn-order strip** (frontend_plan §4.3's "Preview turn") is part of F3: a read-only list, no game-state simulation.

## Tasks
Order:
1. `@dnd-kit/sortable`, routes and nav
2. hooks and the fake API
3. the leave guard move, and `ShareKind`
4. rules list
5. editor: settings form and board thumbnail
6. editor: pipelines, palette and drag
7. editor: validation display, save and the read-only default
8. sharing and the import page
9. e2e
10. docs

Each step comes with its tests.

### Setup
- [x] Check `@dnd-kit/sortable`'s newest release and its peer range, then install it with an exact version.
- [x] Routes: `/rules`, `/rules/new` and `/rules/:id`. Add Rules to the nav.

### Hooks and fake API
- [x] `useRuleset`, `useCreateRuleset`, `useUpdateRuleset`, `useDeleteRuleset` and `useRulesetValidation`; `ShareKind` adds `ruleset`.
- [x] The fake API: ruleset CRUD, a simplified `/validate`, and ruleset share and revoke.

### Rules
- [x] Pure helpers, with unit tests:
  - `insertPhase` (at the end, or before a final `end_turn`) and the move helpers
  - `errorsByPath`: `RuleError`s grouped for the settings, the phases, the pipelines and the header
  - `rulesetSummary` (the list's one-line summary) and the "<name> copy" name
- [x] `RulesListPage`.
- [x] `RulesEditorPage` and `RulesForm`: the header, `RulesSettingsForm` with `BoardThumbnail`, `PhasePipeline`, `PhaseItem`, `ModulePalette` and `TurnOrderStrip`.
- [x] Validation status and inline errors; save and its errors; the leave guard; delete; the read-only default.

### Sharing
- [x] `ShareDialog` for rulesets, from the list and the editor.
- [x] `ImportPage`: the ruleset summary (`RulesetSummary`), the import, and where it lands.

### Tests
- [x] **Unit:** the pipeline helpers, `errorsByPath` and `rulesetSummary`.
- [x] **Pages (Vitest and MSW):**
  - **`RulesListPage`:** the default and own rule sets, the summaries, Duplicate, delete, the shared mark
  - **`RulesEditorPage`:**
    - a new rule set from the default, a duplicate, and an existing one
    - the settings and the thumbnail
    - adding (before `end_turn`), Move up/down, removing, editing params
    - validation errors at each kind of path, and the header list
    - the Save payload, `invalid_ruleset`, and not-found
    - the read-only default, and the unsaved-changes prompt
  - **`ImportPage`:** a ruleset preview and its import
  - **`ShareDialog`:** a ruleset
- [x] **e2e** (`e2e/rules.spec.ts`): duplicate the default, change the lanes, remove End turn and see the error, add it back, add a Draw and drag it into place, set a time limit, save, reload and see the values. A second test (two contexts) shares a rule set and imports it.

### Docs
- [x] [frontend_plan.md](frontend_plan.md):
  - §1: `@dnd-kit/sortable` installed
  - §2: the `rules/` files, and the leave guard in `ui/`
  - §3: `/rules/new?from=`, and the list's contents
  - §4.2a: rule sets can be imported
  - §4.3: click to add, drag to reorder, the read-only default, how errors are placed, no client bounds
  - §7: F3 done
  - §10: UC5 is Duplicate from the list
- [x] Update this file, and write the session file.

## Decided while building (2026-11-13)
- **Validation errors stay out of React Hook Form.** `setError` on a path with no input (`turn`, `turn.2`) would stop `handleSubmit`, so Save would be blocked. `placeRuleErrors` sorts the errors, `catalog/outsideFieldErrors.ts` hands them to `useFieldError` (the form's own error first), and a `RuleErrorsContext` serves the phases and pipelines.
- **The validation query** is keyed by the definition's JSON, outside `["rulesets"]` (a save doesn't recheck), with `staleTime: Infinity` and the previous answer kept while the next one loads. A refused save (`invalid_ruleset`) writes its errors into that query for the sent definition, so they show the same way, plus "Couldn't save: fix the problems listed above."
- **The header's list says where each error is** ("Lanes: …", "Turn, phase 3 (Action phase): …"), since the server's messages alone ("Input should be less than or equal to 5") don't.
- **The default's page runs no validation:** it can't change.
- **Phase summaries are generic:** `describeParams` gives "Draw · Count 1", not "Draw · 1 card", so no module gets text of its own.
- **A phase the catalog doesn't know** has no handle and no Move buttons, only Remove.
- **Focus:** a Move button that turns disabled at an end hands the focus to the other one; Remove gives it to the pipeline's heading. A hidden live region says "Draw was moved to position 1 of 4."
- **The board thumbnail draws up to 10** lanes and slots. That's a drawing limit, not a rule; past it the thumbnail says "No board preview for these numbers."
- **The palette's buttons** say "Add to Setup" and are named "Add Draw to Setup" with `aria-label`: a hidden span in the middle of the text showed as a double space.
- **Small shared changes:** `copyName` in `api/bounds.ts` (the origin editor uses it too), an optional `ref` on `ui/IconButton`, `ui/dragDistance.ts` (5 px, both drag areas), `ui/useDebouncedValue.ts`.
- **The fake API:** `test/rulesetHandlers.ts` (the list moved there from `deckHandlers.ts`), all six phases in `catalogFixture.ts`, `time_limit_s` in the fixture's action phase, and `test/rulesEditor.ts` helpers.

## Added after the first build (2026-11-13, asked by the user)
- **Mana mode:** a new rules setting, `mana.mode`:
  - `grow` (the default, Hearthstone-style): the maximum rises by Mana per turn, up to Maximum mana, and mana refills
  - `restore`: a player gets Mana per turn back, up to Maximum mana, and unspent mana carries over
  - Either way, a player's first turn has Starting mana.
- **Backend:** `ManaRules.mode` in `schemas/rules.py`, the `gain_mana` description, and tests.
  - Definitions stored before it read as `grow` (responses always go through the schema), so there is no data migration.
  - The seed migration's literal is left as it is; the engine (M5) applies the mode, as backend_plan §7.3 says.
- **Frontend:** `schema.d.ts` regenerated, and a "Mana each turn" radio group (`ManaModeField`) in the Mana section, with a hint for the chosen mode.

## Out of scope
- **A "Load from…" button in the editor** (Duplicate covers it; confirmed 2026-11-12).
- **Dragging from the palette, or between Setup and Turn** (confirmed 2026-11-12).
- **A rule sets tile on the dashboard.** The list's `total` includes the default, so it needs its own count; it can come with F4's room creation.
- **Simulating a turn** or a whole game from the rules (F5's board shows the real thing).
- **Editing the default rule set** (the server keeps it read-only).
- **Ruleset `schema_version` migrations** on the client (`migrate()` is server-side).

## Notes
- **What already exists:**
  - `catalog/SchemaForm` renders every phase param type (integers, enums, and `allow` as checkboxes); `defaultParams` and `describeParams` are in `catalog/schemaFields.ts`.
  - `catalog/ModuleListField` shows how an unknown module is handled, but it forbids repeats and has no order, so the pipelines need their own component.
  - `useRulesets` and `findDefaultRuleset` (F2), `ShareDialog`, the import page, and `useLeaveGuard`.
  - The origin editor's `?from=<id>` duplicate and read-only template are the pattern for the default rule set.
- **Error paths and the form:** with React Hook Form holding the definition (`board.lanes`, `turn.2.params.time_limit_s`), a `RuleError.path` joined with dots is the field's name, so `SchemaForm`'s fields can show their errors through `useFieldError`. After a reorder, the old errors may point at the wrong phase until the next validation, a moment later.
- **The server's messages** are written for users (for example "A turn needs a phase where players act, such as 'action_phase'"), so the UI shows them as they are.

## Open questions
- None for F3. The dev nginx stall is a separate fix for the user to decide (F2 session file).

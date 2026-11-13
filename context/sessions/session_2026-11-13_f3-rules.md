# Session 2026-11-13: F3 rules list, rules editor, ruleset sharing

## Summary
We built frontend F3 on the `f3-rules-editor` branch. Nothing is committed yet.
- **Before:** the frontend only listed rulesets, for the deck builder's validity panel. Rule sets could be previewed from a share link but not imported.
- **Now:**
  - `/rules` lists the default rule set (View, Duplicate), then the user's own by name (Edit, Duplicate, Share, Delete). Each has a summary ("3 lanes · 30-card decks · 4 turn phases") and a "Shared" mark.
  - `/rules/new`, `/rules/new?from=<id>` and `/rules/:id` are the rules editor:
    - the settings (board with a thumbnail, deck, mana, hand)
    - the Setup and Turn pipelines: add from the palette, expand to edit params, reorder by drag or Move up/down, remove
    - a turn-order strip
  - The server's `/validate` runs 500 ms after each change, and every error shows where its path points. The header lists them all.
  - Save creates the rule set or replaces it. A refused save shows its errors the same way.
  - Leaving with unsaved changes asks first. The default is read-only, with Duplicate.
  - Rule sets can be shared and revoked, and `/share/:code` previews a rule set's settings and phases and imports a copy.
- **Done when (frontend_plan §7) is met:** the e2e test duplicates the default, edits, breaks and fixes it, drags a phase, saves and reloads, through nginx.

## How it went
1. **Plan:**
   - Three explore passes covered the reusable frontend (SchemaForm, origins, routes), the F2 code that changes, and the M4 contract.
   - Two questions: the user kept all seven "proposed" decisions, and kept `SchemaForm`'s catalog checks on phase params.
   - The plan is in `C:\Users\artem\.claude\plans\create-a-plan-of-elegant-dragon.md`.
2. **Setup:** `@dnd-kit/sortable` 10.0.0 (still the newest; its peer `@dnd-kit/core ^6.3.0` fits 6.3.1).
3. **Shared pieces:**
   - the leave guard moved to `ui/`, with its message as a prop
   - `useDebouncedValue`, `copyName`, the outside-errors context for `useFieldError`
4. **Hooks and the fake API:**
   - ruleset CRUD and the debounced validation, and the `ruleset` share kind
   - `test/rulesetHandlers.ts` with a simplified `/validate`, and all six phases in the catalog fixture
5. **Pure helpers** (`rulesetValues`, `phaseList`, `ruleErrors`), the list, then the editor in pieces, each with its tests.
6. **Import page:** `RulesetSummary` (the editor's pieces, read-only) and the import.
7. **e2e:**
   - `rules.spec.ts` (one user; then two contexts for share and import)
   - The stack wasn't running, so `docker compose up -d` and uvicorn were started. Both are still running.
8. **A look in a scripted browser:** the editor with three errors, the list, and the read-only default. It found a double space in the palette buttons, now fixed.
9. **Docs:** frontend_plan, current-feature.md and this file.

## Decisions made
| Topic | Decision |
|---|---|
| Proposed decisions in current-feature.md | All seven kept (confirmed by the user). |
| Phase param checks | `SchemaForm` keeps its catalog checks in the rules editor (confirmed by the user). |
| Validation errors | Kept out of React Hook Form: `setError` on `turn` or `turn.2` would block `handleSubmit`. `placeRuleErrors` sorts them; `catalog/outsideFieldErrors.ts` feeds `useFieldError`; `RuleErrorsContext` feeds phases and pipelines. |
| Validation query | `["ruleset-validation", json]`, `staleTime: Infinity`, previous answer kept while loading, the query's signal cancels old requests. A refused save writes its errors into the query for the sent definition. |
| Header list | Each message says where it is ("Lanes: …", "Turn, phase 3 (Action phase): …"). |
| Form shape | `RulesetDefinition & {name}`, so a joined `path` is the field's name. |
| Pipelines | Both `useFieldArray`s in `RulesPhases`; one `DndContext` per pipeline; sortable ids are RHF field ids; the handle is `aria-hidden`, Move up/down are the keyboard path. |
| Unknown phases | Only Remove (no handle, no Move). |
| Read-only default | Settings in a disabled fieldset, each expanded `SchemaForm` in its own, no palette, no validation. |
| Board thumbnail | Draws 1–10 lanes and slots (a drawing limit, not a rule). |
| Phase summaries | Generic `describeParams` ("Draw · Count 1"). |
| Palette buttons | Visible "Add to Setup", named "Add Draw to Setup" with `aria-label`. |
| Small shared changes | `copyName` in `api/bounds.ts`, `ref` on `ui/IconButton`, `ui/dragDistance.ts`, `ui/useDebouncedValue.ts`. |

## Found
- **The dev nginx stalls are worse than in F2.** Even with `--workers=1`, some page loads through nginx never finished: the auth spec and both F2 share specs failed once each, besides the new specs. The nginx log shows the same `connect() to [fdc4:…::254]:5173 failed (101: Network unreachable)`. Single requests answer in about 15 ms. With `--retries=2` everything passed. Not fixed; the fix ideas are in the F2 session file.
- **Disabled text inputs look like editable ones.** The shared `TextField` has no disabled style; the read-only default (and origin templates) show fields that can't be typed in. Not changed.
- **The production bundle** is 591 kB (F2: 559 kB). Route splitting is planned for F5.
- **`lastBody` matches a path prefix**, so `POST /api/rulesets` also matched `/validate`; the rules tests use an exact-path helper.

## Files changed
- **New (frontend):**
  - `src/features/rules/`: `RulesListPage`, `RulesetListItem`, `DeleteRulesetDialog`, `RulesEditorPage`, `RulesEditor`, `RulesHeader`, `ValidationStatus`, `RulesSettingsForm`, `SettingNumber`, `SettingCheckbox`, `BoardThumbnail`, `RulesPhases`, `PhasePipeline`, `PhaseItem`, `ModulePalette`, `TurnOrderStrip`, `RulesetSummary`, `ruleErrorsContext`, `useWatchedDefinition`, `rulesetValues`, `phaseList`, `ruleErrors`, `settingFields`, and their tests
  - `src/catalog/outsideFieldErrors.ts`
  - `src/ui/useDebouncedValue.ts` and `src/ui/dragDistance.ts`
  - `src/test/rulesetHandlers.ts` and `src/test/rulesEditor.ts`
  - `e2e/rules.spec.ts`
  - this file
- **Moved:** `useLeaveGuard` and `LeaveGuardDialog` from `src/features/decks/` to `src/ui/`.
- **Changed (frontend):**
  - `package.json` and `package-lock.json` (`@dnd-kit/sortable` 10.0.0)
  - `src/routes.tsx` and `src/AppShell.tsx` (Rules in the nav)
  - `src/api/bounds.ts` (`copyName`), `src/api/hooks/useRulesets.ts`, `useShare.ts`
  - `src/catalog/useFieldError.ts`, `EnumArrayParams.tsx`, `SchemaForm.test.tsx`
  - `src/features/decks/DeckBuilder.tsx` and `DeckDnd.tsx`, `src/features/origins/originValues.ts`
  - `src/features/share/ImportPage.tsx`, `ImportPanel.tsx`, `ShareDialog.tsx` (comment), and their tests
  - `src/ui/IconButton.tsx` (`ref`)
  - `src/test/catalogFixture.ts`, `rulesetFixture.ts`, `contentHandlers.ts`, `deckHandlers.ts`, `shareHandlers.ts`
  - `e2e/helpers.ts` (`dragOnto`) and `e2e/share.spec.ts`
- **Docs:** `context/frontend_plan.md` (§1, §2, §3, §4.2a, §4.3, §7, §10) and `context/current-feature.md`.

## Verification
- `npm run lint`, `format:check`, `typecheck` and `build`: pass. The build warns about the 591 kB bundle.
- `npm test`: 250 passed in 41 files (53 new).
- **`npm run e2e`:**
  - Both rules tests passed, through nginx with `--workers=1`; in the last run, each passed on its first try.
  - Across runs, tests from every spec except `content.spec.ts` hit the nginx stall at least once.
  - The final run of the auth, rules and share specs with `--retries=2`: 3 passed, 2 flaky (the F2 share specs needed retries).
- **The scripted browser (Playwright MCP) through `http://localhost/`:**
  - duplicate the default, lanes 7, End turn removed and an Action phase added to Setup: "3 problems", each in its place
  - fixed and saved, then shared; the list showed it with "Shared"
  - the read-only default
  - The screenshots were deleted afterwards.
- **Not verified:**
  - a look by hand in a real browser
  - anything on Render
- **Left in the dev DB:** the e2e runs and the browser check left `e2e_…` users.

## Afterwards: the mana mode (asked by the user)
The user looked at the editor and asked for Hearthstone-style mana as an option. The plan already described `gain_mana` that way, so the user chose a mode switch with a second mode: a fixed amount restored each turn.
- **Rules:** `mana.mode` is `grow` (the default: the maximum rises by `per_turn` up to `max`, then mana refills) or `restore` (`per_turn` comes back, up to `max`; unspent mana carries over). A player's first turn has `start` either way (backend_plan §7.3, for M5).
- **Backend:** `ManaRules.mode`, the new `gain_mana` description, and four tests. Definitions stored without the field read as `grow`, so there's no data migration; the seed migration's literal stays as it was.
- **Frontend:** `npm run gen:api` (only `ManaRules.mode` changed), and a "Mana each turn" radio group (Grow and refill / Restore a fixed amount) with a hint for the chosen mode.
- **Checks:**
  - backend: `pytest` 568 passed; `ruff check`, `ruff format --check` and `mypy app tests` pass
  - frontend: lint, format, typecheck and build pass; `npm test` 251 passed
  - through nginx in the scripted browser: a Restore rule set saved, reloaded, and still Restore
- uvicorn was restarted to pick up the schema change.

## Notes
- The docker stack and the uvicorn started for the e2e run are still running.

## Next steps
1. Review, commit and merge `f3-rules-editor`. F2 (`716a793`) and M4 (`c8cf578`) still need merging and pushing first.
2. Look at the editor by hand in a real browser.
3. Decide on the dev nginx fix (the IPv4 host gateway, or `workers` in `playwright.config.ts`).
4. F4: the Create room page picks a ruleset from these.

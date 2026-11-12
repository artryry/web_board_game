# Session 2026-11-12: F2 deck builder, share dialog and import page

## Summary
We built frontend F2 on the `f2-decks` branch. Nothing is committed yet.
- **Before:** the frontend had no deck pages. Decks, sharing and rulesets existed only in the API (M3, M4).
- **Now:**
  - `/decks` lists the user's decks (origin, "24 / 30 cards" against the default ruleset, a "Shared" mark), with share, delete and a "Have a share code?" form.
  - `/decks/new` and `/decks/:id` are the deck builder: the origin's and neutral cards on the left, added by click, Enter/Space or drag; the deck with **−**/**+** on the right; the mana curve; and a validity panel against the default or a chosen ruleset. An origin change that drops cards asks first. Leaving with unsaved changes asks too.
  - One share dialog serves decks and card groups (create, copy, revoke). The card library's group panel shares groups and marks shared ones.
  - `/share/:code` previews a deck, a group or a ruleset (preview only), and imports a copy.
  - Deck names in the "still in use" lists are links.
- **Done when (frontend_plan §7) is met:** the e2e test shares a deck and a group from one user and imports them as another, through nginx.

## How it went
1. **Plan.** Three explore passes covered the F1 frontend, the backend's deck, share and ruleset shapes, and the test and e2e setup. One question: the user picked `@dnd-kit/core` 6.3.1 over the pre-1.0 `@dnd-kit/react`. The plan is in `C:\Users\artem\.claude\plans\create-a-plan-for-wise-ember.md`.
2. **Setup:** `npm run gen:api` against the running API. The ruleset sections came out optional (`deck?`), because `default_factory` writes no default into the schema; a one-line backend change (`json_schema_serialization_defaults_required` on `RulesetDefinition`) made them required. Backend checks passed (564 tests, ruff, format, mypy).
3. **API layer and fake API:** `useDecks`, `useRulesets` and `useShare`; `useOriginCards`; deck bounds. The fake API got decks with copy counts and share codes, rulesets, share and import.
4. **Pure helpers** (`deckEntries`, `manaCurve`, `deckProblems`), then the share dialog, the deck list, the builder, the import page, and the F1 changes, each with its tests.
5. **e2e:** `share.spec.ts` with two browser contexts. The first runs timed out; the traces and the nginx log showed the dev nginx stalling (see "Found"), not the app. With `--workers=1` the whole suite passes.
6. **A look in the browser:** screenshots of the builder, the share dialog, the deck list and the import page.
7. **Docs:** frontend_plan, backend_plan, current-feature.md and this file.

## Decisions made
| Topic | Decision |
|---|---|
| dnd-kit | `@dnd-kit/core` 6.3.1, exact (confirmed by the user). Pointer sensor only, 5 px to start a drag; no keyboard sensor, so Enter and Space press the card's button. A `DragOverlay` shows the dragged card; the live region names cards instead of ids. |
| Ruleset types | Fixed in the backend schema (required sections), not with fallbacks on the client. |
| Builder state | React Hook Form for the name and origin (validation, `showServerError`), local state for the cards. Dirty = form dirty or cards changed. Save and Delete mark the page as leavable before they navigate, so the guard doesn't ask. |
| New deck | The POST result is written into the deck's query, then the address is replaced; the builder is keyed by the id, so it remounts without loading. |
| Deleted elsewhere | A `deck_not_found` on Save refetches the deck, so the page shows not-found. `invalid_deck_cards` asks for a reload. |
| `OriginPreview` | Takes props; `OriginFormPreview` wraps it for the origin editor. |
| `ui/IconButton` | Moved out of `CardGroupPanel`, with `disabled` added. |
| Revoke | An inline second step in the share dialog, not a dialog on a dialog. |
| Card edits | Also refresh open decks' details. |
| Fake API files | `test/deckHandlers.ts`, `test/shareHandlers.ts`, `test/handlerUtils.ts`, `test/rulesetFixture.ts`; `contentHandlers.ts` was already 380 lines. |
| Ruleset copy | "Rule sets can be imported once the rules editor is ready." (no "F3" in the UI). |

## Found
- **The dev nginx stalls under parallel load.** It isn't caused by F2, but F2's two-user e2e specs exposed it.
  - `host.docker.internal` resolves to an IPv4 and an IPv6 address inside the nginx container. The IPv6 one is unreachable (`connect() … failed (101: Network unreachable)`), and has been since the first log on 2026-10-23.
  - nginx → host is slow for many small requests: 8 parallel page loads took ~2.5 s straight from Vite and 7–10 s, or a 20 s timeout, through nginx. Upstream keepalive barely helped (tried with a scratch config, then reverted).
  - With Playwright's default workers the specs time out on page loads; `--workers=1` passes.
  - Possible fixes (not applied, for the user to decide): map `host.docker.internal` to the IPv4 host gateway only (`192.168.65.254` on this machine; it differs per setup), and/or set `workers` in `playwright.config.ts`.
- **The production bundle** is 559 kB (F1: 480 kB), over Vite's 500 kB warning. Route splitting was already planned for F5.
- **The fake API** answered `card_group_not_found` where the server says `group_not_found`; fixed.

## Files changed
- **Backend:** `app/schemas/rules.py` (`json_schema_serialization_defaults_required`).
- **New (frontend):**
  - `src/api/hooks/useDecks.ts`, `useRulesets.ts`, `useShare.ts`
  - `src/features/decks/`: `DeckListPage`, `DeckListItem`, `ShareCodeForm`, `DeleteDeckDialog`, `DeckBuilderPage`, `DeckBuilder`, `DeckHeader`, `DeckDnd`, `DeckLibraryPanel`, `LibraryCardButton`, `DeckPanel`, `OriginChangeDialog`, `LeaveGuardDialog`, `useLeaveGuard`, `useLibraryCards`, `ManaCurveChart`, `DeckValidityPanel`, `deckEntries`, `manaCurve`, `deckProblems`, and their tests
  - `src/features/share/`: `ShareDialog`, `shareLink`, `ImportPage`, `ImportPanel`, `SharedContent`, `SharedCards`, and their tests
  - `src/features/origins/OriginFormPreview.tsx`, `src/ui/IconButton.tsx`
  - `src/test/deckHandlers.ts`, `shareHandlers.ts`, `handlerUtils.ts`, `rulesetFixture.ts`
  - `e2e/share.spec.ts`
  - this file
- **Changed (frontend):**
  - `package.json` and `package-lock.json` (`@dnd-kit/core` 6.3.1), `src/api/schema.d.ts` (regenerated)
  - `src/routes.tsx`, `src/AppShell.tsx` (Decks in the nav)
  - `src/api/bounds.ts`, `src/api/inUse.ts`, `src/api/hooks/useCards.ts`, `useCardGroups.ts`, `useOrigins.ts`
  - `src/features/cards/`: `CardGroupPanel` (share, shared mark), `CardForm` and `DeleteCardDialog` (deck links), `MoveToGroupDialog` and `libraryParams` (comments), `cardValues` (`findNeutral`)
  - `src/features/origins/`: `OriginPreview` (props), `OriginForm`, `DeleteOriginDialog` (deck links)
  - `src/test/contentStore.ts`, `contentHandlers.ts`, `handlers.ts`
  - tests: `LoginPage`, `DashboardPage`, `OriginListPage`, `CardEditorPage`, `CardLibraryPage`
  - `e2e/helpers.ts` (`createCard`)
- **Docs:** `context/frontend_plan.md` (§1, §2, §3, §4.2, §4.2a, §7), `context/backend_plan.md` (§8) and `context/current-feature.md`.

## Verification
- `npm run lint`, `format:check`, `typecheck` and `build`: pass (the build warns about the 559 kB bundle).
- `npm test`: 197 passed in 33 files (50 new).
- `npm run e2e`: with `--workers=1`, all 4 passed (auth, content, deck share, group share). One earlier serial run had the group spec hang on a page load during the nginx stalls. With the default workers, the run fails on page-load timeouts, the existing auth spec included.
- Backend after the schema change: `pytest` 564 passed, `ruff check`, `ruff format --check` and `mypy app tests` pass.
- Screenshots of the builder, the share dialog, the deck list and the import page looked right.
- **Not verified:** art on imported cards (e2e uploads no art), a look by hand in two real browsers, and anything on Render. The e2e and screenshot runs left `e2e_…` users in the dev DB.

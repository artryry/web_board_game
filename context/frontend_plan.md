# Frontend implementation plan

The frontend for the card-game constructor described in [project_description.md](project_description.md). The backend plan, which includes the API and the WebSocket protocol, is in [backend_plan.md](backend_plan.md).

## 0. Design decisions (agreed)

| Topic | Decision |
|---|---|
| Stack | React + TypeScript + Vite |
| Board rendering | DOM/CSS cards with **dnd-kit** for drag-and-drop and Framer Motion for animations (no canvas) |
| Authority | The **server is authoritative**. The UI never re-implements game rules: it shows what the server sends and offers only the moves listed in `legal_actions`. |
| Accounts | Login is required for everything, including joining a room by code. |
| Card cost | The editor **suggests** a mana cost from the budget formula. **The final cost is always the user's choice**, and saving is never blocked. |
| Editors | Module settings forms (card abilities, spell effects, origin field effects, rule phases) are **generated from `GET /api/catalog`**, so new backend modules appear without frontend changes. |
| Origins | Users **create origins the same way they create cards**, in an origin editor with a name, look and field effects. The seeded system origins appear as templates. |
| Board size | The number of lanes (1–5, default 3) comes from the ruleset, so the board layout is built dynamically. |
| Turn timer | Default 90 s, editable per interactive phase in the rules editor (10–600 s). |

## 1. Stack

| Concern | Choice |
|---|---|
| Build | Vite 8, React 19, TypeScript 5.9 (`strict`, `noUncheckedIndexedAccess`, the `@/` alias for `src/`) |
| Routing | React Router 8 in data mode: `createBrowserRouter`, with `RouterProvider` from `react-router/dom` (not framework mode) |
| Server data | TanStack Query 5. Client errors (4xx) are never retried. |
| Live game state | Zustand (added in F4/F5, when the game store lands) |
| Drag-and-drop | dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`), added in F2 |
| Animation | Framer Motion, added in F5 |
| Styling | Tailwind CSS 4. The design tokens live in CSS, in the `@theme` block of `src/styles/index.css` (no `tailwind.config.js`). |
| Forms | React Hook Form + a small home-made `SchemaForm` for module params (it supports int, number with min/max, enum, bool and arrays of enums; an array with `uniqueItems` renders as checkboxes). The backend guarantees every catalog schema is inline (no `$ref`) and uses only these types. Labels come from each property's `title`. This is lighter than rjsf. |
| API client | `openapi-fetch`, typed by the generated `paths`, with our own `fetch` that adds the bearer token and handles refresh (§6) |
| API types | `openapi-typescript`, generated from `http://localhost/api/openapi.json` into the committed `src/api/schema.d.ts` (`npm run gen:api`) |
| Tests | Vitest 5 + React Testing Library + jsdom, with MSW 3 mocking the API; Playwright (Chromium) for end-to-end tests through nginx |
| Lint, format | ESLint 10 flat config (`typescript-eslint` strict type-checked, `react-hooks`, `react-refresh`, `jsx-a11y`), Prettier with width 100 and the Tailwind class sorter |

**Versions** are pinned exactly (`.npmrc` has `save-exact=true`), and `package-lock.json` is committed. Node 24 (`engines`, `.nvmrc`). They are the newest releases that fit together (checked 2026-11-06):
- TypeScript stays on 5.9: `typescript-eslint` needs `<6.1` and `openapi-typescript` needs `^5`, so TypeScript 7 has to wait.
- `eslint-plugin-jsx-a11y` 6.10.2 still declares ESLint ≤9, but it only uses rule APIs that ESLint 10 kept, so `package.json` has one `overrides` entry that lets it use our ESLint 10.
- jsdom stays on 29: 30+ needs Node ≥24.15.

In development the app runs on `localhost:5173` and is reached through nginx at `http://localhost/`, so `/api` and `/ws` are on the same origin and need no CORS setup. Vite listens on every interface (`host: true`), because nginx in Docker can't reach a loopback-only server, and its hot-reload socket goes through nginx on port 80. `VITE_API_ORIGIN` can point the client at another API origin; it is empty by default (the page's own). The refresh cookie (§6) is only sent to the page's own origin, so another API origin would also need CORS with credentials. Card art is loaded from the Cloudflare R2 public URL, which is a different origin.

## 2. Project layout

```
frontend/
  src/
    main.tsx, App.tsx, routes.tsx
    AppShell.tsx         header (app name, nav, username, Log out) around the logged-in pages
    NotFoundPage.tsx
    api/
      client.ts          openapi-fetch client: bearer header, one shared refresh on token_expired
      errors.ts          ApiError (code, message, extra, fieldErrors) and unwrap()
      queryClient.ts     QueryClient defaults (no retries on 4xx)
      schema.d.ts        generated OpenAPI types
      hooks/             useLibraryCounts, useOrigins, useCards, useDecks, useRulesets, useRooms, useShare ...
    auth/
      tokens.ts          access token in memory, the session hint in localStorage, cross-tab logout
      AuthContext.ts     auth state and context types
      AuthProvider.tsx   restores the session on start; login, register, logout
      useAuth.ts         useAuth, useCurrentUser
      ProtectedRoute.tsx, GuestRoute.tsx, redirect.ts (the remembered return page)
      LoginPage.tsx, RegisterPage.tsx, AuthLayout.tsx
      bounds.ts          input limits copied from the backend's auth schemas
      showServerError.ts maps API error codes onto form fields
    catalog/
      useCatalog.ts      cached GET /api/catalog
      SchemaForm.tsx     renders a params form from a JSON Schema
    features/
      dashboard/         DashboardPage
      origins/           OriginListPage, OriginEditorPage, OriginPreview (field tile + badge)
      cards/             CardLibraryPage, CardGroupPanel, BalanceLabel, CardEditorPage, CardPreview,
                         CostSuggestion, ArtUpload
      decks/             DeckListPage, DeckBuilderPage, ManaCurveChart, ShareDialog
      rules/             RulesListPage, RulesEditorPage, BoardSettingsForm,
                         PhasePipeline (sortable), ModulePalette, PhaseItem
      share/             ImportPage
      rooms/             CreateRoomPage, JoinByCodeDialog, LobbyView
      game/              GameView, GameBoard, Lane, Section, Slot, CreatureCard,
                         Hand, HandCard, OpponentHand, DeckPile, ManaBar,
                         PhaseTracker, TurnTimer, ActionLog, GameOverModal
      history/           GamesPage, ReplayViewer
    ws/
      socket.ts          RoomSocket: connect, reconnect with backoff, seq, resync
      gameStore.ts       Zustand store for room and game state
      eventQueue.ts      plays server events one after another as animations
    ui/                  Button, TextField, Modal, Toast, Tabs, CardFrame, HpBar, Spinner
    styles/              index.css: Tailwind and the @theme design tokens
    test/                Vitest setup, MSW fake API (handlers, server), renderApp helper
  e2e/                   Playwright specs (and global-setup.ts, which checks /api/health)
```

## 3. Pages and routes

| Route | Page | Main contents |
|---|---|---|
| `/login`, `/register` | Auth | Forms. After login, go back to the page the user came from. |
| `/` | Dashboard | My origins, cards, decks and rulesets (counts and most recent); **Create room**; **Join by code** |
| `/origins` | Origin list | My origins plus system origins (read-only, marked "template", with a **Duplicate** button); new / edit / delete |
| `/origins/new`, `/origins/:id` | Origin editor | See §4.0 |
| `/cards` | Card library | Cards organised by **group** (folders, plus "Ungrouped"): create, rename and delete groups, and move cards between them. A grid with filters (origin, kind, cost). Each card shows its **balance label** (*under-costed / balanced / over-costed*) from the server, as information only. New / edit / delete. Share a group by code (F2). |
| `/cards/new`, `/cards/:id` | Card editor | See §4.1 |
| `/decks` | Deck list | Origin badge, size, validity check against the default ruleset; share button |
| `/decks/:id` | Deck builder | See §4.2 |
| `/rules` | Rules list | My rulesets; duplicate / share / delete |
| `/rules/new`, `/rules/:id` | Rules editor | See §4.3 |
| `/share/:code` | Import | Preview of a shared deck, card group or ruleset → **Import to my library** |
| `/rooms/new` | Create room | Pick a ruleset → `POST /api/rooms` → go to `/room/:code` |
| `/room/:code` | Lobby, then game | See §4.4 and §5. The same route switches from lobby to game when the game starts. |
| `/games`, `/games/:id` | History / replay | Past matches; step-by-step replay |

## 4. Builders

### 4.0 Origin editor
- Works the same way as the card editor.
- Fields:
  - name
  - colour and icon (from a fixed, colour-blind-safe palette and icon set, both listed in the catalog as `origin_colors` (`{key, hex}`) and `origin_icons` (keys mapped to the icon set). Origins store the keys.)
  - optional field background image, uploaded like card art (`POST /api/uploads/origin-art`)
  - **field effects**: up to 3, picked from the catalog's field-effect modules and set up with `SchemaForm` (for example `stat_bonus` +1 HP to own-origin creatures)
- **Live preview:** `OriginPreview` shows a board section tile with this origin's background and effect badges, as it will look in a game.
- You can start from a template by duplicating one of the system origins (forest, volcano, ocean, mountain).
- Deleting an origin that is used by cards or decks shows the server's `409` list, so the user knows what to change first.

### 4.1 Card editor
- Fields:
  - kind (creature / spell)
  - name
  - origin (my origins plus system origins, with a "+ New origin" shortcut that opens the origin editor in a modal)
  - HP (creatures only) and DMG. For a spell, DMG follows the chosen effect's catalog `dmg_use`: positive for `damage`, negative for `heal`, and hidden for `none` (for example `draw_cards`).
  - **mana cost**
  - abilities (creatures, at most 2) or effect (spells), chosen from the catalog and set up with `SchemaForm`
  - group (optional)
  - art upload
- **Cost suggestion (never enforced):**
  - `CostSuggestion` works out `suggested_mana_cost` live from the stats and the catalog's ability costs. Each feature and spell has `cost: {base, per_param}`, so an ability costs `base + Σ weight × params[name]`. It uses the same formula as backend §7.8, kept in one small shared function. Its unit tests run `backend/tests/fixtures/cost_cases.json`, the same cases the backend runs.
  - A **Use suggested** button copies the suggestion into the mana field. The suggestion has no upper cap (backend §7.8), so above 10 the button fills in 10, and the hint says the card is stronger than any legal cost.
  - The editor shows no balance label. That label appears only in the card library (§3).
  - The mana field stays fully editable, and **Save is never disabled because of the formula**. Only hard bounds (for example mana 0–10) are checked.
- **Live preview:** `CardPreview` shows the card exactly as it looks on the board.
- **Art upload:** ask the backend for a presigned URL, `PUT` the file straight to Cloudflare R2 (the bucket needs a CORS rule allowing `PUT` from the app origin), then save `art_key` on the card. Check type and size (2 MB or less) in the browser first, and show a cropped preview.

### 4.2 Deck builder
- Two columns: the library on the left (filtered to the deck's origin plus neutral cards) and the deck list on the right, with copy counts.
- Add cards by clicking or by dragging into the deck.
- The deck origin is chosen once. Changing it warns that cards from the old origin will be removed. The save sends the new `origin_id` and the trimmed `cards` together, since the server rejects an origin change while old cards remain (`card_origin_mismatch`).
- Save sends the whole card list (`PATCH /api/decks/{id}` with `cards: [{card_id, count}]`). The server checks only the hard bounds: 1–4 copies, at most 60 cards, and the deck's origin or neutral.
- A validity panel checks the deck against a chosen ruleset's `deck` rules (size, maximum copies, neutral cards allowed).
- A small mana-curve chart, built from the users' own costs.
- **Share dialog** (decks and card groups use the same one):
  - `POST /api/decks/{id}/share` (or `/api/card-groups/{id}/share`) returns `{share_code}`. Calling it again returns the same code.
  - The dialog shows the code and a link to `/share/:code`, with a copy button.
  - The deck and group responses carry `share_code` (null when the item isn't shared), so the dialog can show an existing code and offer **Revoke** (`DELETE .../share`). After a revoke, sharing again gives a new code.
- Deleting a card that a deck holds, or moving it to an origin that doesn't fit, shows the server's `409 card_in_use` list of decks.

### 4.2a Import page (`/share/:code`)
- `GET /api/share/{code}` gives the preview, switching on `kind`:
  - `deck`: the name, the author, its origin, and the cards with counts
  - `card_group`: the name, the author, the origins its cards use, and the cards
- `share_not_found` shows "This link doesn't work any more".
- **Import to my library** sends `POST /api/share/{code}/import`. On `kind: "deck"` it goes to `/decks/:id`, and on `kind: "card_group"` it goes to `/cards`, filtered to the new group. A deck's cards land in a new group named after the deck.

### 4.3 Rules editor
- **Board / deck / mana / hand settings:** a plain form for the fixed settings:
  - **number of lanes (1–5, default 3)**, with a small board thumbnail that updates as the value changes
  - slots per section and section HP
  - deck size and maximum copies
  - mana start, per turn and maximum
  - hand size and the second-player bonus card
- **Phase pipeline:** two sortable lists, *Setup* and *Turn*.
  - `ModulePalette` lists the phase modules from the catalog. Click or drag one to add it.
  - Each `PhaseItem` can be expanded to edit its params with `SchemaForm`, and can be removed or reordered with dnd-kit sortable.
  - Interactive phases (`action_phase`) show their **time limit** right on the collapsed item (for example "⏱ 90 s"). It defaults to 90 s and can be edited from 10 to 600 s.
- **Validation:** call `POST /api/rulesets/validate` after edits (debounced) and show errors inline on the phase or field they belong to (for example "turn must end with end_turn").
- **Save / Load / Share:** save to my rulesets, load an existing one as a starting point, and share by code.
- Also offer a read-only "Preview turn" strip that shows the turn order as the phase tracker will show it in-game.

### 4.4 Lobby (`/room/:code` before the game starts)
- A big invite code with a copy button and a copyable link.
- Player slots for host and guest, each with a ready indicator.
- A deck selector that offers only decks valid for this room's ruleset (the check runs on the client for display, and the server makes the final decision).
- A ready button. When both players are ready, the server starts the game and the view switches to the board.

## 5. Game board

### 5.1 Layout
```
┌───────────────────────────────────────────────────────────────┐
│ Opponent: name · hand ▢▢▢▢ · deck 24 · mana ◆◆◆◇◇           │
├─────────────────┬─────────────────┬─────────────────┬─────────┤
│ Section (lane 1)│ Section (lane 2)│ Section (lane 3)│ Phase   │
│ HP ███████ 20   │ HP █████ 14     │ HP ░░ CONQUERED │ tracker │
│ [slot][slot][ ] │ [slot][ ][ ]    │ [ ][ ][ ]       │ ───     │
├─────────────────┼─────────────────┼─────────────────┤ Action  │
│ [slot][ ][ ]    │ [slot][slot][ ] │ [ ][ ][ ]       │ log     │
│ HP ████████ 20  │ HP ██████ 17    │ HP ██████ 18    │         │
│ Section (lane 1)│ Section (lane 2)│ Section (lane 3)│ Timer   │
├─────────────────┴─────────────────┴─────────────────┴─────────┤
│ You: mana ◆◆◆◆◇ · deck 22   [ hand cards ... ]   [End phase]  │
└───────────────────────────────────────────────────────────────┘
```
- The layout above shows the default of 3 lanes. **The number of columns comes from `ruleset.board.lanes` (1–5)**: the board is a CSS grid with `grid-template-columns: repeat(lanes, 1fr)`. On narrow screens with 4–5 lanes, the cards switch to a compact size.
- Each section's background shows its **field type** (the colour, icon and background of that side's deck origin), with a tooltip listing the origin's field effects.
- The `PhaseTracker` lists the ruleset's turn pipeline and highlights the current phase and whose action it is. In `actor: both` phases it shows both players' ready states.
- `TurnTimer` counts down to the `deadline` that the server sends. The length comes from the ruleset's phase setting (default 90 s). It turns into a warning colour for the last 10 s.
- **Surrender** asks for confirmation first.

### 5.2 Movement comes from the server
- Each `game_state` message includes `legal_actions`. The store builds an index from it: source uid → list of `{action type, valid targets}`.
- A hand card or creature is **draggable only if it is the source of some legal action**. Cards that can't move are shown slightly dimmed.
- While dragging, only that card's valid targets light up as drop zones: empty slots for playing, sections for moving, and enemy creatures or sections for attacks.
- Dropping on a highlighted target sends the matching `action`. Dropping anywhere else cancels the drag.
- **Click-to-target fallback** for touch devices and accessibility: click the source, then click a highlighted target. Esc cancels.

### 5.3 Server-authoritative update cycle
1. On drop, the client sends `{type: "action", seq, payload}` and marks the card as *pending* (a light spinner overlay). The UI doesn't move the card itself.
2. The server replies with `events`. `eventQueue` plays them in order as Framer Motion animations: draw, summon, attack swing, damage numbers, death, section HP drop, conquest.
3. The following `game_state` replaces the local view after the queued animations finish (or right away if animations are turned off).
4. On `error`, the pending card snaps back and a toast shows the reason (for example "Not enough mana").

## 6. Session, WebSocket client and state

**Session and token refresh** (F0):
- The access token (15 min) lives only in memory. The refresh token (30 days) is an **HttpOnly cookie** (`refresh_token`, `SameSite=Strict`, path `/api/auth`; see backend_plan §8). The browser keeps it, shares it between tabs and sends it to `/api/auth` itself, and no script can read it, so an XSS can't steal it.
- `localStorage` holds only a non-secret hint, `cardtable.session`, set while a session exists. On start, the hint sends the app to `POST /api/auth/refresh`, then `GET /api/auth/me`, behind a full-page spinner. Without the hint the app starts logged out without a request.
- `api/client.ts` adds `Authorization: Bearer` to every request except login, register, refresh and logout.
  - On a 401 with `token_expired` it refreshes once and retries the request. Parallel requests share that one refresh. A request whose token was already replaced retries without another refresh.
  - Any other 401 (or a failed refresh) ends the session. Every refresh stores the new access token (the answer renews the cookie too).
  - A refresh answer that arrives after a logout is dropped, so it can't log the user back in. Its answer has set a new cookie, so the client deletes that again.
- **Logout** forgets the access token and the hint and clears the query cache, then calls `POST /api/auth/logout`, because only the server can delete an HttpOnly cookie. Removing the hint fires a `storage` event, which logs out the app's other tabs. The backend keeps refresh tokens stateless; revocation is a later backend task that needs no UI change.
- Every way a session ends lands in one place (`onSessionEnd`). An intended logout (in this tab or another) sends the user to `/login` without a return page. An expired session or a deep link remembers the page, and the login goes back there.

- `RoomSocket` (`ws/socket.ts`):
  - connects to `/ws/rooms/{code}?token=…`
  - numbers outgoing messages with `seq`
  - drops any `game_state` whose `version` is older than the current one
  - reconnects with exponential backoff (1 s, 2 s, 4 s, up to 15 s), sends `resync` once reconnected, and shows a *Reconnecting…* banner meanwhile
  - refreshes the JWT before reconnecting if it has expired
- The Zustand `gameStore` holds `connection`, `room`, `view`, `version`, `legalActions` (with the index), `eventQueue`, `pendingAction`, `deadline` and `result`.
- REST data (cards, decks, rulesets) stays in TanStack Query. Only live room and game state goes in Zustand.

## 7. Milestones (each one depends on the backend milestone named)

| # | Milestone | Depends on | Done when |
|---|---|---|---|
| F0 | Vite scaffold, Tailwind, router, API client, generated types, auth pages, dashboard shell | M0, M1 | A user can register, log in and log out through nginx |
| F1 | Catalog + `SchemaForm`, origin editor, card editor with cost suggestion, card library with groups and balance labels, art upload | M2 | Origins with field effects, and cards with abilities and art, can be created and edited and sorted into groups; the cost suggestion updates live |
| F2 | Deck builder, share dialog (decks and card groups), import page | M3 | A deck or a card group can be shared by code and imported by another user |
| F3 | Rules editor (settings, sortable pipeline, inline validation, share) | M4 | The default ruleset can be loaded, edited, validated and saved |
| F4 | Create room, join by code, lobby | M6 (lobby part) | Two browsers can meet in a lobby, pick decks and mark ready |
| F5 | Game board: static render from a mocked state → live WS → drag-and-drop from `legal_actions` → event animations | M5, M6 | Two browsers can play a full game to a win |
| F6 | Match history, replay viewer, responsive layout, polish | M7 | Past games can be replayed step by step; the board works on a tablet |

Tip: build the board in F5 against **mock `game_state` JSON fixtures** first (and reuse the backend's golden-replay fixtures), so UI work doesn't have to wait for the live WebSocket.

## 8. Testing

- **Unit tests:** `SchemaForm` (each supported schema type), the cost-suggestion function (the same cases as the backend tests), and the `gameStore` reducers and `legal_actions` index.
- **Component tests:** a card is draggable if and only if `legal_actions` contains it; drop zones light up only for valid targets; an `error` makes the card snap back; the board renders correctly with 1, 3 and 5 lanes.
- **End-to-end tests (Playwright, two browser contexts):** register two users → create an origin, cards and a deck → create a ruleset → create a room → join by code → select decks → play to `game_over`.

## 9. UX suggestions

- **Never re-implement rules on the client.** Everything about which moves are allowed comes from `legal_actions`. This avoids desync bugs and makes cheating pointless.
- **Show the pipeline.** The phase tracker explains the custom rules during play. That matters because every room can have different rules.
- **Show the cost suggestion as advice, not a limit.** The suggested cost helps users price cards fairly, and the decision always stays theirs. The balance label appears only in the card library, as information.
- **Start with templates.** Seeded starter decks and a default ruleset let a new user play within a minute, then customize later.
- **Accessibility:** click-to-target as well as drag; visible focus; colour-blind-safe field-type colours with icons; a "reduced motion" setting that skips animations.
- **Later:** spectator mode, chat with emotes, a public gallery of shared decks and rulesets, and dark/light themes.

## 10. Use case → frontend coverage

| Use case (project_description.md) | Frontend |
|---|---|
| UC1 Create a card | `/cards/new` – Card editor |
| *(new)* Create an origin | `/origins/new` – Origin editor (also reachable from the card editor) |
| UC2 Create a deck | `/decks/:id` – Deck builder |
| UC3 Create a room | `/rooms/new` |
| UC4 Create turn-flow rules | `/rules/new` – Rules editor |
| UC5 Load saved rules | `/rules` list, and "Load" in the rules editor |
| UC6 Invite second player via code | Lobby invite code and link |
| UC7 Play game | `/room/:code` – Game board |
| UC8 Share deck | Deck builder share dialog, `/share/:code` |
| UC9 Share rules | Rules editor share, `/share/:code` |
| UC10 Join a game via code | Dashboard "Join by code" dialog |
| UC11 Select deck | Lobby deck selector |
| UC12 Save rules | Rules editor Save |

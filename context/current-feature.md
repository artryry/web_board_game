# Current feature: F4 — Create room, join by code, lobby

**Status:** built on 2026-11-21, not committed. Branch `f4-rooms`, from `master` (`235e490`). Left: the check by hand in two real browsers ([sessions/session_2026-11-21_f4-rooms.md](sessions/session_2026-11-21_f4-rooms.md)).
**Plan reference:**
- [frontend_plan.md](frontend_plan.md): §2 (layout), §3 (routes), §4.4 (the lobby), §6 (`RoomSocket`, `gameStore`), §6.1 (the socket's log events), §7 and §8
- [backend_plan.md](backend_plan.md): §8 (the Rooms routes and their errors), §9 (rooms and the WebSocket)
- [coding-standards.md](coding-standards.md): §3 (frontend) and §4 (tests)

**Depends on:**
- M6: the Rooms REST routes and the game socket; `npm run gen:api` already typed both
- F2: the decks, `deckProblems`' wording, the share-code helpers
- F3: rule sets, `rulesetSummary` and `RulesetSummary`

All are done.

**Unblocks:** F5, whose board plugs into this room page, `RoomSocket` and `gameStore`.

On the client side it covers UC3 (create a room), UC6 (invite by code), UC10 (join by code) and UC11 (select a deck).

Earlier features still have follow-ups:
- **M4, M5, M6, F2 and F3** are all on `master` (`235e490`) and pushed to `origin/master`. Not checked from here (no `gh`): whether CI passed with M6's Redis service, and whether Render deployed and ran M4's and M5's migrations. Look at the Actions tab and Render.
- **M6, not verified:**
  - rooms on Render and Upstash
  - a graceful shutdown (1012) with sockets open
  - not done, mentioned only: `--ws-max-size 65536` in `start.sh` ([sessions/session_2026-11-15_m6-rooms.md](sessions/session_2026-11-15_m6-rooms.md))
- **F3:** a look by hand in a real browser ([sessions/session_2026-11-13_f3-rules.md](sessions/session_2026-11-13_f3-rules.md)). On 2026-11-21 its e2e drag of a phase to the top landed one place lower, twice in three tries ([sessions/session_2026-11-21_f4-rooms.md](sessions/session_2026-11-21_f4-rooms.md)).
- **F2:** to check by hand: the copied art on imported cards, and a look in two real browsers ([sessions/session_2026-11-12_f2-decks.md](sessions/session_2026-11-12_f2-decks.md)).
- **Dev nginx:** page loads through it stall (an unreachable IPv6 `host.docker.internal`), so `npm run e2e` needs `--workers=1`, and on 2026-11-13 even that needed `--retries=2`. Not fixed. Game sockets through it were fine in M6's smoke run.
- **Art cleanup:** check Render after the deploy ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
Two logged-in players meet in a room:
- one creates it from a rule set and shares the code or the link
- the other joins with the code or by opening the link
- each picks one of their decks that fits the room's rules (the server says which fit, and why the others don't)
- both mark ready, and the game starts

Until F5 brings the board, the started game shows a placeholder: who goes first, an opponent-away countdown, Surrender and the result.

Done when (frontend_plan §7): **two browsers can meet in a lobby, pick decks and mark ready.**

F4 adds no board, drag-and-drop or animations (F5), and no history (M7, F6). It needs no backend change.

## How it works

### Pages and routes
| Route | Page | New in F4 |
|---|---|---|
| `/` | `DashboardPage` | a Play section: **Create room**, **Join by code**, and **Back to room** for the last room |
| `/rooms/new` | `CreateRoomPage` | pick a rule set → `POST /api/rooms` → `/room/:code` |
| `/room/:code` | `RoomPage` | joins, opens the socket, then the lobby → the game placeholder → the result |

- **No new nav item:** games start from the dashboard.
- **Both routes are inside `AppShell`,** like every logged-in page. F5 can take the board out of the shell if it needs the room.

### Dashboard
- **A Play section** above the counts, with two buttons:
  - **Create room** → `/rooms/new`
  - **Join by code** → `JoinByCodeDialog`
- **Back to room** (confirmed 2026-11-21):
  - **What's remembered:** the room page stores the last room this browser joined, as `{user_id, code}`, in `localStorage` (`cardtable.lastRoom`).
  - **When the dashboard shows it:** only for the same user. It checks the room with `GET /api/rooms/{code}` and shows "Back to room ABC123 · In the lobby / Game in progress" only for `lobby` or `playing`.
  - **When it's forgotten:**
    - a 404 or a finished room
    - the guest leaving, the host closing the room, `room_closed`, and 4403/4404 on the socket
  - **Storage blocked:** no tile, and nothing breaks (as `tokens.ts` handles it).

### Join by code (`JoinByCodeDialog`)
- **The code field:** case and spaces don't matter (`normalizeShareCode` from `features/share/shareLink.ts`). Codes are 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. The client only checks that the field isn't empty; the server decides the rest.
- **Join** sends `POST /api/rooms/join {code}`.
- **Errors stay in the dialog,** so a typo can be fixed:
  - `room_not_found`: "No room has this code. It may have closed."
  - `room_full`: "This room is full, or its game has started."
- **On success** it caches the answer for the room page (so the page doesn't join again) and goes to `/room/:code`.

### Create room (`/rooms/new`)
- **The rule sets** come from `useRulesets`: the default first, then the user's own by name.
  - They show as a radio list: the name and `rulesetSummary` ("3 lanes · 30-card decks · 4 turn phases").
  - The default is picked to start with.
  - A "Show rules" toggle shows the picked one in full (`RulesetSummary`, read-only).
- **Create room** sends `POST /api/rooms {ruleset_id}`, then goes to `/room/:code` with `replace`, so Back doesn't land on a form that makes a second room.
- **Errors:**
  - `invalid_ruleset` (422): "This rule set has problems since a module changed. Open it in the rules editor to fix it.", with a link to `/rules/:id`
  - `ruleset_not_found`: "This rule set was deleted.", and the list refreshes
  - anything else: `ErrorAlert`

### Room page (`/room/:code`)
1. **Join** (confirmed 2026-11-21): on load the page sends `POST /api/rooms/join {code}`.
   - A member gets the same answer again, so the host, a returning player and an invited one all take this one path. The link is the invitation.
   - It doesn't join again when the join dialog has just done it (the cached answer).
   - **A code typed in lower case** is replaced in the address by the room's own `code` (`replace`).
   - **Errors:**
     - `room_not_found`: "This room is gone: the code is wrong, or the room closed."
     - `room_full`: "This room is full, or its game has started."
     - Both offer **Back to the dashboard**.
   - **Success:** stores the room as the last room.
2. **The socket:** the page opens a `RoomSocket` and fills `gameStore` with the join's `RoomState` until the first `room_state` arrives. From then on it renders only from `gameStore`.
3. **By `room.status`:**
   - `lobby` → `LobbyView`
   - `playing` → `GamePlaceholder`
   - `finished` → `GamePlaceholder` with the result
4. **The connection:**
   - **Reconnecting:** a *Reconnecting…* banner stays over the view, and its controls are disabled. During a game the banner adds "You lose if you're away for 60 seconds."
   - **An ended connection** replaces the view with a message, each with **Back to the dashboard**:

| How it ended | The page says | Also |
|---|---|---|
| 4403 | "You're not in this room any more." (for example, the guest left in another tab) | forgets the last room |
| 4404 | "This room is gone." | forgets the last room |
| 4409 | "This room is open in another tab." | **Use it here** reconnects, which moves the other tab to this message |
| `room_closed`, then 1000 | the guest: "The host closed the room."; a finished room: "This room has closed." | forgets the last room |
| the player's own `leave` | — | goes straight to the dashboard |
| a second 4401 right after a refresh | "Couldn't sign in to the room." with **Try again** | |

### Lobby (`LobbyView`)
```
┌ Room ABC123  [Copy code]  http://…/room/ABC123 [Copy link]        [Leave] ┐
│ Rule set: Default · 3 lanes · 30-card decks · 4 turn phases  [Show rules] │
├──────────────── Players ───────────────┬────────────── Your deck ─────────┤
│ alice (host, you)  ● Online            │ ○ Fire deck  [Volcano] 30 cards   │
│   Deck chosen · Ready                  │ ● Ice deck   [Ocean]   30 chosen  │
│ bob                ○ Offline           │ ✗ Test deck  [Forest]  12 / 30    │
│   No deck yet · Not ready              │     12 of 30 cards · Edit deck ↗  │
│                                        │ [ I'm ready ]                     │
└────────────────────────────────────────┴───────────────────────────────────┘
```
- **Invite** (UC6):
  - the code, large, with **Copy code**
  - the full link to `/room/:code`, with **Copy link**
  - The copy and its fallback come from `ShareDialog`'s `copyLink`: a refused clipboard selects the text for copying by hand. That code moves to `ui/` (for example `CopyButton`), and a failure logs `room.copy_failed` (warn) here.
- **The rule set:** its name and `rulesetSummary`, and **Show rules** (`RulesetSummary`). It's the room's copy (`room.ruleset`), which later edits don't change.
- **Players:**
  - **Two slots, host first.** Each shows:
    - the username, "host", and "you" on the user's own slot
    - **Online / Offline** (`connected`), as an icon and a word, never colour alone
    - "Deck chosen" or "No deck yet" (`has_deck`); the opponent's deck is never named
    - "Ready" or "Not ready"
  - **No guest yet:** "Waiting for a player. Share the code or the link."
- **Your deck (`RoomDeckPicker`, UC11):**
  - **The list:** `GET /api/rooms/{code}/decks` (`useRoomDecks`), loaded in full.
    - Each deck shows its name, its origin (`OriginBadge`, from `useOrigins`) and its card count against `deck.size`.
    - `staleTime: 0`, so it refreshes whenever the tab gets the focus back (TanStack's `refetchOnWindowFocus`). The app's default is 30 s.
  - **A playable deck** (no `problems`) is a radio option. Picking it sends `select_deck` at once; the server's `my_deck` marks the chosen one.
  - **A deck with problems** is shown disabled, with each problem as its reason:
    - "12 of 30 cards"
    - "More than 2 copies: Wolf, Bear"
    - "Neutral cards not allowed: Squire"

    The wording is shared with F2's `DeckValidityPanel` through one formatter in `features/decks/`. The server names cards as `{id, name}`, F2 by name.
  - **Edit deck** on a refused deck opens `/decks/:id` in a new tab (confirmed 2026-11-21). Coming back to the lobby tab refreshes the list.
  - **The hint under the list:** "The room keeps your deck as it was when you chose it. After editing it, choose it again." (The server copies a snapshot on `select_deck`.)
  - **No decks at all:** "You have no decks yet.", with **Build a deck** (`/decks/new`, new tab).
  - **Errors on `select_deck`:**
    - `deck_not_playable` (the deck changed since the list loaded): its `problems` show at that deck, and the list refreshes
    - `deck_not_found`: "That deck was deleted.", and the list refreshes
- **Ready:**
  - **The button:** **I'm ready** / **Not ready**, a toggle (`aria-pressed`) that sends `ready {ready}`.
  - **Without a chosen deck** it is disabled, with "Choose a deck first".
  - **The server clears ready** when the player picks another deck or disconnects. The button only shows `ready` from `room_state`, never a local guess.
  - **Waiting:** "Waiting for bob to get ready", or "Waiting for a player".
  - **Both ready:** the server starts the game, and `room_state` turns to `playing`.
- **Leave:**
  - **The guest:** **Leave** sends `leave`, with no confirm. The server closes the socket with 1000, the page goes to the dashboard, and the seat is free again.
  - **The host:** **Close room** asks first: "Close the room? bob will be sent out." Then it sends `leave`; the host gets `room_closed` and goes to the dashboard.
  - **Leaving the page another way** (the nav, closing the tab) asks nothing in the lobby. The seat is kept, and the server clears the player's ready flag.
- **Other server errors in the lobby** (`not_in_lobby`, `no_deck`, `bad_message`, `stale_state`): an `ErrorAlert` above the lobby with the server's `message`. It goes away on the next change or when dismissed.

### Game placeholder (`GamePlaceholder`, until F5)
Confirmed 2026-11-21. F5 puts the board in its place, and the result becomes `GameOverModal`.
- **While playing:**
  - "Game in progress", and who goes first: "You play first" or "bob plays first" (seat 0 goes first)
  - **An opponent away** (`away_since`): "bob left the game. They lose in 0:42 unless they come back."
    - It counts down to `away_since` + 60 s.
    - Its clock is corrected by the latest `game_state.server_time`.
    - It stops when they're back.
  - **Surrender** asks first ("Surrender? bob wins."), then sends `action {type: "surrender"}`.
  - **Leaving the page during a game** asks first, with `useLeaveGuard` (in-app links, and the browser's prompt on close or reload): "Leave the game? You lose if you're away for 60 seconds."
- **The result:** from `game_over`, or from `game_state.view` (its winner and `end_reason`) after a reload, since a resync sends no `game_over`.
  - **The headline:** "You won", "You lost" or "Draw" (`winner: null`).
  - **The reason:**

| `end_reason` | Text |
|---|---|
| `conquered` | "Sections conquered." |
| `surrender` | "bob surrendered." / "You surrendered." |
| `out_of_cards` | "Both players ran out of cards." |
| `abandoned` | "bob left the game." / "You were away too long." |

  - **Back to the dashboard.** The room closes 10 minutes after the end (`room_closed`).

### `RoomSocket` (`ws/socket.ts`)
A plain class with no React, so it gets its own tests. It implements the client side of backend_plan §9.2. F4 builds all of the transport (frontend_plan §6), since the lobby needs reconnects too.
- **The URL:** `ws(s)://<origin>/ws/rooms/{code}`, from `apiOrigin()` (`http` → `ws`, `https` → `wss`; empty means the page's own host). No token goes in the URL.
- **Auth:** the first message is `auth {token}`, sent on `open`.
  - Before each connect it takes `getAccessToken()`. When the token is missing, or its `exp` is less than 30 s away (read from the JWT, not checked), it calls `refreshSession()` first.
  - If the refresh says the session ended, the socket stops; the app's own session handling goes to `/login`.
- **`seq`:** every client message gets the next number, counting from 1 for the life of the `RoomSocket` (across reconnects).
- **`ping`** every 30 s while open. `pong` is ignored.
- **Incoming messages** go to `gameStore`:

| Message | What happens |
|---|---|
| `room_state` | `room` |
| `game_state` | the latest `view`, `legal_actions` and `deadline`, and the clock offset (`server_time − Date.now()`). One whose `view.version` is older than the current one is dropped (`game.stale_state_dropped`). |
| `events` | ignored in F4; F5's `eventQueue` plays them |
| `error` | `lastError`, and `ws.server_error` |
| `game_over` | `result` |
| `room_closed` | marks the room closed; the 1000 that follows ends the connection |
| `pong` | nothing |

  - A frame that doesn't parse, or has an unknown `type`, is dropped and logged (`ws.bad_server_message`, warn).
- **Close codes:**
  - **4401:** refresh, then reconnect at once. A second 4401 in a row ends with "Couldn't sign in to the room."
  - **4403, 4404 and 4409:** end, with no reconnect (the messages above).
  - **1000:** after `room_closed` or the player's own `leave`, end. Otherwise reconnect.
  - **1013, 1011, 1006 and anything else:** reconnect.
- **Reconnects** back off: 1 s, 2 s, 4 s, 8 s, then 15 s each time. The delay resets once a connection gets its first `room_state`. The server sends the full state on every connect, so no `resync` is needed after a reconnect.
- **`close()`** (when the room page unmounts): closes with 1000 and stops every timer.
- **Types:** from `schema.d.ts` (`AuthMessage`, `SelectDeckMessage`, `ReadyMessage`, `LeaveMessage`, `ActionMessage`, `PingMessage`, `ResyncMessage`; `RoomStateMessage`, `GameStateMessage`, `EventsMessage`, `ErrorMessage`, `GameOverMessage`, `RoomClosedMessage`, `PongMessage`). `ws/messages.ts` only puts them into unions.

### `gameStore` (`ws/gameStore.ts`, Zustand)
F4's part of frontend_plan §6. F5 adds the `legal_actions` index, `eventQueue` and `pendingAction`.
- **`connection`:** `connecting`, `open`, `reconnecting`, or `ended` with a reason (`not_member`, `room_gone`, `replaced`, `room_closed`, `left`, `auth_failed`)
- **`room`:** `RoomState | null`
- **`game`:** the latest `{view, legalActions, deadline}`, and `clockOffset`
- **`result`:** `{winner, reason} | null`
- **`lastError`:** the last `ErrorPayload`
- **Commands** the views call, which send through the socket: `selectDeck`, `setReady`, `leave`, `surrender`, `useHere` (reconnect after 4409)
- **One room at a time:** the room page resets the store when it mounts.
- REST data (decks, rule sets, origins) stays in TanStack Query (coding-standards §3).

### API hooks (`api/hooks/useRooms.ts`)
- **`useCreateRoom`:** `POST /api/rooms`
- **Joining:**
  - `useJoinRoom`: the dialog's mutation
  - `useRoomMembership(code)`: the room page's join, a query on `POST /api/rooms/join` with `staleTime: Infinity`, which the dialog's answer seeds
- **`useRoom(code)`:** `GET /api/rooms/{code}`, for the dashboard's Back to room
- **`useRoomDecks(code)`:** `GET /api/rooms/{code}/decks`, every page (`fetchAllPages`)
- **Types** from `schema.d.ts`: `RoomState`, `RoomPlayerOut`, `RoomDeckOut`, and the server's problem union (`SizeProblem | CopiesProblem | NeutralProblem`). No regeneration is expected: M6 ran `gen:api`.

### Fake API and fake socket for tests
- **`test/roomHandlers.ts`** (MSW, REST), over an in-memory room store:
  - create, join (`room_not_found`, `room_full`), get (404 for non-members)
  - the deck list with problems
- **`test/roomServer.ts`:** a fake room socket on MSW's WebSocket support (`ws.link`; check MSW 3.0.4's API before using it). It:
  - checks `auth` and sends `room_state` on connect
  - handles `select_deck`, `ready` and `leave`
  - starts a game when both are ready: `room_state` (`playing`), then `game_state` with a small fixture view
  - answers `surrender` with `game_over`
  - can close with any code a test asks for
- **No sleeps:** `vi.useFakeTimers` drives the ping, the backoff and the countdown.

### Logging (frontend_plan §6.1)
- **`ws.connected`** (debug, `room_code`) and **`ws.closed`** (info, `code`, `room_code`)
- **`ws.reconnecting`** (info, `attempt`, `delay_ms`, `code`)
- **`ws.server_error`** (info, `reason`, `seq`): an expected refusal, like a 4xx
- **`ws.bad_server_message`** (warn, `type`)
- **`game.stale_state_dropped`** (debug, `version`, `current`)
- **`room.copy_failed`** (warn)
- **Never logged:** the token, or any message body.
- **REST:** room creation and joins need no event of their own; the server logs `room.created` and `room.joined`.

### From M6 (what the server gives)
- **REST:**

| Route | Answer | Errors |
|---|---|---|
| `POST /api/rooms {ruleset_id}` | 201 `RoomState` | 404 `ruleset_not_found`, 422 `invalid_ruleset` |
| `POST /api/rooms/join {code}` | 200 `RoomState`; a member gets it again | 404 `room_not_found`, 409 `room_full` |
| `GET /api/rooms/{code}` | 200 `RoomState` | 404 `room_not_found`, also for non-members |
| `GET /api/rooms/{code}/decks` | 200 `Page[RoomDeckOut]` | 404 `room_not_found` |

- **`RoomState`:**
  ```
  {code, status, ruleset: {id, name, definition},
   players: [{user_id, username, is_host, connected, has_deck, ready, seat, away_since}],
   my_deck: {id, name, origin_id, card_count} | null}
  ```
  - `seat` is null until the game starts.
  - `away_since` is Unix ms.
  - `connected` comes from the live sockets.
- **The socket:**
  - Client messages are `{type, seq, payload}`; server messages are `{type, payload}`.
  - `events` and `error` name the `seq` they answer.
  - **Close codes:**
    - 4401: no valid `auth` within 10 s, or a bad token
    - 4403: not a member
    - 4404: no such room
    - 4409: a newer socket of the same user
    - 1000: the room closed after `room_closed`, or the guest left
    - 1013: the send queue overflowed
    - 1011: a server error
- **The lobby rules:**
  - `select_deck` clears ready.
  - `ready` needs a deck (`no_deck`).
  - A lobby disconnect clears ready.
  - The guest leaving frees the seat; the host leaving deletes the room.
- **The game starts** when both players have a deck and are ready. Both get `room_state`, `events` and `game_state`.
- **Players away:** a socket closed during a game sets `away_since`. After 60 s (`DISCONNECT_FORFEIT_S`) the server applies `abandon`, and the opponent wins.
- **`game_over`** has `winner` (a seat or null) and `reason`, and no `game_id` until M7.

## Done when
- [x] **Create room:** from the default or one of the user's own rule sets; the room page shows the code and the link; `invalid_ruleset` and `ruleset_not_found` show.
- [x] **Joining:**
  - by code from the dashboard dialog, which shows a wrong code and a full room in place
  - by opening the link, which joins at once
  - a reload or a second visit lands in the same room
- [x] **Lobby:**
  - both players with online, deck and ready
  - the deck list with each refused deck's problems and Edit deck, refreshed on focus
  - picking a deck, ready and not ready
  - the guest leaving, and the host closing the room ("The host closed the room" for the guest)
- [x] **The start:** when both are ready, both screens switch to the placeholder with who goes first. Surrender ends the game, and both see the result; a reload of a finished room still shows it.
- [x] **The socket:**
  - `auth` first, and `ping` every 30 s
  - reconnects with backoff behind the banner
  - 4401 refreshes and reconnects
  - 4403, 4404 and 4409 (with Use it here) show their messages
- [x] **Away:** an opponent away shows the countdown, and its end shows "bob left the game".
- [x] **Back to room** on the dashboard, only for the same user and a live room.
- [x] **Checks pass:** `npm run lint`, `typecheck`, `test` (360) and `build`. `format:check` passes with `--end-of-line auto`: this machine's checkout is CRLF (see Notes). `npm run e2e` (with `--workers=1 --retries=2`) passes with the new rooms spec; the dev nginx still stalls some page loads. In the whole suite, F3's rules-editor drag test failed here (not touched by F4; see the session file).
- [ ] **Checked by hand** in two real browsers through nginx: create, join by link, a refused deck, pick, ready, the start, surrender; a reload and a dropped network in the lobby.

## Decisions
Confirmed with the user on 2026-11-21:
- **The invite link joins at once.** The room page always sends `POST /api/rooms/join`, which is safe for members, so a link opener joins without a prompt.
- **Until F5, a started game shows a placeholder:** who goes first, the away countdown, Surrender and the result. Two browsers can then take a room from lobby to finished.
- **A way back to the room:**
  - a refused deck has Edit deck (a new tab), and the lobby's deck list refreshes when its tab gets the focus back
  - the dashboard offers Back to room for the last room this browser joined

Choices made while writing this spec (say if any should change):
- **All of `RoomSocket` is built in F4** (auth, `seq`, ping, reconnect, refresh, close codes, the version check). F5 adds events, the `legal_actions` index and the turn countdown.
- **The store starts from the join's `RoomState`,** so the lobby draws before the socket answers.
- **Picking a deck sends `select_deck` at once:** no separate confirm button.
- **The host's Close room asks first; the guest's Leave doesn't.**
- **No leave prompt in the lobby; one during a game.** In the lobby the seat is kept anyway; in a game, being away for 60 s loses.
- **No nav item:** the dashboard is where games start.
- **Create room goes to the room with `replace`.**
- **The 60 s forfeit time is copied to the client** (`DISCONNECT_FORFEIT_MS`, next to the socket code), like `bounds.ts` copies limits, since `RoomState` doesn't carry it.
- **Deck problems have one formatter** for F2's validity panel and the lobby.
- **`ws.server_error` logs at INFO:** refusals such as `no_deck` are expected, like a 4xx.
- **`seq` counts for the life of the `RoomSocket`,** across reconnects.
- **Back to room is stored with the user's id,** so another user on the same browser never gets it (opening it would join them).
- **Socket tests use MSW's WebSocket support,** next to the REST handlers, with fake timers.
- **The e2e spec seeds content through the REST API:**
  - a rule set with 10-card decks and up to 4 copies (the smallest the rules allow)
  - three cards
  - a playable deck and a refused one

  Building 30-card decks through the UI would make the spec slow; the deck builder has its own e2e spec.
- **Zustand** goes in now, since the lobby's live state belongs in `gameStore` (coding-standards §3). It gets the newest release, pinned exactly.

Made while building (2026-11-21; say if any should change):
- **The join's answer is handed over once, not cached.** The dialog and Create room put their `RoomState` under `["rooms", "handoff", code]`; the room page's join query (`["rooms", "membership", CODE]`, `staleTime: Infinity`, `gcTime: 0`) takes it and removes it. A later visit joins again: a guest who left and opens the link again must, or the socket answers 4403. Seeding the membership query itself wouldn't work: TanStack keeps the larger `gcTime`, so the seeded answer would outlive the page. The key uses the upper-case code, so replacing a lower-case address doesn't join twice.
- **Deck errors are matched by `seq`.** `ErrorPayload` has no deck id, so the store keeps the last `select_deck`'s `{seq, deckId}`. `deck_not_playable` and `deck_not_found` show at that deck; any other refusal is `lastError` (the alert), which the next `room_state` clears.
- **Clicking the chosen deck sends it again.** A checked radio fires no `change`, so the hint "After editing it, choose it again" needed a click handler on the chosen one.
- **The ready button keeps one name**, "I'm ready", with `aria-pressed` and a check icon when pressed. A toggle whose label also flips would say its state twice to a screen reader.
- **The connection is `open` at the first `room_state`**, not at the socket's `open`, since `auth` can still fail there. The backoff resets then too. A refresh that fails on the network backs off like a dropped connection.
- **A token whose `exp` can't be read is sent as it is** (the fake API's tokens aren't JWTs); 4401 covers a bad one.
- **The player's own `leave` wins over `room_closed`:** the host's Close room gets `room_closed` and 1000 too, but goes straight to the dashboard. That navigation replaces the room in the history, so Back doesn't join again.
- **The copy logic moved to `ui/useCopyText`, a hook,** not a component: the share dialog keeps its layout, and the lobby uses it for the code and the link.
- **`LeaveGuardDialog` got an optional `title`** ("Leave the game?" during a game).
- **The fake game socket closes one microtask after its last message.** MSW delivers a message in a microtask and drops it if the socket is closing by then; a real server's stream keeps the order.
- **Socket timing is tested on `RoomSocket` with fake timers.** Page tests don't wait for a backoff: Testing Library's `waitFor` can't drive Vitest's fake timers without globals. The away countdown's page test fakes only `Date`.

## Tasks
Order:
1. Zustand, the routes, `useRooms` and the fake REST handlers
2. the dashboard's Play section, `CreateRoomPage` and `JoinByCodeDialog`
3. `RoomSocket` and the fake room server
4. `gameStore`, and the room page's join, connection banner and ended screens
5. `LobbyView`: invite, players, the deck picker, ready, leave
6. `GamePlaceholder`: who goes first, the away countdown, Surrender, the result, the leave guard
7. Back to room
8. e2e
9. docs

Each step comes with its tests.

### Setup
- [x] Check Zustand's newest release, then install it with an exact version (5.1.0, released 2026-11-06).
- [x] Routes: `/rooms/new` and `/room/:code`.

### Hooks and fakes
- [x] `api/hooks/useRooms.ts`: `useCreateRoom`, `useJoinRoom`, `useRoomMembership`, `useRoom` and `useRoomDecks`.
- [x] `test/roomHandlers.ts` (REST) and `test/roomServer.ts` (the socket), over `test/roomStore.ts`.

### Rooms
- [x] `DashboardPage`: the Play section, `JoinByCodeDialog`, and Back to room (`features/rooms/lastRoom.ts`).
- [x] `CreateRoomPage`.
- [x] `ws/messages.ts`, `ws/socket.ts` (`RoomSocket`) and `ws/gameStore.ts`.
- [x] `RoomPage`: the join, the socket's life, the banner and the ended screens.
- [x] `LobbyView`:
  - `InviteBox` (the shared copy logic moved to `ui/useCopyText`)
  - `PlayerSlots`
  - `RoomDeckPicker`
  - `ReadyButton`
  - Leave and Close room
- [x] The deck-problem formatter, shared with `DeckValidityPanel` (`features/decks/problemText.ts`).
- [x] `GamePlaceholder`: `AwayCountdown`, Surrender, `GameResult`, and the leave guard.

### Tests
- [x] **Unit:**
  - `RoomSocket`:
    - `auth` first, `seq`, the ping
    - the backoff and its reset
    - each close code
    - the refresh before connecting and on 4401, and a second 4401
    - stale `game_state` dropped
  - `gameStore`'s message handling
  - the WebSocket URL from `apiOrigin()`
  - the away countdown with a clock offset
  - the deck-problem formatter
  - the last-room storage
- [x] **Pages (Vitest, MSW):**
  - **`DashboardPage`:** the Play section, the join dialog's errors and its success, and Back to room (shown, hidden for another user, forgotten on 404 or a finished room)
  - **`CreateRoomPage`:** the list, the default picked first, the payload, `invalid_ruleset`, `ruleset_not_found`
  - **`RoomPage`:**
    - the join on load and its errors
    - the lower-case code replaced
    - the lobby: players, refused decks with problems and Edit deck, `select_deck` and its errors, ready, leave, close (with confirm), the guest's "The host closed the room"
    - the switch to the placeholder, surrender and the result; the result after a reload from the view
    - the banner while reconnecting
    - the 4403, 4404 and 4409 screens, and Use it here
- [x] **e2e** (`e2e/rooms.spec.ts`, with `e2e/seed.ts`), two browser contexts:
  1. register two users and seed their content through the REST API
  2. the host creates a room with the small rule set
  3. the guest joins with the code from the dashboard
  4. the guest sees the refused deck's problem, then picks the playable one
  5. both mark ready, and both see the game start
  6. the host surrenders, and both see the result

  A second test opens the invite link as the guest, leaves, and joins again.

### Docs
- [x] [frontend_plan.md](frontend_plan.md):
  - §1: Zustand installed
  - §2:
    - the `rooms/` files and `ws/messages.ts`
    - the copy button in `ui/`
    - `deckProblems` isn't used by the lobby (the server sends problems); the shared formatter
  - §3: the dashboard's Play section and Back to room; `/room/:code` joins on load
  - §4.4: joining by link, Edit deck and the refresh on focus, Close room's confirm, the placeholder until F5
  - §6: what F4's `gameStore` holds; `seq` across reconnects; the token's `exp` check
  - §6.1: the socket's events as built
  - §7: F3 and F4 done (the "Done:" line still lists only F0–F2)
- [x] [backend_plan.md](backend_plan.md): §11, a line that F4 uses the Rooms routes and the socket (no backend change).
- [x] Update this file, and write the session file.

## Out of scope
- **The board** and everything on it: drag-and-drop, `legal_actions` targets, event animations, the turn timer, toasts for refused actions (F5). `events` messages are received and ignored.
- **Saved games,** `game_id` in `game_over`, and history (M7, F6).
- **A list of open rooms,** spectators, chat, rematches, inviting by username.
- **Changing the rule set in a lobby:** create a new room.
- **A "Play with these rules" button** on the rules list or editor.
- **A rule sets tile on the dashboard** (F3 deferred it): the Create room page lists them.
- **Seeded starter decks** (frontend_plan §9). See Notes.
- **Spotting a dead socket by a missing `pong`:** F4 relies on the browser's close and the reconnect.
- **Closing a socket** when the user logs out in another tab: the logout already sends this tab to `/login`, which unmounts the room page.

## Notes
- **What already exists:**
  - `apiOrigin`, `refreshSession` and `getAccessToken` (`api/client.ts`, `auth/tokens.ts`)
  - `normalizeShareCode` (`features/share/shareLink.ts`)
  - `ShareDialog`'s copy with fallback
  - `useRulesets` and `findDefaultRuleset`
  - `rulesetSummary` (`features/rules/rulesetValues.ts`) and `RulesetSummary`
  - `useOrigins` and `OriginBadge`
  - `fetchAllPages`
  - `ConfirmDialog`, `useLeaveGuard` and `LeaveGuardDialog`, `ErrorAlert`, `LoadingState`
- **The query client** sets `staleTime: 30_000` for everything, so the deck list's focus refresh needs its own `staleTime: 0`.
- **A new user can't play right away:** the default rule set needs a deck of exactly 30 cards with at most 2 copies each, so 15 different cards. Starter decks (frontend_plan §9) aren't in any milestone. Raise it if that matters for a first release.
- **`connected` and `away_since`** come only from the server. The lobby never guesses them from its own socket.
- **The e2e users** (`e2e_…`) stay in the dev DB, as for the other specs (CLAUDE.md has the cleanup query). Their rooms expire from Redis by themselves.
- **This machine (found 2026-11-21):**
  - Node wasn't installed: Node 24.22.3 came from winget (`OpenJS.NodeJS.24`), in `C:\Program Files\nodejs`. A shell opened before the install needs it on its PATH.
  - Git's system config has `core.autocrlf=true`, so the checkout is CRLF while the repo stores LF. Prettier expects LF, so `npm run format:check` flags every file here; `npx prettier --check --end-of-line auto .` checks the formatting itself. CI on Linux checks out LF. A `.gitattributes` line (`* text=auto eol=lf`) would fix it for good; not done here.
  - `backend/venv` runs on Python 3.15.2 (the backend targets 3.12): `pip check` is clean, the migrations ran, and the API and the e2e specs worked.

## Open questions
None. The "Choices made while writing this spec" are open to change.

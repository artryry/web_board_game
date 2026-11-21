import type { RoomState } from "@/api/hooks/useRooms";
import { useCurrentUser } from "@/auth/useAuth";
import { rulesetSummary } from "@/features/rules/rulesetValues";

import { InviteBox } from "./InviteBox";
import { LeaveRoomButton } from "./LeaveRoomButton";
import { PlayerSlots } from "./PlayerSlots";
import { ReadyButton } from "./ReadyButton";
import { RoomDeckPicker } from "./RoomDeckPicker";
import { roomPlayers } from "./roomPlayers";
import { ShowRules } from "./ShowRules";

interface LobbyViewProps {
  room: RoomState;
  /** The socket is connected: while it isn't, nothing can be sent, so the controls are off. */
  live: boolean;
}

/** The room before the game: the invite, the rules, the players, and the user's deck and ready. */
export function LobbyView({ room, live }: LobbyViewProps) {
  const user = useCurrentUser();
  const players = roomPlayers(room, user.id);
  const isHost = players.me?.is_host === true;

  return (
    <section aria-labelledby="lobby-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="lobby-title" className="text-2xl font-semibold">
            Room {room.code}
          </h1>
          <p className="text-text-muted">
            Rule set: {room.ruleset.name} · {rulesetSummary(room.ruleset.definition)}
          </p>
        </div>
        <LeaveRoomButton isHost={isHost} guest={players.guest} disabled={!live} />
      </div>
      <InviteBox code={room.code} />
      {/* The room's own copy of the rules: later edits to the rule set don't change it. */}
      <ShowRules definition={room.ruleset.definition} />
      <div className="grid gap-6 md:grid-cols-2">
        <PlayerSlots players={players} />
        <section aria-labelledby="your-deck-title" className="flex flex-col gap-4">
          <h2 id="your-deck-title" className="text-lg font-semibold">
            Your deck
          </h2>
          <RoomDeckPicker room={room} disabled={!live} />
          <ReadyButton room={room} players={players} disabled={!live} />
        </section>
      </div>
    </section>
  );
}

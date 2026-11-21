import { CircleCheck } from "lucide-react";
import { useId } from "react";

import type { RoomState } from "@/api/hooks/useRooms";
import { Button } from "@/ui/Button";
import { useGameStore } from "@/ws/gameStore";

import type { RoomPlayers } from "./roomPlayers";

interface ReadyButtonProps {
  room: RoomState;
  players: RoomPlayers;
  disabled: boolean;
}

/**
 * "I'm ready", a toggle. It shows only what the server says (`ready` in the room): the server
 * clears it when the player picks another deck or disconnects. Both ready starts the game.
 */
export function ReadyButton({ room, players, disabled }: ReadyButtonProps) {
  const setReady = useGameStore((state) => state.setReady);
  const hintId = useId();
  const ready = players.me?.ready === true;
  const hasDeck = room.my_deck !== null;
  const hint = hasDeck ? waitingText(players) : "Choose a deck first";

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={ready ? "primary" : "secondary"}
          aria-pressed={ready}
          aria-describedby={hint === null ? undefined : hintId}
          disabled={disabled || !hasDeck}
          onClick={() => {
            setReady(!ready);
          }}
        >
          {ready && <CircleCheck aria-hidden="true" className="size-4" />}
          I'm ready
        </Button>
      </div>
      {hint !== null && (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function waitingText({ opponent }: RoomPlayers): string | null {
  if (opponent === undefined) return "Waiting for a player";
  return opponent.ready ? null : `Waiting for ${opponent.username} to get ready`;
}

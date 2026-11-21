import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { RoomState } from "@/api/hooks/useRooms";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LeaveGuardDialog } from "@/ui/LeaveGuardDialog";
import { LoadingState } from "@/ui/LoadingState";
import { useLeaveGuard } from "@/ui/useLeaveGuard";
import { useGameStore } from "@/ws/gameStore";

import { GamePlaceholder } from "./GamePlaceholder";
import { LobbyView } from "./LobbyView";
import { RoomEnded } from "./RoomEnded";

/**
 * One visit to a room: opens the game socket, and renders only from `gameStore` from then on.
 * The join's answer fills the store until the socket's first `room_state` arrives.
 */
export function RoomSession({ initialRoom }: { initialRoom: RoomState }) {
  // The join's answer only starts the store; the socket keeps the room up to date after that.
  // The page keys this component by the room's code, so the first answer is the one to keep.
  const [firstRoom] = useState(initialRoom);
  const openRoom = useGameStore((state) => state.openRoom);
  const closeRoom = useGameStore((state) => state.closeRoom);
  const storeCode = useGameStore((state) => state.code);
  const connection = useGameStore((state) => state.connection);
  const room = useGameStore((state) => state.room);

  useEffect(() => {
    openRoom(firstRoom.code, firstRoom);
    return closeRoom;
  }, [firstRoom, openRoom, closeRoom]);

  const ended = connection.status === "ended";
  // Being away from a running game for 60 s loses it; in the lobby the seat is kept anyway.
  const { blocker } = useLeaveGuard(!ended && room?.status === "playing");

  if (storeCode !== firstRoom.code || room === null) return <LoadingState error={null} />;
  if (ended) return <RoomEnded reason={connection.reason} room={room} />;

  const live = connection.status === "open";
  return (
    <div className="flex flex-col gap-4">
      {connection.status === "reconnecting" && (
        <ReconnectingBanner playing={room.status === "playing"} />
      )}
      <ServerError />
      {room.status === "lobby" ? (
        <LobbyView room={room} live={live} />
      ) : (
        <GamePlaceholder room={room} live={live} />
      )}
      <LeaveGuardDialog
        blocker={blocker}
        title="Leave the game?"
        message="You lose if you're away for 60 seconds."
      />
    </div>
  );
}

function ReconnectingBanner({ playing }: { playing: boolean }) {
  return (
    <p
      role="status"
      className="rounded-md border border-border-strong bg-surface-raised px-4 py-2 text-sm"
    >
      Reconnecting…{playing && " You lose if you're away for 60 seconds."}
    </p>
  );
}

/** A refusal from the server that isn't about a deck (those show at the deck). */
function ServerError() {
  const error = useGameStore((state) => state.lastError);
  const dismiss = useGameStore((state) => state.dismissError);
  if (error === null) return null;
  return (
    <ErrorAlert>
      <span className="flex items-start justify-between gap-3">
        {error.message}
        <button type="button" onClick={dismiss} className="shrink-0 rounded-md hover:text-text">
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Dismiss</span>
        </button>
      </span>
    </ErrorAlert>
  );
}

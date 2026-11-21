import { useEffect, useState } from "react";

import { ApiError } from "@/api/errors";
import { useRoom } from "@/api/hooks/useRooms";
import { useCurrentUser } from "@/auth/useAuth";
import { ButtonLink } from "@/ui/ButtonLink";

import { forgetRoom, lastRoomFor } from "./lastRoom";

const STATUS_TEXT = { lobby: "In the lobby", playing: "Game in progress" } as const;

/**
 * A way back to the last room this browser joined, while it's still on: in the lobby or in a
 * game. A room that's gone (404) or finished is forgotten.
 */
export function BackToRoom() {
  const user = useCurrentUser();
  const [code] = useState(() => lastRoomFor(user.id));
  const room = useRoom(code);
  const status = room.data?.status;
  const gone =
    (room.error instanceof ApiError && room.error.status === 404) || status === "finished";

  useEffect(() => {
    if (gone && code !== null) forgetRoom(code);
  }, [gone, code]);

  if (code === null || status === undefined || status === "finished") return null;
  return (
    <ButtonLink to={`/room/${code}`} variant="secondary">
      Back to room {code}{" "}
      <span className="font-normal text-text-muted">· {STATUS_TEXT[status]}</span>
    </ButtonLink>
  );
}

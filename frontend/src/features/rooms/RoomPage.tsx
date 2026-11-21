import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { ApiError, errorMessage } from "@/api/errors";
import { useRoomMembership } from "@/api/hooks/useRooms";
import { useCurrentUser } from "@/auth/useAuth";
import { normalizeShareCode } from "@/features/share/shareLink";
import { LoadingState } from "@/ui/LoadingState";

import { rememberRoom } from "./lastRoom";
import { RoomMessage } from "./RoomMessage";
import { RoomSession } from "./RoomSession";

const JOIN_ERRORS: Readonly<Record<string, string>> = {
  room_not_found: "This room is gone: the code is wrong, or the room closed.",
  room_full: "This room is full, or its game has started.",
};

/**
 * `/room/:code`: joins the room (a member gets it again), then shows it live: the lobby, then the
 * game, then the result.
 */
export function RoomPage() {
  const params = useParams();
  const code = normalizeShareCode(params.code ?? "");
  const user = useCurrentUser();
  const membership = useRoomMembership(code);
  const navigate = useNavigate();
  const room = membership.data;

  useEffect(() => {
    if (room === undefined) return;
    rememberRoom(user.id, room.code);
    // A code typed in lower case (or with spaces) shows as the room's own.
    if (params.code !== room.code) void navigate(`/room/${room.code}`, { replace: true });
  }, [room, params.code, user.id, navigate]);

  if (membership.error !== null) {
    const error = membership.error;
    const text =
      (error instanceof ApiError ? JOIN_ERRORS[error.code] : undefined) ?? errorMessage(error);
    return <RoomMessage>{text}</RoomMessage>;
  }
  if (room === undefined) return <LoadingState error={null} />;
  return <RoomSession key={room.code} initialRoom={room} />;
}

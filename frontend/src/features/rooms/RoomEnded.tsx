import { useEffect } from "react";
import { useNavigate } from "react-router";

import type { RoomState } from "@/api/hooks/useRooms";
import { Button } from "@/ui/Button";
import { useGameStore } from "@/ws/gameStore";
import type { EndReason } from "@/ws/socket";

import { forgetRoom } from "./lastRoom";
import { RoomMessage } from "./RoomMessage";

/** The room is over for this tab, so the dashboard stops offering it. */
const FORGET: ReadonlySet<EndReason> = new Set(["not_member", "room_gone", "room_closed", "left"]);

interface RoomEndedProps {
  reason: EndReason;
  /** The room as it last was. */
  room: RoomState;
}

/** What the room page shows once the connection has ended for good. */
export function RoomEnded({ reason, room }: RoomEndedProps) {
  const reconnect = useGameStore((state) => state.reconnect);
  const navigate = useNavigate();

  useEffect(() => {
    if (FORGET.has(reason)) forgetRoom(room.code);
    // The player's own leave: straight to the dashboard, and Back doesn't join them again.
    if (reason === "left") void navigate("/", { replace: true });
  }, [reason, room.code, navigate]);

  switch (reason) {
    case "left":
      return null;
    case "not_member":
      return <RoomMessage>You're not in this room any more.</RoomMessage>;
    case "room_gone":
      return <RoomMessage>This room is gone.</RoomMessage>;
    case "room_closed":
      return (
        <RoomMessage>
          {room.status === "finished" ? "This room has closed." : "The host closed the room."}
        </RoomMessage>
      );
    case "replaced":
      return (
        <RoomMessage action={<Button onClick={reconnect}>Use it here</Button>}>
          This room is open in another tab.
        </RoomMessage>
      );
    case "auth_failed":
      return (
        <RoomMessage action={<Button onClick={reconnect}>Try again</Button>}>
          Couldn't sign in to the room.
        </RoomMessage>
      );
  }
}

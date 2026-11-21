import type { RoomPlayer, RoomState } from "@/api/hooks/useRooms";

export interface RoomPlayers {
  host: RoomPlayer | undefined;
  guest: RoomPlayer | undefined;
  me: RoomPlayer | undefined;
  /** The other player, once there is one. */
  opponent: RoomPlayer | undefined;
}

/** The room's players by role, and which one is the user. */
export function roomPlayers(room: RoomState, userId: string): RoomPlayers {
  return {
    host: room.players.find((player) => player.is_host),
    guest: room.players.find((player) => !player.is_host),
    me: room.players.find((player) => player.user_id === userId),
    opponent: room.players.find((player) => player.user_id !== userId),
  };
}

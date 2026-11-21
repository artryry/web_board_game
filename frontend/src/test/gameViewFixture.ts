import type { PlayerView, Seat, ServerMessage } from "@/ws/messages";

// A small game view for the room page's tests: F4 only reads `seat`, `version`, `status`,
// `winner` and `end_reason`. F5's board tests bring fuller views.

function origin(seat: Seat): PlayerView["players"][number]["origin"] {
  return {
    origin_id: `10000000-0000-4000-8000-00000000000${seat + 2}`,
    name: seat === 0 ? "Forest" : "Volcano",
    color: seat === 0 ? "bluish_green" : "vermillion",
    icon: seat === 0 ? "leaf" : "flame",
    field_effects: [],
    background_art_url: null,
  };
}

export function gameView(overrides: Partial<PlayerView> = {}): PlayerView {
  const seat = overrides.seat ?? 0;
  return {
    seat,
    version: 1,
    status: "playing",
    winner: null,
    end_reason: null,
    turn_number: 1,
    active_seat: 0,
    phase: {
      pipeline: "turn",
      index: 2,
      key: "action_phase",
      interactive: true,
      actor: "active",
      allow: ["play", "move", "attack"],
      time_limit_s: 90,
    },
    ready: [false, false],
    players: ([0, 1] as const).map((playerSeat) => ({
      seat: playerSeat,
      origin: origin(playerSeat),
      mana: 1,
      max_mana: 1,
      deck_count: 20,
      hand_count: 3,
      hand: playerSeat === seat ? [] : null,
    })),
    sections: ([0, 1] as const).map((owner) => [
      { owner, lane: 0, hp: 30, max_hp: 30, slots: [null, null], conquered: false },
    ]),
    ...overrides,
  };
}

export function gameStateMessage(view: PlayerView, serverTime = Date.now()): ServerMessage {
  return {
    type: "game_state",
    payload: {
      view,
      legal_actions: [{ type: "surrender" }],
      deadline: null,
      server_time: serverTime,
    },
  };
}

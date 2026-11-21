import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetRoom, LAST_ROOM_KEY, lastRoomFor, rememberRoom } from "./lastRoom";

const ALICE = "user-alice";
const BOB = "user-bob";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lastRoom", () => {
  it("gives the last room back to the user who joined it, and to nobody else", () => {
    rememberRoom(ALICE, "ABC234");
    expect(lastRoomFor(ALICE)).toBe("ABC234");
    expect(lastRoomFor(BOB)).toBeNull();
  });

  it("keeps only the newest room", () => {
    rememberRoom(ALICE, "ABC234");
    rememberRoom(ALICE, "XYZ789");
    expect(lastRoomFor(ALICE)).toBe("XYZ789");
  });

  it("forgets the room only if it's still the last one", () => {
    rememberRoom(ALICE, "XYZ789");
    forgetRoom("ABC234");
    expect(lastRoomFor(ALICE)).toBe("XYZ789");
    forgetRoom("XYZ789");
    expect(lastRoomFor(ALICE)).toBeNull();
  });

  it("ignores a stored value that isn't its own", () => {
    localStorage.setItem(LAST_ROOM_KEY, "not json");
    expect(lastRoomFor(ALICE)).toBeNull();
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ user_id: ALICE }));
    expect(lastRoomFor(ALICE)).toBeNull();
  });

  it("works without storage: nothing is remembered and nothing breaks", () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    expect(() => {
      rememberRoom(ALICE, "ABC234");
    }).not.toThrow();
    expect(lastRoomFor(ALICE)).toBeNull();
    expect(() => {
      forgetRoom("ABC234");
    }).not.toThrow();
  });
});

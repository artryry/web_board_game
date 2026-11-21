import { describe, expect, it } from "vitest";

import { awayRemainingMs, formatCountdown } from "./countdown";

const AWAY_SINCE = 1_800_000_000_000;

describe("awayRemainingMs", () => {
  it("counts down to 60 s after the player left", () => {
    expect(awayRemainingMs(AWAY_SINCE, AWAY_SINCE + 18_000, 0)).toBe(42_000);
  });

  it("reads our clock as the server's with the offset", () => {
    // Our clock is 5 s behind the server's: 13 s on ours is 18 s on the server's.
    expect(awayRemainingMs(AWAY_SINCE, AWAY_SINCE + 13_000, 5_000)).toBe(42_000);
  });

  it("stops at 0", () => {
    expect(awayRemainingMs(AWAY_SINCE, AWAY_SINCE + 75_000, 0)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it.each([
    [42_000, "0:42"],
    [60_000, "1:00"],
    [41_001, "0:42"],
    [1, "0:01"],
    [0, "0:00"],
  ])("shows %i ms as %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

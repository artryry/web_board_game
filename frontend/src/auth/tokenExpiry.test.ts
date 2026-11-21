import { describe, expect, it } from "vitest";

import { tokenExpiresAt } from "./tokenExpiry";

function base64url(value: string): string {
  return btoa(value).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt(payload: string): string {
  return `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(payload)}.signature`;
}

describe("tokenExpiresAt", () => {
  it("reads exp from a JWT's payload, in ms", () => {
    expect(tokenExpiresAt(jwt('{"sub":"u1","exp":1800000000}'))).toBe(1_800_000_000_000);
  });

  it("reads a payload that needs base64url's - and _", () => {
    // "?>" encodes to "Pz4" and "??>" to "Pz8+": the payload has + and / in plain base64.
    const payload = '{"note":"??>??>","exp":1800000000}';
    expect(base64url(payload)).toMatch(/[-_]/);
    expect(tokenExpiresAt(jwt(payload))).toBe(1_800_000_000_000);
  });

  it("is null for a token that isn't a JWT, or has no exp", () => {
    expect(tokenExpiresAt("access-2")).toBeNull();
    expect(tokenExpiresAt(jwt('{"sub":"u1"}'))).toBeNull();
    expect(tokenExpiresAt("a.%%%not-base64%%%.c")).toBeNull();
    expect(tokenExpiresAt(`a.${base64url("not json")}.c`)).toBeNull();
  });
});

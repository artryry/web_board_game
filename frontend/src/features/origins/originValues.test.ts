import { describe, expect, it } from "vitest";

import { addOrigin } from "@/test/contentStore";

import { duplicateOf, toOriginBody } from "./originValues";

describe("duplicateOf", () => {
  it("copies the origin under the name '<name> copy', keeping its background", () => {
    const origin = addOrigin({
      name: "Swamp",
      color: "black",
      icon: "droplet",
      field_effects: [{ key: "free_move", params: {} }],
      background_art_key: "origin/user/swamp.png",
    });

    expect(duplicateOf(origin)).toEqual({
      name: "Swamp copy",
      color: "black",
      icon: "droplet",
      field_effects: [{ key: "free_move", params: {} }],
      background_art_key: "origin/user/swamp.png",
    });
  });

  it("cuts the copy's name to 40 characters", () => {
    const origin = addOrigin({ name: "A".repeat(38) });
    expect(duplicateOf(origin).name).toHaveLength(40);
  });
});

describe("toOriginBody", () => {
  it("trims the name", () => {
    const body = toOriginBody({
      name: "  Swamp ",
      color: "black",
      icon: "droplet",
      field_effects: [],
      background_art_key: null,
    });
    expect(body.name).toBe("Swamp");
  });
});

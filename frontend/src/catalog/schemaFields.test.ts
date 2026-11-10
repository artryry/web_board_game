import { describe, expect, it } from "vitest";

import { findModule } from "@/catalog/useCatalog";
import { CATALOG } from "@/test/catalogFixture";

import { defaultParams, describeParams, parseSchema } from "./schemaFields";

function schemaOf(key: string): Record<string, unknown> {
  const module = findModule(CATALOG.field_effects, key);
  if (module === undefined) throw new Error(`No field effect ${key} in the fixture`);
  return module.params_schema;
}

describe("parseSchema", () => {
  it("reads each supported type with its title, bounds and default", () => {
    expect(parseSchema(schemaOf("stat_bonus"))).toEqual([
      {
        name: "applies_to",
        title: "Applies To",
        kind: "enum",
        options: ["own_origin", "all_own", "enemy"],
        default: "own_origin",
      },
      { name: "hp", title: "HP", kind: "integer", min: 0, max: 2, default: 0 },
      { name: "dmg", title: "DMG", kind: "integer", min: 0, max: 2, default: 0 },
    ]);
    expect(parseSchema(schemaOf("test_every_type"))).toEqual([
      { name: "weight", title: "Weight", kind: "number", min: 0, max: 2.5, default: 1.5 },
      { name: "enabled", title: "Enabled", kind: "boolean", default: true },
      {
        name: "tags",
        title: "Tags",
        kind: "enum-checkboxes",
        options: ["fire", "water", "earth"],
        minItems: 1,
        maxItems: 2,
        default: ["fire"],
      },
      {
        name: "sequence",
        title: "Sequence",
        kind: "enum-list",
        options: ["draw", "play"],
        minItems: 1,
        maxItems: 3,
        default: ["draw"],
      },
    ]);
  });

  it("returns nothing for a schema without properties", () => {
    expect(parseSchema(schemaOf("free_move"))).toEqual([]);
    expect(parseSchema({})).toEqual([]);
  });

  it("marks what it can't render instead of skipping it", () => {
    expect(parseSchema(schemaOf("test_unsupported"))).toEqual([
      expect.objectContaining({ name: "shape", kind: "unsupported" }),
    ]);
    expect(parseSchema({ properties: { n: { type: "integer", minimum: 1 } } })).toEqual([
      expect.objectContaining({ name: "n", kind: "unsupported" }),
    ]);
    expect(parseSchema({ properties: { s: { type: "string" } } })).toEqual([
      expect.objectContaining({ name: "s", kind: "unsupported" }),
    ]);
  });

  it("uses a humanised name when a property has no title", () => {
    const [field] = parseSchema({
      properties: { card_kind: { type: "string", enum: ["spell"], default: "spell" } },
    });
    expect(field?.title).toBe("Card kind");
  });
});

describe("defaultParams", () => {
  it("fills every supported param from its default", () => {
    expect(defaultParams(schemaOf("stat_bonus"))).toEqual({
      applies_to: "own_origin",
      hp: 0,
      dmg: 0,
    });
    expect(defaultParams(schemaOf("test_every_type"))).toEqual({
      weight: 1.5,
      enabled: true,
      tags: ["fire"],
      sequence: ["draw"],
    });
  });
});

describe("describeParams", () => {
  it("lists params as 'Title value', with enum values in words", () => {
    expect(
      describeParams(schemaOf("stat_bonus"), { applies_to: "own_origin", hp: 1, dmg: 0 }),
    ).toBe("Applies To Own origin, HP 1, DMG 0");
  });
});

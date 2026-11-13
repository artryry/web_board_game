import { defaultParams } from "@/catalog/schemaFields";
import type { ModuleRef, ModuleSpec } from "@/catalog/useCatalog";

/** The two phase lists of a ruleset: `setup` runs once before the first turn, `turn` every turn. */
export type Pipeline = "setup" | "turn";

export const END_TURN_KEY = "end_turn";

/**
 * Where the palette adds a phase: at the end, or in Turn just before a final `end_turn`, so a
 * finished turn stays finished. Where phases may go is the server's call; this is only a start.
 */
export function phaseInsertIndex(phases: readonly ModuleRef[], pipeline: Pipeline): number {
  if (pipeline === "turn" && phases.at(-1)?.key === END_TURN_KEY) return phases.length - 1;
  return phases.length;
}

/** A catalog phase with its default params. */
export function newPhase(spec: ModuleSpec): ModuleRef {
  return { key: spec.key, params: defaultParams(spec.params_schema) };
}

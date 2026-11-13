import { ApiError, isRecord } from "@/api/errors";
import type { RuleError } from "@/api/hooks/useRulesets";

import type { Pipeline } from "./phaseList";
import { SETTING_LABELS } from "./settingFields";

/** The server's rule errors, sorted by where the editor shows them. */
export interface PlacedRuleErrors {
  /** By field path: a setting (`board.lanes`) or a phase param (`turn.2.params.time_limit_s`). */
  fields: ReadonlyMap<string, string>;
  /** By phase (`turn.2`): errors about the phase itself or its key. */
  phases: ReadonlyMap<string, readonly string[]>;
  /** Phases with any error, their params' included, so a collapsed phase can say so. */
  marked: ReadonlySet<string>;
  /** Rules about a whole pipeline ("A turn must end with 'end_turn'"). */
  pipelines: ReadonlyMap<Pipeline, readonly string[]>;
  /** Every error, in the server's order, for the header's list. */
  all: readonly RuleError[];
}

const SETTINGS = new Set(["board", "deck", "mana", "hand"]);
const SETTING_LABEL_BY_PATH = new Map<string, string>(Object.entries(SETTING_LABELS));
const PIPELINE_TITLES = { setup: "Setup", turn: "Turn" } as const;

function isPipeline(value: unknown): value is Pipeline {
  return value === "setup" || value === "turn";
}

function append<K>(map: Map<K, string[]>, key: K, message: string) {
  map.set(key, [...(map.get(key) ?? []), message]);
}

/**
 * Puts each error where its `path` points: under a setting, under a phase's param, on a phase, or
 * under a pipeline's heading. Anything else (`["schema_version"]`) shows only in the header's list.
 */
export function placeRuleErrors(errors: readonly RuleError[]): PlacedRuleErrors {
  const fields = new Map<string, string>();
  const phases = new Map<string, string[]>();
  const marked = new Set<string>();
  const pipelines = new Map<Pipeline, string[]>();
  for (const error of errors) {
    const [head, index, part, param] = error.path;
    if (typeof head === "string" && SETTINGS.has(head) && error.path.length === 2) {
      const path = error.path.join(".");
      if (!fields.has(path)) fields.set(path, error.message);
      continue;
    }
    if (!isPipeline(head)) continue;
    if (error.path.length === 1) {
      append(pipelines, head, error.message);
      continue;
    }
    if (typeof index !== "number") continue;
    const phase = `${head}.${index}`;
    marked.add(phase);
    if (part === "params" && param !== undefined) {
      // A deeper path (`allow.1`) belongs to the param's field.
      const path = `${phase}.params.${param}`;
      if (!fields.has(path)) fields.set(path, error.message);
    } else {
      append(phases, phase, error.message);
    }
  }
  return { fields, phases, marked, pipelines, all: errors };
}

/** Nothing to show: before the first check, and in read-only views. */
export const NO_RULE_ERRORS: PlacedRuleErrors = placeRuleErrors([]);

function isRuleError(value: unknown): value is RuleError {
  return (
    isRecord(value) &&
    Array.isArray(value.path) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

/** The rule errors of a save the server refused (422 `invalid_ruleset`), or null for any other. */
export function invalidRulesetErrors(error: unknown): RuleError[] | null {
  if (!(error instanceof ApiError) || error.code !== "invalid_ruleset") return null;
  const errors = error.extra.errors;
  return Array.isArray(errors) ? errors.filter(isRuleError) : null;
}

/**
 * Where an error is, for the header's list: a setting's label ("Lanes"), a pipeline ("Turn"), or a
 * phase ("Turn, phase 3 (Draw)"). Null when the path points nowhere the editor shows.
 */
export function errorPlace(
  path: RuleError["path"],
  phaseName: (pipeline: Pipeline, index: number) => string | undefined,
): string | null {
  const setting = SETTING_LABEL_BY_PATH.get(path.join("."));
  if (setting !== undefined) return setting;
  const [head, index] = path;
  if (!isPipeline(head)) return null;
  if (typeof index !== "number") return PIPELINE_TITLES[head];
  const name = phaseName(head, index);
  return `${PIPELINE_TITLES[head]}, phase ${index + 1}${name === undefined ? "" : ` (${name})`}`;
}

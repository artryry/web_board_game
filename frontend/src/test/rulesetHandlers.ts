import { http, HttpResponse } from "msw";

import { NAME_MAX_LENGTH } from "@/api/bounds";
import { isRecord } from "@/api/errors";
import type { RuleError, Ruleset, RulesetDefinition } from "@/api/hooks/useRulesets";
import { parseSchema } from "@/catalog/schemaFields";
import { findModule } from "@/catalog/useCatalog";

import { CATALOG } from "./catalogFixture";
import { contentStore, newId } from "./contentStore";
import { apiError, apiUrl, authorized } from "./handlers";
import { noContent, pageOf, readBody, type Body, type IdParams } from "./handlerUtils";

// Rulesets over the in-memory store. `/validate` and saves run `fakeValidate`, a small fork of the
// server's checks (backend services/rules_service.py) with the server's messages: enough for the
// editor's error paths, not every rule.

const NOW = "2026-11-12T10:00:00Z";
const END_TURN = "end_turn";

export const rulesetNotFound = () => apiError(404, "ruleset_not_found", "Ruleset not found");
export const rulesetReadOnly = () =>
  apiError(
    403,
    "system_ruleset_read_only",
    "The default ruleset can't be changed or shared. Copy it to make your own version.",
  );

/** FastAPI's own 422 for a bad name: `{detail: [{loc, msg}]}`. */
const invalidName = (message: string) =>
  HttpResponse.json(
    { detail: [{ loc: ["body", "name"], msg: message, type: "string_too_short" }] },
    { status: 422 },
  );

function boundError(
  path: RuleError["path"],
  code: "invalid_value" | "invalid_params",
  value: unknown,
  min: number,
  max: number,
): RuleError | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { path, code, message: "Input should be a valid integer" };
  }
  if (value < min)
    return { path, code, message: `Input should be greater than or equal to ${min}` };
  if (value > max) return { path, code, message: `Input should be less than or equal to ${max}` };
  return null;
}

interface KnownPhase {
  index: number;
  key: string;
  interactive: boolean;
}

/** The phases with a known key, plus the key and params errors (integer bounds only). */
function resolvePhases(pipeline: "setup" | "turn", value: unknown, errors: RuleError[]) {
  const phases: unknown[] = Array.isArray(value) ? value : [];
  const known: KnownPhase[] = [];
  phases.forEach((phase, index) => {
    const key = isRecord(phase) && typeof phase.key === "string" ? phase.key : "";
    const spec = findModule(CATALOG.phases, key);
    if (spec === undefined) {
      const message = `Unknown phase module '${key}'`;
      errors.push({ path: [pipeline, index, "key"], code: "unknown_module", message });
      return;
    }
    known.push({ index, key, interactive: spec.interactive });
    const params = isRecord(phase) && isRecord(phase.params) ? phase.params : {};
    for (const field of parseSchema(spec.params_schema)) {
      if (field.kind !== "integer" || field.min === undefined || field.max === undefined) continue;
      const path = [pipeline, index, "params", field.name];
      const error = boundError(path, "invalid_params", params[field.name], field.min, field.max);
      if (error !== null) errors.push(error);
    }
  });
  return known;
}

function endTurnErrors(phaseCount: number, endTurns: number[]): RuleError[] {
  if (endTurns.length === 0) {
    return [
      { path: ["turn"], code: "end_turn_missing", message: "A turn must end with 'end_turn'" },
    ];
  }
  const last = phaseCount - 1;
  const kept = endTurns.includes(last) ? last : endTurns[0];
  return endTurns.flatMap((index): RuleError[] => {
    if (index !== kept) {
      const message = "A turn has only one 'end_turn'";
      return [{ path: ["turn", index], code: "end_turn_repeated", message }];
    }
    if (index !== last) {
      const message = "'end_turn' must be the last phase";
      return [{ path: ["turn", index], code: "end_turn_not_last", message }];
    }
    return [];
  });
}

/** The server's errors for a definition, in its order (fields, then setup, then turn). */
export function fakeValidate(definition: Body): RuleError[] {
  const errors: RuleError[] = [];
  const board = isRecord(definition.board) ? definition.board : {};
  const lanes = boundError(["board", "lanes"], "invalid_value", board.lanes, 1, 5);
  if (lanes !== null) errors.push(lanes);

  for (const phase of resolvePhases("setup", definition.setup, errors)) {
    if (!phase.interactive && phase.key !== END_TURN) continue;
    errors.push({
      path: ["setup", phase.index],
      code: "setup_phase_not_allowed",
      message: `'${phase.key}' can't be in setup, which runs once and waits for no one`,
    });
  }

  const turn = resolvePhases("turn", definition.turn, errors);
  if (!turn.some((phase) => phase.interactive)) {
    errors.push({
      path: ["turn"],
      code: "turn_needs_interactive_phase",
      message: "A turn needs a phase where players act, such as 'action_phase'",
    });
  }
  const phaseCount = Array.isArray(definition.turn) ? definition.turn.length : 0;
  const endTurns = turn.filter((phase) => phase.key === END_TURN).map((phase) => phase.index);
  return [...errors, ...endTurnErrors(phaseCount, endTurns)];
}

function definitionOf(body: Body): Body {
  return isRecord(body.definition) ? body.definition : {};
}

/** A save's problem as the server answers it, or null when the ruleset can be saved. */
function saveProblem(body: Body): Response | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") return invalidName("String should have at least 1 character");
  if (name.length > NAME_MAX_LENGTH) {
    return invalidName(`String should have at most ${NAME_MAX_LENGTH} characters`);
  }
  const errors = fakeValidate(definitionOf(body));
  if (errors.length === 0) return null;
  return apiError(422, "invalid_ruleset", `The ruleset has ${errors.length} error(s)`, { errors });
}

/** The default first, then the user's own by name, like the server's list. */
function listed(): Ruleset[] {
  return [...contentStore.rulesets].sort(
    (a, b) =>
      Number(b.is_system) - Number(a.is_system) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

function findRuleset(id: string): Ruleset | undefined {
  return contentStore.rulesets.find((ruleset) => ruleset.id === id);
}

/** Adds one of the user's own rulesets, by default with the default's definition. */
export function addRuleset(
  name: string,
  fields: { definition?: RulesetDefinition; shareCode?: string | null } = {},
): Ruleset {
  const base = contentStore.rulesets.find((ruleset) => ruleset.is_system);
  if (base === undefined) throw new Error("The store has no default ruleset");
  const ruleset: Ruleset = {
    ...base,
    id: newId(),
    name,
    definition: structuredClone(fields.definition ?? base.definition),
    is_system: false,
    system_key: null,
    share_code: fields.shareCode ?? null,
    created_at: NOW,
    updated_at: NOW,
  };
  contentStore.rulesets.push(ruleset);
  return ruleset;
}

export const rulesetHandlers = [
  http.get(
    apiUrl("/api/rulesets"),
    authorized(({ request }) => pageOf(listed(), request)),
  ),
  http.post(
    apiUrl("/api/rulesets/validate"),
    authorized(async ({ request }) => {
      const definition = definitionOf(await readBody(request));
      const errors = fakeValidate(definition);
      const valid = errors.length === 0;
      return HttpResponse.json({ valid, errors, definition: valid ? definition : null });
    }),
  ),
  http.post(
    apiUrl("/api/rulesets"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      const problem = saveProblem(body);
      if (problem !== null) return problem;
      const ruleset = addRuleset(String(body.name).trim(), {
        definition: definitionOf(body) as RulesetDefinition,
      });
      return HttpResponse.json(ruleset, { status: 201 });
    }),
  ),
  http.get<IdParams>(
    apiUrl("/api/rulesets/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const ruleset = findRuleset(params.id);
      return ruleset === undefined ? rulesetNotFound() : HttpResponse.json(ruleset);
    }),
  ),
  http.patch<IdParams>(
    apiUrl("/api/rulesets/:id"),
    authorized<IdParams, Promise<Response>>(async ({ request, params }) => {
      const body = await readBody(request);
      const ruleset = findRuleset(params.id);
      if (ruleset === undefined) return rulesetNotFound();
      if (ruleset.is_system) return rulesetReadOnly();
      const problem = saveProblem(body);
      if (problem !== null) return problem;
      ruleset.name = String(body.name).trim();
      ruleset.definition = definitionOf(body) as RulesetDefinition;
      ruleset.updated_at = "2026-11-12T11:00:00Z";
      return HttpResponse.json(ruleset);
    }),
  ),
  http.delete<IdParams>(
    apiUrl("/api/rulesets/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const ruleset = findRuleset(params.id);
      if (ruleset === undefined) return rulesetNotFound();
      if (ruleset.is_system) return rulesetReadOnly();
      contentStore.rulesets = contentStore.rulesets.filter((candidate) => candidate !== ruleset);
      return noContent();
    }),
  ),
];

/** Lets `shareRoutes` read and write a ruleset's `share_code`; the default can't be shared. */
export function rulesetShareTarget(id: string) {
  const ruleset = findRuleset(id);
  if (ruleset === undefined) return undefined;
  return {
    readOnly: ruleset.is_system,
    get shareCode() {
      return ruleset.share_code;
    },
    set shareCode(code: string | null) {
      ruleset.share_code = code;
    },
  };
}

import { http, HttpResponse } from "msw";

import { ART_CONTENT_TYPES, ART_MAX_BYTES } from "@/api/bounds";
import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";

import { CATALOG } from "./catalogFixture";
import {
  artUrl,
  contentStore,
  groupOut,
  newId,
  SYSTEM_ORIGIN_IDS,
  withDerived,
} from "./contentStore";
import { deckHandlers } from "./deckHandlers";
import { apiError, apiUrl, authorized } from "./handlers";
import { noContent, pageOf, readBody, type IdParams } from "./handlerUtils";
import { rulesetHandlers } from "./rulesetHandlers";
import { shareHandlers } from "./shareHandlers";

// The content API over the in-memory store: enough of the backend's rules for the UI's flows
// (the 409 lists, group names, art keys, a spell's hp), not a copy of its validation. Decks are in
// deckHandlers.ts, rulesets in rulesetHandlers.ts, share codes and imports in shareHandlers.ts.

export const R2_TEST_ORIGIN = "https://r2.test";
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The art key's check on save: only a key whose file reached storage is accepted. */
function artProblem(key: unknown, current: string | null) {
  if (key === null || key === undefined || key === current) return null;
  if (typeof key !== "string" || !contentStore.stored.has(key)) {
    return apiError(422, "invalid_art_key", "The art hasn't been uploaded yet");
  }
  return null;
}

function hasRepeats(refs: unknown): boolean {
  if (!Array.isArray(refs)) return false;
  const keys = (refs as { key: string }[]).map((ref) => ref.key);
  return new Set(keys).size !== keys.length;
}

const originHandlers = [
  http.get(
    apiUrl("/api/origins"),
    authorized(({ request }) => {
      const byName = (a: Origin, b: Origin) => a.name.localeCompare(b.name);
      const system = contentStore.origins.filter((origin) => origin.is_system).sort(byName);
      const own = contentStore.origins.filter((origin) => !origin.is_system).sort(byName);
      return pageOf([...system, ...own], request);
    }),
  ),
  http.get<IdParams>(
    apiUrl("/api/origins/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const origin = contentStore.origins.find((candidate) => candidate.id === params.id);
      return origin === undefined
        ? apiError(404, "origin_not_found", "Origin not found")
        : HttpResponse.json(origin);
    }),
  ),
  http.post(
    apiUrl("/api/origins"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      if (hasRepeats(body.field_effects)) {
        return apiError(
          422,
          "invalid_field_effects",
          "An origin can't have the same field effect twice",
        );
      }
      const artError = artProblem(body.background_art_key, null);
      if (artError !== null) return artError;
      const key = (body.background_art_key ?? null) as string | null;
      const origin: Origin = {
        ...(body as unknown as Origin),
        id: newId(),
        field_effects: (body.field_effects ?? []) as Origin["field_effects"],
        background_art_key: key,
        background_art_url: artUrl(key),
        is_system: false,
        system_key: null,
        created_at: "2026-11-10T11:00:00Z",
        updated_at: "2026-11-10T11:00:00Z",
      };
      contentStore.origins.push(origin);
      return HttpResponse.json(origin, { status: 201 });
    }),
  ),
  http.patch<IdParams>(
    apiUrl("/api/origins/:id"),
    authorized<IdParams, Promise<Response>>(async ({ request, params }) => {
      const body = await readBody(request);
      const index = contentStore.origins.findIndex((origin) => origin.id === params.id);
      const origin = contentStore.origins[index];
      if (origin === undefined) return apiError(404, "origin_not_found", "Origin not found");
      if (origin.is_system) {
        return apiError(403, "system_origin_read_only", "System origins can't be changed");
      }
      const artError = artProblem(body.background_art_key, origin.background_art_key);
      if (artError !== null) return artError;
      const updated = { ...origin, ...(body as Partial<Origin>) };
      updated.background_art_url = artUrl(updated.background_art_key);
      contentStore.origins[index] = updated;
      return HttpResponse.json(updated);
    }),
  ),
  http.delete<IdParams>(
    apiUrl("/api/origins/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const origin = contentStore.origins.find((candidate) => candidate.id === params.id);
      if (origin === undefined) return apiError(404, "origin_not_found", "Origin not found");
      if (origin.is_system) {
        return apiError(403, "system_origin_read_only", "System origins can't be changed");
      }
      const cards = contentStore.cards.filter((card) => card.origin_id === origin.id);
      const decks = contentStore.decks.filter((deck) => deck.originId === origin.id);
      if (cards.length > 0 || decks.length > 0) {
        return apiError(
          409,
          "origin_in_use",
          `${cards.length} card(s) and ${decks.length} deck(s) still use this origin.`,
          {
            cards: cards.map(({ id, name }) => ({ id, name })),
            decks: decks.map(({ id, name }) => ({ id, name })),
          },
        );
      }
      contentStore.origins = contentStore.origins.filter((candidate) => candidate !== origin);
      return noContent();
    }),
  ),
];

/** The card's kind rules the editor relies on, as the server answers them. */
function kindProblem(card: Pick<Card, "kind" | "hp" | "dmg" | "abilities">) {
  if (card.kind === "spell" && card.hp !== null) {
    return apiError(422, "invalid_stats", "A spell has no hp");
  }
  if (card.kind === "creature" && (card.hp === null || card.dmg === null)) {
    return apiError(422, "invalid_stats", "A creature needs both hp and dmg");
  }
  if (card.kind === "spell" && card.abilities.length !== 1) {
    return apiError(422, "invalid_abilities", "A spell needs exactly one spell effect");
  }
  return null;
}

function decksHolding(cardId: string, otherThanOrigin?: string) {
  return contentStore.decks
    .filter((deck) => deck.cards.some((entry) => entry.cardId === cardId))
    .filter((deck) => otherThanOrigin === undefined || deck.originId !== otherThanOrigin)
    .map(({ id, name }) => ({ id, name }));
}

const cardHandlers = [
  http.get(
    apiUrl("/api/cards"),
    authorized(({ request }) => {
      const query = new URL(request.url).searchParams;
      const groupId = query.get("group_id");
      const ungrouped = query.get("ungrouped") === "true";
      if (groupId !== null && ungrouped) {
        return apiError(422, "validation_error", "Use either 'group_id' or 'ungrouped', not both");
      }
      const originId = query.get("origin_id");
      const kind = query.get("kind");
      const cards = contentStore.cards.filter(
        (card) =>
          (groupId === null || card.group_id === groupId) &&
          (!ungrouped || card.group_id === null) &&
          (originId === null || card.origin_id === originId) &&
          (kind === null || card.kind === kind),
      );
      return pageOf(cards, request);
    }),
  ),
  http.get<IdParams>(
    apiUrl("/api/cards/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const card = contentStore.cards.find((candidate) => candidate.id === params.id);
      return card === undefined
        ? apiError(404, "card_not_found", "Card not found")
        : HttpResponse.json(card);
    }),
  ),
  http.post(
    apiUrl("/api/cards"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      const card = withDerived({
        ...(body as unknown as Card),
        id: newId(),
        hp: (body.hp ?? null) as number | null,
        dmg: (body.dmg ?? null) as number | null,
        abilities: (body.abilities ?? []) as Card["abilities"],
        group_id: (body.group_id ?? null) as string | null,
        art_key: (body.art_key ?? null) as string | null,
        created_at: "2026-11-10T11:00:00Z",
        updated_at: "2026-11-10T11:00:00Z",
      });
      const problem = kindProblem(card) ?? artProblem(card.art_key, null);
      if (problem !== null) return problem;
      contentStore.cards.unshift(card);
      return HttpResponse.json(card, { status: 201 });
    }),
  ),
  http.patch<IdParams>(
    apiUrl("/api/cards/:id"),
    authorized<IdParams, Promise<Response>>(async ({ request, params }) => {
      const body = await readBody(request);
      const index = contentStore.cards.findIndex((card) => card.id === params.id);
      const card = contentStore.cards[index];
      if (card === undefined) return apiError(404, "card_not_found", "Card not found");
      const merged = withDerived({ ...card, ...(body as Partial<Card>) });
      const problem = kindProblem(merged) ?? artProblem(body.art_key, card.art_key);
      if (problem !== null) return problem;
      if (merged.origin_id !== card.origin_id && merged.origin_id !== SYSTEM_ORIGIN_IDS.neutral) {
        const decks = decksHolding(card.id, merged.origin_id);
        if (decks.length > 0) {
          return apiError(
            409,
            "card_in_use",
            `${decks.length} deck(s) of another origin hold this card.`,
            { decks },
          );
        }
      }
      contentStore.cards[index] = merged;
      return HttpResponse.json(merged);
    }),
  ),
  http.delete<IdParams>(
    apiUrl("/api/cards/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const decks = decksHolding(params.id);
      if (decks.length > 0) {
        return apiError(409, "card_in_use", `${decks.length} deck(s) still hold this card.`, {
          decks,
        });
      }
      contentStore.cards = contentStore.cards.filter((card) => card.id !== params.id);
      return noContent();
    }),
  ),
];

function nameTaken(name: unknown, exceptId?: string): boolean {
  return contentStore.groups.some(
    (group) =>
      group.id !== exceptId && group.name.toLowerCase() === String(name).trim().toLowerCase(),
  );
}

const groupNameTaken = () =>
  apiError(409, "group_name_taken", "You already have a group with this name");

const groupHandlers = [
  http.get(
    apiUrl("/api/card-groups"),
    authorized(({ request }) => {
      const groups = [...contentStore.groups]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(groupOut);
      return pageOf(groups, request);
    }),
  ),
  http.post(
    apiUrl("/api/card-groups"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      if (nameTaken(body.name)) return groupNameTaken();
      const group = {
        id: newId(),
        name: String(body.name).trim(),
        share_code: null,
        created_at: "2026-11-10T11:00:00Z",
        updated_at: "2026-11-10T11:00:00Z",
      };
      contentStore.groups.push(group);
      return HttpResponse.json(groupOut(group), { status: 201 });
    }),
  ),
  http.patch<IdParams>(
    apiUrl("/api/card-groups/:id"),
    authorized<IdParams, Promise<Response>>(async ({ request, params }) => {
      const body = await readBody(request);
      const group = contentStore.groups.find((candidate) => candidate.id === params.id);
      if (group === undefined) return apiError(404, "group_not_found", "Card group not found");
      if (nameTaken(body.name, group.id)) return groupNameTaken();
      group.name = String(body.name).trim();
      return HttpResponse.json(groupOut(group));
    }),
  ),
  http.delete<IdParams>(
    apiUrl("/api/card-groups/:id"),
    authorized<IdParams, Response>(({ params }) => {
      contentStore.groups = contentStore.groups.filter((group) => group.id !== params.id);
      // Like the database's ON DELETE SET NULL: the cards stay, ungrouped.
      contentStore.cards = contentStore.cards.map((card) =>
        card.group_id === params.id ? { ...card, group_id: null } : card,
      );
      return noContent();
    }),
  ),
];

function presign(kind: "card" | "origin") {
  return authorized(async ({ request }) => {
    const body = await readBody(request);
    const contentType = String(body.content_type);
    if (!ART_CONTENT_TYPES.includes(contentType)) {
      return apiError(422, "unsupported_art_type", "Art must be a PNG, JPEG or WebP image");
    }
    if (Number(body.size) > ART_MAX_BYTES) {
      return apiError(422, "art_too_large", `Art must be at most ${ART_MAX_BYTES} bytes`);
    }
    const key = `${kind}/user/${newId()}.${EXTENSIONS[contentType] ?? "bin"}`;
    contentStore.signed.set(key, contentType);
    return HttpResponse.json({
      upload_url: `${R2_TEST_ORIGIN}/upload/${key}`,
      art_key: key,
      expires_in: 300,
    });
  });
}

const uploadHandlers = [
  http.post(apiUrl("/api/uploads/card-art"), presign("card")),
  http.post(apiUrl("/api/uploads/origin-art"), presign("origin")),
  // The bucket: it takes a PUT only with the signed Content-Type, and a bearer token would break
  // the presigned signature.
  http.put(`${R2_TEST_ORIGIN}/upload/*`, ({ request }) => {
    const key = new URL(request.url).pathname.slice("/upload/".length);
    const signedType = contentStore.signed.get(key);
    if (request.headers.has("Authorization")) return new HttpResponse(null, { status: 400 });
    if (signedType === undefined || request.headers.get("Content-Type") !== signedType) {
      return new HttpResponse(null, { status: 403 });
    }
    contentStore.stored.add(key);
    return new HttpResponse(null, { status: 200 });
  }),
];

export const contentHandlers = [
  http.get(
    apiUrl("/api/catalog"),
    authorized(() => HttpResponse.json(CATALOG)),
  ),
  ...originHandlers,
  ...cardHandlers,
  ...groupHandlers,
  ...deckHandlers,
  ...rulesetHandlers,
  ...shareHandlers,
  ...uploadHandlers,
];

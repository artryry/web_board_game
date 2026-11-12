import { HttpResponse } from "msw";

import { isRecord } from "@/api/errors";

import { contentStore } from "./contentStore";

// Small pieces the fake content API's handler files share.

export type Body = Record<string, unknown>;

export interface IdParams {
  id: string;
}

/** Reads a JSON body and records it, so tests can check what was sent (`lastBody`). */
export async function readBody(request: Request): Promise<Body> {
  const body: unknown = await request.json();
  contentStore.requests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    body,
  });
  return isRecord(body) ? body : {};
}

/** One page of a list, by the request's `limit` and `offset`, as `{items, total}`. */
export function pageOf(items: unknown[], request: Request) {
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") ?? 50);
  const offset = Number(query.get("offset") ?? 0);
  return HttpResponse.json({ items: items.slice(offset, offset + limit), total: items.length });
}

export const noContent = () => new HttpResponse(null, { status: 204 });

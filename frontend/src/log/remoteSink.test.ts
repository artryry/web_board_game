import { http, HttpResponse } from "msw";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { components } from "@/api/schema";
import { apiUrl } from "@/test/handlers";
import { logEntries, logged } from "@/test/logCapture";
import { server } from "@/test/server";

import { log, setLogSinks } from "./logger";
import {
  BATCH_SIZE,
  BUCKET_SIZE,
  createRemoteSink,
  MAX_BATCH_BYTES,
  REFILL_MS,
  REPEAT_WINDOW_MS,
} from "./remoteSink";

type Batch = components["schemas"]["ClientLogBatch"];

const URL_ = apiUrl("/api/client-logs");

interface Sent {
  body: Batch;
  bytes: number;
  authorization: string | null;
}

/** A remote sink with a fake clock, the memory sink next to it, and the batches it sends. */
function setUp({ token = null as string | null, status = 204 } = {}) {
  const clock = { now: 1_000_000 };
  const sent: Sent[] = [];
  server.use(
    http.post(URL_, async ({ request }) => {
      const text = await request.text();
      sent.push({
        body: JSON.parse(text) as Batch,
        bytes: new TextEncoder().encode(text).length,
        authorization: request.headers.get("Authorization"),
      });
      return new HttpResponse(null, { status });
    }),
  );
  const remote = createRemoteSink({ url: URL_, getAccessToken: () => token, now: () => clock.now });
  onTestFinished(remote.stop);
  setLogSinks([remote.sink, (entry) => logEntries.push(entry)]);
  const entries = () => sent.flatMap((batch) => batch.body.entries);
  return { remote, clock, sent, entries };
}

describe("createRemoteSink", () => {
  it("sends warnings and errors in the server's shape, with the user's token", async () => {
    const { remote, sent } = setUp({ token: "access-1" });

    log.debug("api.request", { status: 200 });
    log.info("auth.session_expired");
    log.warn("api.request_failed", { status: 502, request_id: "abc", "Bad Key": 1 });
    log.error("ui.render_error", {}, new Error("boom"));
    await remote.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toBe("Bearer access-1");
    const [warning, error] = sent[0]?.body.entries ?? [];
    expect(warning).toEqual({
      level: "warn",
      event: "api.request_failed",
      message: "",
      stack: null,
      page: window.location.pathname,
      client_ts: expect.any(String) as string,
      context: { status: 502, request_id: "abc" },
      breadcrumbs: [],
    });
    expect(error).toMatchObject({ level: "error", message: "boom" });
    expect(error?.stack).toContain("boom");
  });

  it("sends nothing without a session token header when logged out", async () => {
    const { remote, sent } = setUp();

    log.warn("thing.odd");
    await remote.flush();

    expect(sent[0]?.authorization).toBeNull();
  });

  it("carries the steps before an error as breadcrumbs", async () => {
    const { remote, entries } = setUp();

    log.debug("nav.page_viewed", { route: "/cards/:id" });
    log.debug("api.request", { method: "GET", path: "/api/cards/1", status: 500, a: 1, b: 2 });
    log.error("ui.render_error", {}, new Error("boom"));
    await remote.flush();

    const crumbs = entries()[0]?.breadcrumbs ?? [];
    expect(crumbs.map((crumb) => crumb.event)).toEqual(["nav.page_viewed", "api.request"]);
    expect(crumbs[0]).toMatchObject({ level: "debug", context: { route: "/cards/:id" } });
    // At most 5 fields per breadcrumb.
    expect(Object.keys(crumbs[1]?.context ?? {})).toHaveLength(5);
  });

  it("sends a full batch at once, and the rest on the next flush", async () => {
    const { remote, clock, sent, entries } = setUp();

    for (let i = 0; i < BATCH_SIZE; i += 1) log.warn(`thing.odd_${i}`);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    clock.now += 2 * REFILL_MS; // the bucket is empty after 10
    log.warn("thing.later_1");
    log.warn("thing.later_2");
    await remote.flush();

    expect(sent.map((batch) => batch.body.entries.length)).toEqual([BATCH_SIZE, 2]);
    expect(entries()).toHaveLength(BATCH_SIZE + 2);
  });

  it("keeps each batch under the byte cap", async () => {
    const { remote, sent, entries } = setUp();
    const big = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`f${i}`, "x".repeat(200)]),
    );
    const error = new Error("y".repeat(500));
    error.stack = "z".repeat(4000);

    for (let i = 0; i < 8; i += 1) log.warn(`thing.big_${i}`, big, error);
    while (entries().length < 8 && sent.length < 8) await remote.flush();

    expect(entries()).toHaveLength(8);
    expect(sent.length).toBeGreaterThan(1);
    for (const batch of sent) expect(batch.bytes).toBeLessThanOrEqual(MAX_BATCH_BYTES);
  });

  it("counts repeats instead of sending them, then sends the count", async () => {
    const { remote, clock, entries } = setUp();

    for (let i = 0; i < 3; i += 1) log.warn("api.request_failed", {}, new Error("down"));
    await remote.flush();
    clock.now += REPEAT_WINDOW_MS;
    log.warn("api.request_failed", {}, new Error("down"));
    await remote.flush();

    expect(entries().map((entry) => entry.context)).toEqual([{}, { repeats: 2 }]);
  });

  it("holds back a flood, and says how much it dropped", async () => {
    const { remote, clock, entries } = setUp();

    for (let i = 0; i < BUCKET_SIZE + 5; i += 1) log.warn(`thing.flood_${i}`);
    await remote.flush();
    clock.now += REFILL_MS;
    log.warn("thing.after_flood");
    await remote.flush();

    const sentEvents = entries().map((entry) => entry.event);
    expect(sentEvents).toHaveLength(BUCKET_SIZE + 1);
    expect(entries().at(-1)).toMatchObject({ event: "thing.after_flood", context: { dropped: 5 } });
  });

  it("sends what is left with keepalive when the page goes away", async () => {
    const { sent } = setUp();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    onTestFinished(() => {
      fetchSpy.mockRestore();
    });

    log.warn("thing.odd");
    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
  });

  it("never sends its own failures", async () => {
    const { remote, sent } = setUp({ status: 500 });

    log.warn("thing.odd");
    await remote.flush();
    await remote.flush();

    expect(sent).toHaveLength(1);
    const [failure] = logged("log.send_failed");
    expect(failure).toMatchObject({ level: "debug", fields: { status: 500 } });
  });
});

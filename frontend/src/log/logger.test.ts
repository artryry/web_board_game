import { describe, expect, it } from "vitest";

import { logEntries, logged } from "@/test/logCapture";

import { BREADCRUMB_COUNT, log, REDACTED, setLogSinks, type LogEntry } from "./logger";

describe("log", () => {
  it("gives every entry the time, level, event, fields and page", () => {
    log.info("thing.happened", { count: 2, skipped: undefined });

    const [entry] = logEntries;
    expect(entry).toMatchObject({
      level: "info",
      event: "thing.happened",
      fields: { count: 2 },
      page: window.location.pathname,
    });
    expect(entry?.fields).not.toHaveProperty("skipped");
    expect(new Date(entry?.ts ?? "").toISOString()).toBe(entry?.ts);
  });

  it("redacts secret-looking fields and tokens inside text", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";

    log.warn("thing.failed", {
      password: "hunter2",
      access: "a",
      upload_url: "https://r2.test/put",
      Authorization_header: "Bearer x",
      note: `token ${jwt}`,
      status: 500,
    });

    expect(logEntries[0]?.fields).toEqual({
      password: REDACTED,
      access: REDACTED,
      upload_url: REDACTED,
      Authorization_header: REDACTED,
      note: `token ${REDACTED}`,
      status: 500,
    });
  });

  it("keeps an error as plain data", () => {
    log.error("thing.crashed", {}, new RangeError("out of range"));

    expect(logEntries[0]?.error).toMatchObject({
      name: "RangeError",
      message: "out of range",
      stack: expect.stringContaining("out of range") as string,
    });
  });

  it("turns anything thrown into an error entry", () => {
    log.error("thing.crashed", {}, { reason: "nope" });
    log.error("thing.crashed", {}, "plain text");

    expect(logged("thing.crashed").map((entry) => entry.error)).toEqual([
      { name: "NonError", message: '{"reason":"nope"}' },
      { name: "NonError", message: "plain text" },
    ]);
  });

  it("attaches the steps before an error as breadcrumbs, the last 20", () => {
    for (let step = 0; step < BREADCRUMB_COUNT + 5; step += 1) {
      log.debug("nav.page_viewed", { step });
    }
    log.error("thing.crashed");

    const [error] = logged("thing.crashed");
    const steps = error?.breadcrumbs?.map((crumb) => crumb.fields.step);
    expect(steps).toHaveLength(BREADCRUMB_COUNT);
    expect(steps?.[0]).toBe(5);
    expect(steps?.at(-1)).toBe(BREADCRUMB_COUNT + 4);
    expect(logged("nav.page_viewed")[0]).not.toHaveProperty("breadcrumbs");
  });

  it("only error entries carry breadcrumbs", () => {
    log.debug("nav.page_viewed");
    log.warn("thing.odd");

    expect(logged("thing.odd")[0]).not.toHaveProperty("breadcrumbs");
  });

  it("still reaches the other sinks when one throws", () => {
    const received: LogEntry[] = [];
    setLogSinks([
      () => {
        throw new Error("broken sink");
      },
      (entry) => received.push(entry),
    ]);

    log.warn("thing.odd");

    expect(received.map((entry) => entry.event)).toEqual(["thing.odd"]);
  });
});

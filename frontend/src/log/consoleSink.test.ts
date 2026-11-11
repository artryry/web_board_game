import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createConsoleSink } from "./consoleSink";
import { log, setLogSinks } from "./logger";

function spyConsole() {
  const spies = {
    debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
    info: vi.spyOn(console, "info").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
  onTestFinished(() => {
    for (const spy of Object.values(spies)) spy.mockRestore();
  });
  return spies;
}

describe("createConsoleSink", () => {
  it("prints every level in dev, with the event and its fields", () => {
    const spies = spyConsole();
    setLogSinks([createConsoleSink("debug")]);

    log.debug("api.request", { status: 200 });
    log.error("thing.crashed", { page_id: 3 }, new Error("boom"));

    expect(spies.debug).toHaveBeenCalledWith("api.request", { status: 200 });
    expect(spies.error).toHaveBeenCalledWith("thing.crashed", {
      page_id: 3,
      error: expect.objectContaining({ message: "boom" }) as unknown,
    });
  });

  it("prints only warnings and errors in production", () => {
    const spies = spyConsole();
    setLogSinks([createConsoleSink("warn")]);

    log.debug("api.request");
    log.info("auth.session_expired");
    log.warn("api.request_failed");

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledOnce();
  });
});

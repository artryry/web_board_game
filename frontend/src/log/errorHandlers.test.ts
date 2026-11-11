import { describe, expect, it, onTestFinished } from "vitest";

import { logged } from "@/test/logCapture";

import { installWindowErrorHandlers, onRouterError, rootErrorOptions } from "./errorHandlers";

function install() {
  onTestFinished(installWindowErrorHandlers());
}

function errorEvent(init: ErrorEventInit): ErrorEvent {
  return new ErrorEvent("error", { cancelable: true, ...init });
}

describe("window error handlers", () => {
  it("logs an uncaught error with where it came from", () => {
    install();
    const error = new TypeError("x is undefined");

    window.dispatchEvent(
      errorEvent({
        error,
        message: error.message,
        filename: `${window.location.origin}/src/a.ts`,
        lineno: 3,
        colno: 7,
      }),
    );

    const [entry] = logged("window.error");
    expect(entry?.level).toBe("error");
    expect(entry?.fields).toEqual({ source: "/src/a.ts", line: 3, column: 7 });
    expect(entry?.error).toMatchObject({ name: "TypeError", message: "x is undefined" });
  });

  it("skips cross-origin noise and browser extensions", () => {
    install();

    window.dispatchEvent(errorEvent({ message: "Script error." }));
    window.dispatchEvent(
      errorEvent({
        error: new Error("ext"),
        message: "ext",
        filename: "chrome-extension://abc/x.js",
      }),
    );

    expect(logged("window.error")).toEqual([]);
  });

  it("logs an unhandled rejection, but not a cancelled request", () => {
    install();
    const reject = (reason: unknown) => {
      const event = new Event("unhandledrejection") as PromiseRejectionEvent;
      Object.defineProperty(event, "reason", { value: reason });
      window.dispatchEvent(event);
    };

    reject(new Error("nobody caught me"));
    reject(new DOMException("The operation was aborted.", "AbortError"));

    expect(logged("window.unhandled_rejection").map((entry) => entry.error?.message)).toEqual([
      "nobody caught me",
    ]);
  });
});

describe("React and router hooks", () => {
  it("logs a render error once, though React and the router both report it", () => {
    const error = new Error("render failed");

    rootErrorOptions.onCaughtError(error, { componentStack: "\n    at CardEditorPage" });
    onRouterError(error, {
      location: window.location as never,
      params: {},
      pattern: "/cards/:id",
    });

    const [entry, ...others] = logged("ui.render_error");
    expect(others).toEqual([]);
    expect(entry?.fields).toEqual({ component_stack: "\n    at CardEditorPage" });
    expect(entry?.error?.message).toBe("render failed");
  });

  it("logs recoverable errors as warnings", () => {
    rootErrorOptions.onRecoverableError(new Error("hydration"), { componentStack: "" });

    expect(logged("ui.recoverable_error")[0]?.level).toBe("warn");
  });
});

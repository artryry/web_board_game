import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { endSession } from "@/auth/tokens";

import { resetContentStore } from "./contentStore";
import { server } from "./server";

// A page waits for the session, the catalog and its lists before it renders; 1 s (the default
// for findBy and waitFor) was too tight when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 3000 });

// jsdom 29 has <dialog> without its methods. These do what ui/Modal needs: open, close and the
// close event. Esc (`cancel`) is fired by the tests themselves.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

// jsdom has no object URLs either. The art preview only needs a distinct string per file.
let objectUrls = 0;
URL.createObjectURL = () => {
  objectUrls += 1;
  return `blob:test/${objectUrls}`;
};
URL.revokeObjectURL = () => undefined;

// A request without a handler fails the test, so nothing reaches a real network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  // Vitest runs without globals, so Testing Library can't register its cleanup by itself.
  cleanup();
  server.resetHandlers();
  resetContentStore();
  endSession("logout");
  localStorage.clear();
});

afterAll(() => {
  server.close();
});

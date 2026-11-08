import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { endSession } from "@/auth/tokens";

import { server } from "./server";

// A request without a handler fails the test, so nothing reaches a real network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  // Vitest runs without globals, so Testing Library can't register its cleanup by itself.
  cleanup();
  server.resetHandlers();
  endSession("logout");
  localStorage.clear();
});

afterAll(() => {
  server.close();
});

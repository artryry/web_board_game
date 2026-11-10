import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // nginx runs in Docker and reaches this server through host.docker.internal.
    host: true,
    port: 5173,
    strictPort: true,
    // The browser only talks to nginx on port 80, so the hot-reload socket goes there too.
    hmr: { clientPort: 80 },
    // The cost tests read the backend's shared cases (backend/tests/fixtures/cost_cases.json).
    // Only Vitest may load them; the dev server keeps its default reach.
    fs:
      process.env.VITEST === undefined
        ? undefined
        : { allow: [searchForWorkspaceRoot(process.cwd()), "../backend/tests/fixtures"] },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Page tests type into whole editors in jsdom; 5 s was too tight on a busy machine.
    testTimeout: 15_000,
  },
});

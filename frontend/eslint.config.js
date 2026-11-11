import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "playwright-report", "test-results", ".vitest", "src/api/schema.d.ts"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Numbers in template strings are common in UI text and safe.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Log through `log` from @/log/logger, which gives every entry the same shape.
      "no-console": "error",
    },
  },
  {
    // The one place the app writes to the console.
    files: ["src/log/consoleSink.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["vite.config.ts", "playwright.config.ts", "e2e/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);

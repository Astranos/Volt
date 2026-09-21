import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    // .mjs suites use node:test and are executed by scripts/run-tests.mjs.
    include: ["{apps,packages,convex,scripts}/**/*.{test,spec}.{ts,tsx,js,jsx}"],
    exclude: ["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/.output/**"],
  },
});

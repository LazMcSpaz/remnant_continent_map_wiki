/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// Unit tests for the pure derived/sim logic. These don't touch the DOM, the
// network, or DEM tiles — just the math that everything cascades from. Kept
// separate from vite.config.ts so the app build stays untouched.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Der IFC-Parse läuft echt (kein Mock) — großzügiges Zeitbudget.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

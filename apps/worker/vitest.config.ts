import { defineConfig } from "vitest/config";

// @solar/worker unit tests — task handlers exercised against fake helpers.
// No DB / network. Real graphile-worker bootstrap is integration-tested by
// running `pnpm dev:worker` against the dev compose stack (manual).
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 5_000,
  },
});

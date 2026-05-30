import { defineConfig } from "vitest/config";

// @solar/storage unit tests — no network. Uses dummy credentials with the
// AWS SDK presigner; signatures are inspected as query params.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 5_000,
  },
});

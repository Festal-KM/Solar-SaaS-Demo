import { defineConfig } from "vitest/config";

// @solar/email unit tests — pure, no DB / network. Fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 5_000,
  },
});

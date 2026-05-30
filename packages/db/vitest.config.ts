import { defineConfig } from "vitest/config";

// Vitest config for @solar/db.
//
// Tests in `__tests__/` are integration tests that hit a real PostgreSQL
// instance (the `solar_saas_test` database on the dev compose stack — see
// docker-compose.dev.yml). They are slow by unit-test standards so default
// timeouts are bumped, and they MUST run serialised (single fork) because
// they share a database and rely on session-level GUCs.

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    setupFiles: ["__tests__/setup-env.ts"],
  },
});

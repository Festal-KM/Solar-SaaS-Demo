import { defineConfig } from "vitest/config";

// Vitest config for @solar/auth.
//
// The login pipeline integration tests in `__tests__/` hit the same
// `solar_saas_test` PostgreSQL database that @solar/db uses, because
// `verifyPassword` writes to LoginAttempt / AuditLog and reads User rows
// behind RLS. Tests are serialised (single fork) so they can rely on
// session-level GUCs without interleaving with other suites.

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
    // `next-auth/providers/credentials` transitively imports `next/server`
    // via its env loader. Vitest's default ESM resolver chokes on the
    // extensionless `next/server` specifier, so we ask vite to inline-transform
    // next-auth which routes resolution through vite's plugins.
    server: {
      deps: {
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
});

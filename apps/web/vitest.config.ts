import { fileURLToPath } from "node:url";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Vitest config for @solar/web.
//
// Unlike @solar/db / @solar/auth (which hit a real Postgres), the web-layer
// unit tests under apps/web/lib/**/__tests__/ mock the session and the
// Relationship lookup so they can run without external dependencies. We
// resolve workspace path aliases ourselves because Next.js's tsconfig paths
// aren't picked up by Vitest directly.

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Web-owned tests + the pure-function contracts tests (the contracts
    // package itself doesn't ship vitest, so the web vitest suite is the
    // home for any test against `@solar/contracts`).
    include: ["**/__tests__/**/*.test.ts", "../../packages/contracts/__tests__/**/*.test.ts"],
    setupFiles: [path.resolve(here, "__tests__/setup-env.ts")],
    testTimeout: 15_000,
    // `next-auth/providers/credentials` (pulled in by `@/auth`) transitively
    // imports `next/server` via its env loader. Vitest's default ESM resolver
    // chokes on the extension-less specifier, so we ask Vite to inline-
    // transform next-auth which routes resolution through Vite's plugins.
    server: {
      deps: {
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
  resolve: {
    alias: {
      "@/auth": path.resolve(here, "auth.ts"),
      "@/lib/errors": path.resolve(here, "lib/errors.ts"),
      "@/lib/permissions/can": path.resolve(here, "lib/permissions/can.ts"),
      "@/lib/tenancy/context": path.resolve(here, "lib/tenancy/context.ts"),
      "@/lib/tenancy/server-action": path.resolve(here, "lib/tenancy/server-action.ts"),
      "@/lib/tenancy/with-tenant": path.resolve(here, "lib/tenancy/with-tenant.ts"),
      "@/lib/audit/audit-service": path.resolve(here, "lib/audit/audit-service.ts"),
      "@/lib/sentry/pii-filter": path.resolve(here, "lib/sentry/pii-filter.ts"),
      "@/lib": path.resolve(here, "lib"),
      "@solar/db": path.resolve(here, "../../packages/db/src/index.ts"),
      "@solar/auth/config": path.resolve(here, "../../packages/auth/src/config.ts"),
      "@solar/auth": path.resolve(here, "../../packages/auth/src/index.ts"),
      "@solar/contracts/schemas/venue-provider": path.resolve(
        here,
        "../../packages/contracts/src/schemas/venue-provider.ts",
      ),
      "@solar/contracts/schemas/product": path.resolve(
        here,
        "../../packages/contracts/src/schemas/product.ts",
      ),
      "@solar/contracts/services/product-effective": path.resolve(
        here,
        "../../packages/contracts/src/services/product-effective.ts",
      ),
      "@solar/contracts/schemas/incentive-rate": path.resolve(
        here,
        "../../packages/contracts/src/schemas/incentive-rate.ts",
      ),
      "@solar/contracts/services/incentive-rate-effective": path.resolve(
        here,
        "../../packages/contracts/src/services/incentive-rate-effective.ts",
      ),
      "@solar/contracts/dto/product": path.resolve(
        here,
        "../../packages/contracts/src/dto/product.ts",
      ),
      "@solar/contracts/services/masking": path.resolve(
        here,
        "../../packages/contracts/src/services/masking.ts",
      ),
      "@solar/contracts/services/contract-snapshot": path.resolve(
        here,
        "../../packages/contracts/src/services/contract-snapshot.ts",
      ),
      "@solar/contracts/dto/project-info": path.resolve(
        here,
        "../../packages/contracts/src/dto/project-info.ts",
      ),
      "@solar/contracts/logger": path.resolve(
        here,
        "../../packages/contracts/src/logger.ts",
      ),
      "@solar/contracts": path.resolve(here, "../../packages/contracts/src/index.ts"),
    },
  },
});

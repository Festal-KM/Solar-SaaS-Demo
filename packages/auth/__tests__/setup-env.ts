// Test bootstrap — point Prisma at the `solar_saas_test` database and load
// `.env.test` overrides if the developer has any. Mirrors
// `packages/db/__tests__/setup-env.ts` so both packages can share the same
// schema-already-migrated invariant.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

const envPath = resolve(__dirname, "..", ".env.test");
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

const DEFAULT_TEST_URL =
  "postgresql://app_user:app_user_pw@localhost:5434/solar_saas_test?schema=public";

const DEFAULT_ADMIN_URL =
  "postgresql://solar:solar_dev_pw@localhost:5434/solar_saas_test?schema=public";

process.env.DATABASE_URL ??= DEFAULT_TEST_URL;
process.env.DATABASE_URL_DIRECT ??= DEFAULT_ADMIN_URL;
process.env.TEST_DB_ADMIN_URL ??= DEFAULT_ADMIN_URL;
process.env.TEST_DB_APP_URL ??= DEFAULT_TEST_URL;
// `NODE_ENV` is typed as a readonly union under newer @types/node, so cast
// through the env record to keep the same idempotent ??= pattern used by
// `packages/db/__tests__/setup-env.ts`.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";
process.env.AUTH_SECRET ??= "test-secret-do-not-use-in-production";
// 32-byte hex key for AES-256-GCM PII encryption (docs/05 §12, T-01-06). Tests only.
process.env.PII_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

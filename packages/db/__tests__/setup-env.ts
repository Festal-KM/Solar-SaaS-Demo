// Test bootstrap: point Prisma at the dedicated `solar_saas_test` database and
// load any developer overrides from `.env.test` if present.

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
// Admin URL is used by the test harness for seeding + truncation, and to
// exercise the RLS path with the rls-enforced `app_user` role.
process.env.TEST_DB_ADMIN_URL ??= DEFAULT_ADMIN_URL;
process.env.TEST_DB_APP_URL ??= DEFAULT_TEST_URL;
process.env.NODE_ENV ??= "test";

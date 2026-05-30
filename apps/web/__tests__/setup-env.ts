// Web-layer test bootstrap. Mirrors `packages/auth/__tests__/setup-env.ts` so
// any module that touches `process.env.*` at import time gets defensible
// fallbacks. The web-layer unit tests mock the DB / session at the module
// boundary, so we don't need a live Postgres — but Auth.js and `@solar/db`
// crash on construction if these are absent.

process.env.AUTH_SECRET ??= "test-secret-do-not-use-in-production";
process.env.DATABASE_URL ??=
  "postgresql://app_user:app_user_pw@localhost:5434/solar_saas_test?schema=public";
process.env.DATABASE_URL_DIRECT ??=
  "postgresql://solar:solar_dev_pw@localhost:5434/solar_saas_test?schema=public";
process.env.PII_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

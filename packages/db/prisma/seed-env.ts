// Tiny env preload imported FIRST from prisma/seed.ts (and from the seed
// smoke test) so that DATABASE_URL is set before `@prisma/client` is
// instantiated by `../src/client.ts`.
//
// Why a separate module: ES modules hoist `import` statements to the top of
// the file regardless of source order. If we inlined dotenv in seed.ts, the
// `rawPrisma` import would still resolve first and read `process.env`
// before dotenv ran. Splitting the preload into its own module — imported
// at the very top of seed.ts — guarantees ordering because module
// evaluation follows import order at the import-graph level.
//
// We probe well-known dev locations in order; the first match wins. Existing
// process env always wins (`override: false`) so CI / Railway / Docker
// secrets are not stomped on.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

const repoRoot = resolve(__dirname, "..", "..", "..");

const ENV_CANDIDATES = [
  resolve(repoRoot, ".env.local"),
  resolve(repoRoot, "apps", "web", ".env.local"),
  resolve(repoRoot, ".env"),
];

for (const candidate of ENV_CANDIDATES) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, override: false });
  }
}

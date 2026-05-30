// Prisma client singletons (raw + tenant-guarded).
//
// Split from `index.ts` to break the dependency cycle that would otherwise
// arise when `with-tenant.ts` (which needs `rawPrisma`) is itself re-exported
// from the package barrel.

import { PrismaClient } from "@prisma/client";

import { tenantExtension } from "./extension.js";

declare global {
  // Reused across HMR reloads in dev to avoid PG connection exhaustion.
  var __solarPrismaRaw: PrismaClient | undefined;
}

const rawClient: PrismaClient =
  globalThis.__solarPrismaRaw ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__solarPrismaRaw = rawClient;
}

/**
 * Tenant-guarded Prisma client. Use everywhere except migrations / seeds /
 * auth-service paths that must bypass tenant scope.
 */
export const prisma = rawClient.$extends(tenantExtension);

/**
 * Unguarded Prisma client. Reserved for migrations, seeds, and the auth
 * service writing to LoginAttempt (which runs with is_saas_admin=true).
 */
export const rawPrisma: PrismaClient = rawClient;

export type SolarPrismaClient = typeof prisma;

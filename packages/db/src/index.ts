// @solar/db public surface.
//
// `prisma`      — tenant-guarded client. Throws TenantContextRequiredError if
//                  any model operation is issued outside a `withTenant()` scope.
// `rawPrisma`   — unguarded client. Reserved for migration / seed / Auth.js
//                  internals that legitimately bypass the guard. Application
//                  code MUST NOT import this.
// `withTenant`  — canonical entry gate; opens a `$transaction`, applies the
//                  SET LOCAL GUCs, and pushes the context into AsyncLocalStorage.
//
// Both clients hit the same connection pool. RLS at the DB level remains the
// last line of defense — see prisma/migrations/*_rls/migration.sql.

export { prisma, rawPrisma, type SolarPrismaClient } from "./client.js";
export { tenantExtension } from "./extension.js";
export {
  type TenantContext,
  TenantContextRequiredError,
  tenantContextStore,
  getCurrentTenantContext,
  SYSTEM_TENANT_CONTEXT,
} from "./tenant-context.js";
export { withTenant, type TxClient } from "./with-tenant.js";

export * from "@prisma/client";

// Prisma Client extension that enforces tenant scoping at the application
// layer (defense in depth on top of PostgreSQL RLS — see prisma/migrations/
// *_rls/migration.sql).
//
// Contract:
//   - Every model operation MUST happen inside a `withTenant(ctx, fn)` block
//     so that AsyncLocalStorage has a TenantContext on entry.
//   - If the store is empty, the extension throws TenantContextRequiredError
//     and prevents the query from being sent.
//   - The SET LOCAL GUCs (app.current_wholesaler_id, …) are issued by
//     `withTenant()` itself, not by the extension. This split keeps the
//     extension cheap (no per-query SET LOCAL round-trip) and ensures the
//     GUCs live for the entire transaction.

import { Prisma } from "@prisma/client";

import { getCurrentTenantContext, TenantContextRequiredError } from "./tenant-context.js";

/**
 * Tenant-aware extension. Apply with:
 *   const prisma = new PrismaClient().$extends(tenantExtension);
 */
export const tenantExtension = Prisma.defineExtension({
  name: "solar-tenant-guard",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        const ctx = getCurrentTenantContext();
        if (!ctx) {
          throw new TenantContextRequiredError(model, operation);
        }
        return query(args);
      },
    },
  },
});

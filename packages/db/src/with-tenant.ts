// Canonical `withTenant(ctx, fn)` — entry gate for every DB call in the app.
//
// Wraps the work in a Prisma `$transaction`, issues the six `SET LOCAL` GUCs
// expected by the RLS policies (see prisma/migrations/*_rls/migration.sql),
// pushes the context into AsyncLocalStorage so the tenant extension lets
// queries through, and finally runs `fn(tx)`.
//
// Usage (Server Action / Route Handler):
//   const ctx = await getTenantContext();
//   const result = await withTenant(ctx, async (tx) => {
//     return tx.user.findMany();
//   });
//
// Notes:
//   - SET LOCAL only persists for the lifetime of the transaction, which is
//     why this MUST run inside `$transaction`. Don't call SET LOCAL on the
//     top-level client.
//   - For SaaS-operator bypass set `ctx.isSaasAdmin = true`; RLS policies
//     unconditionally pass in that case.
//   - This file is the single source of truth. `apps/web/lib/tenancy/with-tenant.ts`
//     and the integration tests in `__tests__/tenant-isolation.test.ts` both
//     re-export from here.

import { rawPrisma } from "./client.js";
import { tenantContextStore, type TenantContext } from "./tenant-context.js";

import type { Prisma } from "@prisma/client";

/**
 * Transaction client handed to the callback. We expose the full
 * `Prisma.TransactionClient` — including `$queryRaw` / `$executeRaw` /
 * `$queryRawTyped` and friends — because domain services (e.g. monthly
 * reporting, §6.8) need raw typed queries inside the same RLS-scoped
 * transaction.
 */
export type TxClient = Prisma.TransactionClient;

/**
 * Escape a value for embedding into `SET LOCAL <key> = '<value>'`. Postgres
 * accepts only string literals on SET LOCAL, so we hand-quote with the
 * standard `''` escape. Inputs are validated upstream (TenantContext is built
 * from session data, not user input) but we still escape defensively.
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Run `fn` inside a transaction with tenant GUCs applied.
 *
 * The returned promise resolves to whatever `fn` returns; the transaction is
 * committed on success and rolled back on thrown error.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return tenantContextStore.run(ctx, async () => {
    return rawPrisma.$transaction(async (tx) => {
      const tenantId = ctx.tenantId ?? "";
      const wholesalerId = ctx.wholesalerId ?? "";
      const dealerId = ctx.dealerId ?? "";
      const relationshipIds = ctx.relationshipIds.join(",");
      const isSaasAdmin = ctx.isSaasAdmin ? "true" : "false";
      const actorUserId = ctx.actorUserId ?? "";

      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = ${quote(tenantId)};`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_wholesaler_id = ${quote(wholesalerId)};`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_dealer_id = ${quote(dealerId)};`);
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_relationship_ids = ${quote(relationshipIds)};`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL app.is_saas_admin = ${quote(isSaasAdmin)};`);
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_actor_user_id = ${quote(actorUserId)};`,
      );

      return fn(tx);
    });
  });
}

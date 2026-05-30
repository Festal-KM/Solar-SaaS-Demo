// Tenant-context contract shared between `@solar/db` and the web layer.
//
// `withTenant()` (apps/web/lib/tenancy/with-tenant.ts) builds one of these from
// the Auth.js session and pushes it into AsyncLocalStorage before issuing
// SET LOCAL on a Prisma transaction. The Prisma extension (extension.ts) checks
// the store at query time and throws `TenantContextRequiredError` if no
// context is active — guaranteeing every DB call has been scoped.

import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  /**
   * Tenant id of the caller's home tenant (User.tenantId). For wholesaler
   * members this equals `wholesalerId`; for dealer members it equals the dealer
   * tenant's id (not `dealerId`, which is the dealer tenant id seen from the
   * wholesaler side — they are the same id but the names differ in intent).
   * docs/05 §3.9 references this as `app.current_tenant_id` and uses it to
   * scope `User` / `UserRole` / `TotpSecret` / `BackupCode` / `Session` /
   * `UserInvitation`. Required for every non-SaaS-admin context.
   */
  tenantId?: string;
  /** Wholesaler-tenant id when the caller operates as a wholesaler member. */
  wholesalerId?: string;
  /** Dealer-tenant id when the caller operates as a dealer member. */
  dealerId?: string;
  /** Relationships visible to a dealer in the active wholesaler context. */
  relationshipIds: string[];
  /** SaaS operator bypass — must be set explicitly. */
  isSaasAdmin: boolean;
  /** Audit trail key. */
  actorUserId: string;
}

/**
 * Thrown when a Prisma operation is issued without an active tenant context.
 * The web layer must always wrap DB calls with `withTenant(ctx, fn)`.
 */
export class TenantContextRequiredError extends Error {
  constructor(model?: string, operation?: string) {
    const where = model && operation ? ` (${model}.${operation})` : "";
    super(
      `TenantContextRequiredError: no tenant context active${where}. ` +
        `Wrap the call with withTenant(ctx, fn) from apps/web/lib/tenancy.`,
    );
    this.name = "TenantContextRequiredError";
  }
}

/**
 * AsyncLocalStorage holding the context for the lifetime of one request /
 * transaction. Exported so `withTenant()` and the Prisma extension can share
 * the same instance.
 */
export const tenantContextStore = new AsyncLocalStorage<TenantContext>();

export function getCurrentTenantContext(): TenantContext | undefined {
  return tenantContextStore.getStore();
}

/**
 * Canonical "no tenant, run as SaaS operator" context used by the auth layer
 * (LoginAttempt / AuditLog writes during login) and any other infrastructure
 * call that must bypass per-tenant RLS. Application code MUST NOT import this
 * outside of `@solar/auth` / migration / seed scripts.
 */
export const SYSTEM_TENANT_CONTEXT: TenantContext = {
  isSaasAdmin: true,
  relationshipIds: [],
  actorUserId: "system",
};

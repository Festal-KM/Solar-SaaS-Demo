// Prisma-dependent `revealPii` — web layer only.
//
// Fetches the full (unmasked) PII fields for a customer record and records an
// audit event so every REVEAL_PII disclosure is traceable (CLAUDE.md Hard
// Rule #6, docs/05 §6.5, docs/02 §F-031 / §F-055).
//
// Audit write is a TODO stub for SP-07 (`recordAudit` will be wired when the
// audit-log domain service is implemented in T-07-xx). The call site is
// commented out but the interface contract is stable so SP-07 can complete it
// without changing callers.
//
// Usage example (Server Action):
//   const pii = await revealPii(customerId, viewer, "operator requested full address");

import { withTenant, type TenantContext } from "@solar/db";

import type { ViewerContext } from "@solar/contracts/services/masking";
import { recordAudit } from "@/lib/audit/audit-service";

export interface RevealedPii {
  phone: string;
  address: string;
  name: string;
}

/**
 * Return unmasked PII for `customerId` and record a REVEAL_PII audit log.
 *
 * @param customerId  - The `Customer.id` whose PII is being revealed.
 * @param viewer      - Viewer context (used for audit attribution).
 * @param ctx         - Tenant context from `getTenantContext()`.
 * @param reason      - Human-readable disclosure reason, stored in audit log.
 */
export async function revealPii(
  customerId: string,
  viewer: ViewerContext,
  ctx: TenantContext,
  reason: string,
): Promise<RevealedPii> {
  const result = await withTenant(ctx, async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { phone: true, address: true, name: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "REVEAL_PII",
      targetType: "Customer",
      targetId: customerId,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      after: { reason, viewerRole: viewer.role },
    });

    return customer;
  });

  return {
    phone: result.phone ?? "",
    address: result.address ?? "",
    name: result.name,
  };
}

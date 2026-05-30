// Recipient resolution helpers for NotificationService.fire() callers.
//
// Both helpers run inside the caller-supplied withTenant transaction so that
// RLS automatically scopes the User / UserRole lookups to the current tenant.
// Never call these outside a withTenant tx.

import type { TxClient } from "@solar/db";

/**
 * Resolve all ACTIVE users holding the WHOLESALER_ADMIN role inside the given
 * wholesaler tenant. Used to notify the wholesaler side of an event.
 */
export async function resolveWholesalerAdmins(
  tx: TxClient,
  wholesalerId: string,
): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      tenantId: wholesalerId,
      status: "ACTIVE",
      roles: { some: { role: "WHOLESALER_ADMIN" } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Resolve all ACTIVE users holding the DEALER_ADMIN role inside the dealer
 * tenant referenced by the given relationshipId.
 */
export async function resolveDealerAdmins(
  tx: TxClient,
  relationshipId: string,
): Promise<string[]> {
  const rel = await tx.relationship.findUnique({
    where: { id: relationshipId },
    select: { dealerId: true },
  });
  if (!rel) return [];

  const rows = await tx.user.findMany({
    where: {
      tenantId: rel.dealerId,
      status: "ACTIVE",
      roles: { some: { role: "DEALER_ADMIN" } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

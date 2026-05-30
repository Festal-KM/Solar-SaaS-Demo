// Prisma-backed wrapper around the pure `resolveScope` helper (docs/05 §6.4).
//
// Loads EventDealer.scopeOverride and Relationship.defaultScope from the DB
// inside the caller's tenant-scoped transaction, then delegates to the
// DB-agnostic `resolveScope` from @solar/contracts.
//
// Called by T-05-03 deal-action Server Actions to authorize visit/pitch/close.

import { withTenant, type TxClient } from "@solar/db";
import { resolveScope, type DealerScope } from "@solar/contracts";

import type { TenantContext } from "@solar/db";

export interface ResolveScopeFromDbInput {
  relationshipId: string;
  /** When provided, EventDealer.scopeOverride is checked first. */
  eventId?: string;
}

/**
 * Resolves the effective DealerScope for a given relationship (and optionally
 * an event) by reading from the DB within a tenant-scoped transaction.
 *
 * Rule: EventDealer.scopeOverride (non-null) takes precedence over
 *       Relationship.defaultScope.
 */
export async function resolveScopeFromDb(
  ctx: TenantContext,
  input: ResolveScopeFromDbInput,
): Promise<DealerScope> {
  return withTenant(ctx, async (tx: TxClient) => {
    const relationship = await tx.relationship.findUniqueOrThrow({
      where: { id: input.relationshipId },
      select: { defaultScope: true },
    });

    if (input.eventId) {
      const eventDealer = await tx.eventDealer.findUnique({
        where: {
          eventId_relationshipId: {
            eventId: input.eventId,
            relationshipId: input.relationshipId,
          },
        },
        select: { scopeOverride: true },
      });
      return resolveScope(
        { scopeOverride: (eventDealer?.scopeOverride as DealerScope | null) ?? null },
        { defaultScope: relationship.defaultScope as DealerScope },
      );
    }

    return resolveScope(
      { scopeOverride: null },
      { defaultScope: relationship.defaultScope as DealerScope },
    );
  });
}

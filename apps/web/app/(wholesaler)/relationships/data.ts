// Data loader for relationship management (F-009 / F-010).
// Lists all Relationships for the current wholesaler with dealer tenant name.
// Guard: auth → assertCan(relationship.read) → withTenant.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { DealerScope, RelationshipStatus } from "@solar/db";

export interface RelationshipListItem {
  id: string;
  dealerName: string;
  status: RelationshipStatus;
  defaultScope: DealerScope;
  createdAt: string;
}

async function requireCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing",
    });
  }
  const ctx = await getTenantContext();
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action: "relationship.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function listRelationships(): Promise<RelationshipListItem[]> {
  const ctx = await requireCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.relationship.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        defaultScope: true,
        createdAt: true,
        dealer: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      dealerName: r.dealer.name,
      status: r.status,
      defaultScope: r.defaultScope,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

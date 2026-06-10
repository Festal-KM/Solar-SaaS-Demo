// Server-side data loaders for the dealer-relationships master (S-052 tab).
//
// Lists Relationship rows joined with the dealer Tenant for the calling
// wholesaler. RLS via `withTenant` keeps cross-tenant rows invisible and
// `assertCan` raises ForbiddenError so dealer roles never reach the DB.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export type RelationshipStatusValue = "ACTIVE" | "SUSPENDED";
export type DealerScopeValue = "APPOINTMENT_ONLY" | "FIRST_VISIT" | "FULL_CLOSING";

export interface RelationshipListItem {
  id: string;
  dealerId: string;
  dealerName: string;
  franchiseNo: string | null;
  status: RelationshipStatusValue;
  defaultScope: DealerScopeValue;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

async function requireWholesalerCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
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
    action: "masters.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function listRelationships(): Promise<RelationshipListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.relationship.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        dealerId: true,
        franchiseNo: true,
        status: true,
        defaultScope: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        dealer: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      dealerId: r.dealerId,
      dealerName: r.dealer.name,
      franchiseNo: r.franchiseNo,
      status: r.status,
      defaultScope: r.defaultScope,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

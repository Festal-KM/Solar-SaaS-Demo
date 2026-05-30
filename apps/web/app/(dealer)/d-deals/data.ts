// Server-side data loader for the dealer deal list (T-05-03 / F-038 /
// docs/04 §1.5 S-067 / docs/05 §4.8).
//
// Dealer sees ONLY deals where `ownerRelationshipId IN ctx.relationshipIds`.
// APPOINTMENT_ONLY dealers see deals but cannot create/update (action-layer
// restriction). Scope is resolved per-relationship and surfaced in UI.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { rawPrisma } from "@solar/db";
import { canDealerCloseDeal, type DealerScope } from "@solar/contracts";

import type { DealStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface DealerDealListFilter {
  status?: DealStatus;
  page?: number;
}

export interface DealerDealListItem {
  id: string;
  customerId: string;
  customerName: string;
  status: DealStatus;
  ownerRelationshipId: string | null;
  expectedContractDate: string | null;
  createdAt: string;
  // Scope-based capabilities for the UI.
  canUpdate: boolean;
  canClose: boolean;
}

export interface PagedDealerDealResult {
  items: DealerDealListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDealerDeals(
  filter: DealerDealListFilter = {},
): Promise<PagedDealerDealResult> {
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
    action: "deal.read",
  });

  if (ctx.relationshipIds.length === 0) {
    return { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 0 };
  }

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Resolve scope for each relationshipId to determine capabilities.
  const relationships = await rawPrisma.relationship.findMany({
    where: { id: { in: ctx.relationshipIds } },
    select: { id: true, defaultScope: true },
  });
  const scopeByRelId = new Map<string, DealerScope>(
    relationships.map((r) => [r.id, r.defaultScope as DealerScope]),
  );

  return withTenant(ctx, async (tx) => {
    const where = {
      ownerRelationshipId: { in: ctx.relationshipIds },
      ...(filter.status ? { status: filter.status } : {}),
    };

    const [rows, total] = await Promise.all([
      tx.deal.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          customerId: true,
          status: true,
          ownerRelationshipId: true,
          expectedContractDate: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      }),
      tx.deal.count({ where }),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return {
      items: rows.map((r) => {
        const relId = r.ownerRelationshipId;
        const scope: DealerScope = relId
          ? (scopeByRelId.get(relId) ?? "FULL_CLOSING")
          : "FULL_CLOSING";

        return {
          id: r.id,
          customerId: r.customerId,
          customerName: r.customer.name,
          status: r.status,
          ownerRelationshipId: r.ownerRelationshipId,
          expectedContractDate: r.expectedContractDate?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          canUpdate: canDealerCloseDeal(scope, "visit"),
          canClose: canDealerCloseDeal(scope, "close"),
        };
      }),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

// Server-side data loader for the wholesaler deal list (T-05-03 / F-038 /
// docs/04 §1.3 S-037 / docs/05 §4.8).
//
// Wholesaler sees all deals linked to their `wholesalerId` tenant via the
// Customer FK. Filters: status / ownerRelationshipId / date range.
// Pagination: PAGE_SIZE rows per page.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { DealStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface DealListFilter {
  status?: DealStatus;
  ownerRelationshipId?: string;
  from?: string;
  to?: string;
  page?: number;
}

export interface DealListItem {
  id: string;
  customerId: string;
  customerName: string;
  status: DealStatus;
  ownerType: "WHOLESALER" | "DEALER";
  ownerRelationshipId: string | null;
  expectedContractDate: string | null;
  createdAt: string;
}

export interface PagedDealResult {
  items: DealListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDeals(filter: DealListFilter = {}): Promise<PagedDealResult> {
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

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  return withTenant(ctx, async (tx) => {
    const where = {
      customer: { wholesalerId: ctx.wholesalerId! },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.ownerRelationshipId
        ? { ownerRelationshipId: filter.ownerRelationshipId }
        : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
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
          ownerType: true,
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
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.name,
        status: r.status,
        ownerType: r.ownerType as "WHOLESALER" | "DEALER",
        ownerRelationshipId: r.ownerRelationshipId,
        expectedContractDate: r.expectedContractDate?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

export interface DealDetail {
  id: string;
  customerId: string;
  customerName: string;
  status: DealStatus;
  ownerType: "WHOLESALER" | "DEALER";
  ownerUserId: string;
  ownerRelationshipId: string | null;
  firstVisitAt: string | null;
  proposedProduct: string | null;
  proposedAmount: string | null;
  expectedProfit: string | null;
  expectedContractDate: string | null;
  lostReason: string | null;
  nextAction: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getDeal(id: string): Promise<DealDetail | null> {
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

  return withTenant(ctx, async (tx) => {
    const row = await tx.deal.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        status: true,
        ownerType: true,
        ownerUserId: true,
        ownerRelationshipId: true,
        firstVisitAt: true,
        proposedProduct: true,
        proposedAmount: true,
        expectedProfit: true,
        expectedContractDate: true,
        lostReason: true,
        nextAction: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { name: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      customerId: row.customerId,
      customerName: row.customer.name,
      status: row.status,
      ownerType: row.ownerType as "WHOLESALER" | "DEALER",
      ownerUserId: row.ownerUserId,
      ownerRelationshipId: row.ownerRelationshipId,
      firstVisitAt: row.firstVisitAt?.toISOString() ?? null,
      proposedProduct: row.proposedProduct,
      proposedAmount: row.proposedAmount?.toString() ?? null,
      expectedProfit: row.expectedProfit?.toString() ?? null,
      expectedContractDate: row.expectedContractDate?.toISOString() ?? null,
      lostReason: row.lostReason,
      nextAction: row.nextAction,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

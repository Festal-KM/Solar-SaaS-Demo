// Server-side data loader for the wholesaler dealer-deal report list
// (T-05-04 / F-039 / docs/04 §1.3 S-039 / docs/05 §4.8).
//
// Returns deals where ownerType = DEALER that belong to this wholesaler's
// customers.  Filters: status / ownerRelationshipId / targetMonth (YYYY-MM).
// Pagination: PAGE_SIZE rows per page.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { DealStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface DealReportFilter {
  status?: DealStatus;
  ownerRelationshipId?: string;
  /** YYYY-MM — filters by createdAt month */
  targetMonth?: string;
  page?: number;
}

export interface DealReportItem {
  id: string;
  customerId: string;
  customerName: string;
  status: DealStatus;
  ownerRelationshipId: string | null;
  dealerName: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface PagedDealReportResult {
  items: DealReportItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDealReports(
  filter: DealReportFilter = {},
): Promise<PagedDealReportResult> {
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
    // Month range from YYYY-MM string
    let monthGte: Date | undefined;
    let monthLt: Date | undefined;
    if (filter.targetMonth) {
      const [y, m] = filter.targetMonth.split("-").map(Number);
      if (y && m) {
        monthGte = new Date(y, m - 1, 1);
        monthLt = new Date(y, m, 1);
      }
    }

    const where = {
      ownerType: "DEALER" as const,
      customer: { wholesalerId: ctx.wholesalerId! },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.ownerRelationshipId
        ? { ownerRelationshipId: filter.ownerRelationshipId }
        : {}),
      ...(monthGte || monthLt
        ? {
            createdAt: {
              ...(monthGte ? { gte: monthGte } : {}),
              ...(monthLt ? { lt: monthLt } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.deal.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          customerId: true,
          status: true,
          ownerRelationshipId: true,
          updatedAt: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      }),
      tx.deal.count({ where }),
    ]);

    // Resolve dealer (tenant) names for the ownerRelationshipId values present
    const relIds = [...new Set(rows.map((r) => r.ownerRelationshipId).filter(Boolean))] as string[];
    const relMap = new Map<string, string>();
    if (relIds.length > 0) {
      const rels = await tx.relationship.findMany({
        where: { id: { in: relIds } },
        select: { id: true, dealer: { select: { name: true } } },
      });
      for (const rel of rels) {
        relMap.set(rel.id, rel.dealer.name);
      }
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return {
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.name,
        status: r.status,
        ownerRelationshipId: r.ownerRelationshipId,
        dealerName: r.ownerRelationshipId ? (relMap.get(r.ownerRelationshipId) ?? null) : null,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

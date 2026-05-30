// Server-side data loader for S-xxx wholesaler incentive list (docs/04 §1.3).
//
// Lists all Incentive records scoped to the current wholesaler tenant.
// Permission: incentive.read → WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM.
// purchasePrice is never exposed here (wholesaler-only view — no dealer DTO needed).

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import type { IncentiveStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface WholesalerIncentiveFilter {
  status?: IncentiveStatus;
  settledMonth?: string;
  page?: number;
}

export interface WholesalerIncentiveItem {
  id: string;
  contractId: string;
  relationshipId: string;
  dealerName: string;
  contractDate: string;
  settledMonth: string;
  targetProfit: string;
  rate: string;
  amount: string;
  status: IncentiveStatus;
  finalizedAt: string | null;
}

export interface WholesalerIncentiveListResult {
  items: WholesalerIncentiveItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listWholesalerIncentives(
  filter: WholesalerIncentiveFilter = {},
): Promise<WholesalerIncentiveListResult> {
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
    action: "incentive.read",
    resource: { wholesalerId: ctx.wholesalerId ?? undefined },
  });

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  return withTenant(ctx, async (tx) => {
    const where = {
      contract: { wholesalerId: ctx.wholesalerId! },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.settledMonth ? { settledMonth: filter.settledMonth } : {}),
    };

    const [rows, total] = await Promise.all([
      tx.incentive.findMany({
        where,
        orderBy: [{ settledMonth: "desc" }, { finalizedAt: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          contractId: true,
          relationshipId: true,
          targetProfit: true,
          rate: true,
          amount: true,
          status: true,
          settledMonth: true,
          finalizedAt: true,
          contract: { select: { contractDate: true } },
          relationship: { select: { dealer: { select: { name: true } } } },
        },
      }),
      tx.incentive.count({ where }),
    ]);

    const items: WholesalerIncentiveItem[] = rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      relationshipId: r.relationshipId,
      dealerName: r.relationship.dealer.name,
      contractDate: r.contract.contractDate.toISOString(),
      settledMonth: r.settledMonth,
      targetProfit: r.targetProfit.toString(),
      rate: r.rate.toString(),
      amount: r.amount.toString(),
      status: r.status,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
    }));

    return {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
  });
}

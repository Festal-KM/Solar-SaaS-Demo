// Server-side data loader for S-069 二次店 成績確認 (T-06-10 / F-051 / docs/04 §1.5).
//
// listDealerMonthlyPerformance — fetches MonthlyReport rows (scope=DEALER or JOINT)
//   whose relationshipId is in ctx.relationshipIds. Returns only fields relevant to
//   the dealer view; purchaseTotal and wholesaleProfit are never exposed to dealers
//   (CLAUDE.md rule #5). Data is aggregated JSON so we read the top-level
//   MonthlyReport columns plus selected aggregated keys.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface DealerMonthlyPerformanceFilter {
  targetMonth?: string;
}

export interface DealerMonthlyPerformanceItem {
  id: string;
  wholesalerId: string;
  relationshipId: string;
  targetMonth: string;
  scope: string;
  status: string;
  // Selected from aggregated JSON — purchaseTotal / wholesaleProfit excluded.
  contractCount: number | null;
  totalSales: string | null;
  totalIncentive: string | null;
  averageProfitRate: string | null;
  finalizedAt: string | null;
  updatedAt: string;
}

export interface DealerMonthlyPerformanceResult {
  items: DealerMonthlyPerformanceItem[];
}

export async function listDealerMonthlyPerformance(
  filter: DealerMonthlyPerformanceFilter = {},
): Promise<DealerMonthlyPerformanceResult> {
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
    action: "dealer_performance.read",
  });

  const relationshipIds = ctx.relationshipIds ?? [];
  if (relationshipIds.length === 0) {
    return { items: [] };
  }

  return withTenant(ctx, async (tx) => {
    const rows = await tx.monthlyReport.findMany({
      where: {
        relationshipId: { in: relationshipIds },
        scope: { in: ["DEALER", "JOINT"] },
        ...(filter.targetMonth ? { targetMonth: filter.targetMonth } : {}),
      },
      orderBy: [{ targetMonth: "desc" }, { scope: "asc" }],
      select: {
        id: true,
        wholesalerId: true,
        relationshipId: true,
        targetMonth: true,
        scope: true,
        status: true,
        aggregated: true,
        finalizedAt: true,
        updatedAt: true,
      },
    });

    const items: DealerMonthlyPerformanceItem[] = rows.map((r) => {
      const agg =
        r.aggregated && typeof r.aggregated === "object" && !Array.isArray(r.aggregated)
          ? (r.aggregated as Record<string, unknown>)
          : {};

      // purchaseTotal and wholesaleProfit are intentionally NOT extracted here
      // (docs/02 §F-051 受入基準 / CLAUDE.md rule #5).
      return {
        id: r.id,
        wholesalerId: r.wholesalerId,
        relationshipId: r.relationshipId ?? "",
        targetMonth: r.targetMonth,
        scope: r.scope,
        status: r.status,
        contractCount:
          typeof agg["contractCount"] === "number" ? agg["contractCount"] : null,
        totalSales:
          agg["totalSales"] != null ? String(agg["totalSales"]) : null,
        totalIncentive:
          agg["totalIncentive"] != null ? String(agg["totalIncentive"]) : null,
        averageProfitRate:
          agg["averageProfitRate"] != null ? String(agg["averageProfitRate"]) : null,
        finalizedAt: r.finalizedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    return { items };
  });
}

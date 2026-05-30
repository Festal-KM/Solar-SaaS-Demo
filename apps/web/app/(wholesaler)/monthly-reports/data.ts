// Server-side data loaders for S-048 月次報告一覧 (T-06-07 / F-048).
//
// listMonthlyReports — paginated list of MonthlyReport rows filtered by
//   targetMonth and scope. wholesalerId comes from ctx (never from input).
//
// listHistoryForScope — returns aggregated data for the last 6 months of a
//   given scope, used to feed the Recharts bar chart on S-049.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import type { MonthlyScope } from "@solar/db";

const VALID_SCOPES: MonthlyScope[] = ["ALL", "SELF", "DEALER", "JOINT"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonthlyReportListItem {
  id: string;
  targetMonth: string;
  scope: MonthlyScope;
  relationshipId: string | null;
  status: string;
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
  totalIncentive: number;
  updatedAt: string;
}

export interface MonthlyReportListFilter {
  targetMonth?: string;
  scope?: MonthlyScope;
}

export interface MonthlyReportListResult {
  items: MonthlyReportListItem[];
  targetMonth: string | null;
  scope: MonthlyScope | null;
}

// Shape of the aggregated JSON stored in MonthlyReport.aggregated (from
// packages/contracts/src/services/monthly-aggregate.ts MonthlyAggregated).
interface AggregatedJson {
  contractCount?: number;
  totalSales?: number;
  totalGrossProfit?: number;
  totalIncentive?: number;
  averageProfitRate?: number;
}

function extractAggregated(raw: unknown): AggregatedJson {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as AggregatedJson;
  }
  return {};
}

// ---------------------------------------------------------------------------
// listMonthlyReports
// ---------------------------------------------------------------------------

export async function listMonthlyReports(
  filter: MonthlyReportListFilter = {},
): Promise<MonthlyReportListResult> {
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
    action: "monthly_report.read",
  });

  const scopeFilter =
    filter.scope && VALID_SCOPES.includes(filter.scope) ? filter.scope : null;

  const monthFilter =
    filter.targetMonth && /^\d{4}-\d{2}$/.test(filter.targetMonth)
      ? filter.targetMonth
      : null;

  return withTenant(ctx, async (tx) => {
    const where = {
      wholesalerId: ctx.wholesalerId!,
      ...(monthFilter ? { targetMonth: monthFilter } : {}),
      ...(scopeFilter ? { scope: scopeFilter } : {}),
    };

    const rows = await tx.monthlyReport.findMany({
      where,
      orderBy: [{ targetMonth: "desc" }, { scope: "asc" }],
      select: {
        id: true,
        targetMonth: true,
        scope: true,
        relationshipId: true,
        status: true,
        aggregated: true,
        updatedAt: true,
      },
    });

    const items: MonthlyReportListItem[] = rows.map((r) => {
      const agg = extractAggregated(r.aggregated);
      return {
        id: r.id,
        targetMonth: r.targetMonth,
        scope: r.scope,
        relationshipId: r.relationshipId,
        status: r.status,
        contractCount: agg.contractCount ?? 0,
        totalSales: agg.totalSales ?? 0,
        totalGrossProfit: agg.totalGrossProfit ?? 0,
        totalIncentive: agg.totalIncentive ?? 0,
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    return {
      items,
      targetMonth: monthFilter,
      scope: scopeFilter,
    };
  });
}

// ---------------------------------------------------------------------------
// listHistoryForScope — last 6 months of a given scope for sparkline/bar chart
// ---------------------------------------------------------------------------

export interface MonthlyHistoryPoint {
  targetMonth: string;
  totalSales: number;
  totalGrossProfit: number;
  totalIncentive: number;
}

export async function listHistoryForScope(
  scope: MonthlyScope,
  relationshipId: string | null,
): Promise<MonthlyHistoryPoint[]> {
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
    action: "monthly_report.read",
  });

  return withTenant(ctx, async (tx) => {
    const rows = await tx.monthlyReport.findMany({
      where: {
        wholesalerId: ctx.wholesalerId!,
        scope,
        relationshipId,
      },
      orderBy: { targetMonth: "desc" },
      take: 6,
      select: {
        targetMonth: true,
        aggregated: true,
      },
    });

    return rows
      .map((r) => {
        const agg = extractAggregated(r.aggregated);
        return {
          targetMonth: r.targetMonth,
          totalSales: agg.totalSales ?? 0,
          totalGrossProfit: agg.totalGrossProfit ?? 0,
          totalIncentive: agg.totalIncentive ?? 0,
        };
      })
      .reverse(); // oldest first for the chart
  });
}

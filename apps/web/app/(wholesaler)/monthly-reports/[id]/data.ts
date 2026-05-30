// Server-side data loader for S-049 月次報告詳細 (T-06-07 / F-048).
//
// getMonthlyReportDetail — fetches a single MonthlyReport by ID, validates
//   wholesalerId ownership via ctx, and returns the aggregated JSON unpacked.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import type { MonthlyScope } from "@solar/db";

export interface MonthlyReportDetail {
  id: string;
  wholesalerId: string;
  targetMonth: string;
  scope: MonthlyScope;
  relationshipId: string | null;
  status: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  // Unpacked from aggregated JSON
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
  totalIncentive: number;
  averageProfitRate: number;
  // Raw JSON for any extra fields stored during aggregation
  aggregatedRaw: Record<string, unknown>;
  // Raw comments JSON (dealer + wholesaler comments)
  commentsRaw: Record<string, unknown> | null;
  updatedAt: string;
}

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

export async function getMonthlyReportDetail(
  id: string,
): Promise<MonthlyReportDetail | null> {
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
    const row = await tx.monthlyReport.findUnique({
      where: { id },
      select: {
        id: true,
        wholesalerId: true,
        targetMonth: true,
        scope: true,
        relationshipId: true,
        status: true,
        aggregated: true,
        comments: true,
        finalizedAt: true,
        finalizedBy: true,
        updatedAt: true,
      },
    });

    if (!row) return null;
    // Ensure the record belongs to the caller's wholesaler.
    if (ctx.wholesalerId && row.wholesalerId !== ctx.wholesalerId) return null;

    const agg = extractAggregated(row.aggregated);

    return {
      id: row.id,
      wholesalerId: row.wholesalerId,
      targetMonth: row.targetMonth,
      scope: row.scope,
      relationshipId: row.relationshipId,
      status: row.status,
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      finalizedBy: row.finalizedBy ?? null,
      contractCount: agg.contractCount ?? 0,
      totalSales: agg.totalSales ?? 0,
      totalGrossProfit: agg.totalGrossProfit ?? 0,
      totalIncentive: agg.totalIncentive ?? 0,
      averageProfitRate: agg.averageProfitRate ?? 0,
      aggregatedRaw: (row.aggregated && typeof row.aggregated === "object" && !Array.isArray(row.aggregated)
        ? (row.aggregated as Record<string, unknown>)
        : {}),
      commentsRaw: (row.comments && typeof row.comments === "object" && !Array.isArray(row.comments)
        ? (row.comments as Record<string, unknown>)
        : null),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

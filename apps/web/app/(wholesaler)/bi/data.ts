// Server-side data loader for the BI dashboard (S-051 / T-06-11 / F-056).
//
// getBiDashboardData aggregates Contract + GrossProfit rows for a wholesaler
// over the requested month range. It does NOT read MonthlyReport snapshots
// because those are only populated after the worker job runs; the BI view
// queries the source tables directly so it always reflects the current state.
//
// Filters:
//   fromMonth / toMonth — 'YYYY-MM' strings (inclusive)
//   scope               — SELF / DEALER / JOINT / ALL (null = ALL)
//   relationshipId      — restrict to one dealer relationship (null = all)
//
// Permission: bi.read → WHOLESALER_ADMIN, WHOLESALER_EVENT_TEAM,
//             WHOLESALER_DIRECT_SALES (docs/02 §F-056 / docs/04 §S-051).
// Dealer roles are blocked — they must not see cross-dealer aggregates.

import "server-only";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BiFilters {
  fromMonth: string; // 'YYYY-MM'
  toMonth: string;   // 'YYYY-MM'
  scope: "ALL" | "SELF" | "DEALER" | "JOINT";
  relationshipId: string | null;
}

export interface BiTimeSeriesPoint {
  targetMonth: string;
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
  /** Contracts started (non-cancelled) divided by appointments in the month. Null when denominator = 0. */
  conversionRate: number | null;
}

export interface BiDealerRankRow {
  relationshipId: string;
  dealerName: string;
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
}

export interface BiKpiSummary {
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
  averageProfitRate: number;
}

export interface BiRelationshipOption {
  relationshipId: string;
  dealerName: string;
}

export interface BiDashboardData {
  kpi: BiKpiSummary;
  timeSeries: BiTimeSeriesPoint[];
  dealerRanking: BiDealerRankRow[];
  relationshipOptions: BiRelationshipOption[];
}

// ---------------------------------------------------------------------------
// Raw SQL types (Prisma returns snake_case strings for Decimal/BigInt cols)
// ---------------------------------------------------------------------------

interface ContractSqlRow {
  target_month: string;
  relationship_id: string | null;
  contract_amount: string | number;
  project_profit: string | number | null;
  scope_label: string;
}

interface DealerNameRow {
  relationship_id: string;
  dealer_name: string;
}

// ---------------------------------------------------------------------------
// Auth / permission guard
// ---------------------------------------------------------------------------

async function requireBiCtx() {
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
    action: "bi.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  if (!ctx.wholesalerId) {
    throw new ForbiddenError("wholesalerId 未割当のユーザーは BI ダッシュボードを参照できません");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helper — coerce Prisma Decimal / BigInt to JS number
// ---------------------------------------------------------------------------

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "string" ? parseFloat(v) : Number(v);
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export async function getBiDashboardData(filters: BiFilters): Promise<BiDashboardData> {
  const ctx = await requireBiCtx();
  const wholesalerId = ctx.wholesalerId!;

  return withTenant(ctx, async (tx) => {
    // 1. Fetch relationship options for the filter dropdown.
    const relRows = await tx.$queryRaw<DealerNameRow[]>`
      SELECT r.id AS relationship_id,
             t.name AS dealer_name
      FROM relationships r
      JOIN tenants t ON t.id = r.dealer_id
      WHERE r.wholesaler_id = ${wholesalerId}
        AND r.status = 'ACTIVE'
      ORDER BY t.name
    `;

    const relationshipOptions: BiRelationshipOption[] = relRows.map((r) => ({
      relationshipId: r.relationship_id,
      dealerName: r.dealer_name,
    }));

    // 2. Build optional scope / relationship WHERE fragments.
    //    Prisma $queryRaw only supports tagged-template interpolation;
    //    we build the conditions in-memory on the result set instead of
    //    dynamic SQL to keep the query simple and injection-safe.

    // 3. Fetch contract + gross-profit rows for the requested period.
    const contractRows = await tx.$queryRaw<ContractSqlRow[]>`
      SELECT
        to_char(c.contract_date, 'YYYY-MM') AS target_month,
        c.owner_relationship_id             AS relationship_id,
        c.contract_amount,
        COALESCE(gp.project_profit, 0)      AS project_profit,
        CASE
          WHEN c.is_self_hosted              THEN 'SELF'
          WHEN c.event_mode_at_contract = 'JOINT' THEN 'JOINT'
          ELSE 'DEALER'
        END AS scope_label
      FROM contracts c
      LEFT JOIN gross_profits gp ON gp.contract_id = c.id
      WHERE c.wholesaler_id = ${wholesalerId}
        AND to_char(c.contract_date, 'YYYY-MM') >= ${filters.fromMonth}
        AND to_char(c.contract_date, 'YYYY-MM') <= ${filters.toMonth}
        AND c.status <> 'CANCELLED'
      ORDER BY target_month
    `;

    // 4. Apply scope / relationship filters in memory.
    const scopeFiltered = contractRows.filter((r) => {
      if (filters.scope !== "ALL" && r.scope_label !== filters.scope) return false;
      if (filters.relationshipId && r.relationship_id !== filters.relationshipId) return false;
      return true;
    });

    // 5. Aggregate KPI totals.
    let totalSales = 0;
    let totalGrossProfit = 0;
    for (const r of scopeFiltered) {
      totalSales += toNum(r.contract_amount);
      totalGrossProfit += toNum(r.project_profit);
    }
    const kpi: BiKpiSummary = {
      contractCount: scopeFiltered.length,
      totalSales,
      totalGrossProfit,
      averageProfitRate: totalSales > 0 ? totalGrossProfit / totalSales : 0,
    };

    // 6. Build time-series grouped by month.
    const monthMap = new Map<
      string,
      { contractCount: number; totalSales: number; totalGrossProfit: number }
    >();
    for (const r of scopeFiltered) {
      const m = r.target_month;
      const existing = monthMap.get(m) ?? { contractCount: 0, totalSales: 0, totalGrossProfit: 0 };
      existing.contractCount++;
      existing.totalSales += toNum(r.contract_amount);
      existing.totalGrossProfit += toNum(r.project_profit);
      monthMap.set(m, existing);
    }

    // Enumerate all months in range so gaps show as 0.
    const timeSeries: BiTimeSeriesPoint[] = [];
    const fromParts = filters.fromMonth.split("-");
    const toParts = filters.toMonth.split("-");
    let y = parseInt(fromParts[0] ?? "2026", 10);
    let m = parseInt(fromParts[1] ?? "01", 10);
    const toY = parseInt(toParts[0] ?? "2026", 10);
    const toM = parseInt(toParts[1] ?? "01", 10);
    while (y < toY || (y === toY && m <= toM)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const entry = monthMap.get(key) ?? { contractCount: 0, totalSales: 0, totalGrossProfit: 0 };
      timeSeries.push({
        targetMonth: key,
        contractCount: entry.contractCount,
        totalSales: entry.totalSales,
        totalGrossProfit: entry.totalGrossProfit,
        conversionRate: null, // appointments linkage not in scope for MVP
      });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }

    // 7. Dealer ranking — group by relationship, top 10 by contract count desc.
    const dealerMap = new Map<
      string,
      { contractCount: number; totalSales: number; totalGrossProfit: number }
    >();
    for (const r of scopeFiltered) {
      if (!r.relationship_id) continue;
      const existing = dealerMap.get(r.relationship_id) ?? {
        contractCount: 0,
        totalSales: 0,
        totalGrossProfit: 0,
      };
      existing.contractCount++;
      existing.totalSales += toNum(r.contract_amount);
      existing.totalGrossProfit += toNum(r.project_profit);
      dealerMap.set(r.relationship_id, existing);
    }

    const dealerNameMap = new Map(relRows.map((r) => [r.relationship_id, r.dealer_name]));

    const dealerRanking: BiDealerRankRow[] = [...dealerMap.entries()]
      .sort((a, b) => b[1].contractCount - a[1].contractCount)
      .slice(0, 10)
      .map(([relId, stats]) => ({
        relationshipId: relId,
        dealerName: dealerNameMap.get(relId) ?? relId,
        contractCount: stats.contractCount,
        totalSales: stats.totalSales,
        totalGrossProfit: stats.totalGrossProfit,
      }));

    return {
      kpi,
      timeSeries,
      dealerRanking,
      relationshipOptions,
    };
  });
}

// Prisma-backed monthly report aggregation — T-06-06 / F-048 / docs/05 §6.8.
//
// aggregateForMonth runs inside the caller's withTenant transaction.
// It issues raw SQL to aggregate Contract + GrossProfit + Incentive rows for
// wholesalerId × targetMonth, then creates/updates a MonthlyReport for each
// scope (SELF / DEALER / JOINT / ALL) × per-relationshipId.
//
// FINALIZED reports are skipped — the admin must unlock before re-aggregating.
//
// Note on nullable compound unique: Prisma's generated compound-unique input
// type for MonthlyReport requires `relationshipId: string` (non-null) when
// using the compound key. We therefore use findFirst + create/update instead
// of upsert when relationshipId may be null.

import type { TxClient } from "@solar/db";
import {
  aggregateMonthlyData,
  type MonthlyContractRow,
  type MonthlyIncentiveRow,
} from "@solar/contracts";

// ---------------------------------------------------------------------------
// Raw SQL row shapes (Prisma $queryRaw returns lowercase snake_case columns)
// ---------------------------------------------------------------------------

interface ContractSqlRow {
  id: string;
  contract_amount: string | number;
  project_profit: string | number | null;
  scope: "SELF" | "DEALER" | "JOINT";
  relationship_id: string | null;
}

interface IncentiveSqlRow {
  relationship_id: string;
  amount: string | number;
  scope: "SELF" | "DEALER" | "JOINT";
}

// ---------------------------------------------------------------------------
// Public return type
// ---------------------------------------------------------------------------

export interface UpsertedReport {
  id: string;
  wholesalerId: string;
  targetMonth: string;
  scope: string;
  relationshipId: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// aggregateForMonth
// ---------------------------------------------------------------------------

/**
 * Aggregate Contract + Incentive data for `wholesalerId` × `targetMonth`
 * and create/update MonthlyReport rows.
 *
 * Scopes produced:
 *   SELF   — wholesaler-only events (isSelfHosted=true), no per-relationship split
 *   DEALER — dealer-only events per relationship
 *   JOINT  — joint events per relationship
 *   ALL    — entire wholesaler (union of all scopes, no per-relationship split)
 *
 * FINALIZED reports are NOT overwritten.
 */
export async function aggregateForMonth(
  tx: TxClient,
  wholesalerId: string,
  targetMonth: string,
): Promise<UpsertedReport[]> {
  const toNum = (v: string | number | null): number =>
    v === null ? 0 : typeof v === "string" ? parseFloat(v) : v;

  // 1. Contract rows with scope classification (docs/05 §6.8 SQL skeleton).
  const contractRows = await tx.$queryRaw<ContractSqlRow[]>`
    SELECT
      c.id,
      c.contract_amount,
      c.owner_relationship_id AS relationship_id,
      COALESCE(gp.project_profit, 0) AS project_profit,
      (CASE
        WHEN c.is_self_hosted THEN 'SELF'
        WHEN c.event_mode_at_contract = 'JOINT' THEN 'JOINT'
        ELSE 'DEALER'
      END)::text AS scope
    FROM contracts c
    LEFT JOIN gross_profits gp ON gp.contract_id = c.id
    WHERE c.wholesaler_id = ${wholesalerId}
      AND to_char(c.contract_date, 'YYYY-MM') = ${targetMonth}
      AND c.status <> 'CANCELLED'
  `;

  // 2. Incentive rows (non-cancelled, include DRAFT for JOINT pending adjustment).
  const incentiveRows = await tx.$queryRaw<IncentiveSqlRow[]>`
    SELECT
      i.relationship_id,
      i.amount,
      (CASE
        WHEN c.is_self_hosted THEN 'SELF'
        WHEN c.event_mode_at_contract = 'JOINT' THEN 'JOINT'
        ELSE 'DEALER'
      END)::text AS scope
    FROM incentives i
    JOIN contracts c ON c.id = i.contract_id
    WHERE c.wholesaler_id = ${wholesalerId}
      AND i.settled_month = ${targetMonth}
      AND i.status NOT IN ('CANCELLED')
  `;

  // 3. Typed in-memory arrays.
  const contracts = contractRows.map((r) => ({
    contractAmount: toNum(r.contract_amount),
    projectProfit: toNum(r.project_profit),
    scope: r.scope,
    relationshipId: r.relationship_id ?? null,
  }));

  const incentives = incentiveRows.map((r) => ({
    amount: toNum(r.amount),
    scope: r.scope,
    relationshipId: r.relationship_id,
  }));

  const results: UpsertedReport[] = [];

  // Helper: findFirst + create/update (avoids Prisma nullable compound-unique issue).
  const upsert = async (
    scope: "SELF" | "DEALER" | "JOINT" | "ALL",
    relationshipId: string | null,
    cSlice: MonthlyContractRow[],
    iSlice: MonthlyIncentiveRow[],
  ) => {
    const existing = await tx.monthlyReport.findFirst({
      where: { wholesalerId, targetMonth, scope, relationshipId },
      select: { id: true, status: true },
    });

    if (existing?.status === "FINALIZED") {
      results.push({
        id: existing.id,
        wholesalerId,
        targetMonth,
        scope,
        relationshipId,
        status: "FINALIZED",
      });
      return;
    }

    const aggregated = aggregateMonthlyData(cSlice, iSlice);

    if (existing) {
      const updated = await tx.monthlyReport.update({
        where: { id: existing.id },
        data: { aggregated: aggregated as object },
        select: {
          id: true,
          wholesalerId: true,
          targetMonth: true,
          scope: true,
          relationshipId: true,
          status: true,
        },
      });
      results.push({
        id: updated.id,
        wholesalerId: updated.wholesalerId,
        targetMonth: updated.targetMonth,
        scope: updated.scope,
        relationshipId: updated.relationshipId,
        status: updated.status,
      });
    } else {
      const created = await tx.monthlyReport.create({
        data: {
          wholesalerId,
          targetMonth,
          scope,
          relationshipId,
          aggregated: aggregated as object,
          status: "DRAFT",
        },
        select: {
          id: true,
          wholesalerId: true,
          targetMonth: true,
          scope: true,
          relationshipId: true,
          status: true,
        },
      });
      results.push({
        id: created.id,
        wholesalerId: created.wholesalerId,
        targetMonth: created.targetMonth,
        scope: created.scope,
        relationshipId: created.relationshipId,
        status: created.status,
      });
    }
  };

  // 4. SELF scope — one record for the wholesaler (no per-relationship split).
  const selfC = contracts.filter((c) => c.scope === "SELF");
  const selfI = incentives.filter((i) => i.scope === "SELF");
  await upsert("SELF", null, selfC, selfI);

  // 5. DEALER scope — one record per distinct relationship.
  const dealerRelIds = [
    ...new Set(
      contracts
        .filter((c) => c.scope === "DEALER" && c.relationshipId)
        .map((c) => c.relationshipId as string),
    ),
  ];
  for (const relId of dealerRelIds) {
    const dc = contracts.filter((c) => c.scope === "DEALER" && c.relationshipId === relId);
    const di = incentives.filter((i) => i.scope === "DEALER" && i.relationshipId === relId);
    await upsert("DEALER", relId, dc, di);
  }

  // 6. JOINT scope — one record per distinct relationship.
  const jointRelIds = [
    ...new Set(
      contracts
        .filter((c) => c.scope === "JOINT" && c.relationshipId)
        .map((c) => c.relationshipId as string),
    ),
  ];
  for (const relId of jointRelIds) {
    const jc = contracts.filter((c) => c.scope === "JOINT" && c.relationshipId === relId);
    const ji = incentives.filter((i) => i.scope === "JOINT" && i.relationshipId === relId);
    await upsert("JOINT", relId, jc, ji);
  }

  // 7. ALL scope — entire wholesaler, no relationship split.
  await upsert("ALL", null, contracts, incentives);

  return results;
}

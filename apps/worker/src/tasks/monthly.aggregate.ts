// graphile-worker task: monthly.aggregate (T-06-06 / F-048 / docs/05 §5.2 §6.8).
//
// Aggregates Contract + Incentive data for a given wholesaler × month and
// UPSERTs MonthlyReport rows (SELF / DEALER / JOINT / ALL × per-relationship).
//
// Payload validation: monthlyAggregatePayloadSchema from @solar/contracts.
// max_attempts: 3   retry: 1m → 5m → 30m (graphile-worker default backoff).
// Idempotency: jobKey = `monthly.aggregate:{wholesalerId}:{targetMonth}`.
//
// FINALIZED reports are skipped — the admin must unlock before re-aggregating.
//
// Note on nullable compound unique: Prisma's generated compound-unique input
// type for MonthlyReport requires `relationshipId: string` (non-null) when
// using the compound key. We therefore use findFirst + create/update instead
// of upsert when relationshipId may be null.

import {
  monthlyAggregatePayloadSchema,
  aggregateMonthlyData,
  type MonthlyAggregatePayload,
  type MonthlyContractRow,
  type MonthlyIncentiveRow,
} from "@solar/contracts";
import { withTenant, SYSTEM_TENANT_CONTEXT } from "@solar/db";

import type { Task } from "graphile-worker";
import type { TxClient } from "@solar/db";

// ---------------------------------------------------------------------------
// Raw SQL row shapes
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

export interface AggregatedReport {
  id: string;
  scope: string;
  relationshipId: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Core aggregation logic
// ---------------------------------------------------------------------------

async function runAggregate(
  tx: TxClient,
  wholesalerId: string,
  targetMonth: string,
): Promise<AggregatedReport[]> {
  const toNum = (v: string | number | null): number =>
    v === null ? 0 : typeof v === "string" ? parseFloat(v) : v;

  // 1. Contract rows with scope classification.
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

  // 2. Incentive rows (non-cancelled).
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

  // 3. Typed arrays.
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

  const results: AggregatedReport[] = [];

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
      results.push({ id: existing.id, scope, relationshipId, status: "FINALIZED" });
      return;
    }

    const aggregated = aggregateMonthlyData(cSlice, iSlice);

    if (existing) {
      const updated = await tx.monthlyReport.update({
        where: { id: existing.id },
        data: { aggregated: aggregated as object },
        select: { id: true, scope: true, relationshipId: true, status: true },
      });
      results.push({
        id: updated.id,
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
        select: { id: true, scope: true, relationshipId: true, status: true },
      });
      results.push({
        id: created.id,
        scope: created.scope,
        relationshipId: created.relationshipId,
        status: created.status,
      });
    }
  };

  // 4. SELF scope.
  const selfC = contracts.filter((c) => c.scope === "SELF");
  const selfI = incentives.filter((i) => i.scope === "SELF");
  await upsert("SELF", null, selfC, selfI);

  // 5. DEALER — one per distinct relationship.
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

  // 6. JOINT — one per distinct relationship.
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

  // 7. ALL — entire wholesaler.
  await upsert("ALL", null, contracts, incentives);

  return results;
}

// ---------------------------------------------------------------------------
// Task entry point
// ---------------------------------------------------------------------------

export const monthlyAggregateTask: Task = async (rawPayload, helpers) => {
  const payload: MonthlyAggregatePayload = monthlyAggregatePayloadSchema.parse(rawPayload);
  const { wholesalerId, targetMonth } = payload;
  const start = Date.now();

  helpers.logger.info(
    `monthly.aggregate: start wholesalerId=${wholesalerId} targetMonth=${targetMonth} jobId=${helpers.job.id}`,
  );

  const reports = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    return runAggregate(tx, wholesalerId, targetMonth);
  });

  const skipped = reports.filter((r) => r.status === "FINALIZED").length;

  helpers.logger.info(
    `monthly.aggregate: ok wholesalerId=${wholesalerId} targetMonth=${targetMonth} total=${reports.length} skippedFinalized=${skipped} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
  );
};

export default monthlyAggregateTask;

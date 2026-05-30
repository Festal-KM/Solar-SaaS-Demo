// Pure aggregation helper for monthly reporting — no DB / framework dependencies.
//
// docs/05 §6.8 / F-048. Called by aggregateForMonth (apps/web/lib/domain/monthly-report.ts)
// after raw SQL returns the per-scope contract and incentive rows.

export interface MonthlyContractRow {
  contractAmount: number;
  projectProfit: number;
  scope: "SELF" | "DEALER" | "JOINT";
}

export interface MonthlyIncentiveRow {
  amount: number;
  scope: "SELF" | "DEALER" | "JOINT";
}

export interface MonthlyAggregated {
  contractCount: number;
  totalSales: number;
  totalGrossProfit: number;
  totalIncentive: number;
  averageProfitRate: number;
}

/**
 * Compute aggregated figures from a slice of Contract and Incentive rows.
 *
 * Both arrays are pre-filtered to the target month / scope by the caller
 * (the raw SQL query). This function is intentionally scope-agnostic:
 * callers pass ALL rows for ALL scope when computing the ALL aggregate
 * and the matching slice when computing SELF / DEALER / JOINT.
 *
 * averageProfitRate = totalGrossProfit / totalSales (0 when totalSales ≤ 0).
 */
export function aggregateMonthlyData(
  contracts: MonthlyContractRow[],
  incentives: MonthlyIncentiveRow[],
): MonthlyAggregated {
  let totalSales = 0;
  let totalGrossProfit = 0;

  for (const c of contracts) {
    totalSales += c.contractAmount;
    totalGrossProfit += c.projectProfit;
  }

  let totalIncentive = 0;
  for (const i of incentives) {
    totalIncentive += i.amount;
  }

  const contractCount = contracts.length;
  const averageProfitRate = totalSales > 0 ? totalGrossProfit / totalSales : 0;

  return {
    contractCount,
    totalSales,
    totalGrossProfit,
    totalIncentive,
    averageProfitRate,
  };
}

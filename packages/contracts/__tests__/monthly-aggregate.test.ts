// Pure-function tests for aggregateMonthlyData (T-06-06 / F-048 / docs/05 §6.8).
//
// Six cases:
//   1. Normal aggregation — contractCount, totalSales, totalGrossProfit, totalIncentive
//   2. Empty data → all zero values
//   3. averageProfitRate = totalGrossProfit / totalSales
//   4. averageProfitRate = 0 when totalSales = 0
//   5. Multiple scopes summed correctly in ALL scope
//   6. Incentives included regardless of scope label

import { describe, expect, it } from "vitest";

import {
  aggregateMonthlyData,
  type MonthlyContractRow,
  type MonthlyIncentiveRow,
} from "../src/services/monthly-aggregate.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function contract(
  contractAmount: number,
  projectProfit: number,
  scope: "SELF" | "DEALER" | "JOINT" = "DEALER",
): MonthlyContractRow {
  return { contractAmount, projectProfit, scope };
}

function incentive(amount: number, scope: "SELF" | "DEALER" | "JOINT" = "DEALER"): MonthlyIncentiveRow {
  return { amount, scope };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("aggregateMonthlyData", () => {
  it("1. normal aggregation — produces correct contractCount, totalSales, totalGrossProfit, totalIncentive", () => {
    const contracts: MonthlyContractRow[] = [
      contract(1_000_000, 200_000, "DEALER"),
      contract(800_000, 150_000, "DEALER"),
      contract(500_000, 80_000, "SELF"),
    ];
    const incentives: MonthlyIncentiveRow[] = [
      incentive(20_000, "DEALER"),
      incentive(15_000, "DEALER"),
    ];

    const result = aggregateMonthlyData(contracts, incentives);

    expect(result.contractCount).toBe(3);
    expect(result.totalSales).toBe(2_300_000);
    expect(result.totalGrossProfit).toBe(430_000);
    expect(result.totalIncentive).toBe(35_000);
    expect(result.averageProfitRate).toBeCloseTo(430_000 / 2_300_000, 10);
  });

  it("2. empty data → all zero values", () => {
    const result = aggregateMonthlyData([], []);

    expect(result.contractCount).toBe(0);
    expect(result.totalSales).toBe(0);
    expect(result.totalGrossProfit).toBe(0);
    expect(result.totalIncentive).toBe(0);
    expect(result.averageProfitRate).toBe(0);
  });

  it("3. averageProfitRate = totalGrossProfit / totalSales", () => {
    const contracts: MonthlyContractRow[] = [
      contract(500_000, 100_000),
      contract(500_000, 100_000),
    ];

    const result = aggregateMonthlyData(contracts, []);

    expect(result.totalSales).toBe(1_000_000);
    expect(result.totalGrossProfit).toBe(200_000);
    expect(result.averageProfitRate).toBeCloseTo(0.2, 10);
  });

  it("4. averageProfitRate = 0 when totalSales = 0", () => {
    // Zero-amount contracts (edge case: data with 0 sales price).
    const contracts: MonthlyContractRow[] = [contract(0, 0)];

    const result = aggregateMonthlyData(contracts, []);

    expect(result.totalSales).toBe(0);
    expect(result.averageProfitRate).toBe(0);
  });

  it("5. ALL-scope aggregation sums across SELF + DEALER + JOINT rows", () => {
    const contracts: MonthlyContractRow[] = [
      contract(1_000_000, 100_000, "SELF"),
      contract(2_000_000, 300_000, "DEALER"),
      contract(500_000, 50_000, "JOINT"),
    ];
    const incentives: MonthlyIncentiveRow[] = [
      incentive(30_000, "DEALER"),
      incentive(5_000, "JOINT"),
    ];

    const result = aggregateMonthlyData(contracts, incentives);

    expect(result.contractCount).toBe(3);
    expect(result.totalSales).toBe(3_500_000);
    expect(result.totalGrossProfit).toBe(450_000);
    expect(result.totalIncentive).toBe(35_000);
  });

  it("6. incentives summed independently from contracts", () => {
    const incentives: MonthlyIncentiveRow[] = [
      incentive(10_000),
      incentive(20_000),
      incentive(30_000),
    ];

    const result = aggregateMonthlyData([], incentives);

    expect(result.contractCount).toBe(0);
    expect(result.totalIncentive).toBe(60_000);
    expect(result.totalSales).toBe(0);
  });
});

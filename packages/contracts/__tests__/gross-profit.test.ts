// Pure-function tests for gross-profit calculation (T-05-08 / F-042 / docs/05 §6.1).
//
// Five cases:
//   1. Normal calculation — all fields produce correct values
//   2. constructionFee and otherCost reduce projectProfit (not wholesaleProfit)
//   3. incentiveTargetType PROJECT_PROFIT vs WHOLESALE_PROFIT
//   4. MANUAL incentiveTargetType uses manualValue directly
//   5. computeIncentiveAmount — isSelfHosted and isCancelled return 0

import { describe, expect, it } from "vitest";

import {
  computeGrossProfit,
  computeIncentiveAmount,
  type GrossProfitInput,
} from "../src/services/gross-profit.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeItem(purchase: number, dealer: number, list: number, qty = 1) {
  return {
    snapshotPurchasePrice: purchase,
    snapshotDealerPrice: dealer,
    snapshotListPrice: list,
    qty,
  };
}

// ---------------------------------------------------------------------------
// Case 1: Normal calculation — all fields produce correct values
// ---------------------------------------------------------------------------

describe("computeGrossProfit", () => {
  it("1. normal calculation — all output fields are correct", () => {
    // 2 items: 1 panel and 1 battery
    const input: GrossProfitInput = {
      items: [
        makeItem(80_000, 90_000, 100_000, 2), // purchase=160k dealer=180k list=200k
        makeItem(200_000, 250_000, 300_000, 1), // purchase=200k dealer=250k list=300k
      ],
      salesPrice: 500_000,
      constructionFee: 0,
      otherCost: 0,
      discount: 0,
      incentiveTargetType: "PROJECT_PROFIT",
    };

    const result = computeGrossProfit(input);

    expect(result.purchaseTotal).toBe(360_000); // 160k + 200k
    expect(result.dealerTotal).toBe(430_000); // 180k + 250k
    // projectProfit = salesPrice - purchaseTotal - constructionFee - otherCost - discount
    //               = 500k - 360k - 0 - 0 - 0 = 140k
    expect(result.projectProfit).toBe(140_000);
    // wholesaleProfit = dealerTotal - purchaseTotal = 430k - 360k = 70k
    expect(result.wholesaleProfit).toBe(70_000);
    // profitRate = projectProfit / salesPrice = 140k / 500k = 0.28
    expect(result.profitRate).toBeCloseTo(0.28, 10);
    // PROJECT_PROFIT → incentiveTargetProfit = projectProfit = 140k
    expect(result.incentiveTargetProfit).toBe(140_000);
  });

  // ---------------------------------------------------------------------------
  // Case 2: constructionFee and otherCost reduce projectProfit (not wholesaleProfit)
  // ---------------------------------------------------------------------------

  it("2. constructionFee and otherCost reduce projectProfit (not wholesaleProfit)", () => {
    const input: GrossProfitInput = {
      items: [makeItem(80_000, 100_000, 150_000, 1)],
      salesPrice: 150_000,
      constructionFee: 10_000,
      otherCost: 5_000,
      discount: 0,
      incentiveTargetType: "WHOLESALE_PROFIT",
    };

    const result = computeGrossProfit(input);

    expect(result.purchaseTotal).toBe(80_000);
    expect(result.dealerTotal).toBe(100_000);
    // projectProfit = 150k - 80k - 10k - 5k - 0 = 55k
    expect(result.projectProfit).toBe(55_000);
    // wholesaleProfit = dealerTotal - purchaseTotal = 100k - 80k = 20k
    expect(result.wholesaleProfit).toBe(20_000);
    // profitRate = projectProfit / salesPrice = 55k / 150k
    expect(result.profitRate).toBeCloseTo(55_000 / 150_000, 10);
    // WHOLESALE_PROFIT → incentiveTargetProfit = wholesaleProfit = 20k
    expect(result.incentiveTargetProfit).toBe(20_000);
  });

  // ---------------------------------------------------------------------------
  // Case 3: incentiveTargetType PROJECT_PROFIT vs WHOLESALE_PROFIT
  // ---------------------------------------------------------------------------

  it("3. PROJECT_PROFIT vs WHOLESALE_PROFIT produce different incentiveTargetProfit", () => {
    const base: Omit<GrossProfitInput, "incentiveTargetType"> = {
      items: [makeItem(60_000, 80_000, 120_000, 1)],
      salesPrice: 120_000,
      constructionFee: 15_000,
      otherCost: 0,
      discount: 0,
    };

    const projectResult = computeGrossProfit({ ...base, incentiveTargetType: "PROJECT_PROFIT" });
    const wholesaleResult = computeGrossProfit({ ...base, incentiveTargetType: "WHOLESALE_PROFIT" });

    // projectProfit  = 120k - 60k - 15k - 0 - 0 = 45k
    expect(projectResult.incentiveTargetProfit).toBe(45_000);
    // wholesaleProfit = dealerTotal - purchaseTotal = 80k - 60k = 20k
    expect(wholesaleResult.incentiveTargetProfit).toBe(20_000);
  });

  // ---------------------------------------------------------------------------
  // Case 4: MANUAL incentiveTargetType uses manualValue directly
  // ---------------------------------------------------------------------------

  it("4. MANUAL type uses manualValue regardless of computed profits", () => {
    const input: GrossProfitInput = {
      items: [makeItem(100_000, 150_000, 200_000, 1)],
      salesPrice: 200_000,
      constructionFee: 0,
      otherCost: 0,
      discount: 0,
      incentiveTargetType: "MANUAL",
      manualValue: 30_000,
    };

    const result = computeGrossProfit(input);
    expect(result.incentiveTargetProfit).toBe(30_000);
    // Other fields are still computed normally
    // projectProfit = 200k - 100k - 0 - 0 - 0 = 100k
    expect(result.projectProfit).toBe(100_000);
    // wholesaleProfit = dealerTotal - purchaseTotal = 150k - 100k = 50k
    expect(result.wholesaleProfit).toBe(50_000);
  });

  it("4b. MANUAL with no manualValue defaults to 0", () => {
    const input: GrossProfitInput = {
      items: [makeItem(100_000, 150_000, 200_000, 1)],
      salesPrice: 200_000,
      constructionFee: 0,
      otherCost: 0,
      discount: 0,
      incentiveTargetType: "MANUAL",
    };

    const result = computeGrossProfit(input);
    expect(result.incentiveTargetProfit).toBe(0);
  });

  it("5. negative projectProfit is floored to 0 for PROJECT_PROFIT target", () => {
    // discount is huge, making projectProfit negative
    const input: GrossProfitInput = {
      items: [makeItem(50_000, 80_000, 100_000, 1)],
      salesPrice: 100_000,
      constructionFee: 0,
      otherCost: 0,
      discount: 90_000, // projectProfit = 100k - 50k - 0 - 0 - 90k = -40k
      incentiveTargetType: "PROJECT_PROFIT",
    };

    const result = computeGrossProfit(input);
    expect(result.projectProfit).toBe(-40_000); // raw value preserved
    expect(result.incentiveTargetProfit).toBe(0); // floored
  });

  it("6. profitRate is 0 when salesPrice is 0", () => {
    const input: GrossProfitInput = {
      items: [makeItem(10_000, 15_000, 20_000, 1)],
      salesPrice: 0,
      constructionFee: 0,
      otherCost: 0,
      discount: 0,
      incentiveTargetType: "PROJECT_PROFIT",
    };

    const result = computeGrossProfit(input);
    expect(result.profitRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeIncentiveAmount
// ---------------------------------------------------------------------------

describe("computeIncentiveAmount", () => {
  it("normal — rate × targetProfit", () => {
    const amount = computeIncentiveAmount({
      incentiveTargetProfit: 100_000,
      rate: 10,
      isSelfHosted: false,
      isCancelled: false,
    });
    expect(amount).toBe(10_000);
  });

  it("isSelfHosted → 0", () => {
    const amount = computeIncentiveAmount({
      incentiveTargetProfit: 100_000,
      rate: 10,
      isSelfHosted: true,
      isCancelled: false,
    });
    expect(amount).toBe(0);
  });

  it("isCancelled → 0", () => {
    const amount = computeIncentiveAmount({
      incentiveTargetProfit: 100_000,
      rate: 10,
      isSelfHosted: false,
      isCancelled: true,
    });
    expect(amount).toBe(0);
  });

  it("negative targetProfit floored to 0", () => {
    const amount = computeIncentiveAmount({
      incentiveTargetProfit: -5_000,
      rate: 10,
      isSelfHosted: false,
      isCancelled: false,
    });
    expect(amount).toBe(0);
  });
});

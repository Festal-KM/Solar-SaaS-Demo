// Pure-function tests for contract snapshot helpers (T-05-05).
//
// Five cases:
//   1. snapshotItems: prices from the effective row at contractDate are captured
//   2. snapshotItems: a price revision after contractDate does NOT affect the snapshot
//   3. snapshotIncentiveRate: the row effective at contractDate is returned
//   4. snapshotIncentiveRate: no row before contractDate → throws
//   5. computeCancelDeadline: contractDate + 8 days is returned

import { describe, expect, it } from "vitest";

import {
  computeCancelDeadline,
  snapshotIncentiveRate,
  snapshotItems,
  type SnapshotItemInput,
  type SnapshotProductRow,
} from "../src/services/contract-snapshot.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function product(
  productId: string,
  from: string,
  to: string | null,
  purchasePrice: string,
  dealerPrice: string,
  listPrice: string,
): SnapshotProductRow {
  return {
    productId,
    effectiveFrom: new Date(from),
    effectiveTo: to !== null ? new Date(to) : null,
    isActive: true,
    productName: `商品 ${productId}`,
    maker: "テストメーカー",
    modelNo: null,
    unit: "枚",
    purchasePrice,
    dealerPrice,
    listPrice,
  };
}

// ---------------------------------------------------------------------------
// 1. snapshotItems — prices from the effective row at contractDate are captured
// ---------------------------------------------------------------------------

describe("snapshotItems", () => {
  it("captures prices from the product row effective at contractDate", () => {
    const contractDate = new Date("2026-05-15T00:00:00Z");

    const products: SnapshotProductRow[] = [
      // version 1: effective Jan–Apr
      product("p1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z", "80000", "90000", "100000"),
      // version 2: effective Apr–Jul  ← this is the one that should be snapshotted
      product("p1", "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z", "85000", "95000", "110000"),
      // version 3: effective Jul onwards (future)
      product("p1", "2026-07-01T00:00:00Z", null, "90000", "100000", "120000"),
    ];

    const items: SnapshotItemInput[] = [{ productId: "p1", qty: 2 }];

    const result = snapshotItems(items, contractDate, products);

    expect(result).toHaveLength(1);
    expect(result[0]!.snapshotPurchasePrice).toBe("85000");
    expect(result[0]!.snapshotDealerPrice).toBe("95000");
    expect(result[0]!.snapshotListPrice).toBe("110000");
    // subtotal = 2 × 110000 = 220000
    expect(result[0]!.subtotal).toBe("220000.00");
    expect(result[0]!.qty).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 2. snapshotItems — post-contractDate price revision does not affect snapshot
  // -------------------------------------------------------------------------

  it("is unaffected by price revisions applied after contractDate", () => {
    const contractDate = new Date("2026-03-01T00:00:00Z");

    const products: SnapshotProductRow[] = [
      // Only row effective at contractDate
      product("p2", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", "50000", "60000", "70000"),
    ];

    const items: SnapshotItemInput[] = [{ productId: "p2", qty: 3 }];
    const result = snapshotItems(items, contractDate, products);

    // Simulate: master is later revised with different prices
    // (revision row not added to the products array — replicates DB state at
    //  snapshot time; the function must return the original prices regardless)
    expect(result[0]!.snapshotListPrice).toBe("70000");
    expect(result[0]!.subtotal).toBe("210000.00");

    // Now call again with a future-revision product list (as if re-called after
    // a master change) — the snapshot function should still pick the row
    // effective at the original contractDate, not the future row.
    const productsAfterRevision: SnapshotProductRow[] = [
      product("p2", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", "50000", "60000", "70000"),
      // New row effective Jun 2026 — post contractDate, must NOT be used
      product("p2", "2026-06-01T00:00:00Z", null, "55000", "65000", "80000"),
    ];

    const result2 = snapshotItems(items, contractDate, productsAfterRevision);
    expect(result2[0]!.snapshotListPrice).toBe("70000");
    expect(result2[0]!.snapshotPurchasePrice).toBe("50000");
  });
});

// ---------------------------------------------------------------------------
// 3. snapshotIncentiveRate — effective row is returned
// ---------------------------------------------------------------------------

describe("snapshotIncentiveRate", () => {
  it("returns the rate row effective at contractDate", () => {
    const contractDate = new Date("2026-05-15T00:00:00Z");

    const rates = [
      {
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: new Date("2026-04-01T00:00:00Z"),
        rate: "10.00",
        targetType: "PROJECT_PROFIT" as const,
      },
      {
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
        effectiveTo: null,
        rate: "12.50",
        targetType: "WHOLESALE_PROFIT" as const,
      },
    ];

    const result = snapshotIncentiveRate(contractDate, rates);

    expect(result.rate).toBe("12.50");
    expect(result.targetType).toBe("WHOLESALE_PROFIT");
  });

  // -------------------------------------------------------------------------
  // 4. snapshotIncentiveRate — no row before contractDate → throws
  // -------------------------------------------------------------------------

  it("throws when no rate row is effective at contractDate", () => {
    const contractDate = new Date("2026-01-01T00:00:00Z");

    const rates = [
      {
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
        effectiveTo: null,
        rate: "15.00",
        targetType: "PROJECT_PROFIT" as const,
      },
    ];

    expect(() => snapshotIncentiveRate(contractDate, rates)).toThrow(
      "契約日時点で有効なインセンティブ率が見つかりません",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. computeCancelDeadline — contractDate + 8 days
// ---------------------------------------------------------------------------

describe("computeCancelDeadline", () => {
  it("returns contractDate + 8 calendar days when called with default", () => {
    const contractDate = new Date("2026-05-15T00:00:00Z");
    const deadline = computeCancelDeadline(contractDate);
    expect(deadline).toEqual(new Date("2026-05-23T00:00:00Z"));
  });

  it("respects a custom cancelDeadlineDays value", () => {
    const contractDate = new Date("2026-01-28T00:00:00Z");
    // 5-day window, crossing month boundary
    const deadline = computeCancelDeadline(contractDate, 5);
    expect(deadline).toEqual(new Date("2026-02-02T00:00:00Z"));
  });

  it("does not mutate the contractDate argument", () => {
    const contractDate = new Date("2026-05-15T00:00:00Z");
    const original = contractDate.getTime();
    computeCancelDeadline(contractDate);
    expect(contractDate.getTime()).toBe(original);
  });
});

// Vitest — 損益タブ 契約別コスト明細の計算純関数（docs/05 §20.2）.
//   粗利 = 売上 − 施工代 − 場所代 / 手数料 = 粗利 × 手数料率（%）.

import { describe, expect, it } from "vitest";

import {
  computeContractCommission,
  computeContractGrossProfit,
} from "../src/dto/project-info.js";
import {
  ContractCommissionRateSchema,
  ContractCostUpsertSchema,
} from "../src/schemas/customer.js";

describe("computeContractGrossProfit", () => {
  it("売上 − 施工代 − 場所代", () => {
    expect(computeContractGrossProfit(1_000_000, 300_000, 50_000)).toBe(650_000);
  });

  it("コストが 0 なら売上と一致", () => {
    expect(computeContractGrossProfit(800_000, 0, 0)).toBe(800_000);
  });

  it("コストが売上を超えると負値", () => {
    expect(computeContractGrossProfit(100_000, 80_000, 40_000)).toBe(-20_000);
  });
});

describe("computeContractCommission", () => {
  it("粗利 × 率(%)（10% → 0.10）", () => {
    expect(computeContractCommission(650_000, 10)).toBe(65_000);
  });

  it("率 null は 0", () => {
    expect(computeContractCommission(650_000, null)).toBe(0);
  });

  it("率 0 は 0", () => {
    expect(computeContractCommission(650_000, 0)).toBe(0);
  });

  it("円未満は四捨五入", () => {
    // 12345 * 7.5% = 925.875 → 926
    expect(computeContractCommission(12_345, 7.5)).toBe(926);
  });

  it("負の粗利にも比例", () => {
    expect(computeContractCommission(-20_000, 10)).toBe(-2_000);
  });
});

describe("ContractCostUpsertSchema", () => {
  it("正常系（施工代・施工参照あり）", () => {
    const r = ContractCostUpsertSchema.safeParse({
      customerId: "c1",
      contractId: "k1",
      category: "CONSTRUCTION_FEE",
      amount: 300000,
      constructionId: "con1",
    });
    expect(r.success).toBe(true);
  });

  it("金額は負値不可", () => {
    const r = ContractCostUpsertSchema.safeParse({
      customerId: "c1",
      contractId: "k1",
      category: "VENUE_FEE",
      amount: -1,
    });
    expect(r.success).toBe(false);
  });

  it("未知カテゴリ拒否", () => {
    const r = ContractCostUpsertSchema.safeParse({
      customerId: "c1",
      contractId: "k1",
      category: "OTHER",
      amount: 100,
    });
    expect(r.success).toBe(false);
  });
});

describe("ContractCommissionRateSchema", () => {
  it("0..100 を受理、null 可", () => {
    expect(ContractCommissionRateSchema.safeParse({ customerId: "c", contractId: "k", ratePercent: 10 }).success).toBe(true);
    expect(ContractCommissionRateSchema.safeParse({ customerId: "c", contractId: "k", ratePercent: null }).success).toBe(true);
  });

  it("範囲外拒否", () => {
    expect(ContractCommissionRateSchema.safeParse({ customerId: "c", contractId: "k", ratePercent: 120 }).success).toBe(false);
    expect(ContractCommissionRateSchema.safeParse({ customerId: "c", contractId: "k", ratePercent: -5 }).success).toBe(false);
  });
});

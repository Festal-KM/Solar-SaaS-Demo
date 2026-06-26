// Vitest — F-062 案件情報インライン編集の Zod スキーマ（docs/05 §16）.
//   1. 受理（正常値）
//   2. null クリア許容 / 省略許容（partial 更新）
//   3. 不正値 reject（負数 / 範囲外 enum / 型不一致）
//   4. 仕入値スナップショットキーは strip される（schema に存在しない）

import { describe, expect, it } from "vitest";

import {
  ProjectApplicationEditSchema,
  ProjectConstructionEditSchema,
  ProjectContractEditSchema,
  ProjectEquipmentEditSchema,
  ProjectOverviewSchema,
} from "../src/schemas/customer.js";

describe("ProjectOverviewSchema", () => {
  it("正常値を受理する", () => {
    const r = ProjectOverviewSchema.safeParse({
      customerId: "c1",
      electricBill: "12000",
      household: "4人",
      housingType: "戸建て",
      inflowRoute: "EVENT",
      maekakuStatus: "done",
    });
    expect(r.success).toBe(true);
  });
  it("null クリア / 省略を許容する", () => {
    const r = ProjectOverviewSchema.safeParse({
      customerId: "c1",
      electricBill: null,
      inflowRoute: null,
    });
    expect(r.success).toBe(true);
  });
  it("不正な inflowRoute を reject する", () => {
    const r = ProjectOverviewSchema.safeParse({ customerId: "c1", inflowRoute: "BOGUS" });
    expect(r.success).toBe(false);
  });
  it("customerId 欠如を reject する", () => {
    const r = ProjectOverviewSchema.safeParse({ electricBill: "x" });
    expect(r.success).toBe(false);
  });
});

describe("ProjectContractEditSchema", () => {
  it("Contract + Payment 値を受理する（架電/金額は schema 外）", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      contractDate: "2026-01-10",
      equipmentSerialId: "SN-1",
      paymentCount: 120,
      paymentStatus: "PARTIAL",
      creditLifeInsurance: true,
      loanNote: "備考",
    });
    expect(r.success).toBe(true);
  });
  it("null クリアを許容する", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      loanCompany: null,
      downPayment: null,
      creditLifeInsurance: null,
      depositDate: null,
    });
    expect(r.success).toBe(true);
  });
  it("負の頭金を reject する", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      downPayment: -1,
    });
    expect(r.success).toBe(false);
  });
  it("不正な paymentStatus を reject する", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      paymentStatus: "DONE",
    });
    expect(r.success).toBe(false);
  });
  it("架電関連（callStatus / loanReviewCallAt）と契約金額は schema に出ない（strip）", () => {
    const r = ProjectContractEditSchema.parse({
      customerId: "c1",
      contractId: "ct1",
      // @ts-expect-error 架電/金額/仕入値キーは strip される
      callStatus: "DONE",
      loanReviewCallAt: "2026-01-01T00:00",
      contractAmount: 9999,
      snapshotPurchasePrice: 1,
    });
    const keys = Object.keys(r);
    expect(keys).not.toContain("callStatus");
    expect(keys).not.toContain("loanReviewCallAt");
    expect(keys).not.toContain("contractAmount");
    expect(keys).not.toContain("snapshotPurchasePrice");
  });
});

describe("ProjectEquipmentEditSchema", () => {
  it("非価格フィールドを受理する", () => {
    const r = ProjectEquipmentEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      equipmentId: "eq1",
      contracted: true,
      manufacturer: "長州産業",
      quantity: 12,
      introducedStatus: "NEW",
      warrantyStandard: true,
      attributes: { model2: "X" },
    });
    expect(r.success).toBe(true);
  });
  it("null クリア / 省略を許容する", () => {
    const r = ProjectEquipmentEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      equipmentId: "eq1",
      manufacturer: null,
      quantity: null,
      attributes: null,
    });
    expect(r.success).toBe(true);
  });
  it("負の枚数を reject する", () => {
    const r = ProjectEquipmentEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      equipmentId: "eq1",
      quantity: -3,
    });
    expect(r.success).toBe(false);
  });
  it("不正な introducedStatus を reject する", () => {
    const r = ProjectEquipmentEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      equipmentId: "eq1",
      introducedStatus: "USED",
    });
    expect(r.success).toBe(false);
  });
  it("仕入値スナップショットキーは schema に出ない（strip）", () => {
    const r = ProjectEquipmentEditSchema.parse({
      customerId: "c1",
      contractId: "ct1",
      equipmentId: "eq1",
      // @ts-expect-error 未知キーは strip される
      snapshotPurchasePrice: 1,
      snapshotDealerPrice: 2,
      snapshotListPrice: 3,
    });
    const keys = Object.keys(r);
    expect(keys).not.toContain("snapshotPurchasePrice");
    expect(keys).not.toContain("snapshotDealerPrice");
    expect(keys).not.toContain("snapshotListPrice");
  });
});

describe("ProjectConstructionEditSchema", () => {
  it("Construction + 親 Contract 列を受理する", () => {
    const r = ProjectConstructionEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "cn1",
      status: "CONSTRUCTING",
      completedDate: "2026-02-01",
      fee: 200000,
      postCompletionStatus: "IN_PROGRESS",
      defectStatus: "OPEN",
      defectDetail: "雨漏り",
    });
    expect(r.success).toBe(true);
  });
  it("null クリアを許容する", () => {
    const r = ProjectConstructionEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "cn1",
      surveyDate: null,
      vendorName: null,
      fee: null,
      thankYouCallAt: null,
    });
    expect(r.success).toBe(true);
  });
  it("不正な status を reject する", () => {
    const r = ProjectConstructionEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "cn1",
      status: "FINISHED",
    });
    expect(r.success).toBe(false);
  });
  it("負の fee を reject する", () => {
    const r = ProjectConstructionEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "cn1",
      fee: -1,
    });
    expect(r.success).toBe(false);
  });
});

describe("ProjectApplicationEditSchema", () => {
  it("正常値を受理する", () => {
    const r = ProjectApplicationEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      applicationId: "ap1",
      status: "APPROVED",
      type: "FIT",
      approvedDate: "2026-03-01",
      grantedAmount: 100000,
    });
    expect(r.success).toBe(true);
  });
  it("null クリア / 省略を許容する", () => {
    const r = ProjectApplicationEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      applicationId: "ap1",
      type: null,
      submittedDate: null,
      grantedAmount: null,
    });
    expect(r.success).toBe(true);
  });
  it("不正な status を reject する", () => {
    const r = ProjectApplicationEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      applicationId: "ap1",
      status: "PENDING",
    });
    expect(r.success).toBe(false);
  });
  it("負の交付額を reject する", () => {
    const r = ProjectApplicationEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      applicationId: "ap1",
      grantedAmount: -5,
    });
    expect(r.success).toBe(false);
  });
});

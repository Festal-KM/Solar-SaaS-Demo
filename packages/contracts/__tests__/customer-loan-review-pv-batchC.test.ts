// Vitest — バッチ C ローン審査ステータス + PV設置図面カテゴリ。
//   1. LoanReviewStatusEnum / LOAN_REVIEW_STATUS_VALUES の値域（単一の真実）
//   2. ProjectContractEditSchema.loanReviewStatus の受理 / null / 省略 / 不正値 reject
//   3. CustomerFileCategoryEnum に PV_DRAWING が追加されている
//   4. data ローダの PV_DRAWING 分離述語（GENERAL/APPLICATION と相互排他）

import { describe, expect, it } from "vitest";

import {
  CustomerFileCategoryEnum,
  LOAN_REVIEW_STATUS_VALUES,
  LoanReviewStatusEnum,
  PresignCustomerFileSchema,
  ProjectContractEditSchema,
} from "../src/schemas/customer.js";

describe("LoanReviewStatusEnum / LOAN_REVIEW_STATUS_VALUES — 値域（バッチ C）", () => {
  it("LOAN_REVIEW_STATUS_VALUES は 4 値（審査前/審査中/完了/不備在り）", () => {
    expect(LOAN_REVIEW_STATUS_VALUES).toEqual([
      "not_reviewed",
      "reviewing",
      "completed",
      "defect",
    ]);
  });

  it("enum は 4 値を受理する", () => {
    for (const v of LOAN_REVIEW_STATUS_VALUES) {
      expect(LoanReviewStatusEnum.parse(v)).toBe(v);
    }
  });

  it("不正値は reject", () => {
    expect(LoanReviewStatusEnum.safeParse("審査前").success).toBe(false);
    expect(LoanReviewStatusEnum.safeParse("NOT_REVIEWED").success).toBe(false);
    expect(LoanReviewStatusEnum.safeParse("").success).toBe(false);
  });

  it("enum の値域は LOAN_REVIEW_STATUS_VALUES と一致（単一の真実）", () => {
    expect(LoanReviewStatusEnum.options).toEqual([...LOAN_REVIEW_STATUS_VALUES]);
  });
});

describe("ProjectContractEditSchema.loanReviewStatus — 保存ペイロード（バッチ C）", () => {
  it("有効なステータスを受理する", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      loanReviewStatus: "reviewing",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.loanReviewStatus).toBe("reviewing");
  });

  it("null でクリアできる", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      loanReviewStatus: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.loanReviewStatus).toBeNull();
  });

  it("省略（部分更新）を許容する", () => {
    const r = ProjectContractEditSchema.safeParse({ customerId: "c1", contractId: "ct1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.loanReviewStatus).toBeUndefined();
  });

  it("不正なステータスは reject する", () => {
    const r = ProjectContractEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      loanReviewStatus: "BOGUS",
    });
    expect(r.success).toBe(false);
  });
});

describe("CustomerFileCategoryEnum — PV_DRAWING 追加（バッチ C）", () => {
  it("GENERAL / APPLICATION / PV_DRAWING を受理する", () => {
    expect(CustomerFileCategoryEnum.parse("GENERAL")).toBe("GENERAL");
    expect(CustomerFileCategoryEnum.parse("APPLICATION")).toBe("APPLICATION");
    expect(CustomerFileCategoryEnum.parse("PV_DRAWING")).toBe("PV_DRAWING");
  });

  it("不正なカテゴリは reject する", () => {
    expect(() => CustomerFileCategoryEnum.parse("OTHER")).toThrow();
  });

  it("PresignCustomerFileSchema は PV_DRAWING を受理する", () => {
    const parsed = PresignCustomerFileSchema.parse({
      customerId: "c1",
      fileName: "drawing.pdf",
      contentType: "application/pdf",
      category: "PV_DRAWING",
    });
    expect(parsed.category).toBe("PV_DRAWING");
  });
});

// data.ts ローダの GENERAL / APPLICATION / PV_DRAWING 分割と同じ述語（完全一致フィルタ）。
describe("CustomerFile ローダ分割述語 — PV_DRAWING 分離（バッチ C）", () => {
  const rows = [
    { id: "f1", category: "GENERAL" as const },
    { id: "f2", category: "APPLICATION" as const },
    { id: "f3", category: "PV_DRAWING" as const },
    { id: "f4", category: "PV_DRAWING" as const },
  ];

  it("PV_DRAWING は PV設置図面スロットにのみ分離される（相互排他）", () => {
    const general = rows.filter((r) => r.category === "GENERAL").map((r) => r.id);
    const application = rows.filter((r) => r.category === "APPLICATION").map((r) => r.id);
    const pvDrawing = rows.filter((r) => r.category === "PV_DRAWING").map((r) => r.id);
    expect(general).toEqual(["f1"]);
    expect(application).toEqual(["f2"]);
    expect(pvDrawing).toEqual(["f3", "f4"]);
    // 相互排他: PV_DRAWING が関連ファイル/申請関連に混入しない
    expect(pvDrawing.some((id) => general.includes(id) || application.includes(id))).toBe(false);
  });
});

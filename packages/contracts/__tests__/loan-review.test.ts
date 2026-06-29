// Vitest — 独立 LoanReview エンティティのスキーマ・値域（顧客 1:N・契約タブと同型）。
//   1. 値域 enum: LOAN_REVIEW_STATUS / DEFECT_STATUS / RESULT の受理・不正値 reject
//   2. LoanReviewCreate/Save/Delete: 受理 / null クリア / 省略許容 / 越境キー検証
//   3. LoanReviewLogCreate/Delete: result 値域 / 必須 reviewedAt
//   4. defectStatus 値域（なし/不備あり(未解消)/解消済み）の 3 値

import { describe, expect, it } from "vitest";

import {
  LOAN_REVIEW_DEFECT_STATUS_VALUES,
  LOAN_REVIEW_RESULT_VALUES,
  LOAN_REVIEW_STATUS_VALUES,
  LoanReviewCreateSchema,
  LoanReviewDefectStatusEnum,
  LoanReviewDeleteSchema,
  LoanReviewLogCreateSchema,
  LoanReviewLogDeleteSchema,
  LoanReviewResultEnum,
  LoanReviewSaveSchema,
  LoanReviewStatusEnum,
} from "../src/schemas/customer.js";

describe("LoanReview 値域 enum", () => {
  it("status は not_reviewed/reviewing/completed/defect の 4 値", () => {
    expect(LOAN_REVIEW_STATUS_VALUES).toEqual([
      "not_reviewed",
      "reviewing",
      "completed",
      "defect",
    ]);
    for (const v of LOAN_REVIEW_STATUS_VALUES) {
      expect(LoanReviewStatusEnum.parse(v)).toBe(v);
    }
    expect(() => LoanReviewStatusEnum.parse("bogus")).toThrow();
  });

  it("defectStatus は none/defect/resolved の 3 値（なし/未解消/解消済み）", () => {
    expect(LOAN_REVIEW_DEFECT_STATUS_VALUES).toEqual(["none", "defect", "resolved"]);
    for (const v of LOAN_REVIEW_DEFECT_STATUS_VALUES) {
      expect(LoanReviewDefectStatusEnum.parse(v)).toBe(v);
    }
    expect(() => LoanReviewDefectStatusEnum.parse("OPEN")).toThrow();
  });

  it("result は approved/rejected/defect/other の 4 値", () => {
    expect(LOAN_REVIEW_RESULT_VALUES).toEqual(["approved", "rejected", "defect", "other"]);
    for (const v of LOAN_REVIEW_RESULT_VALUES) {
      expect(LoanReviewResultEnum.parse(v)).toBe(v);
    }
    expect(() => LoanReviewResultEnum.parse("pending")).toThrow();
  });
});

describe("LoanReviewCreateSchema", () => {
  it("customerId のみで受理する（最小作成）", () => {
    expect(LoanReviewCreateSchema.parse({ customerId: "c1" })).toEqual({ customerId: "c1" });
  });
  it("customerId 欠落は reject", () => {
    expect(() => LoanReviewCreateSchema.parse({})).toThrow();
  });
});

describe("LoanReviewSaveSchema — 部分更新 / null クリア / 値域", () => {
  it("全フィールド受理", () => {
    const parsed = LoanReviewSaveSchema.parse({
      customerId: "c1",
      loanReviewId: "lr1",
      status: "defect",
      loanCompany: "ジャックス",
      downPayment: 100000,
      creditLifeInsurance: true,
      note: "メモ",
      defectContent: "源泉徴収票の年度相違",
      defectStatus: "defect",
      reviewedAt: "2026-06-01",
    });
    expect(parsed.status).toBe("defect");
    expect(parsed.defectStatus).toBe("defect");
  });

  it("各任意フィールドは null クリア可・省略可", () => {
    const parsed = LoanReviewSaveSchema.parse({
      customerId: "c1",
      loanReviewId: "lr1",
      loanCompany: null,
      downPayment: null,
      creditLifeInsurance: null,
      note: null,
      defectContent: null,
      defectStatus: null,
    });
    expect(parsed.loanCompany).toBeNull();
    expect(parsed.status).toBeUndefined();
  });

  it("負の頭金 / 不正 status / 不正 defectStatus は reject", () => {
    expect(() =>
      LoanReviewSaveSchema.parse({ customerId: "c1", loanReviewId: "lr1", downPayment: -1 }),
    ).toThrow();
    expect(() =>
      LoanReviewSaveSchema.parse({ customerId: "c1", loanReviewId: "lr1", status: "x" }),
    ).toThrow();
    expect(() =>
      LoanReviewSaveSchema.parse({ customerId: "c1", loanReviewId: "lr1", defectStatus: "OPEN" }),
    ).toThrow();
  });
});

describe("LoanReviewDeleteSchema", () => {
  it("customerId + loanReviewId で受理", () => {
    expect(LoanReviewDeleteSchema.parse({ customerId: "c1", loanReviewId: "lr1" })).toEqual({
      customerId: "c1",
      loanReviewId: "lr1",
    });
  });
});

describe("LoanReviewLogCreateSchema / DeleteSchema", () => {
  it("reviewedAt + result 必須で受理", () => {
    const parsed = LoanReviewLogCreateSchema.parse({
      customerId: "c1",
      loanReviewId: "lr1",
      reviewedAt: "2026-06-01T10:00",
      result: "approved",
      note: "所見",
    });
    expect(parsed.result).toBe("approved");
  });
  it("reviewedAt 空 / 不正 result は reject", () => {
    expect(() =>
      LoanReviewLogCreateSchema.parse({
        customerId: "c1",
        loanReviewId: "lr1",
        reviewedAt: "",
        result: "approved",
      }),
    ).toThrow();
    expect(() =>
      LoanReviewLogCreateSchema.parse({
        customerId: "c1",
        loanReviewId: "lr1",
        reviewedAt: "2026-06-01T10:00",
        result: "maybe",
      }),
    ).toThrow();
  });
  it("delete は customerId + loanReviewId + logId で受理", () => {
    expect(
      LoanReviewLogDeleteSchema.parse({ customerId: "c1", loanReviewId: "lr1", logId: "log1" }),
    ).toEqual({ customerId: "c1", loanReviewId: "lr1", logId: "log1" });
  });
});

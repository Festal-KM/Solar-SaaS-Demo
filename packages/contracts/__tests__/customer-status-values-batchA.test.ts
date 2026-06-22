// バッチ A — 営業ステータス(contractStatus) / 設置申請ステータス(subsidyStatus) /
// 現地調査ステータス(surveyStatus) の値域拡張を検証する。
//   - contractStatus: 6 主要値 + 既存 cancelled を受理。旧/不正値を reject。
//   - subsidyStatus: 新 5 値を受理。旧値域 (none/applying/granted) を reject。
//   - surveyStatus: ProjectConstructionEditSchema が新 3 値 + null を受理、不正値 reject。

import { describe, expect, it } from "vitest";

import {
  ContractStatusEnum,
  ProjectConstructionEditSchema,
  SubsidyStatusEnum,
  SurveyStatusEnum,
  CustomerUpdateSchema,
} from "../src/schemas/customer.js";

describe("contractStatus value domain (batch A)", () => {
  const accepted = [
    "pre_visit",
    "negotiating",
    "quote_presented",
    "contract_pending",
    "contracted",
    "lost",
    "cancelled",
  ];

  it.each(accepted)("ContractStatusEnum accepts %s", (v) => {
    expect(ContractStatusEnum.safeParse(v).success).toBe(true);
  });

  it.each(accepted)("CustomerUpdateSchema accepts contractStatus=%s", (v) => {
    const parsed = CustomerUpdateSchema.parse({ id: "c1", contractStatus: v });
    expect(parsed.contractStatus).toBe(v);
  });

  it("rejects an unknown contractStatus", () => {
    expect(ContractStatusEnum.safeParse("unknown").success).toBe(false);
    expect(CustomerUpdateSchema.safeParse({ id: "c1", contractStatus: "unknown" }).success).toBe(
      false,
    );
  });
});

describe("subsidyStatus value domain (batch A)", () => {
  const accepted = ["not_applied", "preparing", "applied", "revising", "completed"];
  const removed = ["none", "applying", "granted"];

  it.each(accepted)("SubsidyStatusEnum accepts %s", (v) => {
    expect(SubsidyStatusEnum.safeParse(v).success).toBe(true);
  });

  it.each(accepted)("CustomerUpdateSchema accepts subsidyStatus=%s", (v) => {
    const parsed = CustomerUpdateSchema.parse({ id: "c1", subsidyStatus: v });
    expect(parsed.subsidyStatus).toBe(v);
  });

  it.each(removed)("rejects the removed legacy subsidyStatus %s", (v) => {
    expect(SubsidyStatusEnum.safeParse(v).success).toBe(false);
    expect(CustomerUpdateSchema.safeParse({ id: "c1", subsidyStatus: v }).success).toBe(false);
  });

  // 旧→新の非破壊リマップ規則のドキュメント化（migration.sql と同一の写像）。
  it("documents the non-destructive remap (none→not_applied, applying→applied, granted→completed)", () => {
    const remap: Record<string, string> = {
      none: "not_applied",
      applying: "applied",
      granted: "completed",
    };
    for (const [, next] of Object.entries(remap)) {
      expect(SubsidyStatusEnum.safeParse(next).success).toBe(true);
    }
  });
});

describe("surveyStatus on ProjectConstructionEditSchema (batch A)", () => {
  const accepted = ["not_surveyed", "scheduled", "surveyed"];

  it.each(accepted)("SurveyStatusEnum accepts %s", (v) => {
    expect(SurveyStatusEnum.safeParse(v).success).toBe(true);
  });

  it.each(accepted)("ProjectConstructionEditSchema accepts surveyStatus=%s", (v) => {
    const parsed = ProjectConstructionEditSchema.parse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "con1",
      surveyStatus: v,
    });
    expect(parsed.surveyStatus).toBe(v);
  });

  it("accepts null to clear surveyStatus", () => {
    const parsed = ProjectConstructionEditSchema.parse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "con1",
      surveyStatus: null,
    });
    expect(parsed.surveyStatus).toBeNull();
  });

  it("rejects an unknown surveyStatus", () => {
    const result = ProjectConstructionEditSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      constructionId: "con1",
      surveyStatus: "done",
    });
    expect(result.success).toBe(false);
  });
});

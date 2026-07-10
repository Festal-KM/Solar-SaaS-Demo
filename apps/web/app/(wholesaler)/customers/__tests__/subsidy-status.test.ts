// Unit tests for the 設置申請状況 derivation (deriveSubsidyStatusValue).
//
// 設置申請状況は業務上 4 値（申請前 not_applied / 申請済み applied / 修正対応中 revising /
// 完了 completed）。Application(ApplicationStatus enum) を applicationEnumToSubsidyValue で
// マップし、固定優先順位
//   completed > applied > revising > not_applied
// で代表を選ぶ。write-on-save で Customer.subsidyStatus に書き戻すため、一覧の
// read/filter (data.ts) と表示が常に一致する。これらのテストがマップと優先順位を固定する。

import { describe, expect, it } from "vitest";

import {
  applicationEnumToSubsidyValue,
  deriveSubsidyStatusValue,
} from "../constants";

describe("applicationEnumToSubsidyValue", () => {
  it("maps ApplicationStatus enum to the 4-value subsidy scheme", () => {
    expect(applicationEnumToSubsidyValue("DRAFT")).toBe("not_applied");
    expect(applicationEnumToSubsidyValue("SUBMITTED")).toBe("applied");
    expect(applicationEnumToSubsidyValue("APPROVED")).toBe("completed");
    expect(applicationEnumToSubsidyValue("REJECTED")).toBe("revising");
    // CANCELLED (legacy) は申請前に正規化される。
    expect(applicationEnumToSubsidyValue("CANCELLED")).toBe("not_applied");
  });
});

describe("deriveSubsidyStatusValue (fixed priority: completed > applied > revising > not_applied)", () => {
  it("returns not_applied when there are no applications", () => {
    expect(deriveSubsidyStatusValue([])).toBe("not_applied");
  });

  it("returns the single application's mapped value", () => {
    expect(deriveSubsidyStatusValue([{ status: "DRAFT" }])).toBe("not_applied");
    expect(deriveSubsidyStatusValue([{ status: "SUBMITTED" }])).toBe("applied");
    expect(deriveSubsidyStatusValue([{ status: "CANCELLED" }])).toBe("not_applied");
  });

  it("prefers completed over any other status", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "SUBMITTED" }, { status: "APPROVED" }]),
    ).toBe("completed");
  });

  it("prefers applied over revising", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "REJECTED" }, { status: "SUBMITTED" }]),
    ).toBe("applied");
  });

  it("prefers revising over not_applied", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "DRAFT" }, { status: "REJECTED" }]),
    ).toBe("revising");
  });

  it("returns not_applied when all applications are DRAFT/CANCELLED", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "DRAFT" }, { status: "CANCELLED" }]),
    ).toBe("not_applied");
  });
});

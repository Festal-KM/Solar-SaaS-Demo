// Unit tests for the 設置申請状況 derivation (deriveSubsidyStatusValue).
//
// 設置申請状況は 5 値（申請前 not_applied / 申請準備中 preparing / 申請済 applied /
// 修正対応中 revising / 完了 completed）。Application(ApplicationStatus enum) を
// applicationEnumToSubsidyValue でマップし、固定優先順位
//   completed > applied > revising > preparing > not_applied
// で代表を選ぶ。write-on-save で Customer.subsidyStatus に書き戻すため、一覧の
// read/filter (data.ts) と表示が常に一致する。これらのテストがマップと優先順位を固定する。

import { describe, expect, it } from "vitest";

import {
  applicationEnumToSubsidyValue,
  deriveSubsidyStatusValue,
} from "../constants";

describe("applicationEnumToSubsidyValue", () => {
  it("maps ApplicationStatus enum to the 5-value subsidy scheme", () => {
    expect(applicationEnumToSubsidyValue("DRAFT")).toBe("preparing");
    expect(applicationEnumToSubsidyValue("SUBMITTED")).toBe("applied");
    expect(applicationEnumToSubsidyValue("APPROVED")).toBe("completed");
    expect(applicationEnumToSubsidyValue("REJECTED")).toBe("revising");
    expect(applicationEnumToSubsidyValue("CANCELLED")).toBe("not_applied");
  });
});

describe("deriveSubsidyStatusValue (fixed priority: completed > applied > revising > preparing > not_applied)", () => {
  it("returns not_applied when there are no applications", () => {
    expect(deriveSubsidyStatusValue([])).toBe("not_applied");
  });

  it("returns the single application's mapped value", () => {
    expect(deriveSubsidyStatusValue([{ status: "DRAFT" }])).toBe("preparing");
    expect(deriveSubsidyStatusValue([{ status: "SUBMITTED" }])).toBe("applied");
    expect(deriveSubsidyStatusValue([{ status: "CANCELLED" }])).toBe("not_applied");
  });

  it("prefers completed over any other status", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "SUBMITTED" }, { status: "APPROVED" }]),
    ).toBe("completed");
  });

  it("prefers applied over revising/preparing", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "REJECTED" }, { status: "SUBMITTED" }]),
    ).toBe("applied");
  });

  it("prefers revising over preparing", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "DRAFT" }, { status: "REJECTED" }]),
    ).toBe("revising");
  });

  it("returns not_applied when all applications are CANCELLED", () => {
    expect(
      deriveSubsidyStatusValue([{ status: "CANCELLED" }, { status: "CANCELLED" }]),
    ).toBe("not_applied");
  });
});

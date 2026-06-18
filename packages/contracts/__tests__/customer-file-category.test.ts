// Vitest — 顧客ファイルのカテゴリ（GENERAL / APPLICATION）。
//   1. PresignCustomerFileSchema / CustomerFileRecordSchema の category デフォルト = GENERAL
//   2. APPLICATION 明示時はそのまま通る
//   3. data.ts のローダ分割と同じ述語で GENERAL / APPLICATION に分かれること

import { describe, expect, it } from "vitest";

import {
  CustomerFileCategoryEnum,
  CustomerFileRecordSchema,
  PresignCustomerFileSchema,
} from "../src/schemas/customer.js";

describe("CustomerFileCategoryEnum", () => {
  it("GENERAL / APPLICATION のみを受理する", () => {
    expect(CustomerFileCategoryEnum.parse("GENERAL")).toBe("GENERAL");
    expect(CustomerFileCategoryEnum.parse("APPLICATION")).toBe("APPLICATION");
    expect(() => CustomerFileCategoryEnum.parse("OTHER")).toThrow();
  });
});

describe("PresignCustomerFileSchema.category", () => {
  it("未指定なら GENERAL がデフォルト適用される", () => {
    const parsed = PresignCustomerFileSchema.parse({
      customerId: "c1",
      fileName: "a.pdf",
      contentType: "application/pdf",
    });
    expect(parsed.category).toBe("GENERAL");
  });

  it("APPLICATION を明示するとそのまま通る", () => {
    const parsed = PresignCustomerFileSchema.parse({
      customerId: "c1",
      fileName: "a.pdf",
      contentType: "application/pdf",
      category: "APPLICATION",
    });
    expect(parsed.category).toBe("APPLICATION");
  });
});

describe("CustomerFileRecordSchema.category", () => {
  it("未指定なら GENERAL がデフォルト適用される", () => {
    const parsed = CustomerFileRecordSchema.parse({
      customerId: "c1",
      fileKey: "customers/c1/files/x-a.pdf",
      fileName: "a.pdf",
    });
    expect(parsed.category).toBe("GENERAL");
  });

  it("APPLICATION を明示するとそのまま通る", () => {
    const parsed = CustomerFileRecordSchema.parse({
      customerId: "c1",
      fileKey: "customers/c1/applications/x-a.pdf",
      fileName: "a.pdf",
      category: "APPLICATION",
    });
    expect(parsed.category).toBe("APPLICATION");
  });
});

// data.ts ローダの GENERAL / APPLICATION 分割と同じ述語（category 完全一致フィルタ）。
describe("CustomerFile ローダ分割述語", () => {
  const rows = [
    { id: "f1", category: "GENERAL" as const },
    { id: "f2", category: "APPLICATION" as const },
    { id: "f3", category: "GENERAL" as const },
    { id: "f4", category: "APPLICATION" as const },
  ];

  it("GENERAL は関連ファイルタブ、APPLICATION は設置申請タブに分かれる", () => {
    const general = rows.filter((r) => r.category === "GENERAL").map((r) => r.id);
    const application = rows.filter((r) => r.category === "APPLICATION").map((r) => r.id);
    expect(general).toEqual(["f1", "f3"]);
    expect(application).toEqual(["f2", "f4"]);
    // 相互排他: 同じファイルが両方に現れない
    expect(general.some((id) => application.includes(id))).toBe(false);
  });
});

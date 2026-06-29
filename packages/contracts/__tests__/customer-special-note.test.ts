// 契約タブ「特記事項」(Customer.specialNote) の CustomerUpdateSchema 受理・
// null クリア・未指定許容・上限長を検証。

import { describe, expect, it } from "vitest";

import { CustomerUpdateSchema } from "../src/schemas/customer.js";

describe("CustomerUpdateSchema — 特記事項 (specialNote)", () => {
  it("accepts a free-text string value", () => {
    const parsed = CustomerUpdateSchema.parse({
      id: "cust_1",
      specialNote: "旧型パワコン交換要相談。近隣に既設導入実績あり。",
    });
    expect(parsed.specialNote).toBe("旧型パワコン交換要相談。近隣に既設導入実績あり。");
  });

  it("accepts null to clear the field", () => {
    const parsed = CustomerUpdateSchema.parse({ id: "cust_1", specialNote: null });
    expect(parsed.specialNote).toBeNull();
  });

  it("allows specialNote to be omitted entirely (partial update)", () => {
    const parsed = CustomerUpdateSchema.parse({ id: "cust_1", name: "山田 太郎" });
    expect(parsed.specialNote).toBeUndefined();
  });

  it("rejects an over-length specialNote (> 4000)", () => {
    const result = CustomerUpdateSchema.safeParse({
      id: "cust_1",
      specialNote: "x".repeat(4001),
    });
    expect(result.success).toBe(false);
  });
});

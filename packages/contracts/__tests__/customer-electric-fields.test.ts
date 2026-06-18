// 基本情報タブ 電気契約・設備項目（electricContractStatus / electricAccountNo /
// supplyPointNo / equipmentId）の CustomerUpdateSchema 受理・未指定許容を検証。

import { describe, expect, it } from "vitest";

import { CustomerUpdateSchema } from "../src/schemas/customer.js";

describe("CustomerUpdateSchema — 電気契約・設備項目", () => {
  it("accepts all four fields with string values", () => {
    const parsed = CustomerUpdateSchema.parse({
      id: "cust_1",
      electricContractStatus: "従量電灯B 40A",
      electricAccountNo: "00-1234-5678",
      supplyPointNo: "0123456789012345678901",
      equipmentId: "EQ-001",
    });
    expect(parsed.electricContractStatus).toBe("従量電灯B 40A");
    expect(parsed.electricAccountNo).toBe("00-1234-5678");
    expect(parsed.supplyPointNo).toBe("0123456789012345678901");
    expect(parsed.equipmentId).toBe("EQ-001");
  });

  it("accepts null to clear each field", () => {
    const parsed = CustomerUpdateSchema.parse({
      id: "cust_1",
      electricContractStatus: null,
      electricAccountNo: null,
      supplyPointNo: null,
      equipmentId: null,
    });
    expect(parsed.electricContractStatus).toBeNull();
    expect(parsed.electricAccountNo).toBeNull();
    expect(parsed.supplyPointNo).toBeNull();
    expect(parsed.equipmentId).toBeNull();
  });

  it("allows the four fields to be omitted entirely (partial update)", () => {
    const parsed = CustomerUpdateSchema.parse({ id: "cust_1", name: "山田 太郎" });
    expect(parsed.electricContractStatus).toBeUndefined();
    expect(parsed.electricAccountNo).toBeUndefined();
    expect(parsed.supplyPointNo).toBeUndefined();
    expect(parsed.equipmentId).toBeUndefined();
  });

  it("rejects an over-length electricContractStatus", () => {
    const result = CustomerUpdateSchema.safeParse({
      id: "cust_1",
      electricContractStatus: "x".repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

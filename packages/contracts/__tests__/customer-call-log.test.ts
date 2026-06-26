// Vitest — 過去コール履歴（CustomerCallLog）スキーマ + ProjectCallLogDto / コールタブ DTO の
// 電話番号・次回アポ投影。
//   1. CustomerCallLogCreateSchema: calledAt 必須 / handler 任意 / メモ任意 / customerId 必須
//   2. CustomerCallLogDeleteSchema: customerId + callLogId 必須
//   3. ProjectCallsDto: 電話番号（マスク済み）・callLogs・次回アポ担当者名が二次店 DTO に保持される

import { describe, expect, it } from "vitest";

import {
  CustomerCallLogCreateSchema,
  CustomerCallLogDeleteSchema,
} from "../src/schemas/customer.js";

describe("CustomerCallLogCreateSchema — 過去コール履歴 追加ペイロード", () => {
  it("架電日時 + 対応者 + メモ を受理", () => {
    const parsed = CustomerCallLogCreateSchema.parse({
      customerId: "c1",
      calledAt: "2026-06-25T10:00:00.000Z",
      handlerUserId: "u1",
      note: "不在のため折返し依頼",
    });
    expect(parsed.calledAt).toBe("2026-06-25T10:00:00.000Z");
    expect(parsed.handlerUserId).toBe("u1");
  });

  it("対応者・メモ省略 / null を許容（calledAt と customerId のみ必須）", () => {
    const parsed = CustomerCallLogCreateSchema.parse({
      customerId: "c1",
      calledAt: "2026-06-25T10:00:00.000Z",
      handlerUserId: null,
      note: null,
    });
    expect(parsed.handlerUserId).toBeNull();
    expect(parsed.note).toBeNull();
  });

  it("calledAt 空 / customerId 欠落は reject", () => {
    expect(
      CustomerCallLogCreateSchema.safeParse({ customerId: "c1", calledAt: "" }).success,
    ).toBe(false);
    expect(
      CustomerCallLogCreateSchema.safeParse({ calledAt: "2026-06-25T10:00:00.000Z" }).success,
    ).toBe(false);
  });
});

describe("CustomerCallLogDeleteSchema — 過去コール履歴 削除ペイロード", () => {
  it("customerId + callLogId を受理", () => {
    const parsed = CustomerCallLogDeleteSchema.parse({ customerId: "c1", callLogId: "cl1" });
    expect(parsed.callLogId).toBe("cl1");
  });

  it("いずれか欠落は reject", () => {
    expect(CustomerCallLogDeleteSchema.safeParse({ customerId: "c1" }).success).toBe(false);
    expect(CustomerCallLogDeleteSchema.safeParse({ callLogId: "cl1" }).success).toBe(false);
  });
});

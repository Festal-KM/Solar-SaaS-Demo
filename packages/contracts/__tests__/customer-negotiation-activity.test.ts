// Vitest — 商談履歴タブ 3 点改修のスキーマ/純関数。
//   1. CustomerUpdateSchema.maekakuPreferredAt（マエカク希望日時）の受理
//   2. CustomerActivityCreateSchema.assigneeUserId（記録の担当者）の受理・既定 null
//   3. CustomerFileCategoryEnum に QUOTE 追加 + CustomerActivityFileRecordSchema 既定 QUOTE
//   4. 担当者表示の優先（assigneeUserId 優先・無ければ作成者・共に無ければ "—"）

import { describe, expect, it } from "vitest";

import {
  CustomerActivityCreateSchema,
  CustomerActivityFileRecordSchema,
  CustomerFileCategoryEnum,
  CustomerUpdateSchema,
} from "../src/schemas/customer.js";

describe("CustomerUpdateSchema.maekakuPreferredAt", () => {
  it("ISO 文字列を受理する", () => {
    const parsed = CustomerUpdateSchema.parse({
      id: "c1",
      maekakuPreferredAt: "2026-06-25T10:30:00.000Z",
    });
    expect(parsed.maekakuPreferredAt).toBe("2026-06-25T10:30:00.000Z");
  });

  it("null でクリアできる / 省略は無変更（undefined）", () => {
    expect(CustomerUpdateSchema.parse({ id: "c1", maekakuPreferredAt: null }).maekakuPreferredAt).toBeNull();
    expect(CustomerUpdateSchema.parse({ id: "c1" }).maekakuPreferredAt).toBeUndefined();
  });
});

describe("CustomerActivityCreateSchema.assigneeUserId", () => {
  const base = {
    customerId: "c1",
    occurredAt: "2026-06-25",
    category: "tossup" as const,
    detail: "対応メモ",
  };

  it("担当者 id を受理する", () => {
    const parsed = CustomerActivityCreateSchema.parse({ ...base, assigneeUserId: "u1" });
    expect(parsed.assigneeUserId).toBe("u1");
  });

  it("未指定は undefined（=null 扱い）/ null も許容", () => {
    expect(CustomerActivityCreateSchema.parse(base).assigneeUserId).toBeUndefined();
    expect(CustomerActivityCreateSchema.parse({ ...base, assigneeUserId: null }).assigneeUserId).toBeNull();
  });

  it("空文字は拒否する", () => {
    expect(() => CustomerActivityCreateSchema.parse({ ...base, assigneeUserId: "" })).toThrow();
  });
});

describe("CustomerFileCategoryEnum QUOTE", () => {
  it("QUOTE を受理する", () => {
    expect(CustomerFileCategoryEnum.parse("QUOTE")).toBe("QUOTE");
  });
});

describe("CustomerActivityFileRecordSchema", () => {
  const base = {
    customerId: "c1",
    activityId: "a1",
    fileKey: "customers/c1/quotes/x-quote.pdf",
    fileName: "quote.pdf",
  };

  it("category 未指定なら QUOTE がデフォルト適用される", () => {
    expect(CustomerActivityFileRecordSchema.parse(base).category).toBe("QUOTE");
  });

  it("activityId は必須", () => {
    const { activityId: _omit, ...withoutActivity } = base;
    expect(() => CustomerActivityFileRecordSchema.parse(withoutActivity)).toThrow();
  });
});

// data.ts ローダの担当者表示優先ロジック（assigneeUserId 優先 → 作成者 → "—"）。
describe("商談履歴 担当者表示の優先", () => {
  const nameByUserId = new Map([
    ["u-assignee", "担当 太郎"],
    ["u-creator", "作成 次郎"],
  ]);

  function resolveAssigneeName(assigneeUserId: string | null, createdByUserId: string): string {
    return (
      (assigneeUserId ? nameByUserId.get(assigneeUserId) : null) ??
      nameByUserId.get(createdByUserId) ??
      "—"
    );
  }

  it("assigneeUserId があればそれを優先", () => {
    expect(resolveAssigneeName("u-assignee", "u-creator")).toBe("担当 太郎");
  });

  it("assigneeUserId 未設定なら作成者にフォールバック", () => {
    expect(resolveAssigneeName(null, "u-creator")).toBe("作成 次郎");
  });

  it("どちらも解決できなければ '—'", () => {
    expect(resolveAssigneeName("unknown", "unknown")).toBe("—");
  });
});

// data.ts の QUOTE ファイル → activityId 単位グルーピング。
describe("見積書ファイルの activityId 単位グルーピング", () => {
  const fileRows = [
    { id: "f1", category: "QUOTE" as const, activityId: "a1" },
    { id: "f2", category: "QUOTE" as const, activityId: "a1" },
    { id: "f3", category: "QUOTE" as const, activityId: "a2" },
    { id: "f4", category: "QUOTE" as const, activityId: null },
    { id: "f5", category: "GENERAL" as const, activityId: "a1" },
  ];

  it("QUOTE かつ activityId を持つ行のみ、紐づく activity 単位でまとまる", () => {
    const byActivity = new Map<string, string[]>();
    for (const f of fileRows) {
      if (f.category !== "QUOTE" || !f.activityId) continue;
      const list = byActivity.get(f.activityId) ?? [];
      list.push(f.id);
      byActivity.set(f.activityId, list);
    }
    expect(byActivity.get("a1")).toEqual(["f1", "f2"]);
    expect(byActivity.get("a2")).toEqual(["f3"]);
    // activityId=null（f4）と GENERAL（f5）は除外
    expect([...byActivity.values()].flat()).not.toContain("f4");
    expect([...byActivity.values()].flat()).not.toContain("f5");
  });
});

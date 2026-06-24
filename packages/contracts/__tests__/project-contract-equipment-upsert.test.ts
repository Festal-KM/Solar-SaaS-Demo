// Vitest — 契約状況タブ「設備の追加・編集」スキーマ + デモ契約生成の純関数（docs/05 §16）.
//   1. ProjectContractEquipmentUpsertSchema の受理 / null・省略許容 / 不正値 reject
//   2. contractId 省略（契約 find-or-create）を許容する
//   3. 仕入値スナップショットキーは strip される（schema に存在しない）
//   4. buildDemoContractSeed: cancelDeadline 計算 / 既定値 / hasBattery / 金額クランプ

import { describe, expect, it } from "vitest";

import {
  buildDemoContractSeed,
  ProjectContractEquipmentUpsertSchema,
} from "../src/schemas/customer.js";

describe("ProjectContractEquipmentUpsertSchema", () => {
  it("カテゴリ + 非価格フィールドを受理する", () => {
    const r = ProjectContractEquipmentUpsertSchema.safeParse({
      customerId: "c1",
      contractId: "ct1",
      category: "PV",
      contractAmount: 3500000,
      contracted: true,
      manufacturer: "長州産業",
      model: "CS-440MB",
      capacity: "4.4 kW",
      quantity: 12,
      warrantyStandard: true,
      warrantyExtended: true,
    });
    expect(r.success).toBe(true);
  });

  it("contractId 省略（契約 find-or-create）を許容する", () => {
    const r = ProjectContractEquipmentUpsertSchema.safeParse({
      customerId: "c1",
      category: "BT",
      manufacturer: "ニチコン",
      warrantyDisaster: true,
    });
    expect(r.success).toBe(true);
  });

  it("contractId を null クリアできる", () => {
    const r = ProjectContractEquipmentUpsertSchema.safeParse({
      customerId: "c1",
      contractId: null,
      category: "EQ",
    });
    expect(r.success).toBe(true);
  });

  it("不正なカテゴリを reject する", () => {
    const r = ProjectContractEquipmentUpsertSchema.safeParse({
      customerId: "c1",
      category: "SOLAR",
    });
    expect(r.success).toBe(false);
  });

  it("負の枚数 / 契約金額を reject する", () => {
    expect(
      ProjectContractEquipmentUpsertSchema.safeParse({
        customerId: "c1",
        category: "PV",
        quantity: -1,
      }).success,
    ).toBe(false);
    expect(
      ProjectContractEquipmentUpsertSchema.safeParse({
        customerId: "c1",
        category: "PV",
        contractAmount: -100,
      }).success,
    ).toBe(false);
  });

  it("仕入値スナップショットキーは schema に出ない（strip）", () => {
    const r = ProjectContractEquipmentUpsertSchema.parse({
      customerId: "c1",
      category: "PV",
      // @ts-expect-error 未知キーは strip される
      snapshotPurchasePrice: 1,
      snapshotDealerPrice: 2,
      snapshotListPrice: 3,
    });
    const keys = Object.keys(r);
    expect(keys).not.toContain("snapshotPurchasePrice");
    expect(keys).not.toContain("snapshotDealerPrice");
    expect(keys).not.toContain("snapshotListPrice");
  });
});

describe("buildDemoContractSeed", () => {
  const now = new Date("2026-06-22T09:00:00.000Z");

  it("cancelDeadline = contractDate + cancelDeadlineDays", () => {
    const seed = buildDemoContractSeed({ cancelDeadlineDays: 8, now });
    const diffDays =
      (seed.cancelDeadline.getTime() - seed.contractDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(8);
    expect(seed.contractDate.getTime()).toBe(now.getTime());
  });

  it("cancelDeadlineDays 未指定は既定 8 日", () => {
    const seed = buildDemoContractSeed({ now });
    const diffDays =
      (seed.cancelDeadline.getTime() - seed.contractDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(8);
  });

  it("contractAmount は null / 負数で 0 にクランプ", () => {
    expect(buildDemoContractSeed({ contractAmount: null, now }).contractAmount).toBe(0);
    expect(buildDemoContractSeed({ contractAmount: -5, now }).contractAmount).toBe(0);
    expect(buildDemoContractSeed({ contractAmount: 1000, now }).contractAmount).toBe(1000);
  });

  it("hasBattery / status を反映する", () => {
    const bt = buildDemoContractSeed({ hasBattery: true, now });
    expect(bt.hasBattery).toBe(true);
    expect(bt.status).toBe("CONTRACTED");
    expect(bt.dealStatus).toBe("CONTRACTED");
    expect(buildDemoContractSeed({ now }).hasBattery).toBe(false);
  });
});

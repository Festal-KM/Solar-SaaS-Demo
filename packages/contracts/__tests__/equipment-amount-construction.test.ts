import { describe, expect, it } from "vitest";

import {
  CustomerFileCategoryEnum,
  EQUIPMENT_CATEGORY_VALUES,
  EquipmentCategoryEnum,
  ProjectContractEquipmentUpsertSchema,
  sumEquipmentAmounts,
} from "../src/schemas/customer.js";
import {
  emptyEquipmentByCategory,
  type EquipmentCategoryKey,
} from "../src/dto/project-info.js";

describe("sumEquipmentAmounts", () => {
  it("各商材 amount の合計を返す", () => {
    expect(sumEquipmentAmounts([1000, 2000, 500])).toBe(3500);
  });

  it("null を無視して合計する", () => {
    expect(sumEquipmentAmounts([1000, null, undefined, 250])).toBe(1250);
  });

  it("全て null/undefined のときは null（未入力と 0 を区別）", () => {
    expect(sumEquipmentAmounts([null, undefined])).toBeNull();
    expect(sumEquipmentAmounts([])).toBeNull();
  });

  it("実数 0 のみのときは 0 を返す（null ではない）", () => {
    expect(sumEquipmentAmounts([0, null])).toBe(0);
  });
});

describe("EquipmentCategory / CONSTRUCTION 商材ライン", () => {
  it("EQUIPMENT_CATEGORY_VALUES に CONSTRUCTION を含む", () => {
    expect(EQUIPMENT_CATEGORY_VALUES).toContain("CONSTRUCTION");
  });

  it("EquipmentCategoryEnum が CONSTRUCTION を受理する", () => {
    expect(EquipmentCategoryEnum.parse("CONSTRUCTION")).toBe("CONSTRUCTION");
  });

  it("emptyEquipmentByCategory に CONSTRUCTION バケットがある", () => {
    const buckets = emptyEquipmentByCategory();
    const key: EquipmentCategoryKey = "CONSTRUCTION";
    expect(buckets[key]).toEqual([]);
  });

  it("upsert スキーマが施工商材ラインの amount を受理する", () => {
    const parsed = ProjectContractEquipmentUpsertSchema.parse({
      customerId: "c1",
      category: "CONSTRUCTION",
      amount: 150000,
      manufacturer: "施工業者A",
    });
    expect(parsed.category).toBe("CONSTRUCTION");
    expect(parsed.amount).toBe(150000);
  });
});

describe("CustomerFileCategory / CONTRACT", () => {
  it("CustomerFileCategoryEnum が CONTRACT を受理する", () => {
    expect(CustomerFileCategoryEnum.parse("CONTRACT")).toBe("CONTRACT");
  });
});

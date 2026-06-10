// Vitest — F-060 LanePreference DTO（docs/05 §3.4.4）.
//   1. zod schema が新構造（venueLabel 必須 / desiredDates 形式 / items ≥ 1）を検証
//   2. 卸非公開項目の物理除外（stripDealerOmittedLaneKeys / Object.keys に出ない / #5）

import { describe, expect, it } from "vitest";

import {
  DEALER_OMITTED_LANE_PREFERENCE_KEYS,
  DesiredDatesSchema,
  LanePreferenceItemDtoSchema,
  SaveLanePreferenceInputSchema,
  stripDealerOmittedLaneKeys,
} from "../src/dto/lane-preference.js";

describe("DesiredDatesSchema", () => {
  it("accepts YYYY-MM-DD arrays and rejects malformed entries", () => {
    expect(DesiredDatesSchema.safeParse(["2026-07-07", "2026-07-08"]).success).toBe(true);
    expect(DesiredDatesSchema.safeParse(["2026/07/07"]).success).toBe(false);
    expect(DesiredDatesSchema.safeParse([]).success).toBe(true);
  });
});

describe("LanePreferenceItemDtoSchema", () => {
  it("requires venueLabel and a positive priority", () => {
    const ok = LanePreferenceItemDtoSchema.safeParse({
      priority: 1,
      venueLabel: "カインズ 大宮店",
      venueProviderId: null,
      venueProviderName: null,
      storeId: null,
      storeName: null,
      lineEventId: null,
      lineName: null,
      desiredDates: ["2026-07-07"],
      memo: null,
    });
    expect(ok.success).toBe(true);

    const badPriority = LanePreferenceItemDtoSchema.safeParse({
      priority: 0,
      venueLabel: "x",
      venueProviderId: null,
      venueProviderName: null,
      storeId: null,
      storeName: null,
      lineEventId: null,
      lineName: null,
      desiredDates: [],
      memo: null,
    });
    expect(badPriority.success).toBe(false);
  });
});

describe("SaveLanePreferenceInputSchema", () => {
  it("requires targetMonth (YYYY-MM) and at least one item with venueLabel", () => {
    const ok = SaveLanePreferenceInputSchema.safeParse({
      targetMonth: "2026-07",
      note: "特記",
      items: [{ venueLabel: "カインズ 大宮店", desiredDates: ["2026-07-07"] }],
    });
    expect(ok.success).toBe(true);
    // desiredDates defaults to [].
    if (ok.success) {
      expect(ok.data.items[0]!.desiredDates).toEqual(["2026-07-07"]);
    }

    expect(
      SaveLanePreferenceInputSchema.safeParse({ targetMonth: "2026-07", items: [] }).success,
    ).toBe(false);
    expect(
      SaveLanePreferenceInputSchema.safeParse({
        targetMonth: "2026-13",
        items: [{ venueLabel: "x" }],
      }).success,
    ).toBe(false);
    expect(
      SaveLanePreferenceInputSchema.safeParse({
        targetMonth: "2026-07",
        items: [{ venueLabel: "" }],
      }).success,
    ).toBe(false);
  });

  it("defaults desiredDates to [] when omitted", () => {
    const parsed = SaveLanePreferenceInputSchema.parse({
      targetMonth: "2026-07",
      items: [{ venueLabel: "カインズ 大宮店" }],
    });
    expect(parsed.items[0]!.desiredDates).toEqual([]);
  });
});

describe("stripDealerOmittedLaneKeys (物理除外 / #5)", () => {
  it("removes fixedFee/performanceRate/purchasePrice and keeps name", () => {
    const link = {
      id: "le_1",
      name: "イオンモール幕張新都心",
      fixedFee: "30000",
      performanceRate: "5",
      purchasePrice: 12000,
    };
    const safe = stripDealerOmittedLaneKeys(link);
    const keys = Object.keys(safe);
    for (const omitted of DEALER_OMITTED_LANE_PREFERENCE_KEYS) {
      expect(keys).not.toContain(omitted);
    }
    expect(keys).toContain("name");
    expect(safe.name).toBe("イオンモール幕張新都心");
  });
});

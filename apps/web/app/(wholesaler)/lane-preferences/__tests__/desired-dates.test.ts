// Unit tests for desiredDates band-grouping (F-060 / 連続日 → 帯チップ).

import { describe, expect, it } from "vitest";

import { bandColor, groupConsecutiveDates } from "../desired-dates.js";

describe("groupConsecutiveDates", () => {
  it("groups consecutive days into a single band and labels it", () => {
    const bands = groupConsecutiveDates(["2026-07-07", "2026-07-08"]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.label).toBe("7/7~8");
    expect(bands[0]!.dates).toEqual(["2026-07-07", "2026-07-08"]);
  });

  it("splits non-consecutive days into separate bands and sorts ascending", () => {
    const bands = groupConsecutiveDates([
      "2026-07-15",
      "2026-07-07",
      "2026-07-08",
      "2026-07-14",
    ]);
    expect(bands.map((b) => b.label)).toEqual(["7/7~8", "7/14~15"]);
  });

  it("labels a single day without a range", () => {
    const bands = groupConsecutiveDates(["2026-07-21"]);
    expect(bands[0]!.label).toBe("7/21");
    expect(bands[0]!.dates).toHaveLength(1);
  });

  it("crosses a month boundary with full m/d on both ends", () => {
    const bands = groupConsecutiveDates(["2026-07-31", "2026-08-01"]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.label).toBe("7/31~8/1");
  });

  it("deduplicates repeated dates", () => {
    const bands = groupConsecutiveDates(["2026-07-07", "2026-07-07", "2026-07-08"]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.dates).toEqual(["2026-07-07", "2026-07-08"]);
  });

  it("returns [] for empty input", () => {
    expect(groupConsecutiveDates([])).toEqual([]);
  });

  it("color-codes Sunday red, Saturday blue, weekday neutral", () => {
    // 2026-07-05 is Sunday, 2026-07-04 Saturday, 2026-07-06 Monday.
    expect(bandColor(0)).toContain("red");
    expect(bandColor(6)).toContain("blue");
    expect(bandColor(1)).toContain("surface-soft");
  });
});

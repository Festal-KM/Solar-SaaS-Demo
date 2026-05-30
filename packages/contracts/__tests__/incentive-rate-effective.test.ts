// Pure-function tests for `findEffectiveIncentiveRate` (T-02-06 / F-014).
//
// 三ケース:
//   1. asOf が複数行のうち中盤の期間に入ったときに該当行を返す
//   2. open-ended (effectiveTo=null) 行が常に効く
//   3. asOf がどの行よりも前 → null

import { describe, expect, it } from "vitest";

import { findEffectiveIncentiveRate } from "../src/services/incentive-rate-effective.js";

interface Row {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

function row(id: string, from: string, to: string | null): Row {
  return {
    id,
    effectiveFrom: new Date(from),
    effectiveTo: to === null ? null : new Date(to),
  };
}

describe("findEffectiveIncentiveRate", () => {
  it("returns the row whose period brackets asOf (closed-open interval)", () => {
    const rates: Row[] = [
      row("r1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      row("r2", "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      row("r3", "2026-07-01T00:00:00Z", null),
    ];
    const out = findEffectiveIncentiveRate(rates, new Date("2026-05-15T00:00:00Z"));
    expect(out?.id).toBe("r2");
  });

  it("returns the open-ended (effectiveTo=null) row when asOf is far in the future", () => {
    const rates: Row[] = [
      row("r1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      row("r2", "2026-04-01T00:00:00Z", null),
    ];
    const out = findEffectiveIncentiveRate(rates, new Date("2030-01-01T00:00:00Z"));
    expect(out?.id).toBe("r2");
  });

  it("returns null when asOf falls before every effectiveFrom", () => {
    const rates: Row[] = [
      row("r1", "2026-06-01T00:00:00Z", "2026-12-01T00:00:00Z"),
      row("r2", "2027-01-01T00:00:00Z", null),
    ];
    const out = findEffectiveIncentiveRate(rates, new Date("2026-01-01T00:00:00Z"));
    expect(out).toBeNull();
  });
});

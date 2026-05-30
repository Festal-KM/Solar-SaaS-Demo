// Pure-function tests for `findEffectiveProducts` (T-02-03).
//
// Effective-window semantics under test:
//   - `effectiveFrom <= asOf`            (inclusive lower bound)
//   - `asOf < effectiveTo`               (exclusive upper bound)
//   - `effectiveTo == null` → open-ended
//   - retired rows (`isActive == false`) excluded by default
//
// Five canonical cases mirror docs/02 §F-012 (時系列価格管理).

import { describe, expect, it } from "vitest";

import { findEffectiveProducts } from "../src/services/product-effective.js";

interface Row {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
}

function row(id: string, from: string, to: string | null, isActive = true): Row {
  return {
    id,
    effectiveFrom: new Date(from),
    effectiveTo: to === null ? null : new Date(to),
    isActive,
  };
}

describe("findEffectiveProducts", () => {
  it("returns the row whose period brackets asOf (closed-open interval)", () => {
    const rows: Row[] = [
      row("v1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      row("v2", "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      row("v3", "2026-07-01T00:00:00Z", null),
    ];
    const out = findEffectiveProducts(rows, new Date("2026-05-15T00:00:00Z"));
    expect(out.map((r) => r.id)).toEqual(["v2"]);
  });

  it("includes rows whose effectiveTo is null (open-ended)", () => {
    const rows: Row[] = [
      row("v3", "2026-07-01T00:00:00Z", null),
      row("v1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
    ];
    const out = findEffectiveProducts(rows, new Date("2027-12-01T00:00:00Z"));
    expect(out.map((r) => r.id)).toEqual(["v3"]);
  });

  it("treats effectiveFrom as inclusive and effectiveTo as exclusive at the boundaries", () => {
    const rows: Row[] = [
      row("v1", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      row("v2", "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z"),
    ];

    // asOf equals v2.effectiveFrom → v2 (inclusive lower)
    expect(findEffectiveProducts(rows, new Date("2026-04-01T00:00:00Z")).map((r) => r.id)).toEqual([
      "v2",
    ]);

    // asOf equals v1.effectiveTo → v2, not v1 (exclusive upper)
    expect(findEffectiveProducts(rows, new Date("2026-04-01T00:00:00Z")).map((r) => r.id)).toEqual([
      "v2",
    ]);
  });

  it("excludes retired (isActive=false) rows by default and keeps them when excludeRetired=false", () => {
    const rows: Row[] = [
      row("v_active", "2026-01-01T00:00:00Z", null, true),
      row("v_retired", "2026-01-01T00:00:00Z", null, false),
    ];
    expect(findEffectiveProducts(rows, new Date("2026-05-15T00:00:00Z")).map((r) => r.id)).toEqual([
      "v_active",
    ]);

    expect(
      findEffectiveProducts(rows, new Date("2026-05-15T00:00:00Z"), { excludeRetired: false })
        .map((r) => r.id)
        .sort(),
    ).toEqual(["v_active", "v_retired"]);
  });

  it("returns an empty list when asOf falls before every effectiveFrom", () => {
    const rows: Row[] = [
      row("v1", "2026-06-01T00:00:00Z", "2026-12-01T00:00:00Z"),
      row("v2", "2027-01-01T00:00:00Z", null),
    ];
    const out = findEffectiveProducts(rows, new Date("2026-01-01T00:00:00Z"));
    expect(out).toEqual([]);
  });
});

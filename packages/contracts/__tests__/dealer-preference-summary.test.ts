// Pure-function tests for `summariseDealerPreferences` (T-03-07 / F-022 /
// docs/04 §1.3 S-025/S-026).
//
// 5 ケース:
//   1. 提出済みのみ → 全て SUBMITTED、totals.submitted = visibility 数
//   2. 期限前で未提出 → PENDING、OVERDUE は 0
//   3. 期限超過で未提出 → OVERDUE
//   4. 期限超過でも提出済みは SUBMITTED のまま（取り下げは別フロー）
//   5. 公開対象 0 件 → 空サマリ + totals 全 0

import { describe, expect, it } from "vitest";

import {
  summariseDealerPreferences,
  type PreferenceInput,
  type VisibilityInput,
} from "../src/services/dealer-preference-summary.js";

function vis(id: string, dealerName: string): VisibilityInput {
  return { relationshipId: id, dealerId: `dl_${id}`, dealerName };
}

function pref(relationshipId: string, submittedAt: string): PreferenceInput {
  return {
    id: `pref_${relationshipId}`,
    relationshipId,
    priority: 1,
    availableDates: ["2026-06-15"],
    availablePeople: 2,
    comment: null,
    submittedAt: new Date(submittedAt),
  };
}

describe("summariseDealerPreferences", () => {
  it("returns SUBMITTED rows when every visible dealer has a preference", () => {
    const result = summariseDealerPreferences({
      visibility: [vis("rel_a", "二次店 A"), vis("rel_b", "二次店 B")],
      preferences: [pref("rel_a", "2026-05-20T09:00:00Z"), pref("rel_b", "2026-05-21T09:00:00Z")],
      deadlineAt: new Date("2026-06-01T00:00:00Z"),
      now: new Date("2026-05-25T00:00:00Z"),
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.status === "SUBMITTED")).toBe(true);
    expect(result.totals).toEqual({ visible: 2, submitted: 2, pending: 0, overdue: 0 });
    expect(result.rows[0]!.preference?.id).toBe("pref_rel_a");
  });

  it("classifies un-submitted dealers as PENDING before the deadline", () => {
    const result = summariseDealerPreferences({
      visibility: [vis("rel_a", "二次店 A"), vis("rel_b", "二次店 B")],
      preferences: [pref("rel_a", "2026-05-20T09:00:00Z")],
      deadlineAt: new Date("2026-06-01T00:00:00Z"),
      now: new Date("2026-05-25T00:00:00Z"),
    });
    const byRel = new Map(result.rows.map((r) => [r.relationshipId, r]));
    expect(byRel.get("rel_a")?.status).toBe("SUBMITTED");
    expect(byRel.get("rel_b")?.status).toBe("PENDING");
    expect(result.totals).toEqual({ visible: 2, submitted: 1, pending: 1, overdue: 0 });
  });

  it("flips un-submitted dealers to OVERDUE once the deadline has passed", () => {
    const result = summariseDealerPreferences({
      visibility: [vis("rel_a", "二次店 A"), vis("rel_b", "二次店 B")],
      preferences: [pref("rel_a", "2026-05-20T09:00:00Z")],
      deadlineAt: new Date("2026-06-01T00:00:00Z"),
      // 期限丁度 (>=) も超過扱い。
      now: new Date("2026-06-01T00:00:00Z"),
    });
    const byRel = new Map(result.rows.map((r) => [r.relationshipId, r]));
    expect(byRel.get("rel_a")?.status).toBe("SUBMITTED");
    expect(byRel.get("rel_b")?.status).toBe("OVERDUE");
    expect(result.totals).toEqual({ visible: 2, submitted: 1, pending: 0, overdue: 1 });
  });

  it("keeps already-submitted rows as SUBMITTED even after the deadline (取り下げは別フロー)", () => {
    const result = summariseDealerPreferences({
      visibility: [vis("rel_a", "二次店 A")],
      preferences: [pref("rel_a", "2026-05-20T09:00:00Z")],
      deadlineAt: new Date("2026-06-01T00:00:00Z"),
      now: new Date("2026-06-10T00:00:00Z"),
    });
    expect(result.rows[0]!.status).toBe("SUBMITTED");
    expect(result.totals.overdue).toBe(0);
  });

  it("returns an empty summary when no dealer relationship is published", () => {
    const result = summariseDealerPreferences({
      visibility: [],
      preferences: [],
      deadlineAt: new Date("2026-06-01T00:00:00Z"),
      now: new Date("2026-05-25T00:00:00Z"),
    });
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ visible: 0, submitted: 0, pending: 0, overdue: 0 });
  });
});

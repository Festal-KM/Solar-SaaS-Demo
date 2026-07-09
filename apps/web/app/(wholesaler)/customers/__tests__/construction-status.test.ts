// Unit tests for the 施工状況 derivation (deriveConstructionStatusValue).
//
// The derived list label MUST match the DB filter (buildConstructionStatusWhere)
// exactly, so the derivation uses a FIXED priority — in_progress > done >
// not_started — with no updatedAt tiebreak. These tests lock that ordering,
// including the multi-construction "DONE + newer REQUEST_PENDING" case that the
// old updatedAt-latest logic classified inconsistently with the filter.

import { describe, expect, it } from "vitest";

import {
  constructionEnumToStatusValue,
  deriveConstructionStatusValue,
} from "../constants";

describe("constructionEnumToStatusValue", () => {
  it("maps DONE → done, REQUEST_PENDING → not_started, else → in_progress", () => {
    expect(constructionEnumToStatusValue("DONE")).toBe("done");
    expect(constructionEnumToStatusValue("REQUEST_PENDING")).toBe("not_started");
    expect(constructionEnumToStatusValue("REQUESTED")).toBe("in_progress");
    expect(constructionEnumToStatusValue("SURVEYED")).toBe("in_progress");
    expect(constructionEnumToStatusValue("CONSTRUCTING")).toBe("in_progress");
    expect(constructionEnumToStatusValue("PAUSED")).toBe("in_progress");
  });
});

describe("deriveConstructionStatusValue (fixed priority: in_progress > done > not_started)", () => {
  it("falls back to Customer column when there are no constructions", () => {
    expect(deriveConstructionStatusValue([], "done")).toBe("done");
    expect(deriveConstructionStatusValue([], "not_started")).toBe("not_started");
  });

  it("returns in_progress when any construction is in progress", () => {
    expect(
      deriveConstructionStatusValue([{ status: "CONSTRUCTING" }], "not_started"),
    ).toBe("in_progress");
  });

  it("prefers in_progress over done regardless of ordering", () => {
    expect(
      deriveConstructionStatusValue(
        [{ status: "DONE" }, { status: "SURVEYED" }],
        "not_started",
      ),
    ).toBe("in_progress");
  });

  it("returns done when there is a DONE and no in-progress construction — even with a newer REQUEST_PENDING (no updatedAt tiebreak)", () => {
    // The regression case: DONE + a more-recently-updated REQUEST_PENDING.
    // Old logic (updatedAt-latest) returned not_started; the filter classified
    // this customer as done. Fixed priority must return done to stay consistent.
    expect(
      deriveConstructionStatusValue(
        [{ status: "DONE" }, { status: "REQUEST_PENDING" }],
        "not_started",
      ),
    ).toBe("done");
  });

  it("returns not_started when constructions exist but none are in progress or done", () => {
    expect(
      deriveConstructionStatusValue(
        [{ status: "REQUEST_PENDING" }, { status: "REQUEST_PENDING" }],
        "done",
      ),
    ).toBe("not_started");
  });
});

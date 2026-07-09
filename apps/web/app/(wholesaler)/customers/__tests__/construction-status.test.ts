// Unit tests for the 施工状況 derivation (deriveConstructionStatusValue).
//
// 施工状況は 4 値（現地調査前 not_started / 施工前 surveyed / 施工中 in_progress / 完工 done）。
// The derived list label MUST match the DB filter (buildConstructionStatusWhere)
// exactly, so the derivation uses a FIXED priority — in_progress > done >
// surveyed > not_started — with no updatedAt tiebreak. These tests lock that
// ordering, including the multi-construction "DONE + newer REQUEST_PENDING" case.

import { describe, expect, it } from "vitest";

import {
  constructionEnumToStatusValue,
  deriveConstructionStatusValue,
} from "../constants";

describe("constructionEnumToStatusValue", () => {
  it("maps enum 6 values to the 4-value list scheme", () => {
    expect(constructionEnumToStatusValue("DONE")).toBe("done");
    expect(constructionEnumToStatusValue("REQUEST_PENDING")).toBe("not_started");
    expect(constructionEnumToStatusValue("REQUESTED")).toBe("not_started");
    expect(constructionEnumToStatusValue("SURVEYED")).toBe("surveyed");
    expect(constructionEnumToStatusValue("CONSTRUCTING")).toBe("in_progress");
    expect(constructionEnumToStatusValue("PAUSED")).toBe("in_progress");
  });
});

describe("deriveConstructionStatusValue (fixed priority: in_progress > done > surveyed > not_started)", () => {
  it("falls back to Customer column when there are no constructions", () => {
    expect(deriveConstructionStatusValue([], "done")).toBe("done");
    expect(deriveConstructionStatusValue([], "surveyed")).toBe("surveyed");
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
        [{ status: "DONE" }, { status: "CONSTRUCTING" }],
        "not_started",
      ),
    ).toBe("in_progress");
  });

  it("returns done when there is a DONE and no in-progress construction — even with a newer REQUEST_PENDING (no updatedAt tiebreak)", () => {
    expect(
      deriveConstructionStatusValue(
        [{ status: "DONE" }, { status: "REQUEST_PENDING" }],
        "not_started",
      ),
    ).toBe("done");
  });

  it("returns surveyed when there is a SURVEYED and no in-progress/done construction", () => {
    expect(
      deriveConstructionStatusValue(
        [{ status: "SURVEYED" }, { status: "REQUEST_PENDING" }],
        "not_started",
      ),
    ).toBe("surveyed");
  });

  it("returns not_started when constructions exist but none are surveyed/in-progress/done", () => {
    expect(
      deriveConstructionStatusValue(
        [{ status: "REQUEST_PENDING" }, { status: "REQUESTED" }],
        "done",
      ),
    ).toBe("not_started");
  });
});

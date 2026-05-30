// Pure-function tests for `resolveScope` and `canDealerCloseDeal`
// (T-03-09, T-05-02 / F-024 / docs/05 §6.4).
//
// resolveScope — 2 ケース:
//   1. scopeOverride が設定されている → eventDealer.scopeOverride を返す
//   2. scopeOverride が null → relationship.defaultScope を返す
//
// canDealerCloseDeal — 9 ケース (3 スコープ × 3 アクション):
//   APPOINTMENT_ONLY × visit/pitch/close → false/false/false
//   FIRST_VISIT      × visit/pitch/close → true/false/false
//   FULL_CLOSING     × visit/pitch/close → true/true/true

import { describe, expect, it } from "vitest";

import {
  canDealerCloseDeal,
  resolveScope,
  type EventDealerScopeInput,
  type RelationshipScopeInput,
} from "../src/services/dealer-scope.js";

describe("resolveScope", () => {
  it("returns eventDealer.scopeOverride when it is set", () => {
    const eventDealer: EventDealerScopeInput = { scopeOverride: "APPOINTMENT_ONLY" };
    const relationship: RelationshipScopeInput = { defaultScope: "FULL_CLOSING" };

    expect(resolveScope(eventDealer, relationship)).toBe("APPOINTMENT_ONLY");
  });

  it("falls back to relationship.defaultScope when scopeOverride is null", () => {
    const eventDealer: EventDealerScopeInput = { scopeOverride: null };
    const relationship: RelationshipScopeInput = { defaultScope: "FIRST_VISIT" };

    expect(resolveScope(eventDealer, relationship)).toBe("FIRST_VISIT");
  });
});

describe("canDealerCloseDeal", () => {
  describe("APPOINTMENT_ONLY scope", () => {
    it("denies visit", () => {
      expect(canDealerCloseDeal("APPOINTMENT_ONLY", "visit")).toBe(false);
    });
    it("denies pitch", () => {
      expect(canDealerCloseDeal("APPOINTMENT_ONLY", "pitch")).toBe(false);
    });
    it("denies close", () => {
      expect(canDealerCloseDeal("APPOINTMENT_ONLY", "close")).toBe(false);
    });
  });

  describe("FIRST_VISIT scope", () => {
    it("allows visit", () => {
      expect(canDealerCloseDeal("FIRST_VISIT", "visit")).toBe(true);
    });
    it("denies pitch", () => {
      expect(canDealerCloseDeal("FIRST_VISIT", "pitch")).toBe(false);
    });
    it("denies close", () => {
      expect(canDealerCloseDeal("FIRST_VISIT", "close")).toBe(false);
    });
  });

  describe("FULL_CLOSING scope", () => {
    it("allows visit", () => {
      expect(canDealerCloseDeal("FULL_CLOSING", "visit")).toBe(true);
    });
    it("allows pitch", () => {
      expect(canDealerCloseDeal("FULL_CLOSING", "pitch")).toBe(true);
    });
    it("allows close", () => {
      expect(canDealerCloseDeal("FULL_CLOSING", "close")).toBe(true);
    });
  });
});

// Vitest — MaskingService pure-function tests (T-04-05 / docs/05 §6.5 /
// CLAUDE.md Hard Rule #6).
//
// 6 canonical cases:
//   1. WHOLESALER_ADMIN × FULL mode  → all fields returned as-is
//   2. DEALER_ADMIN × MASKED mode    → all fields masked
//   3. SAAS_ADMIN (any mode)         → forced MASKED on all fields
//   4. WHOLESALER × PARTIAL mode     → phone last-4, address city prefix, family name
//   5. DEALER × isSelfTenant=true × PARTIAL → PARTIAL applied (same as case 4)
//   6. DEALER × isSelfTenant=false   → forced MASKED regardless of piiMaskingMode

import { describe, expect, it } from "vitest";

import {
  maskAddress,
  maskName,
  maskPhone,
  type ViewerContext,
} from "../src/services/masking.js";

const PHONE = "090-1234-5678";
const ADDRESS = "東京都新宿区西新宿2-8-1";
const NAME = "山田 太郎";

describe("maskPhone", () => {
  it("WHOLESALER_ADMIN × FULL: returns phone as-is", () => {
    const viewer: ViewerContext = {
      role: "WHOLESALER_ADMIN",
      tenantType: "WHOLESALER",
      isSelfTenant: true,
      piiMaskingMode: "FULL",
    };
    expect(maskPhone(PHONE, viewer)).toBe(PHONE);
    expect(maskAddress(ADDRESS, viewer)).toBe(ADDRESS);
    expect(maskName(NAME, viewer)).toBe(NAME);
  });

  it("DEALER_ADMIN × MASKED: all fields masked", () => {
    const viewer: ViewerContext = {
      role: "DEALER_ADMIN",
      tenantType: "DEALER",
      isSelfTenant: true,
      piiMaskingMode: "MASKED",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-****");
    expect(maskAddress(ADDRESS, viewer)).toBe("***");
    expect(maskName(NAME, viewer)).toBe("***");
  });

  it("SAAS_ADMIN: forced MASKED regardless of piiMaskingMode=FULL", () => {
    const viewer: ViewerContext = {
      role: "SAAS_ADMIN",
      tenantType: "SAAS_ADMIN",
      isSelfTenant: false,
      piiMaskingMode: "FULL",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-****");
    expect(maskAddress(ADDRESS, viewer)).toBe("***");
    expect(maskName(NAME, viewer)).toBe("***");
  });

  it("WHOLESALER × PARTIAL: phone last-4, address city prefix, family name", () => {
    const viewer: ViewerContext = {
      role: "WHOLESALER_ADMIN",
      tenantType: "WHOLESALER",
      isSelfTenant: true,
      piiMaskingMode: "PARTIAL",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-5678");
    expect(maskAddress(ADDRESS, viewer)).toBe("東京都新宿区");
    expect(maskName(NAME, viewer)).toBe("山田");
  });

  it("DEALER × isSelfTenant=true × PARTIAL: PARTIAL applied", () => {
    const viewer: ViewerContext = {
      role: "DEALER_STAFF",
      tenantType: "DEALER",
      isSelfTenant: true,
      piiMaskingMode: "PARTIAL",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-5678");
    expect(maskAddress(ADDRESS, viewer)).toBe("東京都新宿区");
    expect(maskName(NAME, viewer)).toBe("山田");
  });

  it("WHOLESALER_ADMIN × MASKED: capped at PARTIAL (not fully masked)", () => {
    // docs/05 §6.5: WHOLESALER_ADMIN is capped at PARTIAL when piiMaskingMode=MASKED.
    const viewer: ViewerContext = {
      role: "WHOLESALER_ADMIN",
      tenantType: "WHOLESALER",
      isSelfTenant: true,
      piiMaskingMode: "MASKED",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-5678");
    expect(maskAddress(ADDRESS, viewer)).toBe("東京都新宿区");
    expect(maskName(NAME, viewer)).toBe("山田");
  });

  it("DEALER × isSelfTenant=false: forced MASKED regardless of piiMaskingMode=FULL", () => {
    const viewer: ViewerContext = {
      role: "DEALER_ADMIN",
      tenantType: "DEALER",
      isSelfTenant: false,
      piiMaskingMode: "FULL",
    };
    expect(maskPhone(PHONE, viewer)).toBe("***-****-****");
    expect(maskAddress(ADDRESS, viewer)).toBe("***");
    expect(maskName(NAME, viewer)).toBe("***");
  });
});

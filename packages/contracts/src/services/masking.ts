// Pure masking helpers — no DB / framework dependencies.
//
// Implements docs/05 §6.5 `MaskingService` and CLAUDE.md Hard Rule #6.
// All three functions accept a `ViewerContext` assembled by the caller (the
// Server Action / Route Handler layer) after loading `WholesalerSettings`.
//
// Forced-mask rules (applied before piiMaskingMode):
//   1. SAAS_ADMIN → always MASKED (internal ops team must not see PII).
//   2. DEALER_* with isSelfTenant=false → always MASKED (cross-tenant access).
//
// Format conventions (PARTIAL):
//   phone   : "***-****-XXXX" (last 4 digits of the original number exposed)
//   address : prefecture + city prefix only — we keep everything up to and
//             including the first city/town/ward character boundary. Because
//             address formats vary widely we adopt a simple heuristic: keep
//             the longest match of /^[^0-9０-９A-Za-zａ-ｚＡ-Ｚ－]+/ and
//             truncate the rest. This preserves "東京都新宿区" while stripping
//             street/building details.
//   name    : family name (first token before whitespace) only, e.g. "山田"

// AppRole mirrors the Prisma-generated enum. Duplicated here so that the
// contracts package stays DB-agnostic (no @prisma/client dependency).
export type MaskingAppRole =
  | "SAAS_ADMIN"
  | "WHOLESALER_ADMIN"
  | "WHOLESALER_EVENT_TEAM"
  | "WHOLESALER_CALL_TEAM"
  | "WHOLESALER_DIRECT_SALES"
  | "WHOLESALER_FIELD_STAFF"
  | "DEALER_ADMIN"
  | "DEALER_STAFF";

// Re-uses the same set of values as `PiiMaskingMode` in wholesaler-settings.ts
// but is declared separately to avoid a re-export name collision when both
// modules are barrel-exported from @solar/contracts.
export type MaskingPiiMode = "FULL" | "PARTIAL" | "MASKED";

export interface ViewerContext {
  role: MaskingAppRole;
  tenantType: "WHOLESALER" | "DEALER" | "SAAS_ADMIN";
  isSelfTenant: boolean;
  piiMaskingMode: MaskingPiiMode;
}

// Resolve the effective masking mode considering forced-mask overrides.
function effectiveMode(viewer: ViewerContext): MaskingPiiMode {
  if (viewer.tenantType === "SAAS_ADMIN") return "MASKED";
  if (viewer.tenantType === "DEALER" && !viewer.isSelfTenant) return "MASKED";
  // WHOLESALER_ADMIN defaults to FULL but is capped at PARTIAL when the
  // wholesaler has opted in to MASKED mode (docs/05 §6.5).
  if (viewer.tenantType === "WHOLESALER" && viewer.piiMaskingMode === "MASKED")
    return "PARTIAL";
  return viewer.piiMaskingMode;
}

/**
 * Mask a phone number according to the viewer's effective mode.
 *
 * FULL    : return as-is
 * PARTIAL : "***-****-XXXX" — expose only the last 4 digits
 * MASKED  : "***-****-****"
 */
export function maskPhone(phone: string, viewer: ViewerContext): string {
  const mode = effectiveMode(viewer);
  if (mode === "FULL") return phone;

  // Extract last 4 digits from digits-only string for PARTIAL.
  const digitsOnly = phone.replace(/\D/g, "");
  const last4 = digitsOnly.slice(-4).padStart(4, "*");

  if (mode === "PARTIAL") return `***-****-${last4}`;
  return "***-****-****";
}

/**
 * Mask a physical address according to the viewer's effective mode.
 *
 * FULL    : return as-is
 * PARTIAL : prefecture + city (up to 市区町村 boundary), rest stripped
 * MASKED  : "***"
 */
export function maskAddress(address: string, viewer: ViewerContext): string {
  const mode = effectiveMode(viewer);
  if (mode === "FULL") return address;
  if (mode === "MASKED") return "***";

  // PARTIAL: keep the city/ward/town prefix.
  // Heuristic: strip everything starting from the first ASCII digit, ASCII
  // letter, full-width digit (０-９), or common address delimiter (丁目・番地
  // etc. are kept as part of the city name; only house-number-level digits are
  // stripped). We match the leading non-address-number characters greedily.
  const match = address.match(/^(.+?[市区町村])/);
  if (match?.[1]) return match[1];
  return "***";
}

/**
 * Mask a person's name according to the viewer's effective mode.
 *
 * FULL    : return as-is
 * PARTIAL : family name only (first whitespace-delimited token)
 * MASKED  : "***"
 */
export function maskName(name: string, viewer: ViewerContext): string {
  const mode = effectiveMode(viewer);
  if (mode === "FULL") return name;
  if (mode === "MASKED") return "***";

  // PARTIAL: family name = first token before any whitespace (full-width or half-width).
  const familyName = name.split(/[\s　]/)[0] ?? "";
  return familyName || "***";
}

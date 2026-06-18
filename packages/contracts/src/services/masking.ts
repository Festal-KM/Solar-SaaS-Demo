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

/**
 * Mask a birth date according to the viewer's effective mode (docs/05 §6.5 /
 * §16.4). Used by the F-061 project-info aggregate view.
 *
 * FULL    : return the ISO date string (YYYY-MM-DD) as-is
 * PARTIAL : decade band only, e.g. "40代"
 * MASKED  : decade band only (SAAS_ADMIN / cross-tenant dealer never see full)
 *
 * `birthDate` is a Date or an ISO string. `null`/invalid → "未設定".
 */
export function maskBirthDate(
  birthDate: Date | string | null | undefined,
  viewer: ViewerContext,
): string {
  if (!birthDate) return "未設定";
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "未設定";

  const mode = effectiveMode(viewer);
  if (mode === "FULL") {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // PARTIAL / MASKED → 年代のみ。
  const age = computeAge(d);
  if (age == null) return "未設定";
  const decade = Math.floor(age / 10) * 10;
  return `${decade}代`;
}

/**
 * Full age in years from a birth date, or `null` when invalid / future.
 * Exposed for the F-061 loader so `age` can be returned as a number for FULL
 * viewers and `null` once masked (docs/05 §16.9 / §16.10).
 */
export function computeAge(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * True when the viewer is allowed to see un-masked PII (FULL effective mode).
 * Used to decide whether `age` is returned as a number or null.
 */
export function isFullPiiViewer(viewer: ViewerContext): boolean {
  return effectiveMode(viewer) === "FULL";
}

// ---------------------------------------------------------------------------
// F-063 住環境・家族属性ヒアリング マスキング（docs/05 §17.5 / CLAUDE.md #6）.
// 家族年齢は年代のみ / 分離電話は下 4 桁 / 既設設備詳細は二次店ロールで縮約。
// ---------------------------------------------------------------------------

/**
 * Mask a family member's age (husband / wife / child) — a hearing-snapshot
 * value, not derived from a birth date (docs/05 §17.1.3).
 *
 * FULL            : the raw number, e.g. "45歳"
 * PARTIAL / MASKED: decade band only, e.g. "40代"
 * `null`          : "未設定" (not heard yet)
 */
export function maskFamilyAge(age: number | null | undefined, viewer: ViewerContext): string {
  if (age == null || !Number.isFinite(age) || age < 0 || age >= 130) return "未設定";
  const mode = effectiveMode(viewer);
  if (mode === "FULL") return `${age}歳`;
  const decade = Math.floor(age / 10) * 10;
  return `${decade}代`;
}

/**
 * Mask a landline number to the viewer's effective mode. Returns "未設定" for
 * `null`/empty so callers can render uniformly. Reuses `maskPhone` for the
 * non-empty case (last-4-digits convention).
 */
export function maskLandlinePhone(
  phone: string | null | undefined,
  viewer: ViewerContext,
): string {
  if (!phone) return "未設定";
  return maskPhone(phone, viewer);
}

/** Mask a mobile number — same convention as {@link maskLandlinePhone}. */
export function maskMobilePhone(
  phone: string | null | undefined,
  viewer: ViewerContext,
): string {
  if (!phone) return "未設定";
  return maskPhone(phone, viewer);
}

// Minimal shape for the dealer-scope reduction — keeps this module free of the
// dto/project-info import (avoids a cycle; the dto re-declares the full type).
interface ExistingEquipmentForMask {
  category: "GAS_WATER_HEATER" | "ECO_CUTE" | "PV";
  installed: "YES" | "NO" | "UNKNOWN";
}

/**
 * Reduce an existing-equipment row to the dealer-visible projection
 * (category + presence only). The detail fields (installDate / maker /
 * capacityKw / panelCount / attributes) are wholesaler-only (docs/05 §17.5 /
 * docs/02 Assumption 22). The DTO layer additionally destructure-and-rest
 * removes those keys so they never appear in `Object.keys` (#5).
 */
export function maskExistingEquipmentForDealer<T extends ExistingEquipmentForMask>(
  eq: T,
): Pick<ExistingEquipmentForMask, "category" | "installed"> {
  return { category: eq.category, installed: eq.installed };
}

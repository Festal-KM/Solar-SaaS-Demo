// Server-Action friendly wrappers around the TotpService.
//
// These wrappers exist for two reasons:
//   1. They drop the plaintext `secret` from `generateTotpSetup` before it
//      ever crosses an RSC / Server Action boundary — the UI receives a
//      masked-only string for the manual-entry fallback. The QR code itself
//      still encodes the full secret for authenticator-app scanning.
//   2. They normalise inputs (trim / lower-case) so the calling page in
//      `apps/web/app/(auth)/mfa/...` can pass `FormData` strings verbatim.
//
// The actions themselves still expect to be called from inside an
// authenticated context — `apps/web/app/(auth)/mfa/actions.ts` resolves the
// userId from `getServerSession()` and forwards it here.

import { SYSTEM_TENANT_CONTEXT, withTenant } from "@solar/db";

import { UnauthorizedError } from "./errors.js";
import { verifyArgon2 } from "./password.js";
import {
  generateTotpSetup,
  regenerateBackupCodes,
  verifyTotpCode,
  type VerifyTotpResult,
} from "./totp.js";

export interface SetupTotpActionResult {
  /** Property name matches docs/05 §4.3 (lower-case `c`). */
  qrcodeDataUrl: string;
  /**
   * Masked base32 secret for the manual-entry fallback under the QR. Shape is
   * `先頭4文字 + '...' + 末尾4文字` per docs/05 §4.3. Never carries the full
   * secret across the Server Action boundary.
   */
  secretMasked: string;
  backupCodes: string[];
}

export interface RegenerateBackupCodesActionInput {
  password: string;
}

export interface RegenerateBackupCodesActionResult {
  codes: string[];
}

/**
 * Provision QR + backup codes for the signed-in user. The shared secret is
 * intentionally NOT returned in plaintext — clients see only a masked form for
 * the manual-entry fallback. The QR code itself encodes the full secret.
 */
export async function setupTotpAction(
  userId: string,
  userEmail: string,
): Promise<SetupTotpActionResult> {
  const result = await generateTotpSetup(userId, userEmail);
  return {
    qrcodeDataUrl: result.qrcodeDataUrl,
    secretMasked: maskSecret(result.secret),
    backupCodes: result.backupCodes,
  };
}

/**
 * Verify a TOTP / backup code at the MFA challenge step (S-002). On success
 * the calling layer flips `session.user.mfaVerified = true` via Auth.js's
 * `unstable_update()` so subsequent middleware checks pass.
 */
export async function verifyTotpAction(userId: string, code: string): Promise<VerifyTotpResult> {
  return verifyTotpCode(userId, code);
}

/**
 * Re-roll the 8 backup codes from the security settings page (S-083). Requires
 * the user's current password — we re-verify against `User.passwordHash` here
 * (NOT via `verifyPassword`, to avoid writing a LoginAttempt row for what is a
 * sensitive-action re-auth, not a login). Callers MUST follow up with
 * `bumpSessionVersion(userId)` to terminate other sessions — that lives in
 * the Server Action layer per docs/05 §6.10.
 */
export async function regenerateBackupCodesAction(
  input: RegenerateBackupCodesActionInput,
  userId: string,
): Promise<RegenerateBackupCodesActionResult> {
  if (!userId) throw new Error("regenerateBackupCodesAction: userId is required");
  const password = (input.password ?? "").toString();
  if (!password) {
    throw new UnauthorizedError({ code: "INVALID_CREDENTIALS" });
  }

  const user = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    }),
  );

  if (!user?.passwordHash || !(await verifyArgon2(user.passwordHash, password))) {
    throw new UnauthorizedError({ code: "INVALID_CREDENTIALS" });
  }

  const result = await regenerateBackupCodes(userId);
  return { codes: result.backupCodes };
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

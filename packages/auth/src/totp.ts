// TotpService — TOTP 2FA setup, verification, backup codes (T-01-06).
//
// docs/05 §3.2 / §6.10 / §3.9 contract:
//   - `TotpSecret(userId PK, secretEnc, activatedAt?)` — one secret per user,
//      symmetric-encrypted at rest with PII_ENCRYPTION_KEY (AES-256-GCM, docs/05 §12).
//   - `BackupCode(id, userId, codeHash, usedAt?)` — argon2id-hashed one-shot
//      codes. 8 codes are issued at setup and re-rolled by
//      `regenerateBackupCodes`. Once `usedAt` is set, the code cannot be
//      reused.
//   - RLS: `TotpSecret_isolation` / `BackupCode_isolation` derive ownership
//      from the related `User.tenantId`. We open every DB call with
//      `SYSTEM_TENANT_CONTEXT` (isSaasAdmin=true) so the auth layer can read
//      these tables WITHOUT requiring an active per-tenant context — the same
//      pattern `verifyPassword` uses for LoginAttempt / AuditLog (see
//      auth-service.ts).
//
// TOTP parameters are SHA-1 / 6 digits / 30 s period — the de-facto default
// every authenticator app (Authy, 1Password, Google Authenticator, …) expects.
// A `window: 1` tolerance on verify lets a code valid for the previous /
// current / next 30-second step pass, smoothing clock drift.

import { randomBytes } from "node:crypto";

import { SYSTEM_TENANT_CONTEXT, withTenant, type TxClient } from "@solar/db";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

import { hashPassword, verifyArgon2 } from "./password.js";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-encryption.js";

// ---------------------------------------------------------------------------
// Constants — pinned to the values every TOTP authenticator app expects.
// ---------------------------------------------------------------------------

const DEFAULT_ISSUER = "Solar SaaS";
const TOTP_ALGORITHM = "SHA1" as const;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SEC = 30;
// `window: 1` accepts the previous, current, and next 30-s step (±30 s drift).
const TOTP_VERIFY_WINDOW = 1;
const SECRET_BYTES = 20; // 160 bits per RFC 4226 / Google Authenticator spec.
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_BYTES = 6; // → 12 hex chars (96 bits of entropy).

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateTotpSetupResult {
  /**
   * Base32 of the shared secret. Returned ONCE to the caller so the UI can
   * render a fallback manual-entry string under the QR code (docs/04 S-003).
   * Never persisted in plaintext — `TotpSecret.secretEnc` holds the AES-GCM
   * encrypted form.
   */
  secret: string;
  /**
   * `data:image/png;base64,...` URL the UI embeds in an `<img>` tag.
   * Property name matches the docs/05 §4.3 API contract (lower-case `c`).
   */
  qrcodeDataUrl: string;
  /**
   * 8 backup codes, plaintext. Shown once at setup — the DB only holds
   * argon2id hashes.
   */
  backupCodes: string[];
}

export interface ActivateTotpResult {
  activated: boolean;
}

export interface VerifyTotpResult {
  ok: boolean;
  /** True iff the matching code was a backup code (consumed on success). */
  usedBackup: boolean;
}

export interface RegenerateBackupCodesResult {
  backupCodes: string[];
}

/**
 * Provision a new TOTP secret + 8 backup codes for the given user.
 *
 * - Creates / upserts `TotpSecret` with the AES-GCM-encrypted secret. The row
 *   is left INACTIVE (`activatedAt = null`) until the user confirms a valid
 *   TOTP code via `activateTotp`. Re-running setup overwrites a prior pending
 *   secret (the user might have lost the QR before scanning it).
 * - Replaces any pre-existing backup codes — both used and unused — so the new
 *   set is the only valid set.
 * - Returns the plaintext secret + backup codes ONCE to the caller. The
 *   higher-level Server Action layer (`totp-actions.ts`) drops the secret
 *   before returning to the client.
 */
export async function generateTotpSetup(
  userId: string,
  userEmail: string,
  issuer: string = DEFAULT_ISSUER,
): Promise<GenerateTotpSetupResult> {
  if (!userId) throw new Error("generateTotpSetup: userId is required");
  if (!userEmail) throw new Error("generateTotpSetup: userEmail is required");

  // 160-bit random secret. `OTPAuth.Secret` derives the base32 / hex / etc.
  // representations the QR code and verify path need.
  const secret = new OTPAuth.Secret({ size: SECRET_BYTES });

  const totp = new OTPAuth.TOTP({
    issuer,
    label: userEmail,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SEC,
    secret,
  });

  const uri = totp.toString();
  const qrcodeDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M" });

  const secretEnc = encryptTotpSecret(secret.base32);

  // Plaintext backup codes returned to the caller; argon2 hashes go to DB.
  const plainBackupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  const backupCodeHashes = await Promise.all(plainBackupCodes.map((code) => hashPassword(code)));

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    await tx.totpSecret.upsert({
      where: { userId },
      update: { secretEnc, activatedAt: null },
      create: { userId, secretEnc, activatedAt: null },
    });

    // Drop ALL prior codes (used or not) so the new set is the only set.
    await tx.backupCode.deleteMany({ where: { userId } });
    await tx.backupCode.createMany({
      data: backupCodeHashes.map((codeHash) => ({ userId, codeHash })),
    });
  });

  return {
    secret: secret.base32,
    qrcodeDataUrl,
    backupCodes: plainBackupCodes,
  };
}

/**
 * Activate a pending TOTP secret by verifying the user-typed code matches the
 * authenticator app's current window. Sets `TotpSecret.activatedAt = now()`
 * on success. Idempotent: a second call with a valid code is a no-op.
 */
export async function activateTotp(userId: string, totpCode: string): Promise<ActivateTotpResult> {
  if (!userId) throw new Error("activateTotp: userId is required");
  const code = (totpCode ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { activated: false };

  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const row = await tx.totpSecret.findUnique({ where: { userId } });
    if (!row) return { activated: false };

    const secretB32 = decryptTotpSecret(row.secretEnc);
    if (!validateTotp(secretB32, code)) return { activated: false };

    if (!row.activatedAt) {
      await tx.totpSecret.update({
        where: { userId },
        data: { activatedAt: new Date() },
      });
    }
    return { activated: true };
  });
}

/**
 * Verify a TOTP code OR a backup code. Falls back to backup-code verification
 * only when the TOTP path fails. A matched backup code is consumed (`usedAt`
 * set) so it cannot be reused.
 *
 * Returns `{ ok: false, usedBackup: false }` for every failure mode (no
 * secret, not activated, bad code, exhausted backup codes) — callers never
 * see the failure reason; the UI just renders "コードが一致しません".
 */
export async function verifyTotpCode(userId: string, code: string): Promise<VerifyTotpResult> {
  if (!userId) throw new Error("verifyTotpCode: userId is required");
  const trimmed = (code ?? "").trim();
  if (!trimmed) return { ok: false, usedBackup: false };

  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const row = await tx.totpSecret.findUnique({ where: { userId } });
    if (!row || !row.activatedAt) return { ok: false, usedBackup: false };

    // TOTP path first — fast and far more common than backup codes.
    if (/^\d{6}$/.test(trimmed)) {
      const secretB32 = decryptTotpSecret(row.secretEnc);
      if (validateTotp(secretB32, trimmed)) {
        return { ok: true, usedBackup: false };
      }
    }

    // Backup-code fallback. We argon2-verify the input against EVERY unused
    // code rather than indexing on the hash because argon2 hashes are salted
    // — there is no deterministic lookup. The cost is O(8) verifies per
    // attempt, dominated by the TOTP path's single decrypt + HMAC.
    const usedBackup = await consumeMatchingBackupCode(tx, userId, trimmed);
    return { ok: usedBackup, usedBackup };
  });
}

/**
 * Re-roll the 8 backup codes. Existing codes (used or not) are dropped and
 * replaced. The caller is expected to also call `bumpSessionVersion(userId)`
 * to terminate all other sessions — that lives in the Server Action layer
 * (docs/05 S-083 / §6.10).
 */
export async function regenerateBackupCodes(userId: string): Promise<RegenerateBackupCodesResult> {
  if (!userId) throw new Error("regenerateBackupCodes: userId is required");

  const plainBackupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  const backupCodeHashes = await Promise.all(plainBackupCodes.map((code) => hashPassword(code)));

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    await tx.backupCode.deleteMany({ where: { userId } });
    await tx.backupCode.createMany({
      data: backupCodeHashes.map((codeHash) => ({ userId, codeHash })),
    });
  });

  return { backupCodes: plainBackupCodes };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function generateBackupCodes(n: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    codes.push(randomBytes(BACKUP_CODE_BYTES).toString("hex"));
  }
  return codes;
}

function validateTotp(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SEC,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // `validate` returns the integer delta from the current step or `null`.
  const delta = totp.validate({ token: code, window: TOTP_VERIFY_WINDOW });
  return delta !== null;
}

async function consumeMatchingBackupCode(
  tx: TxClient,
  userId: string,
  candidate: string,
): Promise<boolean> {
  // Backup codes are stored as `aaaa-bbbb-cccc` or `aaaabbbbcccc` interchangeably;
  // strip dashes / whitespace so users can paste either form.
  const normalised = candidate.replace(/[-\s]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(normalised)) return false;

  const rows = await tx.backupCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const row of rows) {
    if (await verifyArgon2(row.codeHash, normalised)) {
      await tx.backupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
  }
  return false;
}

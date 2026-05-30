// AES-256-GCM symmetric encryption for TOTP shared secrets (and any other PII
// docs/05 §12 routes through the same key).
//
// docs/05 §3.2 stores `TotpSecret.secretEnc` symmetrically encrypted. argon2id
// is one-way and unfit here — we MUST be able to recover the secret to feed
// into otpauth.TOTP at verify time. AES-256-GCM provides confidentiality plus
// integrity (the auth tag) which is exactly what we want.
//
// Wire format (single base64 blob to keep schema unchanged):
//
//   base64( iv(12) || ciphertext(N) || tag(16) )
//
// 12-byte IV is the canonical GCM nonce size (NIST SP 800-38D). 16-byte tag is
// the GCM default. Each call generates a fresh random IV via crypto.randomBytes.
//
// Key material lives in `PII_ENCRYPTION_KEY` — the docs/05 §12 共通鍵 used for
// TOTP secrets and other PII at rest. 64 hex chars = 32 bytes = 256 bits.
// We load and validate the key once at module load so a missing / malformed
// env var crashes on import, not on first encrypt.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENV_VAR = "PII_ENCRYPTION_KEY";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set. Generate with \`openssl rand -hex 32\` and add to .env.local.`,
    );
  }
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${ENV_VAR} must be exactly 64 hex characters (32 bytes / 256 bits). ` +
        "Generate with `openssl rand -hex 32`.",
    );
  }
  cachedKey = Buffer.from(hex, "hex");
  if (cachedKey.length !== KEY_BYTES) {
    throw new Error(`${ENV_VAR} decoded length ${cachedKey.length} != ${KEY_BYTES} bytes.`);
  }
  return cachedKey;
}

/**
 * Encrypt a TOTP shared secret. Returns a single base64 string carrying the
 * IV, ciphertext, and GCM auth tag. The caller stores this verbatim in
 * `TotpSecret.secretEnc`; nothing else is needed to decrypt.
 */
export function encryptTotpSecret(plaintext: string): string {
  if (!plaintext) {
    throw new Error("encryptTotpSecret: plaintext must be a non-empty string");
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Decrypt a value previously produced by `encryptTotpSecret`. Throws if the
 * blob is shorter than IV+TAG, if base64 decoding fails, or if the GCM auth
 * tag does not verify (tamper / wrong key).
 */
export function decryptTotpSecret(encrypted: string): string {
  if (!encrypted) {
    throw new Error("decryptTotpSecret: encrypted must be a non-empty string");
  }
  const key = loadKey();
  const blob = Buffer.from(encrypted, "base64");
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("decryptTotpSecret: payload too short to contain IV + ciphertext + tag");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Test-only escape hatch — lets the Vitest setup clear the module-level key
 * cache after mutating `process.env.PII_ENCRYPTION_KEY`. Application code MUST
 * NOT import this.
 */
export const __testing = {
  resetKeyCache(): void {
    cachedKey = null;
  },
};

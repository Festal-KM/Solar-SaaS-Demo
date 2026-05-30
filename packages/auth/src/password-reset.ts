// Password reset — F-003, docs/05 §6.10.
//
// Two Server Actions back the S-004 / S-005 pages:
//
//   `requestPasswordResetAction({ email, ip })`
//     - Resolves the User by email. Whether or not a row exists we ALWAYS
//       return `{ ok: true }` so the response cannot be used as a user-
//       enumeration oracle. When the user exists we generate a 32-byte random
//       token, argon2id-hash it, store the hash in `PasswordResetToken` with
//       a 30-minute expiry, and dispatch a reset link via `@solar/email`.
//     - Records `AuditLog(STATUS_CHANGE, event: PASSWORD_RESET_REQUESTED)` on
//       the user's home tenant. The AuditAction enum in SP-01 does not yet
//       have a dedicated `PASSWORD_RESET_REQUESTED` value (lands in SP-07);
//       until then we piggy-back on `STATUS_CHANGE` with a discriminator in
//       the JSON payload — exactly the pattern `verifyPassword` uses for
//       `LOGIN_LOCKED` (auth-service.ts).
//
//   `resetPasswordAction({ token, newPassword })`
//     - Finds the matching token by argon2-verifying the supplied plaintext
//       against EVERY unused, in-window row (no deterministic lookup —
//       hashes are salted). Throws `UnauthorizedError(INVALID_OR_EXPIRED_TOKEN)`
//       on any failure mode so the UI surfaces a single generic message.
//     - On success: re-hashes the password with argon2id, bumps the user's
//       `sessionVersion` (force-logout every other device), stamps `usedAt`
//       on the consumed token, and writes
//       `AuditLog(STATUS_CHANGE, event: PASSWORD_RESET_COMPLETED)`.
//
// All DB work runs under `SYSTEM_TENANT_CONTEXT` because the caller is
// unauthenticated — there is no per-tenant context to derive from the
// session. RLS on `PasswordResetToken` / `AuditLog` allows isSaasAdmin=true.

import { randomBytes } from "node:crypto";

import { SYSTEM_TENANT_CONTEXT, withTenant } from "@solar/db";
import { defaultEmailClient, sendPasswordResetEmail, type EmailClient } from "@solar/email";
import { z } from "zod";

import { UnauthorizedError } from "./errors.js";
import { hashPassword, verifyArgon2 } from "./password.js";

const TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MIN = 30;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

export const requestPasswordResetInputSchema = z.object({
  email: z.string().email().max(254),
  ip: z.string().min(1).max(64),
});

export const resetPasswordInputSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export interface PasswordResetDeps {
  emailClient?: EmailClient;
  /**
   * Base URL used to build the reset link the user clicks in the email.
   * Defaults to `process.env.APP_BASE_URL` and ultimately to
   * `http://localhost:3000`. The link points at S-005 (`/reset/[token]`).
   */
  appBaseUrl?: string;
}

/**
 * Request a password reset email. Always resolves to `{ ok: true }` regardless
 * of whether the email maps to a real user (enumeration mitigation). The
 * caller MUST surface the same "we sent the link if the account exists" UI in
 * both branches.
 */
export async function requestPasswordResetAction(
  rawInput: RequestPasswordResetInput,
  deps: PasswordResetDeps = {},
): Promise<{ ok: true }> {
  const parsed = requestPasswordResetInputSchema.safeParse(rawInput);
  // Bad shape => silent ok to stay enumeration-safe even on malformed input.
  if (!parsed.success) return { ok: true };

  const email = parsed.data.email.trim().toLowerCase();
  const emailClient = deps.emailClient ?? defaultEmailClient;
  const appBaseUrl = deps.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";

  // Resolve the user first under SaaS-admin context; the request can come
  // from any tenant and we never know which one until we look the row up.
  const user = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    return tx.user.findUnique({ where: { email }, select: { id: true, tenantId: true } });
  });

  if (!user) {
    // Enumeration safety: don't reveal that the email is unknown.
    return { ok: true };
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = await hashPassword(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: null,
        tenantId: user.tenantId,
        targetType: "User",
        targetId: user.id,
        action: "STATUS_CHANGE",
        ip: parsed.data.ip,
        after: {
          event: "PASSWORD_RESET_REQUESTED",
          email,
        },
      },
    });
  });

  const resetUrl = `${appBaseUrl.replace(/\/$/, "")}/reset/${token}`;
  await sendPasswordResetEmail(emailClient, {
    to: email,
    resetUrl,
    expiresInMinutes: RESET_TOKEN_TTL_MIN,
  });

  return { ok: true };
}

/**
 * Consume a reset token and replace the user's password. Throws
 * `UnauthorizedError(INVALID_OR_EXPIRED_TOKEN)` for every failure mode
 * (unknown / expired / already used) so the UI cannot distinguish them.
 */
export async function resetPasswordAction(rawInput: ResetPasswordInput): Promise<{ ok: true }> {
  const parsed = resetPasswordInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
  }
  const { token, newPassword } = parsed.data;

  const now = new Date();

  // Stage 1 — find the matching row. argon2 hashes are salted so we must
  // verify against every viable (unused + still-in-window) candidate. The
  // pool is bounded by the rate at which reset requests come in for the
  // same user (typically <= 1) so the O(N) cost is small in practice.
  const matched = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const candidates = await tx.passwordResetToken.findMany({
      where: { usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, tokenHash: true },
    });
    for (const row of candidates) {
      if (await verifyArgon2(row.tokenHash, token)) {
        return row;
      }
    }
    return null;
  });

  if (!matched) {
    throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
  }

  const newHash = await hashPassword(newPassword);

  // Stage 2 — atomically replace the password, consume the token, and bump
  // sessionVersion to force every other session to re-login. We do these
  // three writes in one transaction so a partial outcome cannot leave the
  // account in a half-rotated state.
  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: matched.userId },
      select: { id: true, tenantId: true, sessionVersion: true },
    });
    if (!user) {
      // The user was deleted between stages — treat as invalid token.
      throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
    }
    // Consume the token first via CAS — if two requests race on the same
    // plaintext, only one updateMany matches (`usedAt: null`) and the loser
    // hits count === 0 below, forcing a generic 401. Mirrors the pattern in
    // `consumeInviteCode` (invite.ts) for the same reason: avoid double-use
    // of single-use tokens.
    const updated = await tx.passwordResetToken.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
    }
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        sessionVersion: { increment: 1 },
      },
    });
    // bumpSessionVersion is intentionally NOT called separately — the
    // in-transaction `user.update({ sessionVersion: { increment: 1 } })`
    // already did the work. Calling `bumpSessionVersion()` again would tick
    // the counter twice and invalidate the JWT the user is about to receive
    // after re-login.
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId,
        targetType: "User",
        targetId: user.id,
        action: "STATUS_CHANGE",
        after: {
          event: "PASSWORD_RESET_COMPLETED",
        },
      },
    });
  });

  return { ok: true };
}

// Re-exported constants the tests + the Server Action UI layer can reuse.
export const PASSWORD_RESET_TTL_MINUTES = RESET_TOKEN_TTL_MIN;

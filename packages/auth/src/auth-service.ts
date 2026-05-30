// AuthService — docs/05 §6.10 four-step login pipeline.
//
//   1. COUNT failed LoginAttempt rows for this email in the last 15 min.
//   2. If >= 5: throw LockedError. argon2 verify is intentionally skipped.
//   3. Otherwise look up User.passwordHash and verify with argon2id. If the
//      user is missing we still call verify against a dummy hash so the wall
//      clock matches the user-exists path (timing side channel).
//   4. INSERT LoginAttempt with success/reason. On success bump
//      `User.lastLoginAt`. The 5th consecutive failure also writes an
//      AuditLog row so the SaaS operator can see lockouts (SP-07 will swap
//      STATUS_CHANGE for a dedicated LOGIN_LOCKED enum value).
//
// All DB calls go through `withTenant(SYSTEM_TENANT_CONTEXT, ...)` because the
// `LoginAttempt` and `AuditLog` RLS policies only let saas_admin context
// read/write — there is no per-tenant context at login time anyway.
//
// IMPORTANT: the bookkeeping in step 4 (LoginAttempt INSERT, lock AuditLog)
// MUST persist even when verifyPassword ultimately throws — otherwise the
// 15-min lock counter would never accrue. We therefore split the work into
// two independent `withTenant` calls: a read-only one for steps 1-3 and a
// write-only one for step 4 that commits before we re-throw the auth error.
//
// `verifyPassword()` is the **only** place that writes LoginAttempt rows. The
// `probeLock()` helper below is READ-only and lets the Server Action surface
// the lock state to the UI without double-counting failures (the reviewer's
// "5 回失敗で 15 分ロック が実質 2.5 回でトリップする" regression).

import {
  prisma,
  SYSTEM_TENANT_CONTEXT,
  withTenant,
  type Tenant,
  type User,
  type UserRole,
} from "@solar/db";

import { LockedError, UnauthorizedError } from "./errors.js";
import { getDummyHash, verifyArgon2 } from "./password.js";

const LOCK_WINDOW_MINUTES = 15;
const LOCK_THRESHOLD = 5;

export interface VerifyPasswordInput {
  email: string;
  password: string;
  /**
   * Client IP captured by the Server Action (`x-forwarded-for` / `x-real-ip`)
   * or by Auth.js's `authorize(credentials, request)` from `request.headers`.
   * Required so the LoginAttempt row honours the docs/05 §6.10 step 4 contract
   * `{ userId, email, ip, success, reason }`. Use `"0.0.0.0"` only when the
   * source IP is genuinely unknowable (never as a silent fallback).
   */
  ip: string;
}

export type VerifiedUser = User & {
  tenant: Tenant;
  roles: UserRole[];
};

export interface VerifyPasswordResult {
  user: VerifiedUser;
  sessionVersion: number;
}

export interface LockProbeResult {
  locked: boolean;
  lockedUntil?: Date;
  recentFailureCount: number;
}

type FailureReason = "NO_SUCH_USER" | "INVITED_NO_PASSWORD" | "BAD_PASSWORD" | `USER_${string}`;

interface AttemptOutcome {
  user: VerifiedUser | null;
  success: boolean;
  reason: FailureReason | null;
  recentFailureCount: number;
}

/**
 * Read-only lock probe. Returns whether the email is currently in the
 * 5-in-15-min lock window WITHOUT writing a LoginAttempt row. The Server
 * Action layer calls this before `signIn('credentials', ...)` so the S-001 UI
 * can surface a countdown immediately. Crucially, this MUST NOT INSERT — the
 * single source of truth for LoginAttempt writes is `verifyPassword()` inside
 * Auth.js's `authorize()` callback (one write per real attempt).
 */
export async function probeLock(emailRaw: string): Promise<LockProbeResult> {
  const email = emailRaw.trim().toLowerCase();
  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const windowStart = new Date(Date.now() - LOCK_WINDOW_MINUTES * 60_000);
    const recentFailures = await tx.loginAttempt.findMany({
      where: { email, success: false, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (recentFailures.length >= LOCK_THRESHOLD) {
      const oldest = recentFailures[0]!.createdAt;
      const lockedUntil = new Date(oldest.getTime() + LOCK_WINDOW_MINUTES * 60_000);
      return { locked: true, lockedUntil, recentFailureCount: recentFailures.length };
    }
    return { locked: false, recentFailureCount: recentFailures.length };
  });
}

/**
 * Verify email/password and return the user + current sessionVersion. Throws:
 *   - `LockedError`            — 5 failures within 15 min for this email
 *   - `UnauthorizedError`      — bad credentials, suspended / invited user
 *
 * Callers MUST treat any thrown error as a generic "login failed" from the
 * UI; only the lock UI surfaces `lockedUntil` (S-006 / docs/04 §S-006).
 */
export async function verifyPassword(input: VerifyPasswordInput): Promise<VerifyPasswordResult> {
  const email = input.email.trim().toLowerCase();
  const ip = input.ip;

  // -----------------------------------------------------------------------
  // Steps 1-3: read-only — lock probe + argon2 verify.
  // -----------------------------------------------------------------------
  const probe = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const windowStart = new Date(Date.now() - LOCK_WINDOW_MINUTES * 60_000);
    const recentFailures = await tx.loginAttempt.findMany({
      where: { email, success: false, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    if (recentFailures.length >= LOCK_THRESHOLD) {
      const oldest = recentFailures[0]!.createdAt;
      const lockedUntil = new Date(oldest.getTime() + LOCK_WINDOW_MINUTES * 60_000);
      return { locked: true as const, lockedUntil };
    }

    const user = await tx.user.findUnique({
      where: { email },
      include: { tenant: true, roles: true },
    });

    let passwordOk = false;
    if (user?.passwordHash) {
      passwordOk = await verifyArgon2(user.passwordHash, input.password);
    } else {
      const dummy = await getDummyHash();
      await verifyArgon2(dummy, input.password);
    }

    return {
      locked: false as const,
      user: user as VerifiedUser | null,
      passwordOk,
      recentFailureCount: recentFailures.length,
    };
  });

  if (probe.locked) {
    throw new LockedError(probe.lockedUntil);
  }

  const outcome = classifyOutcome({
    user: probe.user,
    passwordOk: probe.passwordOk,
    recentFailureCount: probe.recentFailureCount,
  });

  // -----------------------------------------------------------------------
  // Step 4: persist LoginAttempt (and AuditLog on the 5th failure). This
  // MUST commit independently of the verify error so the 15-min lock counter
  // accrues correctly.
  // -----------------------------------------------------------------------
  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    await tx.loginAttempt.create({
      data: {
        userId: outcome.user?.id ?? null,
        email,
        ip,
        success: outcome.success,
        reason: outcome.reason,
      },
    });

    if (outcome.success && outcome.user) {
      await tx.user.update({
        where: { id: outcome.user.id },
        data: { lastLoginAt: new Date() },
      });
    } else if (outcome.user && outcome.recentFailureCount + 1 === LOCK_THRESHOLD) {
      // TODO(SP-07 audit): replace STATUS_CHANGE with dedicated LOGIN_LOCKED enum value once docs/05 §3.7 AuditAction is extended
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          tenantId: outcome.user.tenantId,
          targetType: "User",
          targetId: outcome.user.id,
          action: "STATUS_CHANGE",
          after: {
            event: "LOGIN_LOCKED",
            email,
            ip,
            windowMinutes: LOCK_WINDOW_MINUTES,
            threshold: LOCK_THRESHOLD,
          },
        },
      });
    }
  });

  if (!outcome.success) {
    if (outcome.user && outcome.user.status !== "ACTIVE") {
      throw new UnauthorizedError({
        code: outcome.user.status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_INVITED",
      });
    }
    throw new UnauthorizedError({ code: "INVALID_CREDENTIALS" });
  }

  return {
    user: outcome.user!,
    sessionVersion: outcome.user!.sessionVersion,
  };
}

function classifyOutcome(input: {
  user: VerifiedUser | null;
  passwordOk: boolean;
  recentFailureCount: number;
}): AttemptOutcome {
  const { user, passwordOk, recentFailureCount } = input;
  const isActive = user?.status === "ACTIVE";
  const success = Boolean(user) && passwordOk && isActive;

  let reason: FailureReason | null = null;
  if (!user) {
    reason = "NO_SUCH_USER";
  } else if (!user.passwordHash) {
    reason = "INVITED_NO_PASSWORD";
  } else if (!passwordOk) {
    reason = "BAD_PASSWORD";
  } else if (!isActive) {
    reason = `USER_${user.status}`;
  }

  return { user, success, reason, recentFailureCount };
}

/**
 * Force-logout helper — increments `User.sessionVersion`. Existing JWTs carry
 * the old version and the `session` callback rejects them on next use.
 */
export async function bumpSessionVersion(userId: string): Promise<number> {
  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    return updated.sessionVersion;
  });
}

// Re-export `prisma` reference for tests that want to assert via the guarded
// client. Internal use only.
export const __internal = { prisma };

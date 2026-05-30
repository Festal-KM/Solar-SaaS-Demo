// Integration tests for the login pipeline (T-01-05, docs/05 §6.10).
//
// Required scenarios from SP-01-bootstrap.md:
//   1. Happy-path login records success + lastLoginAt.
//   2. Five failures in 15 min raise LockedError with `lockedUntil`.
//   3. `bumpSessionVersion()` invalidates a JWT carrying the old version via
//      the `jwt` + `session` callbacks in `authConfig`.
//   4. (review feedback) `loginAction` end-to-end: 5 failures via `signIn`
//      then a 6th call lands on `status: "LOCKED"` AND only writes the
//      LoginAttempt once per attempt (no double-counting).
//
// Backed by the dedicated `solar_saas_test` database (same as @solar/db).
// `verifyPassword` runs with `isSaasAdmin=true` internally so the LoginAttempt /
// AuditLog RLS policies allow it.

import { PrismaClient } from "@solar/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  authConfig,
  bumpSessionVersion,
  hashPassword,
  LockedError,
  loginAction,
  UnauthorizedError,
  verifyPassword,
  type SignInFn,
} from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `auth login tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

const TEST_PASSWORD = "Pilot!2026";
let userId: string;
let tenantId: string;

async function truncate(): Promise<void> {
  await admin.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "Session",
      "LoginAttempt",
      "BackupCode",
      "TotpSecret",
      "UserInvitation",
      "InviteCode",
      "Relationship",
      "UserRole",
      "User",
      "WholesalerSettings",
      "Tenant"
    RESTART IDENTITY CASCADE;
  `);
}

async function seed(): Promise<{ userId: string; tenantId: string }> {
  const tenant = await admin.tenant.create({
    data: { type: "WHOLESALER", name: "テスト卸 株式会社", plan: "PILOT" },
  });
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await admin.user.create({
    data: {
      tenantId: tenant.id,
      email: "login-test@example.com",
      name: "テスト ユーザー",
      status: "ACTIVE",
      passwordHash,
      sessionVersion: 0,
      roles: {
        create: [{ role: "WHOLESALER_ADMIN" }],
      },
    },
  });
  return { userId: user.id, tenantId: tenant.id };
}

beforeAll(async () => {
  // Schema is migrated by `pnpm -F @solar/db test` setup; we rely on that
  // having been run at least once. If the DB hasn't been migrated yet the
  // truncate below will fail loudly with a helpful "relation does not exist".
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
  const seeded = await seed();
  userId = seeded.userId;
  tenantId = seeded.tenantId;
});

describe("verifyPassword — happy path", () => {
  it("returns the user, writes a successful LoginAttempt, updates lastLoginAt", async () => {
    const before = await admin.user.findUniqueOrThrow({ where: { id: userId } });
    expect(before.lastLoginAt).toBeNull();

    const result = await verifyPassword({
      email: "login-test@example.com",
      password: TEST_PASSWORD,
      ip: "127.0.0.1",
    });

    expect(result.user.id).toBe(userId);
    expect(result.user.tenant.id).toBe(tenantId);
    expect(result.user.roles.map((r) => r.role)).toContain("WHOLESALER_ADMIN");
    expect(result.sessionVersion).toBe(0);

    const attempts = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.success).toBe(true);
    expect(attempts[0]!.userId).toBe(userId);
    expect(attempts[0]!.ip).toBe("127.0.0.1");

    const after = await admin.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.lastLoginAt!.getTime()).toBeGreaterThan(before.createdAt.getTime() - 1);
  });

  it("rejects a wrong password without locking the account", async () => {
    await expect(
      verifyPassword({
        email: "login-test@example.com",
        password: "WRONG_PASSWORD",
        ip: "127.0.0.1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const attempts = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.success).toBe(false);
    expect(attempts[0]!.reason).toBe("BAD_PASSWORD");
    expect(attempts[0]!.ip).toBe("127.0.0.1");
  });
});

describe("verifyPassword — 5-in-15-minutes lockout", () => {
  it("throws LockedError with lockedUntil ~15 min ahead after 5 failures", async () => {
    // Seed 5 failed attempts within the lock window (4.9 min ago oldest, 0.1 min
    // ago newest). Using a fixed `createdAt` lets us assert lockedUntil exactly.
    const now = Date.now();
    const failures = Array.from({ length: 5 }).map((_, i) => ({
      email: "login-test@example.com",
      ip: "127.0.0.1",
      success: false,
      reason: "BAD_PASSWORD",
      userId,
      createdAt: new Date(now - (5 - i) * 60_000),
    }));
    await admin.loginAttempt.createMany({ data: failures });

    let caught: unknown;
    try {
      await verifyPassword({
        email: "login-test@example.com",
        password: TEST_PASSWORD,
        ip: "127.0.0.1",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LockedError);
    expect(caught).toBeInstanceOf(UnauthorizedError);

    const err = caught as LockedError;
    expect(err.code).toBe("LOCKED_TEMPORARILY");
    // Oldest failure (5 min ago) + 15 min = ~10 min in the future.
    const tenMinFromNow = now + 10 * 60_000;
    expect(err.lockedUntil.getTime()).toBeGreaterThanOrEqual(tenMinFromNow - 5_000);
    expect(err.lockedUntil.getTime()).toBeLessThanOrEqual(tenMinFromNow + 5_000);
    expect(err.details).toMatchObject({
      lockedUntil: err.lockedUntil.toISOString(),
    });
  });

  it("writes an AuditLog row when the 5th failure flips the account into the locked window", async () => {
    // Pre-load 4 failures so the 5th attempt (this verifyPassword call) trips
    // the threshold during step 4 of docs/05 §6.10.
    const now = Date.now();
    await admin.loginAttempt.createMany({
      data: Array.from({ length: 4 }).map((_, i) => ({
        email: "login-test@example.com",
        ip: "127.0.0.1",
        success: false,
        reason: "BAD_PASSWORD",
        userId,
        createdAt: new Date(now - (4 - i) * 60_000),
      })),
    });

    await expect(
      verifyPassword({
        email: "login-test@example.com",
        password: "STILL_WRONG",
        ip: "127.0.0.1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const audits = await admin.auditLog.findMany({
      where: { targetType: "User", targetId: userId, action: "STATUS_CHANGE" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ event: "LOGIN_LOCKED" });
  });
});

describe("loginAction — end-to-end via injected signIn", () => {
  // The Server Action layer wires its own `signIn` from `apps/web/auth.ts`.
  // For the unit test we inject a stub that calls `verifyPassword` directly —
  // exactly what Auth.js's `authorize()` callback does in production. This
  // mirrors the contract that LoginAttempt is written by `verifyPassword` and
  // by `verifyPassword` ALONE (the regression the reviewer flagged).
  const makeFakeSignIn = (): SignInFn => {
    return async (_provider, opts) => {
      // Production `authorize()` swallows errors and returns null; signIn()
      // then throws a CredentialsSignin error. We replicate by throwing a
      // generic Error so loginAction's catch branch fires.
      try {
        await verifyPassword({ email: opts.email, password: opts.password, ip: opts.ip });
        return { ok: true };
      } catch {
        throw new Error("CredentialsSignin");
      }
    };
  };

  it("returns LOCKED on the 6th attempt without writing a 6th LoginAttempt row", async () => {
    const signIn = makeFakeSignIn();

    // First 4 wrong-password attempts via loginAction are plain bad
    // credentials. Each writes EXACTLY one LoginAttempt — confirming there's
    // no double-write (the reviewer's blocker).
    for (let i = 0; i < 4; i++) {
      const r = await loginAction(
        {
          email: "login-test@example.com",
          password: "WRONG_PASSWORD",
          ip: "127.0.0.1",
        },
        { signIn },
      );
      expect(r.status).toBe("INVALID_CREDENTIALS");
    }

    const after4 = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    // Four attempts, four rows. More means LoginAttempt is double-written.
    expect(after4).toHaveLength(4);
    expect(after4.every((a) => a.success === false)).toBe(true);

    // 5th attempt: probeLock sees 4 (< threshold), so it proceeds. signIn
    // runs verifyPassword which writes the 5th failure. loginAction's catch
    // branch then re-probes, sees 5 failures, and surfaces LOCKED to the UI.
    const fifth = await loginAction(
      {
        email: "login-test@example.com",
        password: "WRONG_PASSWORD",
        ip: "127.0.0.1",
      },
      { signIn },
    );
    expect(fifth.status).toBe("LOCKED");

    const after5 = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    expect(after5).toHaveLength(5);

    // 6th attempt — even with the correct password — must short-circuit on
    // probeLock alone WITHOUT writing another LoginAttempt row.
    const sixth = await loginAction(
      {
        email: "login-test@example.com",
        password: TEST_PASSWORD,
        ip: "127.0.0.1",
      },
      { signIn },
    );
    expect(sixth.status).toBe("LOCKED");
    if (sixth.status === "LOCKED") {
      expect(sixth.lockedUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const after6 = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    expect(after6).toHaveLength(5);
  });

  it("happy path via loginAction returns OK and writes one LoginAttempt", async () => {
    const signIn = makeFakeSignIn();
    const r = await loginAction(
      {
        email: "login-test@example.com",
        password: TEST_PASSWORD,
        ip: "203.0.113.42",
      },
      { signIn },
    );
    expect(r.status).toBe("OK");
    const attempts = await admin.loginAttempt.findMany({
      where: { email: "login-test@example.com" },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.success).toBe(true);
    expect(attempts[0]!.ip).toBe("203.0.113.42");
  });
});

describe("jwt + session callbacks — sessionVersion forced logout", () => {
  // The forced-logout check now lives in the `jwt` callback (review feedback):
  // a sessionVersion mismatch zeros the JWT to `{}`, and the `session`
  // callback then returns no `user`. The two callbacks are chained in
  // production by Auth.js; we exercise them the same way here.
  type JwtCb = NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>;
  type SessionCb = NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>;

  it("zeros the JWT when sessionVersion is stale after bumpSessionVersion()", async () => {
    const staleToken = {
      sub: userId,
      email: "login-test@example.com",
      name: "テスト ユーザー",
      tenantId,
      tenantType: "WHOLESALER" as const,
      wholesalerId: tenantId,
      dealerId: null,
      roles: ["WHOLESALER_ADMIN" as const],
      isSaasAdmin: false,
      sessionVersion: 0,
    };

    const newVersion = await bumpSessionVersion(userId);
    expect(newVersion).toBe(1);

    const jwtCb = authConfig.callbacks?.jwt as JwtCb | undefined;
    const sessionCb = authConfig.callbacks?.session as SessionCb | undefined;
    if (!jwtCb || !sessionCb) throw new Error("authConfig.callbacks missing");

    const refreshed = await jwtCb({
      token: staleToken,
      // No `user` payload on subsequent-request invocations.
    } as unknown as Parameters<JwtCb>[0]);

    // Stale -> zeroed.
    expect(Object.keys(refreshed ?? {})).toHaveLength(0);

    const result = await sessionCb({
      session: {
        user: {
          id: userId,
          email: "login-test@example.com",
          name: "テスト ユーザー",
          tenantId,
          tenantType: "WHOLESALER",
          wholesalerId: tenantId,
          dealerId: null,
          roles: ["WHOLESALER_ADMIN"],
          isSaasAdmin: false,
          sessionVersion: 0,
        },
        expires: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      token: refreshed ?? {},
    } as unknown as Parameters<SessionCb>[0]);

    expect((result as { user?: unknown }).user).toBeUndefined();
  });

  it("preserves the JWT and projects session.user when sessionVersion still matches", async () => {
    const freshToken = {
      sub: userId,
      email: "login-test@example.com",
      name: "テスト ユーザー",
      tenantId,
      tenantType: "WHOLESALER" as const,
      wholesalerId: tenantId,
      dealerId: null,
      roles: ["WHOLESALER_ADMIN" as const],
      isSaasAdmin: false,
      sessionVersion: 0,
    };

    const jwtCb = authConfig.callbacks?.jwt as JwtCb | undefined;
    const sessionCb = authConfig.callbacks?.session as SessionCb | undefined;
    if (!jwtCb || !sessionCb) throw new Error("authConfig.callbacks missing");

    const refreshed = await jwtCb({
      token: freshToken,
    } as unknown as Parameters<JwtCb>[0]);

    expect((refreshed as { sub?: string })?.sub).toBe(userId);

    const result = await sessionCb({
      session: {
        user: {
          id: userId,
          email: "login-test@example.com",
          name: "テスト ユーザー",
          tenantId,
          tenantType: "WHOLESALER",
          wholesalerId: tenantId,
          dealerId: null,
          roles: ["WHOLESALER_ADMIN"],
          isSaasAdmin: false,
          sessionVersion: 0,
        },
        expires: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      token: refreshed,
    } as unknown as Parameters<SessionCb>[0]);

    const sessionUser = (result as { user?: { id: string; sessionVersion: number } }).user;
    expect(sessionUser?.id).toBe(userId);
    expect(sessionUser?.sessionVersion).toBe(0);
  });
});

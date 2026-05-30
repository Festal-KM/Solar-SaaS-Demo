// Integration tests for password reset (T-01-07, F-003, docs/05 §6.10).
//
// Required scenarios from SP-01-bootstrap.md §5:
//   1. リンク 30 分超過で失効 — token with `expiresAt` in the past is rejected.
//   2. 1 回限り使用 — happy-path reset succeeds, then re-using the same token
//      fails. As a side effect, `bumpSessionVersion` semantics — the User row's
//      `sessionVersion` MUST increment so existing JWTs become stale.
//   3. (sanity) Unknown email request still returns `{ ok: true }` and does
//      NOT write a PasswordResetToken row (enumeration safety).
//
// Backed by the `solar_saas_test` database. All tokens here are seeded
// directly through the admin client so we can drive the `usedAt` / `expiresAt`
// edge cases without waiting 30 minutes.

import { PrismaClient } from "@solar/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  hashPassword,
  PASSWORD_RESET_TTL_MINUTES,
  requestPasswordResetAction,
  resetPasswordAction,
  UnauthorizedError,
  verifyPassword,
} from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `auth reset tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

const ORIGINAL_PASSWORD = "Pilot!2026";
const NEW_PASSWORD = "ChangedPilot!2027";
const TEST_EMAIL = "reset-test@example.com";

async function truncate(): Promise<void> {
  await admin.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "Session",
      "LoginAttempt",
      "PasswordResetToken",
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

interface Seeded {
  userId: string;
  tenantId: string;
}

async function seed(): Promise<Seeded> {
  const tenant = await admin.tenant.create({
    data: { type: "WHOLESALER", name: "リセット卸", plan: "PILOT" },
  });
  const passwordHash = await hashPassword(ORIGINAL_PASSWORD);
  const user = await admin.user.create({
    data: {
      tenantId: tenant.id,
      email: TEST_EMAIL,
      name: "リセット ユーザー",
      status: "ACTIVE",
      passwordHash,
      sessionVersion: 0,
      roles: { create: [{ role: "WHOLESALER_ADMIN" }] },
    },
  });
  return { userId: user.id, tenantId: tenant.id };
}

beforeAll(async () => {
  // Schema is migrated by `pnpm -F @solar/db test`; we rely on that having
  // been run at least once. The TRUNCATE in `beforeEach` fails loudly with
  // "relation does not exist" otherwise.
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
});

// ---------------------------------------------------------------------------
// Scenario 1: happy-path reset rotates the password + bumps sessionVersion.
// ---------------------------------------------------------------------------

describe("resetPasswordAction — happy path", () => {
  it("rotates the password and bumps sessionVersion", async () => {
    const { userId } = await seed();
    await requestPasswordResetAction({ email: TEST_EMAIL, ip: "127.0.0.1" });

    // Test harness reaches into the DB to retrieve the row. In production the
    // token only exists in the email body — we cannot replicate that path
    // here, but we CAN seed our own row with a known plaintext so the
    // argon2-verify path is exercised identically.
    const rows = await admin.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);

    const KNOWN_TOKEN = "a".repeat(64); // 64-char hex shape matches randomBytes(32).toString("hex")
    const tokenHash = await hashPassword(KNOWN_TOKEN);
    await admin.passwordResetToken.update({
      where: { id: rows[0]!.id },
      data: { tokenHash },
    });

    const before = await admin.user.findUniqueOrThrow({ where: { id: userId } });

    const result = await resetPasswordAction({ token: KNOWN_TOKEN, newPassword: NEW_PASSWORD });
    expect(result).toEqual({ ok: true });

    const after = await admin.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).not.toEqual(before.passwordHash);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);

    // The old password no longer authenticates; the new one does.
    await expect(
      verifyPassword({ email: TEST_EMAIL, password: ORIGINAL_PASSWORD, ip: "127.0.0.1" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    const ok = await verifyPassword({
      email: TEST_EMAIL,
      password: NEW_PASSWORD,
      ip: "127.0.0.1",
    });
    expect(ok.user.id).toBe(userId);

    // Token row is consumed.
    const consumed = await admin.passwordResetToken.findUniqueOrThrow({
      where: { id: rows[0]!.id },
    });
    expect(consumed.usedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: 30-minute expiry.
// ---------------------------------------------------------------------------

describe("resetPasswordAction — expiry", () => {
  it("rejects a token whose expiresAt is in the past", async () => {
    const { userId } = await seed();
    const KNOWN_TOKEN = "b".repeat(64);
    const tokenHash = await hashPassword(KNOWN_TOKEN);
    await admin.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        // 1 minute past expiry — still inside the 30-minute window, but
        // expired regardless.
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await expect(
      resetPasswordAction({ token: KNOWN_TOKEN, newPassword: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // Make sure the token row was NOT consumed by a failed attempt.
    const rows = await admin.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).toBeNull();
  });

  it("accepts a token whose expiresAt is still in the future (sanity)", async () => {
    const { userId } = await seed();
    const KNOWN_TOKEN = "c".repeat(64);
    const tokenHash = await hashPassword(KNOWN_TOKEN);
    await admin.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    const result = await resetPasswordAction({
      token: KNOWN_TOKEN,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: single-use semantics.
// ---------------------------------------------------------------------------

describe("resetPasswordAction — single-use", () => {
  it("rejects the second use of the same token", async () => {
    const { userId } = await seed();
    const KNOWN_TOKEN = "d".repeat(64);
    const tokenHash = await hashPassword(KNOWN_TOKEN);
    await admin.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    const first = await resetPasswordAction({
      token: KNOWN_TOKEN,
      newPassword: NEW_PASSWORD,
    });
    expect(first).toEqual({ ok: true });

    await expect(
      resetPasswordAction({ token: KNOWN_TOKEN, newPassword: "AnotherPassword!2027" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("survives a concurrent race: exactly one resetPasswordAction wins, the other gets INVALID_OR_EXPIRED_TOKEN", async () => {
    const { userId } = await seed();
    const KNOWN_TOKEN = "e".repeat(64);
    const tokenHash = await hashPassword(KNOWN_TOKEN);
    await admin.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    // Fire both calls in parallel. The Stage 2 CAS (`updateMany` with
    // `usedAt: null`) is what makes this deterministic — without it the two
    // transactions could both pass the Stage 1 lookup and both rewrite the
    // password / increment sessionVersion twice.
    const results = await Promise.allSettled([
      resetPasswordAction({ token: KNOWN_TOKEN, newPassword: "RaceWinner!2027" }),
      resetPasswordAction({ token: KNOWN_TOKEN, newPassword: "RaceLoser!2027" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loser = rejected[0] as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(UnauthorizedError);
    expect((loser.reason as UnauthorizedError).code).toBe("INVALID_OR_EXPIRED_TOKEN");

    // The token row reached the consumed state exactly once.
    const rows = await admin.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).not.toBeNull();

    // And sessionVersion was bumped exactly once (not twice) because only the
    // winner's transaction completed Stage 2.
    const after = await admin.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.sessionVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bonus: enumeration safety on requestPasswordResetAction.
// ---------------------------------------------------------------------------

describe("requestPasswordResetAction — enumeration safety", () => {
  it("returns ok:true and writes no row when the email is unknown", async () => {
    // Seed nothing — User table is empty.
    const result = await requestPasswordResetAction({
      email: "no-such-user@example.com",
      ip: "127.0.0.1",
    });
    expect(result).toEqual({ ok: true });

    const rows = await admin.passwordResetToken.findMany({});
    expect(rows).toHaveLength(0);
  });
});

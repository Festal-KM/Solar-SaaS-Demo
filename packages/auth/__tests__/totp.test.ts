// Integration tests for the TOTP 2FA service (T-01-06, docs/05 §3.2 §6.10).
//
// Required scenarios from SP-01-bootstrap.md §4 T-01-06:
//   1. TOTP コード検証成功・失敗 — generate setup, derive a valid 6-digit code
//      with otpauth, verify it succeeds; verify `000000` fails.
//   2. バックアップコード 1 個使用で再利用不可 — call verifyTotpCode with one
//      of the 8 codes returned from setup, then call it again with the same
//      code and assert the second attempt fails.
//   3. 必須ロールで TOTP 未設定 — seed a User with `twoFactorRequired = true`
//      and no TotpSecret. Drive the authorize() → jwt() → session() chain
//      and assert `session.user.mfaSetupRequired === true`.
//
// Backed by the dedicated `solar_saas_test` database (same as @solar/db).

import { PrismaClient } from "@solar/db";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  activateTotp,
  authConfig,
  generateTotpSetup,
  hashPassword,
  regenerateBackupCodesAction,
  setupTotpAction,
  UnauthorizedError,
  verifyTotpCode,
} from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `auth totp tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

const TEST_PASSWORD = "Pilot!2026";
const TEST_EMAIL = "totp-test@example.com";

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

interface SeededUser {
  userId: string;
  tenantId: string;
}

async function seedUser(opts: { twoFactorRequired: boolean; email?: string }): Promise<SeededUser> {
  const tenant = await admin.tenant.create({
    data: { type: "WHOLESALER", name: "TOTP テスト卸", plan: "PILOT" },
  });
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await admin.user.create({
    data: {
      tenantId: tenant.id,
      email: opts.email ?? TEST_EMAIL,
      name: "TOTP ユーザー",
      status: "ACTIVE",
      passwordHash,
      twoFactorRequired: opts.twoFactorRequired,
      sessionVersion: 0,
      roles: { create: [{ role: "WHOLESALER_ADMIN" }] },
    },
  });
  return { userId: user.id, tenantId: tenant.id };
}

beforeAll(async () => {
  // Schema migrated by `pnpm -F @solar/db test` setup — same invariant the
  // sibling login.test.ts relies on.
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
});

// ---------------------------------------------------------------------------
// Scenario 1: TOTP code verification success + failure.
// ---------------------------------------------------------------------------

describe("verifyTotpCode — TOTP path", () => {
  it("accepts a valid 6-digit TOTP code and rejects 000000", async () => {
    const { userId } = await seedUser({ twoFactorRequired: true });
    const setup = await generateTotpSetup(userId, TEST_EMAIL);

    expect(setup.qrcodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.backupCodes).toHaveLength(8);
    setup.backupCodes.forEach((code) => expect(code).toMatch(/^[0-9a-f]{12}$/));

    // Activate the secret with a valid code so verifyTotpCode is willing to
    // consider it. Mirrors the docs/05 §6.10 flow where the user confirms
    // setup before MFA is enforced.
    const validCode = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate();

    const activate = await activateTotp(userId, validCode);
    expect(activate.activated).toBe(true);

    // Re-derive a fresh code post-activation (the previous one might be on
    // the very edge of a step boundary).
    const freshCode = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate();

    const ok = await verifyTotpCode(userId, freshCode);
    expect(ok).toEqual({ ok: true, usedBackup: false });

    const bad = await verifyTotpCode(userId, "000000");
    expect(bad).toEqual({ ok: false, usedBackup: false });
  });

  it("rejects a TOTP code when the secret was never activated", async () => {
    const { userId } = await seedUser({ twoFactorRequired: true });
    const setup = await generateTotpSetup(userId, TEST_EMAIL);

    // Skip activateTotp — secret is pending.
    const code = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate();

    const r = await verifyTotpCode(userId, code);
    expect(r).toEqual({ ok: false, usedBackup: false });
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: backup code single-use semantics.
// ---------------------------------------------------------------------------

describe("verifyTotpCode — backup code path", () => {
  it("accepts a backup code once and rejects the second attempt with the same code", async () => {
    const { userId } = await seedUser({ twoFactorRequired: true });
    const setup = await generateTotpSetup(userId, TEST_EMAIL);

    // Activate so verifyTotpCode is willing to consider the secret + codes.
    const activationCode = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate();
    await activateTotp(userId, activationCode);

    const code = setup.backupCodes[0]!;

    const first = await verifyTotpCode(userId, code);
    expect(first).toEqual({ ok: true, usedBackup: true });

    // DB-level invariant: the row is now marked `usedAt != null`.
    const rows = await admin.backupCode.findMany({ where: { userId } });
    const used = rows.filter((r) => r.usedAt !== null);
    expect(used).toHaveLength(1);

    const second = await verifyTotpCode(userId, code);
    expect(second).toEqual({ ok: false, usedBackup: false });

    // Other 7 codes remain valid — exercise one to be sure we didn't blow
    // them all away.
    const other = setup.backupCodes[1]!;
    const otherResult = await verifyTotpCode(userId, other);
    expect(otherResult).toEqual({ ok: true, usedBackup: true });
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: required-role TOTP-unset users get `mfaSetupRequired = true`
// on the session.
// ---------------------------------------------------------------------------

describe("authorize → jwt → session — MFA enforcement", () => {
  // We exercise the same callback chain Auth.js drives in production:
  //   1. authorize() returns the user payload (with mfaSetupRequired).
  //   2. jwt({ user, token }) copies it onto the JWT.
  //   3. session({ token, session }) projects it onto session.user.
  type AuthorizeFn = (
    credentials: Record<string, unknown>,
    request: Request | undefined,
  ) => Promise<unknown>;
  type JwtCb = NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>;
  type SessionCb = NonNullable<NonNullable<typeof authConfig.callbacks>["session"]>;

  function getAuthorize(): AuthorizeFn {
    // `Credentials()` from @auth/core returns a provider object where the
    // top-level `authorize` is a stub `() => null`; the real handler is
    // tucked inside `options.authorize` so the framework can wrap it with
    // its own credentials parsing. Reach through to the real one for the
    // unit test — production drives this same function via the wrapped
    // path with no extra logic in between for our config.
    const provider = authConfig.providers[0] as unknown as {
      authorize?: AuthorizeFn;
      options?: { authorize?: AuthorizeFn };
    };
    const fn = provider?.options?.authorize ?? provider?.authorize;
    if (!fn) throw new Error("authConfig.providers[0].authorize missing");
    return fn;
  }

  it("sets mfaSetupRequired=true on session for a twoFactorRequired user without TotpSecret", async () => {
    const { userId, tenantId } = await seedUser({ twoFactorRequired: true });

    const authorize = getAuthorize();
    const authorized = (await authorize(
      { email: TEST_EMAIL, password: TEST_PASSWORD, ip: "127.0.0.1" },
      undefined,
    )) as {
      id: string;
      mfaSetupRequired: boolean;
      mfaVerified: boolean;
      sessionVersion: number;
      tenantId: string;
    } | null;

    expect(authorized).not.toBeNull();
    expect(authorized!.id).toBe(userId);
    expect(authorized!.tenantId).toBe(tenantId);
    expect(authorized!.mfaSetupRequired).toBe(true);
    expect(authorized!.mfaVerified).toBe(false);

    const jwtCb = authConfig.callbacks?.jwt as JwtCb | undefined;
    const sessionCb = authConfig.callbacks?.session as SessionCb | undefined;
    if (!jwtCb || !sessionCb) throw new Error("authConfig.callbacks missing");

    const token = await jwtCb({
      token: {},
      user: authorized as never,
    } as unknown as Parameters<JwtCb>[0]);

    expect((token as { mfaSetupRequired?: boolean }).mfaSetupRequired).toBe(true);
    expect((token as { mfaVerified?: boolean }).mfaVerified).toBe(false);

    const projected = await sessionCb({
      session: {
        user: {
          // session.user is overwritten by the callback — these are
          // placeholder fields just to satisfy the TS shape.
          id: userId,
          email: TEST_EMAIL,
          name: "TOTP ユーザー",
          emailVerified: null,
          tenantId,
          tenantType: "WHOLESALER",
          wholesalerId: tenantId,
          dealerId: null,
          roles: ["WHOLESALER_ADMIN"],
          isSaasAdmin: false,
          sessionVersion: 0,
          mfaSetupRequired: false,
          mfaVerified: false,
        },
        expires: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      token,
    } as unknown as Parameters<SessionCb>[0]);

    const user = (projected as { user?: { mfaSetupRequired: boolean; mfaVerified: boolean } }).user;
    expect(user?.mfaSetupRequired).toBe(true);
    expect(user?.mfaVerified).toBe(false);
  });

  it("sets mfaSetupRequired=false and mfaVerified=true for a user with neither flag nor active TotpSecret (no MFA at all)", async () => {
    // twoFactorRequired=false AND no TotpSecret → there is nothing to
    // challenge, so we pre-mark mfaVerified=true so middleware lets the user
    // through without a /mfa stop.
    const { userId } = await seedUser({
      twoFactorRequired: false,
      email: "no-mfa-test@example.com",
    });

    const authorize = getAuthorize();
    const authorized = (await authorize(
      { email: "no-mfa-test@example.com", password: TEST_PASSWORD, ip: "127.0.0.1" },
      undefined,
    )) as {
      id: string;
      mfaSetupRequired: boolean;
      mfaVerified: boolean;
    } | null;

    expect(authorized).not.toBeNull();
    expect(authorized!.id).toBe(userId);
    expect(authorized!.mfaSetupRequired).toBe(false);
    expect(authorized!.mfaVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Server Action wrappers — docs/05 §4.3 API contract.
// ---------------------------------------------------------------------------

describe("setupTotpAction — Server Action contract", () => {
  it("returns {qrcodeDataUrl, secretMasked, backupCodes} matching docs/05 §4.3", async () => {
    const { userId } = await seedUser({ twoFactorRequired: true });
    const result = await setupTotpAction(userId, TEST_EMAIL);

    expect(result.qrcodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.backupCodes).toHaveLength(8);
    // `先頭4文字 + '...' + 末尾4文字` = 11 chars total.
    expect(result.secretMasked).toMatch(/^[A-Z2-7]{4}\.{3}[A-Z2-7]{4}$/);
    expect(result.secretMasked).toHaveLength(11);
    // The masked form MUST NOT carry the full base32 secret across the SA boundary.
    expect(result).not.toHaveProperty("secret");
  });
});

describe("regenerateBackupCodesAction — sensitive-action re-auth", () => {
  it("rejects with UnauthorizedError when the supplied password does not match", async () => {
    const { userId } = await seedUser({
      twoFactorRequired: true,
      email: "regen-wrongpw@example.com",
    });

    await expect(
      regenerateBackupCodesAction({ password: "WrongPassword!2026" }, userId),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // Sanity: correct password still works and returns 8 fresh codes.
    const ok = await regenerateBackupCodesAction({ password: TEST_PASSWORD }, userId);
    expect(ok.codes).toHaveLength(8);
    ok.codes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{12}$/));
  });
});

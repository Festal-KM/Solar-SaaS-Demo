// Integration tests for user invitations + invite codes (T-01-07, F-006 /
// F-007 / F-008, docs/05 §6.10).
//
// Required scenarios from SP-01-bootstrap.md §5:
//   1. 正常受諾 — UserInvitation issued, accepted, user activated with role.
//   2. 期限切れ拒否 — UserInvitation with `expiresAt` in the past is rejected.
//   3. InviteCode maxUses 超過 — createInviteCode(maxUses=1), consume twice;
//      second attempt fails with `INVITE_CODE_EXHAUSTED`.
//
// Backed by the `solar_saas_test` database.

import { PrismaClient } from "@solar/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  acceptUserInviteAction,
  consumeInviteCode,
  createInviteCode,
  issueUserInvitation,
  UnauthorizedError,
} from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `auth invite tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

const ACCEPTED_PASSWORD = "Invitee!2026";

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

interface SeededTenant {
  tenantId: string;
  inviterUserId: string;
}

async function seedTenantWithInviter(opts?: {
  tenantName?: string;
  inviterEmail?: string;
}): Promise<SeededTenant> {
  const tenant = await admin.tenant.create({
    data: { type: "WHOLESALER", name: opts?.tenantName ?? "招待元卸", plan: "PILOT" },
  });
  // Inviter row is required by the schema (`UserInvitation.invitedBy` is a free
  // string but the AuditLog `actorUserId` FK demands a real User).
  const inviter = await admin.user.create({
    data: {
      tenantId: tenant.id,
      email: opts?.inviterEmail ?? "inviter@example.com",
      name: "管理者",
      status: "ACTIVE",
      passwordHash: "x",
      sessionVersion: 0,
      roles: { create: [{ role: "WHOLESALER_ADMIN" }] },
    },
  });
  return { tenantId: tenant.id, inviterUserId: inviter.id };
}

beforeAll(async () => {
  // Schema migrated by `pnpm -F @solar/db test`.
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
});

// ---------------------------------------------------------------------------
// Scenario 1: happy-path UserInvitation acceptance.
// ---------------------------------------------------------------------------

describe("acceptUserInviteAction — happy path", () => {
  it("provisions the user with the invited role and marks the invitation consumed", async () => {
    const { tenantId, inviterUserId } = await seedTenantWithInviter();

    const issued = await issueUserInvitation({
      tenantId,
      email: "new-member@example.com",
      role: "WHOLESALER_EVENT_TEAM",
      invitedBy: inviterUserId,
    });

    const result = await acceptUserInviteAction({
      token: issued.token,
      name: "新規メンバー",
      password: ACCEPTED_PASSWORD,
    });

    expect(result.userId).toBeTypeOf("string");
    expect(result.mfaSetupRequired).toBe(false); // EVENT_TEAM is not 2FA-required by default

    const user = await admin.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { roles: true },
    });
    expect(user.email).toBe("new-member@example.com");
    expect(user.tenantId).toBe(tenantId);
    expect(user.status).toBe("ACTIVE");
    expect(user.roles.map((r) => r.role)).toContain("WHOLESALER_EVENT_TEAM");

    const consumed = await admin.userInvitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
    });
    expect(consumed.acceptedAt).not.toBeNull();
  });

  it("flips twoFactorRequired=true and returns mfaSetupRequired=true for WHOLESALER_ADMIN", async () => {
    const { tenantId, inviterUserId } = await seedTenantWithInviter();

    const issued = await issueUserInvitation({
      tenantId,
      email: "new-admin@example.com",
      role: "WHOLESALER_ADMIN",
      invitedBy: inviterUserId,
    });

    const result = await acceptUserInviteAction({
      token: issued.token,
      name: "新規管理者",
      password: ACCEPTED_PASSWORD,
    });

    expect(result.mfaSetupRequired).toBe(true);
    const user = await admin.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.twoFactorRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: expired invitation is rejected.
// ---------------------------------------------------------------------------

describe("acceptUserInviteAction — expired", () => {
  it("rejects an invitation whose expiresAt is in the past", async () => {
    const { tenantId, inviterUserId } = await seedTenantWithInviter();
    const issued = await issueUserInvitation({
      tenantId,
      email: "expired@example.com",
      role: "DEALER_STAFF",
      invitedBy: inviterUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      acceptUserInviteAction({
        token: issued.token,
        name: "期限切れ",
        password: ACCEPTED_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // Invitation row not consumed.
    const row = await admin.userInvitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
    });
    expect(row.acceptedAt).toBeNull();
  });

  it("rejects an already-accepted invitation on second use", async () => {
    const { tenantId, inviterUserId } = await seedTenantWithInviter();
    const issued = await issueUserInvitation({
      tenantId,
      email: "double@example.com",
      role: "DEALER_STAFF",
      invitedBy: inviterUserId,
    });

    const ok = await acceptUserInviteAction({
      token: issued.token,
      name: "二度受諾",
      password: ACCEPTED_PASSWORD,
    });
    expect(ok.userId).toBeTypeOf("string");

    await expect(
      acceptUserInviteAction({
        token: issued.token,
        name: "二度受諾",
        password: ACCEPTED_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: InviteCode maxUses overflow.
// ---------------------------------------------------------------------------

describe("createInviteCode + consumeInviteCode — maxUses=1 overflow", () => {
  it("rejects the second consume with INVITE_CODE_EXHAUSTED", async () => {
    const { tenantId, inviterUserId } = await seedTenantWithInviter();

    const issued = await createInviteCode({
      wholesalerId: tenantId,
      createdBy: inviterUserId,
      maxUses: 1,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    expect(issued.code).toMatch(/^SOLAR-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const first = await consumeInviteCode(issued.code);
    expect(first.wholesalerId).toBe(tenantId);
    expect(first.inviteCodeId).toBe(issued.inviteCodeId);

    let caught: unknown;
    try {
      await consumeInviteCode(issued.code);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
    expect((caught as UnauthorizedError).code).toBe("INVITE_CODE_EXHAUSTED");

    // Sanity: the DB-level usedCount actually reached the cap (no double-
    // increment, no off-by-one).
    const row = await admin.inviteCode.findUniqueOrThrow({ where: { id: issued.inviteCodeId } });
    expect(row.usedCount).toBe(1);
    expect(row.maxUses).toBe(1);
  });

  it("rejects an unknown code with INVALID_OR_EXPIRED_TOKEN (not exhausted)", async () => {
    let caught: unknown;
    try {
      await consumeInviteCode("SOLAR-XXXX-YYYY");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
    expect((caught as UnauthorizedError).code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: cross-tenant overwrite is rejected.
//
// An attacker who controls Tenant B issues an invitation to an email address
// that is already an ACTIVE user of Tenant A. Accepting that invitation MUST
// NOT overwrite the Tenant A user's tenantId / passwordHash / status —
// otherwise the attacker hijacks the account by colliding on email.
// ---------------------------------------------------------------------------

describe("acceptUserInviteAction — cross-tenant overwrite rejection", () => {
  it("rejects accepting a Tenant B invite when the email already belongs to an ACTIVE Tenant A user", async () => {
    // Tenant A: bootstrap an ACTIVE user via a real invitation acceptance so
    // we exercise the same code path that would happen in prod.
    const tenantA = await seedTenantWithInviter({
      tenantName: "Tenant A",
      inviterEmail: "inviter-a@example.com",
    });
    const SHARED_EMAIL = "victim@example.com";
    const inviteA = await issueUserInvitation({
      tenantId: tenantA.tenantId,
      email: SHARED_EMAIL,
      role: "WHOLESALER_EVENT_TEAM",
      invitedBy: tenantA.inviterUserId,
    });
    const accepted = await acceptUserInviteAction({
      token: inviteA.token,
      name: "被害者",
      password: ACCEPTED_PASSWORD,
    });

    const before = await admin.user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(before.tenantId).toBe(tenantA.tenantId);
    expect(before.status).toBe("ACTIVE");
    const beforePasswordHash = before.passwordHash;

    // Tenant B: attacker issues an invitation to the SAME email.
    const tenantB = await seedTenantWithInviter({
      tenantName: "Tenant B",
      inviterEmail: "inviter-b@example.com",
    });
    const inviteB = await issueUserInvitation({
      tenantId: tenantB.tenantId,
      email: SHARED_EMAIL,
      role: "WHOLESALER_ADMIN",
      invitedBy: tenantB.inviterUserId,
    });

    let caught: unknown;
    try {
      await acceptUserInviteAction({
        token: inviteB.token,
        name: "攻撃者",
        password: "Attacker!2026",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
    expect((caught as UnauthorizedError).code).toBe("INVALID_OR_EXPIRED_TOKEN");

    // The Tenant A user is untouched: same tenantId, same passwordHash.
    const after = await admin.user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(after.tenantId).toBe(tenantA.tenantId);
    expect(after.passwordHash).toBe(beforePasswordHash);
    expect(after.status).toBe("ACTIVE");

    // Tenant B invitation was NOT consumed.
    const inviteBRow = await admin.userInvitation.findUniqueOrThrow({
      where: { id: inviteB.invitationId },
    });
    expect(inviteBRow.acceptedAt).toBeNull();
  });
});

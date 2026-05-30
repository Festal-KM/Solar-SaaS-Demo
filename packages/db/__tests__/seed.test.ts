// Smoke test for prisma/seed.ts (T-01-12).
//
// Verifies the contract that matters for the rest of SP-01:
//   1. `seedAll()` is exported and can be called against the test DB.
//   2. Two invocations are a no-op the second time around (idempotency).
//   3. The pilot password is stored only as an argon2id hash — never as
//      plaintext — so it cannot leak via a dump of the User table.
//
// Auth flow correctness (loginAction succeeds with `Pilot!2026`) is exercised
// in the Playwright suite (`tests/e2e/auth/seed-login.spec.ts`). Keeping the
// Vitest layer at smoke-level avoids dragging next-auth/Server Action setup
// into a DB integration test.

import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedAll } from "../prisma/seed.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `seed tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

async function applyMigrations(): Promise<void> {
  execSync("pnpm prisma migrate deploy --schema=prisma/schema.prisma", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: ADMIN_URL, DATABASE_URL_DIRECT: ADMIN_URL },
    stdio: "inherit",
  });
}

async function truncate(): Promise<void> {
  // SP-02 master tables (no FK from `wholesalerId` to Tenant, so CASCADE on
  // Tenant alone leaves them behind). Listed up front to clear FKs into
  // Relationship / Product before the parent rows.
  await admin.$executeRawUnsafe(`
    TRUNCATE TABLE
      "EventChange",
      "EventShift",
      "EventDealer",
      "Event",
      "DealerPreference",
      "EventCandidateVisibility",
      "EventCandidate",
      "VenueNegotiation",
      "IncentiveRate",
      "ProductPriceHistory",
      "Product",
      "Installer",
      "VenueProvider",
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

beforeAll(async () => {
  await applyMigrations();
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
});

describe("seedAll()", () => {
  it("creates 5 tenants, 3 relationships and 12 users on first run", async () => {
    const summary = await seedAll();

    expect(summary.userCount).toBe(12);
    expect(summary.relationshipIds).toHaveLength(3);
    expect(summary.wholesalerTenantId).toBeTruthy();
    expect(summary.saasOpsTenantId).toBeTruthy();
    expect(summary.dealerTenantIds.alpha).toBeTruthy();

    const [tenants, relationships, users, roles] = await Promise.all([
      admin.tenant.count(),
      admin.relationship.count(),
      admin.user.count(),
      admin.userRole.count(),
    ]);
    expect(tenants).toBe(5); // saas-ops + pilot wholesaler + 3 dealers
    expect(relationships).toBe(3);
    expect(users).toBe(12);
    expect(roles).toBe(12);
  });

  it("is idempotent — running twice yields the same row counts", async () => {
    const first = await seedAll();
    const second = await seedAll();

    expect(second.wholesalerTenantId).toBe(first.wholesalerTenantId);
    expect(second.saasOpsTenantId).toBe(first.saasOpsTenantId);
    expect(second.dealerTenantIds).toEqual(first.dealerTenantIds);
    expect(second.relationshipIds.sort()).toEqual(first.relationshipIds.sort());

    const [tenants, relationships, users, roles] = await Promise.all([
      admin.tenant.count(),
      admin.relationship.count(),
      admin.user.count(),
      admin.userRole.count(),
    ]);
    expect(tenants).toBe(5);
    expect(relationships).toBe(3);
    expect(users).toBe(12);
    expect(roles).toBe(12);
  });

  it("flags SAAS_ADMIN / WHOLESALER_ADMIN with twoFactorRequired=true and other roles with false", async () => {
    await seedAll();

    const saasAdmin = await admin.user.findUnique({
      where: { email: "saas_admin@solar-saas.dev" },
      select: { twoFactorRequired: true, status: true },
    });
    const wsAdmin = await admin.user.findUnique({
      where: { email: "wholesaler_admin@solar-saas.dev" },
      select: { twoFactorRequired: true, status: true },
    });
    const dealerStaff = await admin.user.findUnique({
      where: { email: "alpha-staff@solar-saas.dev" },
      select: { twoFactorRequired: true, status: true },
    });

    expect(saasAdmin?.twoFactorRequired).toBe(true);
    expect(saasAdmin?.status).toBe("ACTIVE");
    expect(wsAdmin?.twoFactorRequired).toBe(true);
    expect(dealerStaff?.twoFactorRequired).toBe(false);
    expect(dealerStaff?.status).toBe("ACTIVE");
  });

  it("never stores the pilot password in plaintext", async () => {
    await seedAll();

    const users = await admin.user.findMany({
      select: { email: true, passwordHash: true },
    });
    for (const user of users) {
      expect(user.passwordHash).toBeTruthy();
      // argon2id encoded hashes always begin with `$argon2id$`.
      expect(user.passwordHash?.startsWith("$argon2id$")).toBe(true);
      expect(user.passwordHash).not.toContain("Pilot!2026");
    }
  });

  it("uses the documented dealer scope distribution across the 3 relationships", async () => {
    await seedAll();

    const rels = await admin.relationship.findMany({
      include: { dealer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const byDealer = new Map(rels.map((r) => [r.dealer.name, r.defaultScope] as const));
    expect(byDealer.get("二次店アルファ")).toBe("APPOINTMENT_ONLY");
    expect(byDealer.get("二次店ベータ")).toBe("FIRST_VISIT");
    expect(byDealer.get("二次店ガンマ")).toBe("FULL_CLOSING");
  });
});

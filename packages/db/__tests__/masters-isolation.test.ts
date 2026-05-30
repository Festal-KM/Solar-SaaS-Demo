// Integration tests for SP-02 master tables (T-02-01).
//
// Covers the three properties the migration introduces:
//   1. RLS — VenueProvider / Product / IncentiveRate are wholesaler-scoped
//      (tenant A cannot see tenant B's rows, INSERT into the other tenant
//      fails fail-closed).
//   2. CHECK — Product.effectiveFrom < Product.effectiveTo (when non-null)
//      is enforced at the DB layer.
//   3. is_saas_admin bypass — a SaaS-operator context sees every tenant's
//      master rows, mirroring the existing pattern for `tenants` / `users`.
//
// The fixture seeds two wholesaler tenants and one dealer tenant + a
// Relationship between wholesaler A and the dealer so we can exercise the
// IncentiveRate policy's relationship-membership branch.

import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type TenantContext, withTenant } from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const APP_URL = process.env.TEST_DB_APP_URL!;
const REQUIRED_DB_NAME = "solar_saas_test";

if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `masters-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `masters-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
  dealer: { id: string; userId: string };
  relationshipAB: string; // wholesaler A ↔ dealer
  productA: string;
  productB: string;
  venueA: string;
  venueB: string;
  incentiveAB: string;
}

let fixture: Fixture;

async function applyMigrations(): Promise<void> {
  execSync("pnpm prisma migrate deploy --schema=prisma/schema.prisma", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: ADMIN_URL, DATABASE_URL_DIRECT: ADMIN_URL },
    stdio: "inherit",
  });
}

async function grantAppUserPrivileges(): Promise<void> {
  // `prisma migrate deploy` runs as `solar`, so the new master tables are
  // owned by `solar`. Grant `app_user` row-level access so RLS — not GRANT —
  // gates queries from the application role.
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO app_user;`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;`,
  );
}

async function truncate(): Promise<void> {
  // Cascade from Tenant covers Relationship → IncentiveRate and Product →
  // ProductPriceHistory; we still list the master tables explicitly so the
  // intent is obvious and the truncate works even if FK CASCADE rules change.
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

async function seed(): Promise<Fixture> {
  const tenantA = await admin.tenant.create({
    data: { type: "WHOLESALER", name: "卸 A 株式会社", plan: "PILOT" },
  });
  const tenantB = await admin.tenant.create({
    data: { type: "WHOLESALER", name: "卸 B 株式会社", plan: "PILOT" },
  });
  const dealerTenant = await admin.tenant.create({
    data: { type: "DEALER", name: "二次店アルファ" },
  });

  const userA = await admin.user.create({
    data: {
      tenantId: tenantA.id,
      email: "admin-a@example.com",
      name: "管理者 A",
      status: "ACTIVE",
      passwordHash: "x",
    },
  });
  const userB = await admin.user.create({
    data: {
      tenantId: tenantB.id,
      email: "admin-b@example.com",
      name: "管理者 B",
      status: "ACTIVE",
      passwordHash: "x",
    },
  });
  const userDealer = await admin.user.create({
    data: {
      tenantId: dealerTenant.id,
      email: "dealer@example.com",
      name: "二次店担当",
      status: "ACTIVE",
      passwordHash: "x",
    },
  });

  const relationshipAB = await admin.relationship.create({
    data: {
      wholesalerId: tenantA.id,
      dealerId: dealerTenant.id,
      defaultScope: "FULL_CLOSING",
    },
  });

  const venueA = await admin.venueProvider.create({
    data: {
      wholesalerId: tenantA.id,
      name: "ホームセンター A 店",
      contractType: "FIXED",
      fixedFee: "50000.00",
    },
  });
  const venueB = await admin.venueProvider.create({
    data: {
      wholesalerId: tenantB.id,
      name: "ホームセンター B 店",
      contractType: "PERFORMANCE",
      performanceRate: "10.00",
    },
  });

  const productA = await admin.product.create({
    data: {
      wholesalerId: tenantA.id,
      category: "PANEL",
      maker: "メーカー A",
      name: "パネル A-300",
      capacity: "0.30",
      unit: "kW",
      purchasePrice: "30000.00",
      dealerPrice: "42000.00",
      listPrice: "60000.00",
      effectiveFrom: new Date("2026-04-01"),
      createdBy: userA.id,
    },
  });
  const productB = await admin.product.create({
    data: {
      wholesalerId: tenantB.id,
      category: "BATTERY",
      maker: "メーカー B",
      name: "蓄電池 B-10",
      capacity: "10.00",
      unit: "kWh",
      purchasePrice: "800000.00",
      dealerPrice: "950000.00",
      listPrice: "1100000.00",
      effectiveFrom: new Date("2026-04-01"),
      createdBy: userB.id,
    },
  });

  const incentiveAB = await admin.incentiveRate.create({
    data: {
      relationshipId: relationshipAB.id,
      targetType: "PROJECT_PROFIT",
      rate: "5.00",
      effectiveFrom: new Date("2026-04-01"),
      createdBy: userA.id,
    },
  });

  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
    dealer: { id: dealerTenant.id, userId: userDealer.id },
    relationshipAB: relationshipAB.id,
    productA: productA.id,
    productB: productB.id,
    venueA: venueA.id,
    venueB: venueB.id,
    incentiveAB: incentiveAB.id,
  };
}

function ctxForWholesaler(wholesalerId: string, actorUserId: string): TenantContext {
  return {
    tenantId: wholesalerId,
    wholesalerId,
    relationshipIds: [],
    isSaasAdmin: false,
    actorUserId,
  };
}

function ctxForDealer(
  dealerTenantId: string,
  wholesalerId: string,
  relationshipIds: string[],
  actorUserId: string,
): TenantContext {
  return {
    tenantId: dealerTenantId,
    wholesalerId,
    dealerId: dealerTenantId,
    relationshipIds,
    isSaasAdmin: false,
    actorUserId,
  };
}

function saasAdminCtx(actorUserId: string): TenantContext {
  return {
    relationshipIds: [],
    isSaasAdmin: true,
    actorUserId,
  };
}

beforeAll(async () => {
  await applyMigrations();
  await grantAppUserPrivileges();
});

afterAll(async () => {
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncate();
  fixture = await seed();
});

describe("masters — RLS (wholesaler scope)", () => {
  it("wholesaler A sees only its own VenueProvider rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.venueProvider.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.venueA]);
  });

  it("wholesaler A sees only its own Product rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.product.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.productA]);

    const cross = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.product.findUnique({ where: { id: fixture.productB } }),
    );
    expect(cross).toBeNull();
  });

  it("wholesaler A cannot INSERT Product into wholesaler B", async () => {
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.product.create({
          data: {
            wholesalerId: fixture.tenantB.id,
            category: "PANEL",
            maker: "侵入",
            name: "侵入パネル",
            capacity: "0.40",
            unit: "kW",
            purchasePrice: "0.00",
            dealerPrice: "0.00",
            listPrice: "0.00",
            effectiveFrom: new Date("2026-04-01"),
            createdBy: fixture.tenantA.userId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("dealer with relationshipIds=[AB] sees IncentiveRate AB but not unrelated rates", async () => {
    // Create a second relationship + incentive that the dealer is NOT a
    // member of, then assert the dealer context only sees the AB rate.
    const unrelatedDealer = await admin.tenant.create({
      data: { type: "DEALER", name: "二次店ベータ" },
    });
    const unrelatedRel = await admin.relationship.create({
      data: { wholesalerId: fixture.tenantA.id, dealerId: unrelatedDealer.id },
    });
    await admin.incentiveRate.create({
      data: {
        relationshipId: unrelatedRel.id,
        targetType: "WHOLESALE_PROFIT",
        rate: "3.00",
        effectiveFrom: new Date("2026-04-01"),
        createdBy: fixture.tenantA.userId,
      },
    });

    const rows = await withTenant(
      ctxForDealer(
        fixture.dealer.id,
        fixture.tenantA.id,
        [fixture.relationshipAB],
        fixture.dealer.userId,
      ),
      (tx) => tx.incentiveRate.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.incentiveAB]);
  });
});

describe("masters — saas-admin bypass", () => {
  it("saas-admin sees every wholesaler's VenueProvider rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.venueProvider.findMany({ orderBy: { name: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([fixture.venueA, fixture.venueB].sort());
  });

  it("saas-admin sees every wholesaler's Product rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.product.findMany({ orderBy: { name: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([fixture.productA, fixture.productB].sort());
  });
});

describe("masters — CHECK constraints", () => {
  it("rejects Product with effectiveFrom == effectiveTo", async () => {
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.product.create({
          data: {
            wholesalerId: fixture.tenantA.id,
            category: "PANEL",
            maker: "メーカー A",
            name: "不正パネル",
            capacity: "0.30",
            unit: "kW",
            purchasePrice: "1.00",
            dealerPrice: "2.00",
            listPrice: "3.00",
            effectiveFrom: new Date("2026-04-01"),
            effectiveTo: new Date("2026-04-01"),
            createdBy: fixture.tenantA.userId,
          },
        }),
      ),
    ).rejects.toThrow(/Product_effective_period_check/);
  });

  it("rejects Product with effectiveFrom > effectiveTo", async () => {
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.product.create({
          data: {
            wholesalerId: fixture.tenantA.id,
            category: "PANEL",
            maker: "メーカー A",
            name: "不正パネル",
            capacity: "0.30",
            unit: "kW",
            purchasePrice: "1.00",
            dealerPrice: "2.00",
            listPrice: "3.00",
            effectiveFrom: new Date("2026-05-01"),
            effectiveTo: new Date("2026-04-01"),
            createdBy: fixture.tenantA.userId,
          },
        }),
      ),
    ).rejects.toThrow(/Product_effective_period_check/);
  });

  it("allows Product with null effectiveTo (open-ended interval)", async () => {
    const row = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) =>
        tx.product.create({
          data: {
            wholesalerId: fixture.tenantA.id,
            category: "PANEL",
            maker: "メーカー A",
            name: "通常パネル",
            capacity: "0.30",
            unit: "kW",
            purchasePrice: "10000.00",
            dealerPrice: "15000.00",
            listPrice: "20000.00",
            effectiveFrom: new Date("2026-04-01"),
            createdBy: fixture.tenantA.userId,
          },
        }),
    );
    expect(row.effectiveTo).toBeNull();
  });

  it("rejects IncentiveRate with effectiveFrom >= effectiveTo", async () => {
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.incentiveRate.create({
          data: {
            relationshipId: fixture.relationshipAB,
            targetType: "PROJECT_PROFIT",
            rate: "5.00",
            effectiveFrom: new Date("2026-05-01"),
            effectiveTo: new Date("2026-04-01"),
            createdBy: fixture.tenantA.userId,
          },
        }),
      ),
    ).rejects.toThrow(/IncentiveRate_effective_period_check/);
  });
});

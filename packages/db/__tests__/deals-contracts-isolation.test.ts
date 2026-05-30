// Integration tests for SP-05 deals/contracts tables (T-05-01).
//
// Covers RLS isolation for all 9 new tables:
//   (a) Deal rows from wholesaler A are invisible to wholesaler B.
//   (b) Deal visibility for dealer: own relationship only.
//   (c) Contract rows scoped by wholesalerId directly.
//   (d) ContractItem inherits isolation from parent Contract.
//   (e) GrossProfit inherits isolation from parent Contract.
//   (f) Incentive — three-branch: saas_admin / wholesaler / dealer (own relationship).
//   (g) IncentiveAdjustment inherits from parent Incentive.
//   (h) ContractCancellation inherits from parent Contract.
//   (i) Construction inherits from parent Contract.
//   (j) Application inherits from parent Contract.
//
// Fixture: two wholesaler tenants A/B, two dealer tenants alpha/beta.
//   alpha ↔ A (relAAlpha)
//   beta  ↔ B (relBBeta)
//   One deal + contract + items per wholesaler.

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
    `deals-contracts-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `deals-contracts-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
  dealerAlpha: { id: string };
  dealerBeta: { id: string };
  relAAlpha: string;
  relBBeta: string;
  customerA: string;
  customerB: string;
  dealA: string;
  dealB: string;
  contractA: string;
  contractB: string;
  itemA: string;
  itemB: string;
  grossProfitA: string;
  grossProfitB: string;
  incentiveAAlpha: string;
  incentiveBBeta: string;
  adjustmentA: string;
  cancellationA: string;
  constructionA: string;
  applicationA: string;
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
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO app_user;`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;`,
  );
}

async function truncate(): Promise<void> {
  await admin.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Application",
      "Construction",
      "ContractCancellation",
      "IncentiveAdjustment",
      "Incentive",
      "GrossProfit",
      "ContractItem",
      "Contract",
      "Deal",
      "PreCallNotification",
      "PreCall",
      "Appointment",
      "Customer",
      "EventReport",
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
  const dealerAlphaTenant = await admin.tenant.create({
    data: { type: "DEALER", name: "二次店アルファ" },
  });
  const dealerBetaTenant = await admin.tenant.create({
    data: { type: "DEALER", name: "二次店ベータ" },
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

  const relAAlpha = await admin.relationship.create({
    data: {
      wholesalerId: tenantA.id,
      dealerId: dealerAlphaTenant.id,
      status: "ACTIVE",
      defaultScope: "FULL_CLOSING",
    },
  });
  const relBBeta = await admin.relationship.create({
    data: {
      wholesalerId: tenantB.id,
      dealerId: dealerBetaTenant.id,
      status: "ACTIVE",
      defaultScope: "FULL_CLOSING",
    },
  });

  const productA = await admin.product.create({
    data: {
      wholesalerId: tenantA.id,
      category: "PANEL",
      maker: "Maker X",
      name: "Panel 400W",
      unit: "枚",
      purchasePrice: 30000,
      dealerPrice: 40000,
      listPrice: 60000,
      effectiveFrom: new Date("2024-01-01"),
      createdBy: userA.id,
    },
  });

  const customerA = await admin.customer.create({
    data: {
      wholesalerId: tenantA.id,
      name: "山田 太郎",
      phone: "09011112222",
      channel: "EVENT",
      registeredByUserId: userA.id,
      registeredByOrgType: "WHOLESALER",
    },
  });
  const customerB = await admin.customer.create({
    data: {
      wholesalerId: tenantB.id,
      name: "鈴木 花子",
      phone: "09033334444",
      channel: "EVENT",
      registeredByUserId: userB.id,
      registeredByOrgType: "WHOLESALER",
    },
  });

  const dealA = await admin.deal.create({
    data: {
      customerId: customerA.id,
      ownerType: "WHOLESALER",
      ownerUserId: userA.id,
      ownerRelationshipId: relAAlpha.id,
      status: "VISIT_PLANNED",
    },
  });
  const dealB = await admin.deal.create({
    data: {
      customerId: customerB.id,
      ownerType: "WHOLESALER",
      ownerUserId: userB.id,
      ownerRelationshipId: relBBeta.id,
      status: "VISIT_PLANNED",
    },
  });

  const now = new Date();
  const deadline = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  const contractA = await admin.contract.create({
    data: {
      wholesalerId: tenantA.id,
      dealId: dealA.id,
      customerId: customerA.id,
      ownerRelationshipId: relAAlpha.id,
      contractDate: now,
      contractAmount: 1200000,
      cancelDeadline: deadline,
      status: "CONTRACTED",
      createdBy: userA.id,
    },
  });
  const contractB = await admin.contract.create({
    data: {
      wholesalerId: tenantB.id,
      dealId: dealB.id,
      customerId: customerB.id,
      ownerRelationshipId: relBBeta.id,
      contractDate: now,
      contractAmount: 900000,
      cancelDeadline: deadline,
      status: "CONTRACTED",
      createdBy: userB.id,
    },
  });

  const itemA = await admin.contractItem.create({
    data: {
      contractId: contractA.id,
      productId: productA.id,
      productName: "Panel 400W",
      maker: "Maker X",
      qty: 20,
      unit: "枚",
      snapshotPurchasePrice: 30000,
      snapshotDealerPrice: 40000,
      snapshotListPrice: 60000,
    },
  });
  const itemB = await admin.contractItem.create({
    data: {
      contractId: contractB.id,
      productId: productA.id,
      productName: "Panel 400W",
      maker: "Maker X",
      qty: 15,
      unit: "枚",
      snapshotPurchasePrice: 30000,
      snapshotDealerPrice: 40000,
      snapshotListPrice: 60000,
    },
  });

  const grossProfitA = await admin.grossProfit.create({
    data: {
      contractId: contractA.id,
      salesPrice: 1200000,
      purchaseTotal: 600000,
      dealerTotal: 800000,
      projectProfit: 600000,
      wholesaleProfit: 200000,
      profitRate: 0.5,
      incentiveTargetProfit: 200000,
      incentiveTargetType: "WHOLESALE_PROFIT",
    },
  });
  const grossProfitB = await admin.grossProfit.create({
    data: {
      contractId: contractB.id,
      salesPrice: 900000,
      purchaseTotal: 450000,
      dealerTotal: 600000,
      projectProfit: 450000,
      wholesaleProfit: 150000,
      profitRate: 0.5,
      incentiveTargetProfit: 150000,
      incentiveTargetType: "WHOLESALE_PROFIT",
    },
  });

  const incentiveAAlpha = await admin.incentive.create({
    data: {
      contractId: contractA.id,
      relationshipId: relAAlpha.id,
      targetProfit: 200000,
      rate: 10,
      amount: 20000,
      status: "DRAFT",
      settledMonth: "2026-05",
    },
  });
  const incentiveBBeta = await admin.incentive.create({
    data: {
      contractId: contractB.id,
      relationshipId: relBBeta.id,
      targetProfit: 150000,
      rate: 10,
      amount: 15000,
      status: "DRAFT",
      settledMonth: "2026-05",
    },
  });

  const adjustmentA = await admin.incentiveAdjustment.create({
    data: {
      incentiveId: incentiveAAlpha.id,
      kind: "MANUAL",
      beforeAmount: 20000,
      afterAmount: 18000,
      reason: "調整",
      adjustedBy: userA.id,
    },
  });

  const cancellationA = await admin.contractCancellation.create({
    data: {
      contractId: contractA.id,
      cancelledAt: now,
      isWithinDeadline: true,
      negativeAdjustmentIds: [],
      recordedBy: userA.id,
    },
  });

  const constructionA = await admin.construction.create({
    data: {
      contractId: contractA.id,
      status: "REQUEST_PENDING",
      fileKeys: [],
    },
  });

  const applicationA = await admin.application.create({
    data: {
      contractId: contractA.id,
      type: "補助金A",
      status: "DRAFT",
      fileKeys: [],
    },
  });

  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
    dealerAlpha: { id: dealerAlphaTenant.id },
    dealerBeta: { id: dealerBetaTenant.id },
    relAAlpha: relAAlpha.id,
    relBBeta: relBBeta.id,
    customerA: customerA.id,
    customerB: customerB.id,
    dealA: dealA.id,
    dealB: dealB.id,
    contractA: contractA.id,
    contractB: contractB.id,
    itemA: itemA.id,
    itemB: itemB.id,
    grossProfitA: grossProfitA.id,
    grossProfitB: grossProfitB.id,
    incentiveAAlpha: incentiveAAlpha.id,
    incentiveBBeta: incentiveBBeta.id,
    adjustmentA: adjustmentA.id,
    cancellationA: cancellationA.id,
    constructionA: constructionA.id,
    applicationA: applicationA.id,
  };
}

beforeAll(async () => {
  await applyMigrations();
  await grantAppUserPrivileges();
});

beforeEach(async () => {
  await truncate();
  fixture = await seed();
});

afterAll(async () => {
  await admin.$disconnect();
});

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function ctxWholesaler(wholesalerId: string, actorUserId: string): TenantContext {
  return {
    tenantId: wholesalerId,
    wholesalerId,
    relationshipIds: [],
    isSaasAdmin: false,
    actorUserId,
  };
}

function ctxDealer(
  dealerTenantId: string,
  wholesalerId: string,
  relationshipId: string,
  actorUserId: string,
): TenantContext {
  return {
    tenantId: dealerTenantId,
    wholesalerId,
    dealerId: dealerTenantId,
    relationshipIds: [relationshipId],
    isSaasAdmin: false,
    actorUserId,
  };
}

function ctxSaasAdmin(actorUserId: string): TenantContext {
  return {
    relationshipIds: [],
    isSaasAdmin: true,
    actorUserId,
  };
}

// ---------------------------------------------------------------------------
// Deal isolation
// ---------------------------------------------------------------------------
describe("Deal RLS isolation", () => {
  it("wholesaler A sees only its own deals", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.deal.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.dealA]);
  });

  it("wholesaler B sees only its own deals", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.deal.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.dealB]);
  });

  it("dealer alpha sees only deals in its relationship", async () => {
    const rows = await withTenant(
      ctxDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        fixture.relAAlpha,
        fixture.tenantA.userId,
      ),
      (tx) => tx.deal.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.dealA]);
  });

  it("dealer beta cannot see dealA", async () => {
    const rows = await withTenant(
      ctxDealer(
        fixture.dealerBeta.id,
        fixture.tenantB.id,
        fixture.relBBeta,
        fixture.tenantB.userId,
      ),
      (tx) => tx.deal.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(fixture.dealA);
    expect(ids).toContain(fixture.dealB);
  });

  it("saas admin sees all deals", async () => {
    const rows = await withTenant(
      ctxSaasAdmin(fixture.tenantA.userId),
      (tx) => tx.deal.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fixture.dealA);
    expect(ids).toContain(fixture.dealB);
  });
});

// ---------------------------------------------------------------------------
// Contract isolation
// ---------------------------------------------------------------------------
describe("Contract RLS isolation", () => {
  it("wholesaler A sees only its own contracts", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.contract.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.contractA]);
  });

  it("wholesaler B sees only its own contracts", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.contract.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.contractB]);
  });

  it("wholesaler A cannot read wholesaler B contract by id", async () => {
    const row = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.contract.findUnique({ where: { id: fixture.contractB } }),
    );
    expect(row).toBeNull();
  });

  it("saas admin sees all contracts", async () => {
    const rows = await withTenant(
      ctxSaasAdmin(fixture.tenantA.userId),
      (tx) => tx.contract.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fixture.contractA);
    expect(ids).toContain(fixture.contractB);
  });
});

// ---------------------------------------------------------------------------
// ContractItem isolation (derived from Contract)
// ---------------------------------------------------------------------------
describe("ContractItem RLS isolation", () => {
  it("wholesaler A sees only its own items", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.contractItem.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.itemA]);
  });

  it("wholesaler B cannot see itemA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.contractItem.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(fixture.itemA);
    expect(ids).toContain(fixture.itemB);
  });
});

// ---------------------------------------------------------------------------
// GrossProfit isolation (derived from Contract)
// ---------------------------------------------------------------------------
describe("GrossProfit RLS isolation", () => {
  it("wholesaler A sees only its own gross profit", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.grossProfit.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.grossProfitA]);
  });

  it("wholesaler B cannot see grossProfitA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.grossProfit.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(fixture.grossProfitA);
    expect(ids).toContain(fixture.grossProfitB);
  });
});

// ---------------------------------------------------------------------------
// Incentive isolation (three-branch)
// ---------------------------------------------------------------------------
describe("Incentive RLS isolation", () => {
  it("wholesaler A sees incentive for its relationship", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.incentive.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.incentiveAAlpha]);
  });

  it("wholesaler B cannot see incentiveAAlpha", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.incentive.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(fixture.incentiveAAlpha);
    expect(ids).toContain(fixture.incentiveBBeta);
  });

  it("dealer alpha sees only its own incentive", async () => {
    const rows = await withTenant(
      ctxDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        fixture.relAAlpha,
        fixture.tenantA.userId,
      ),
      (tx) => tx.incentive.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.incentiveAAlpha]);
  });

  it("dealer beta cannot see incentiveAAlpha", async () => {
    const rows = await withTenant(
      ctxDealer(
        fixture.dealerBeta.id,
        fixture.tenantB.id,
        fixture.relBBeta,
        fixture.tenantB.userId,
      ),
      (tx) => tx.incentive.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(fixture.incentiveAAlpha);
    expect(ids).toContain(fixture.incentiveBBeta);
  });

  it("saas admin sees all incentives", async () => {
    const rows = await withTenant(
      ctxSaasAdmin(fixture.tenantA.userId),
      (tx) => tx.incentive.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fixture.incentiveAAlpha);
    expect(ids).toContain(fixture.incentiveBBeta);
  });
});

// ---------------------------------------------------------------------------
// IncentiveAdjustment isolation (derived from Incentive)
// ---------------------------------------------------------------------------
describe("IncentiveAdjustment RLS isolation", () => {
  it("wholesaler A sees its own adjustments", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.incentiveAdjustment.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.adjustmentA]);
  });

  it("wholesaler B cannot see adjustmentA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.incentiveAdjustment.findMany(),
    );
    expect(rows.map((r) => r.id)).not.toContain(fixture.adjustmentA);
  });
});

// ---------------------------------------------------------------------------
// ContractCancellation isolation (derived from Contract)
// ---------------------------------------------------------------------------
describe("ContractCancellation RLS isolation", () => {
  it("wholesaler A sees its own cancellation", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.contractCancellation.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.cancellationA]);
  });

  it("wholesaler B cannot see cancellationA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.contractCancellation.findMany(),
    );
    expect(rows.map((r) => r.id)).not.toContain(fixture.cancellationA);
  });
});

// ---------------------------------------------------------------------------
// Construction isolation (derived from Contract)
// ---------------------------------------------------------------------------
describe("Construction RLS isolation", () => {
  it("wholesaler A sees its own constructions", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.construction.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.constructionA]);
  });

  it("wholesaler B cannot see constructionA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.construction.findMany(),
    );
    expect(rows.map((r) => r.id)).not.toContain(fixture.constructionA);
  });
});

// ---------------------------------------------------------------------------
// Application isolation (derived from Contract)
// ---------------------------------------------------------------------------
describe("Application RLS isolation", () => {
  it("wholesaler A sees its own applications", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.application.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.applicationA]);
  });

  it("wholesaler B cannot see applicationA", async () => {
    const rows = await withTenant(
      ctxWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.application.findMany(),
    );
    expect(rows.map((r) => r.id)).not.toContain(fixture.applicationA);
  });
});

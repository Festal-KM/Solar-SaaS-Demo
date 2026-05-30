// Integration tests for SP-04 execution tables (T-04-01).
//
// Covers RLS isolation for all 5 new tables:
//   (a) Customer rows from wholesaler A are invisible to wholesaler B.
//   (b) EventReport inherits isolation from parent Event.wholesalerId.
//   (c) Appointment inherits isolation from parent Customer.
//   (d) PreCall inherits isolation through Appointment → Customer chain.
//   (e) PreCallNotification is scoped by relationshipId:
//       - wholesaler branch sees rows in its own relationships
//       - dealer branch sees only its own relationship's rows
//       - cross-tenant negative case: unrelated dealer sees nothing
//
// Fixture: two wholesaler tenants A/B, two dealer tenants alpha/beta.
//   alpha ↔ A (relationshipAAlpha)
//   beta  ↔ B (relationshipBBeta)
//   One customer, appointment, pre-call, and pre-call notification per tenant.
//   One event report on each wholesaler's event.

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
    `execution-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `execution-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
  dealerAlpha: { id: string; userId: string };
  dealerBeta: { id: string; userId: string };
  relationshipAAlpha: string;
  relationshipBBeta: string;
  eventA: string;
  eventB: string;
  reportA: string;
  reportB: string;
  customerA: string;
  customerB: string;
  appointmentA: string;
  appointmentB: string;
  preCallA: string;
  preCallB: string;
  notificationAAlpha: string; // PreCallNotification for relationship A-alpha
  notificationBBeta: string;  // PreCallNotification for relationship B-beta
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
  const userAlpha = await admin.user.create({
    data: {
      tenantId: dealerAlphaTenant.id,
      email: "alpha@example.com",
      name: "二次店アルファ担当",
      status: "ACTIVE",
      passwordHash: "x",
    },
  });
  const userBeta = await admin.user.create({
    data: {
      tenantId: dealerBetaTenant.id,
      email: "beta@example.com",
      name: "二次店ベータ担当",
      status: "ACTIVE",
      passwordHash: "x",
    },
  });

  const relationshipAAlpha = await admin.relationship.create({
    data: {
      wholesalerId: tenantA.id,
      dealerId: dealerAlphaTenant.id,
      defaultScope: "FULL_CLOSING",
    },
  });
  const relationshipBBeta = await admin.relationship.create({
    data: {
      wholesalerId: tenantB.id,
      dealerId: dealerBetaTenant.id,
      defaultScope: "APPOINTMENT_ONLY",
    },
  });

  const venueA = await admin.venueProvider.create({
    data: { wholesalerId: tenantA.id, name: "ホームセンター A 店", contractType: "FIXED" },
  });
  const venueB = await admin.venueProvider.create({
    data: { wholesalerId: tenantB.id, name: "ホームセンター B 店", contractType: "FIXED" },
  });

  const negotiationA = await admin.venueNegotiation.create({
    data: {
      wholesalerId: tenantA.id,
      venueProviderId: venueA.id,
      candidateDates: ["2026-07-15"],
      status: "CONTACTING",
    },
  });
  const negotiationB = await admin.venueNegotiation.create({
    data: {
      wholesalerId: tenantB.id,
      venueProviderId: venueB.id,
      candidateDates: ["2026-07-20"],
      status: "FEASIBLE",
    },
  });

  const candidateA = await admin.eventCandidate.create({
    data: {
      wholesalerId: tenantA.id,
      venueProviderId: venueA.id,
      venueNegotiationId: negotiationA.id,
      targetMonth: "2026-07",
      scheduledDate: new Date("2026-07-15T10:00:00+09:00"),
      storeName: "A 店",
      deadlineAt: new Date("2026-07-01T23:59:00+09:00"),
      status: "OPEN",
      createdBy: userA.id,
    },
  });
  const candidateB = await admin.eventCandidate.create({
    data: {
      wholesalerId: tenantB.id,
      venueProviderId: venueB.id,
      venueNegotiationId: negotiationB.id,
      targetMonth: "2026-07",
      scheduledDate: new Date("2026-07-20T10:00:00+09:00"),
      storeName: "B 店",
      deadlineAt: new Date("2026-07-06T23:59:00+09:00"),
      status: "OPEN",
      createdBy: userB.id,
    },
  });

  const eventA = await admin.event.create({
    data: {
      wholesalerId: tenantA.id,
      eventCandidateId: candidateA.id,
      mode: "SELF",
      decidedBy: userA.id,
    },
  });
  const eventB = await admin.event.create({
    data: {
      wholesalerId: tenantB.id,
      eventCandidateId: candidateB.id,
      mode: "SELF",
      decidedBy: userB.id,
    },
  });

  // EventReport rows — one per wholesaler event.
  const reportA = await admin.eventReport.create({
    data: {
      eventId: eventA.id,
      type: "START",
      reporterUserId: userA.id,
      reporterOrgType: "WHOLESALER",
      payload: { startedAt: "2026-07-15T10:00:00+09:00", memo: "開始", attachments: [] },
    },
  });
  const reportB = await admin.eventReport.create({
    data: {
      eventId: eventB.id,
      type: "START",
      reporterUserId: userB.id,
      reporterOrgType: "WHOLESALER",
      payload: { startedAt: "2026-07-20T10:00:00+09:00", memo: "開始", attachments: [] },
    },
  });

  // Customer rows — one per wholesaler tenant.
  const customerA = await admin.customer.create({
    data: {
      wholesalerId: tenantA.id,
      name: "田中 太郎",
      phone: "09011112222",
      channel: "EVENT",
      sourceEventId: eventA.id,
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
      sourceEventId: eventB.id,
      registeredByUserId: userB.id,
      registeredByOrgType: "WHOLESALER",
    },
  });

  // Appointment rows — one per customer.
  const appointmentA = await admin.appointment.create({
    data: {
      customerId: customerA.id,
      eventId: eventA.id,
      scheduledAt: new Date("2026-07-22T14:00:00+09:00"),
      acquiredByUserId: userA.id,
      acquiredOrgType: "WHOLESALER",
    },
  });
  const appointmentB = await admin.appointment.create({
    data: {
      customerId: customerB.id,
      eventId: eventB.id,
      scheduledAt: new Date("2026-07-25T14:00:00+09:00"),
      acquiredByUserId: userB.id,
      acquiredOrgType: "WHOLESALER",
    },
  });

  // PreCall rows — one per appointment.
  const preCallA = await admin.preCall.create({
    data: {
      appointmentId: appointmentA.id,
      calledAt: new Date("2026-07-21T10:00:00+09:00"),
      result: "APPROVED",
      calledByUserId: userA.id,
    },
  });
  const preCallB = await admin.preCall.create({
    data: {
      appointmentId: appointmentB.id,
      calledAt: new Date("2026-07-24T10:00:00+09:00"),
      result: "APPROVED",
      calledByUserId: userB.id,
    },
  });

  // PreCallNotification rows — one per relationship.
  const notificationAAlpha = await admin.preCallNotification.create({
    data: {
      preCallId: preCallA.id,
      relationshipId: relationshipAAlpha.id,
    },
  });
  const notificationBBeta = await admin.preCallNotification.create({
    data: {
      preCallId: preCallB.id,
      relationshipId: relationshipBBeta.id,
    },
  });

  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
    dealerAlpha: { id: dealerAlphaTenant.id, userId: userAlpha.id },
    dealerBeta: { id: dealerBetaTenant.id, userId: userBeta.id },
    relationshipAAlpha: relationshipAAlpha.id,
    relationshipBBeta: relationshipBBeta.id,
    eventA: eventA.id,
    eventB: eventB.id,
    reportA: reportA.id,
    reportB: reportB.id,
    customerA: customerA.id,
    customerB: customerB.id,
    appointmentA: appointmentA.id,
    appointmentB: appointmentB.id,
    preCallA: preCallA.id,
    preCallB: preCallB.id,
    notificationAAlpha: notificationAAlpha.id,
    notificationBBeta: notificationBBeta.id,
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

// ---------------------------------------------------------------------------
// (a) Customer isolation — wholesaler-scoped directly
// ---------------------------------------------------------------------------

describe("execution — Customer RLS", () => {
  it("wholesaler A sees only its own Customer rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.customer.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.customerA]);
  });

  it("wholesaler A cannot read wholesaler B's Customer row by id", async () => {
    const row = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.customer.findUnique({ where: { id: fixture.customerB } }),
    );
    expect(row).toBeNull();
  });

  it("wholesaler B sees only its own Customer rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.customer.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.customerB]);
  });

  it("saas-admin sees all Customer rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.customer.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.customerA, fixture.customerB].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (b) EventReport isolation — inherits from parent Event.wholesalerId
// ---------------------------------------------------------------------------

describe("execution — EventReport RLS (parent Event scope)", () => {
  it("wholesaler A sees only EventReport rows linked to its own Events", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventReport.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.reportA]);
  });

  it("wholesaler A cannot read wholesaler B's EventReport by id", async () => {
    const row = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventReport.findUnique({ where: { id: fixture.reportB } }),
    );
    expect(row).toBeNull();
  });

  it("saas-admin sees all EventReport rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.eventReport.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.reportA, fixture.reportB].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Appointment isolation — inherits from parent Customer.wholesalerId
// ---------------------------------------------------------------------------

describe("execution — Appointment RLS (parent Customer scope)", () => {
  it("wholesaler A sees only Appointment rows for its own Customers", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.appointment.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.appointmentA]);
  });

  it("wholesaler A cannot read wholesaler B's Appointment by id", async () => {
    const row = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.appointment.findUnique({ where: { id: fixture.appointmentB } }),
    );
    expect(row).toBeNull();
  });

  it("saas-admin sees all Appointment rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.appointment.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.appointmentA, fixture.appointmentB].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) PreCall isolation — inherits through Appointment → Customer chain
// ---------------------------------------------------------------------------

describe("execution — PreCall RLS (Appointment → Customer chain)", () => {
  it("wholesaler A sees only PreCall rows linked to its own Appointments", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.preCall.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.preCallA]);
  });

  it("wholesaler A cannot read wholesaler B's PreCall by id", async () => {
    const row = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.preCall.findUnique({ where: { id: fixture.preCallB } }),
    );
    expect(row).toBeNull();
  });

  it("saas-admin sees all PreCall rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.preCall.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.preCallA, fixture.preCallB].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (e) PreCallNotification isolation — relationship-scoped, three-branch policy
// ---------------------------------------------------------------------------

describe("execution — PreCallNotification RLS (relationship scope)", () => {
  it("wholesaler A (branch: no dealer_id) sees notifications for its own relationships", async () => {
    // Wholesaler branch: current_dealer_id is empty, so the policy matches
    // rows whose Relationship.wholesalerId equals the active wholesaler.
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.preCallNotification.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.notificationAAlpha]);
  });

  it("dealer alpha sees only its own relationship's PreCallNotification rows", async () => {
    const rows = await withTenant(
      ctxForDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        [fixture.relationshipAAlpha],
        fixture.dealerAlpha.userId,
      ),
      (tx) => tx.preCallNotification.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relationshipId).toBe(fixture.relationshipAAlpha);
    expect(rows[0]!.id).toBe(fixture.notificationAAlpha);
  });

  it("dealer alpha (cross-tenant negative) cannot see beta relationship's notification", async () => {
    // Alpha belongs to wholesaler A; beta's notification is on wholesaler B.
    // Even if alpha somehow knew beta's notification id, RLS must return null.
    const row = await withTenant(
      ctxForDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        [fixture.relationshipAAlpha],
        fixture.dealerAlpha.userId,
      ),
      (tx) =>
        tx.preCallNotification.findUnique({ where: { id: fixture.notificationBBeta } }),
    );
    expect(row).toBeNull();
  });

  it("saas-admin sees all PreCallNotification rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.preCallNotification.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.notificationAAlpha, fixture.notificationBBeta].sort(),
    );
  });
});

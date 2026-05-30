// Integration tests for SP-03 event-flow tables (T-03-01).
//
// Covers the three properties the migration introduces:
//   1. RLS — VenueNegotiation / EventCandidate / Event are wholesaler-scoped;
//      EventCandidateVisibility / DealerPreference / EventDealer are
//      relationship-scoped; EventShift / EventChange derive their scope from
//      the parent Event.wholesalerId.
//   2. is_saas_admin bypass — a SaaS-operator context sees every tenant's
//      event-flow rows, mirroring the existing pattern.
//   3. EventShift uniqueness — `(userId, startPlanned)` UNIQUE catches the
//      same-start collision; `endPlanned > startPlanned` CHECK rejects
//      reversed intervals.
//
// Fixture seeds two wholesaler tenants (each with a venue + event candidate +
// event), two dealer tenants (alpha bound to wholesaler A only, beta to both
// wholesalers via separate relationships), and the matching shift / change /
// preference / visibility rows.

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
    `event-flow-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `event-flow-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
  dealerAlpha: { id: string; userId: string };
  dealerBeta: { id: string; userId: string };
  // dealer-alpha ↔ wholesaler A (relationship-scoped tables hang here).
  relationshipAAlpha: string;
  // dealer-beta ↔ wholesaler B (used to prove alpha cannot see beta's rows).
  relationshipBBeta: string;
  venueA: string;
  venueB: string;
  negotiationA: string;
  negotiationB: string;
  candidateA: string;
  candidateB: string;
  eventA: string;
  eventB: string;
  shiftA: string;
  changeA: string;
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
  // Children-first ordering so FK CASCADE doesn't have to traverse the full
  // tree; mirrors the truncate order in tenant-isolation / masters-isolation.
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
      candidateDates: ["2026-06-15", "2026-06-22"],
      status: "CONTACTING",
    },
  });
  const negotiationB = await admin.venueNegotiation.create({
    data: {
      wholesalerId: tenantB.id,
      venueProviderId: venueB.id,
      candidateDates: ["2026-06-29"],
      status: "FEASIBLE",
    },
  });

  const candidateA = await admin.eventCandidate.create({
    data: {
      wholesalerId: tenantA.id,
      venueProviderId: venueA.id,
      venueNegotiationId: negotiationA.id,
      targetMonth: "2026-06",
      scheduledDate: new Date("2026-06-15T10:00:00+09:00"),
      storeName: "A 店",
      deadlineAt: new Date("2026-06-01T23:59:00+09:00"),
      status: "OPEN",
      createdBy: userA.id,
    },
  });
  const candidateB = await admin.eventCandidate.create({
    data: {
      wholesalerId: tenantB.id,
      venueProviderId: venueB.id,
      venueNegotiationId: negotiationB.id,
      targetMonth: "2026-06",
      scheduledDate: new Date("2026-06-29T10:00:00+09:00"),
      storeName: "B 店",
      deadlineAt: new Date("2026-06-15T23:59:00+09:00"),
      status: "OPEN",
      createdBy: userB.id,
    },
  });

  // Visibility A → alpha (tenant A's candidate is visible to dealer alpha).
  await admin.eventCandidateVisibility.create({
    data: { eventCandidateId: candidateA.id, relationshipId: relationshipAAlpha.id },
  });
  // Visibility B → beta (tenant B's candidate is visible to dealer beta).
  await admin.eventCandidateVisibility.create({
    data: { eventCandidateId: candidateB.id, relationshipId: relationshipBBeta.id },
  });

  // Preferences: alpha submitted for candidate A; beta submitted for candidate B.
  await admin.dealerPreference.create({
    data: {
      eventCandidateId: candidateA.id,
      relationshipId: relationshipAAlpha.id,
      targetMonth: "2026-06",
      submittedBy: userAlpha.id,
    },
  });
  await admin.dealerPreference.create({
    data: {
      eventCandidateId: candidateB.id,
      relationshipId: relationshipBBeta.id,
      targetMonth: "2026-06",
      submittedBy: userBeta.id,
    },
  });

  const eventA = await admin.event.create({
    data: {
      wholesalerId: tenantA.id,
      eventCandidateId: candidateA.id,
      mode: "JOINT",
      requiredPeople: 3,
      decidedBy: userA.id,
    },
  });
  const eventB = await admin.event.create({
    data: {
      wholesalerId: tenantB.id,
      eventCandidateId: candidateB.id,
      mode: "DEALER",
      decidedBy: userB.id,
    },
  });

  await admin.eventDealer.create({
    data: {
      eventId: eventA.id,
      relationshipId: relationshipAAlpha.id,
      assignedBy: userA.id,
    },
  });
  await admin.eventDealer.create({
    data: {
      eventId: eventB.id,
      relationshipId: relationshipBBeta.id,
      assignedBy: userB.id,
    },
  });

  const shiftA = await admin.eventShift.create({
    data: {
      eventId: eventA.id,
      userId: userA.id,
      role: "LEAD",
      startPlanned: new Date("2026-06-15T09:00:00+09:00"),
      endPlanned: new Date("2026-06-15T18:00:00+09:00"),
    },
  });
  // Parallel shift in tenant B so the cross-tenant test has something to miss.
  await admin.eventShift.create({
    data: {
      eventId: eventB.id,
      userId: userB.id,
      role: "LEAD",
      startPlanned: new Date("2026-06-29T09:00:00+09:00"),
      endPlanned: new Date("2026-06-29T18:00:00+09:00"),
    },
  });

  const changeA = await admin.eventChange.create({
    data: {
      eventId: eventA.id,
      before: { mode: "SELF" },
      after: { mode: "JOINT" },
      changedBy: userA.id,
    },
  });

  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
    dealerAlpha: { id: dealerAlphaTenant.id, userId: userAlpha.id },
    dealerBeta: { id: dealerBetaTenant.id, userId: userBeta.id },
    relationshipAAlpha: relationshipAAlpha.id,
    relationshipBBeta: relationshipBBeta.id,
    venueA: venueA.id,
    venueB: venueB.id,
    negotiationA: negotiationA.id,
    negotiationB: negotiationB.id,
    candidateA: candidateA.id,
    candidateB: candidateB.id,
    eventA: eventA.id,
    eventB: eventB.id,
    shiftA: shiftA.id,
    changeA: changeA.id,
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

describe("event-flow — RLS (wholesaler scope)", () => {
  it("wholesaler A sees only its own VenueNegotiation rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.venueNegotiation.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.negotiationA]);

    const cross = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.venueNegotiation.findUnique({ where: { id: fixture.negotiationB } }),
    );
    expect(cross).toBeNull();
  });

  it("wholesaler A sees only its own EventCandidate rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventCandidate.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.candidateA]);
  });

  it("wholesaler A sees only its own Event rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.event.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.eventA]);
  });
});

describe("event-flow — RLS (relationship scope)", () => {
  it("dealer alpha sees only its own DealerPreference rows (alpha ↔ A)", async () => {
    const rows = await withTenant(
      ctxForDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        [fixture.relationshipAAlpha],
        fixture.dealerAlpha.userId,
      ),
      (tx) => tx.dealerPreference.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relationshipId).toBe(fixture.relationshipAAlpha);
  });

  it("dealer alpha sees only its own EventCandidateVisibility rows", async () => {
    const rows = await withTenant(
      ctxForDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        [fixture.relationshipAAlpha],
        fixture.dealerAlpha.userId,
      ),
      (tx) => tx.eventCandidateVisibility.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relationshipId).toBe(fixture.relationshipAAlpha);
    expect(rows[0]!.eventCandidateId).toBe(fixture.candidateA);
  });

  it("dealer alpha sees only its own EventDealer rows", async () => {
    const rows = await withTenant(
      ctxForDealer(
        fixture.dealerAlpha.id,
        fixture.tenantA.id,
        [fixture.relationshipAAlpha],
        fixture.dealerAlpha.userId,
      ),
      (tx) => tx.eventDealer.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relationshipId).toBe(fixture.relationshipAAlpha);
  });

  it("wholesaler A sees every EventDealer attached to its own relationships", async () => {
    // Wholesaler-branch (`current_dealer_id` empty) must see relationship-scoped
    // rows whose Relationship is owned by the active wholesaler tenant.
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventDealer.findMany(),
    );
    expect(rows.map((r) => r.relationshipId)).toEqual([fixture.relationshipAAlpha]);
  });
});

describe("event-flow — RLS (parent Event scope)", () => {
  it("wholesaler A sees only its own EventShift rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventShift.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(fixture.shiftA);
  });

  it("wholesaler A sees only its own EventChange rows", async () => {
    const rows = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.eventChange.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.changeA]);
  });
});

describe("event-flow — saas-admin bypass", () => {
  it("saas-admin sees every wholesaler's Event rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.event.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([fixture.eventA, fixture.eventB].sort());
  });
});

describe("event-flow — EventShift constraints", () => {
  it("rejects a second EventShift with the same userId + startPlanned (DB UNIQUE)", async () => {
    // Same user, same startPlanned, different end → still rejected by the
    // `(userId, startPlanned)` UNIQUE that the migration creates.
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.eventShift.create({
          data: {
            eventId: fixture.eventA,
            userId: fixture.tenantA.userId,
            role: "CATCH",
            startPlanned: new Date("2026-06-15T09:00:00+09:00"),
            endPlanned: new Date("2026-06-15T12:00:00+09:00"),
          },
        }),
      ),
      // Prisma cannot always recover the constraint name from inside an
      // application-layer-bypassed RLS path, so we match the generic
      // "Unique constraint failed" error string the engine surfaces.
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("rejects EventShift with endPlanned <= startPlanned (CHECK constraint)", async () => {
    await expect(
      withTenant(ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId), (tx) =>
        tx.eventShift.create({
          data: {
            eventId: fixture.eventA,
            userId: fixture.tenantA.userId,
            role: "RECEPTION",
            startPlanned: new Date("2026-06-15T10:00:00+09:00"),
            // 同時刻 → CHECK 違反
            endPlanned: new Date("2026-06-15T10:00:00+09:00"),
          },
        }),
      ),
    ).rejects.toThrow(/EventShift_planned_range_check/);
  });
});

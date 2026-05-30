// Integration tests for SP-07 notification tables (T-07-01).
//
// Covers RLS isolation for Notification / NotificationDelivery /
// NotificationPreference using the `app.current_actor_user_id` GUC added in
// migration 20260526020000_notifications.
//
// Test matrix (docs/05 §3.9):
//   (a) User A sees only their own Notification rows, not User B's.
//   (b) NotificationDelivery isolation — access gated via parent Notification.
//   (c) NotificationPreference isolation — scoped by userId GUC.
//   (d) saas_admin bypass — sees all rows across users.
//   (e) No GUC set — zero rows returned (fail-closed).
//
// Fixture: two wholesaler tenants A/B, each with one admin user.
//   Each user has one Notification, one NotificationDelivery, and one
//   NotificationPreference row.

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
    `notification-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `notification-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });
// Raw app-role client used to test RLS-only path (application-layer guard bypassed).
const appRaw = new PrismaClient({ datasourceUrl: APP_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
  notifA: string; // Notification.id for user A
  notifB: string; // Notification.id for user B
  deliveryA: string; // NotificationDelivery.id linked to notifA
  deliveryB: string; // NotificationDelivery.id linked to notifB
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
  await admin.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;`,
  );
}

async function truncate(): Promise<void> {
  await admin.$executeRawUnsafe(`
    TRUNCATE TABLE
      "NotificationPreference",
      "NotificationDelivery",
      "Notification",
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

  const notifA = await admin.notification.create({
    data: {
      recipientUserId: userA.id,
      tenantId: tenantA.id,
      type: "EVENT_PUBLISHED",
      title: "イベント公開",
      body: "イベントが公開されました",
      payload: {},
    },
  });
  const notifB = await admin.notification.create({
    data: {
      recipientUserId: userB.id,
      tenantId: tenantB.id,
      type: "EVENT_PUBLISHED",
      title: "イベント公開",
      body: "イベントが公開されました",
      payload: {},
    },
  });

  const deliveryA = await admin.notificationDelivery.create({
    data: {
      notificationId: notifA.id,
      channel: "IN_APP",
      status: "PENDING",
      updatedAt: new Date(),
    },
  });
  const deliveryB = await admin.notificationDelivery.create({
    data: {
      notificationId: notifB.id,
      channel: "IN_APP",
      status: "PENDING",
      updatedAt: new Date(),
    },
  });

  // Seed NotificationPreference rows for both users.
  await admin.notificationPreference.create({
    data: {
      userId: userA.id,
      type: "EVENT_PUBLISHED",
      channel: "IN_APP",
      enabled: true,
    },
  });
  await admin.notificationPreference.create({
    data: {
      userId: userB.id,
      type: "EVENT_PUBLISHED",
      channel: "IN_APP",
      enabled: false,
    },
  });

  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
    notifA: notifA.id,
    notifB: notifB.id,
    deliveryA: deliveryA.id,
    deliveryB: deliveryB.id,
  };
}

// ctx where actorUserId drives Notification / NotificationPreference RLS.
function ctxForUser(tenantId: string, userId: string): TenantContext {
  return {
    tenantId,
    wholesalerId: tenantId,
    relationshipIds: [],
    isSaasAdmin: false,
    actorUserId: userId,
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
  await appRaw.$disconnect();
});

beforeEach(async () => {
  await truncate();
  fixture = await seed();
});

// ---------------------------------------------------------------------------
// (a) Notification isolation — recipientUserId = current_actor_user_id
// ---------------------------------------------------------------------------

describe("notification isolation — Notification", () => {
  it("user A sees only their own Notification rows", async () => {
    const rows = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.notification.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.notifA]);
  });

  it("user A cannot read user B's Notification by id", async () => {
    const row = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.notification.findUnique({ where: { id: fixture.notifB } }),
    );
    expect(row).toBeNull();
  });

  it("user B sees only their own Notification rows", async () => {
    const rows = await withTenant(
      ctxForUser(fixture.tenantB.id, fixture.tenantB.userId),
      (tx) => tx.notification.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.notifB]);
  });
});

// ---------------------------------------------------------------------------
// (b) NotificationDelivery isolation — gated via parent Notification
// ---------------------------------------------------------------------------

describe("notification isolation — NotificationDelivery", () => {
  it("user A sees only NotificationDelivery rows for their own Notifications", async () => {
    const rows = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.notificationDelivery.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([fixture.deliveryA]);
  });

  it("user A cannot read user B's NotificationDelivery by id", async () => {
    const row = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.notificationDelivery.findUnique({ where: { id: fixture.deliveryB } }),
    );
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) NotificationPreference isolation — userId = current_actor_user_id
// ---------------------------------------------------------------------------

describe("notification isolation — NotificationPreference", () => {
  it("user A sees only their own NotificationPreference rows", async () => {
    const rows = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.notificationPreference.findMany(),
    );
    expect(rows.every((r) => r.userId === fixture.tenantA.userId)).toBe(true);
    expect(rows.length).toBe(1);
  });

  it("user A cannot read user B's NotificationPreference", async () => {
    // Attempt a raw where-clause targeting user B's primary key.
    const rows = await withTenant(
      ctxForUser(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) =>
        tx.notificationPreference.findMany({
          where: { userId: fixture.tenantB.userId },
        }),
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) saas_admin bypass — sees all rows across users
// ---------------------------------------------------------------------------

describe("notification isolation — saas_admin bypass", () => {
  it("saas_admin sees all Notification rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.notification.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.notifA, fixture.notifB].sort(),
    );
  });

  it("saas_admin sees all NotificationDelivery rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.notificationDelivery.findMany({ orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [fixture.deliveryA, fixture.deliveryB].sort(),
    );
  });

  it("saas_admin sees all NotificationPreference rows", async () => {
    const rows = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.notificationPreference.findMany(),
    );
    expect(rows.length).toBe(2);
    const userIds = rows.map((r) => r.userId).sort();
    expect(userIds).toEqual(
      [fixture.tenantA.userId, fixture.tenantB.userId].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// (e) No GUC — fail-closed: zero rows returned
// ---------------------------------------------------------------------------

describe("notification isolation — fail-closed (no GUC)", () => {
  it("raw app_user without any SET LOCAL sees zero Notification rows", async () => {
    const rows = await appRaw.notification.findMany();
    expect(rows).toEqual([]);
  });

  it("raw app_user without any SET LOCAL sees zero NotificationDelivery rows", async () => {
    const rows = await appRaw.notificationDelivery.findMany();
    expect(rows).toEqual([]);
  });

  it("raw app_user without any SET LOCAL sees zero NotificationPreference rows", async () => {
    const rows = await appRaw.notificationPreference.findMany();
    expect(rows).toEqual([]);
  });
});

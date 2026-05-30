// Integration tests for tenant isolation (T-01-04).
//
// Verifies the two layers introduced by this task:
//   1. Application-layer guard — the Prisma `$extends` tenant extension throws
//      TenantContextRequiredError when a call is issued without a context.
//   2. Database-layer RLS    — even if the application layer is bypassed,
//      PostgreSQL row-level security returns 0 rows for cross-tenant reads.
//
// The tests run against the `solar_saas_test` database. Two roles are used:
//   - `solar`    — BYPASSRLS=true, used for seeding / truncation
//   - `app_user` — BYPASSRLS=false, used to exercise the RLS policies
//
// Migrations are applied once via `prisma migrate deploy` against the admin
// URL, and `app_user` is granted privileges on every table afterwards.
//
// `withTenant` is imported from `@solar/db` — the same production helper used
// by the web app — so the integration tests exercise the canonical code path,
// not a local copy that could drift.

import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  TenantContextRequiredError,
  type TenantContext,
  prisma,
  tenantContextStore,
  withTenant,
} from "../src/index.js";

const ADMIN_URL = process.env.TEST_DB_ADMIN_URL!;
const APP_URL = process.env.TEST_DB_APP_URL!;

// Safety guard: never let `pnpm -F @solar/db test` run against anything other
// than the dedicated test database. The harness will silently apply migrations
// to whatever URL is set, so misconfiguration can otherwise corrupt dev/prod
// data. We check both URLs because some tests use ADMIN_URL for setup and
// APP_URL for queries.
const REQUIRED_DB_NAME = "solar_saas_test";
if (!ADMIN_URL || !ADMIN_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `tenant-isolation tests refuse to run: TEST_DB_ADMIN_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${ADMIN_URL ?? "<unset>"}`,
  );
}
if (!APP_URL || !APP_URL.includes(REQUIRED_DB_NAME)) {
  throw new Error(
    `tenant-isolation tests refuse to run: TEST_DB_APP_URL must target the '${REQUIRED_DB_NAME}' database. ` +
      `Got: ${APP_URL ?? "<unset>"}`,
  );
}

// `prisma` (the guarded singleton) is built from DATABASE_URL = APP_URL. We
// also instantiate an admin client for setup/teardown that bypasses RLS.
const admin = new PrismaClient({ datasourceUrl: ADMIN_URL, log: ["error", "warn"] });

// A raw app-role client used by the "RLS-only" test that intentionally
// bypasses the application-layer guard.
const appRaw = new PrismaClient({ datasourceUrl: APP_URL, log: ["error", "warn"] });

interface Fixture {
  tenantA: { id: string; userId: string };
  tenantB: { id: string; userId: string };
}

let fixture: Fixture;

async function applyMigrations(): Promise<void> {
  // `prisma migrate deploy` is idempotent — it skips already-applied migrations.
  // We point it at the admin URL because RLS-restricted `app_user` cannot
  // create tables.
  execSync("pnpm prisma migrate deploy --schema=prisma/schema.prisma", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: ADMIN_URL, DATABASE_URL_DIRECT: ADMIN_URL },
    stdio: "inherit",
  });
}

async function grantAppUserPrivileges(): Promise<void> {
  // The migration owner is `solar`. `app_user` needs explicit GRANT to read /
  // write the tables so RLS — not GRANT failures — gates access.
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
  // Master tables (SP-02) are listed first so the FK from IncentiveRate →
  // Relationship and ProductPriceHistory → Product is cleared before the
  // parent rows. CASCADE handles transitive deletes for tables that have
  // declared FKs (e.g. PasswordResetToken → User).
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
  // Two wholesaler tenants, each with one admin user, so we can assert
  // tenant-A cannot see tenant-B's rows and vice versa.
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
  return {
    tenantA: { id: tenantA.id, userId: userA.id },
    tenantB: { id: tenantB.id, userId: userB.id },
  };
}

function ctxForWholesaler(wholesalerId: string, actorUserId: string): TenantContext {
  // For a wholesaler member, the home tenant id IS the wholesaler tenant id.
  return {
    tenantId: wholesalerId,
    wholesalerId,
    relationshipIds: [],
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
  await appRaw.$disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncate();
  fixture = await seed();
});

describe("tenant isolation — application layer (Prisma extension)", () => {
  it("guarded client throws TenantContextRequiredError when no context is active", async () => {
    await expect(prisma.tenant.findMany()).rejects.toBeInstanceOf(TenantContextRequiredError);
  });

  it("tenant A context: findMany on User returns only tenant A users", async () => {
    const users = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.user.findMany(),
    );
    expect(users.map((u) => u.tenantId)).toEqual([fixture.tenantA.id]);
    expect(users.find((u) => u.tenantId === fixture.tenantB.id)).toBeUndefined();
  });

  it("tenant A context: findUnique({id: tenantB.userId}) returns null", async () => {
    const otherUser = await withTenant(
      ctxForWholesaler(fixture.tenantA.id, fixture.tenantA.userId),
      (tx) => tx.user.findUnique({ where: { id: fixture.tenantB.userId } }),
    );
    expect(otherUser).toBeNull();
  });

  it("saas-admin context (bypass=true) sees both tenants", async () => {
    const tenants = await withTenant(saasAdminCtx(fixture.tenantA.userId), (tx) =>
      tx.tenant.findMany({ orderBy: { name: "asc" } }),
    );
    expect(tenants.map((t) => t.id).sort()).toEqual(
      [fixture.tenantA.id, fixture.tenantB.id].sort(),
    );
  });
});

describe("tenant isolation — database layer (RLS, app-layer bypassed)", () => {
  it("raw app_user client with tenant A GUC still cannot see tenant B (RLS-only)", async () => {
    // Bypass the application-layer guard entirely — call directly on the
    // app-role client with only SET LOCAL applied. This proves RLS alone
    // prevents cross-tenant reads even if the extension is bypassed.
    await appRaw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixture.tenantA.id}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_wholesaler_id = '${fixture.tenantA.id}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_dealer_id = '';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_relationship_ids = '';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.is_saas_admin = 'false';`);

      const users = await tx.user.findMany();
      expect(users.map((u) => u.tenantId)).toEqual([fixture.tenantA.id]);

      const otherUser = await tx.user.findUnique({ where: { id: fixture.tenantB.userId } });
      expect(otherUser).toBeNull();

      // INSERT into tenant B from tenant A context must fail (WITH CHECK).
      await expect(
        tx.user.create({
          data: {
            tenantId: fixture.tenantB.id,
            email: "intruder@example.com",
            name: "侵入者",
            status: "ACTIVE",
            passwordHash: "x",
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("raw app_user client without any SET LOCAL sees zero rows (fail closed)", async () => {
    // No SET LOCAL at all — every policy evaluates the GUCs to NULL, all
    // predicates become false → 0 rows returned, no error.
    // tenantContextStore is empty here, so we don't go through the guarded
    // client; we hit the raw app-role client to test pure RLS behaviour.
    expect(tenantContextStore.getStore()).toBeUndefined();
    const users = await appRaw.user.findMany();
    expect(users).toEqual([]);
    const tenants = await appRaw.tenant.findMany();
    expect(tenants).toEqual([]);
  });

  it("AuditLog UPDATE/DELETE are denied even with is_saas_admin='true' (docs/05 §3.9)", async () => {
    // Seed one AuditLog row via the admin client (BYPASSRLS) so we have a
    // target. Then attempt UPDATE and DELETE from the app-role client with
    // is_saas_admin='true'. Both must fail because the migration intentionally
    // omits UPDATE/DELETE policies under FORCE RLS.
    const row = await admin.auditLog.create({
      data: {
        actorUserId: fixture.tenantA.userId,
        tenantId: fixture.tenantA.id,
        targetType: "User",
        targetId: fixture.tenantA.userId,
        action: "CREATE",
      },
    });

    await appRaw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixture.tenantA.id}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_wholesaler_id = '${fixture.tenantA.id}';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_dealer_id = '';`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_relationship_ids = '';`);
      // Highest privilege the app role can claim. UPDATE/DELETE must still fail.
      await tx.$executeRawUnsafe(`SET LOCAL app.is_saas_admin = 'true';`);

      // Two failure modes are acceptable under FORCE RLS without a matching
      // policy: PostgreSQL may raise "new row violates row-level security
      // policy" or it may return 0 rows affected. We require the latter to
      // be treated as a hard failure by asserting `count === 0` and then a
      // follow-up SELECT proves the row is still intact.
      const updateResult = await tx.$executeRawUnsafe(
        `UPDATE "AuditLog" SET "targetType" = 'Tampered' WHERE id = ${row.id};`,
      );
      expect(updateResult).toBe(0);

      const deleteResult = await tx.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE id = ${row.id};`,
      );
      expect(deleteResult).toBe(0);
    });

    // Confirm via the admin client that the row is unchanged.
    const fresh = await admin.auditLog.findUnique({ where: { id: row.id } });
    expect(fresh).not.toBeNull();
    expect(fresh?.targetType).toBe("User");
  });
});

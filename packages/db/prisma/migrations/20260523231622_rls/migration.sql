-- Solar-SaaS — Row-Level Security (RLS) policies for auth / tenant / role tables.
--
-- Source of truth: docs/05-program-design.md §3.9.
--
-- Session variables expected to be set via `SET LOCAL` at the start of every
-- transaction (see `packages/db/src/with-tenant.ts`):
--   app.current_tenant_id         — tenant id of the caller's home tenant
--                                   (User.tenantId; wholesaler or dealer)
--   app.current_wholesaler_id     — wholesaler-tenant id of the caller (or '')
--   app.current_dealer_id         — dealer-tenant id of the caller (or '')
--   app.current_relationship_ids  — comma-separated relationship ids (or '')
--   app.is_saas_admin             — 'true' or 'false' (SaaS operator bypass flag)
--
-- All settings use `current_setting(name, true)` (missing_ok=true) so the DB
-- still works in maintenance contexts where the GUC has not been issued.
-- Without context all policies evaluate to false → zero rows (fail closed).
--
-- AuditLog: only SELECT and INSERT policies are created. UPDATE and DELETE
-- are intentionally omitted; under FORCE ROW LEVEL SECURITY, the absence of
-- a policy for an operation denies it for every role (including
-- `is_saas_admin = 'true'`). This implements the docs/05 §3.9 rule
-- "UPDATE/DELETE は saas_admin ロールでも禁止".
--
-- This migration is idempotent: every policy is DROP IF EXISTS-ed first.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enable + force RLS on every target table
-- ---------------------------------------------------------------------------

ALTER TABLE "Tenant"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "WholesalerSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WholesalerSettings" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "UserRole"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Relationship"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Relationship"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "InviteCode"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InviteCode"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "UserInvitation"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserInvitation"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "TotpSecret"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TotpSecret"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "BackupCode"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupCode"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "LoginAttempt"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginAttempt"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Session"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"            FORCE  ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"           FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Tenant — visible if caller is operating as this tenant (wholesaler or dealer)
-- or is the SaaS operator.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Tenant_isolation" ON "Tenant";
CREATE POLICY "Tenant_isolation" ON "Tenant"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "id" = current_setting('app.current_wholesaler_id', true)::text
    OR "id" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "id" = current_setting('app.current_wholesaler_id', true)::text
    OR "id" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- WholesalerSettings — wholesaler-scoped only.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "WholesalerSettings_isolation" ON "WholesalerSettings";
CREATE POLICY "WholesalerSettings_isolation" ON "WholesalerSettings"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- User — tenantId must match the caller's home tenant id (docs/05 §3.9).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "User_isolation" ON "User";
CREATE POLICY "User_isolation" ON "User"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- UserRole — derived from User.tenantId via correlated EXISTS.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "UserRole_isolation" ON "UserRole";
CREATE POLICY "UserRole_isolation" ON "UserRole"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "UserRole"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "UserRole"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Relationship — wholesaler sees its own, dealer sees its own.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Relationship_isolation" ON "Relationship";
CREATE POLICY "Relationship_isolation" ON "Relationship"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR "dealerId" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR "dealerId" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- InviteCode — wholesaler-scoped only.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "InviteCode_isolation" ON "InviteCode";
CREATE POLICY "InviteCode_isolation" ON "InviteCode"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- UserInvitation — tenant-scoped (both wholesaler self-invites + dealer staff
-- invites). Uses `app.current_tenant_id` per docs/05 §3.9.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "UserInvitation_isolation" ON "UserInvitation";
CREATE POLICY "UserInvitation_isolation" ON "UserInvitation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- ---------------------------------------------------------------------------
-- TotpSecret — derived from User.tenantId.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "TotpSecret_isolation" ON "TotpSecret";
CREATE POLICY "TotpSecret_isolation" ON "TotpSecret"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "TotpSecret"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "TotpSecret"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- ---------------------------------------------------------------------------
-- BackupCode — derived from User.tenantId.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "BackupCode_isolation" ON "BackupCode";
CREATE POLICY "BackupCode_isolation" ON "BackupCode"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "BackupCode"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "BackupCode"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Session — derived from User.tenantId.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Session_isolation" ON "Session";
CREATE POLICY "Session_isolation" ON "Session"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "Session"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "Session"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- ---------------------------------------------------------------------------
-- LoginAttempt — SaaS-operator only (read), INSERT allowed for the auth
-- service path which always runs with is_saas_admin=true (T-01-05 contract).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "LoginAttempt_saas_admin_only" ON "LoginAttempt";
CREATE POLICY "LoginAttempt_saas_admin_only" ON "LoginAttempt"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (current_setting('app.is_saas_admin', true)::text = 'true')
  WITH CHECK (current_setting('app.is_saas_admin', true)::text = 'true');

-- ---------------------------------------------------------------------------
-- AuditLog — tenant-scoped SELECT + INSERT only.
--
-- Under FORCE ROW LEVEL SECURITY, omitting UPDATE / DELETE policies denies
-- those operations to every role (including is_saas_admin = 'true'). This is
-- the docs/05 §3.9 rule "UPDATE/DELETE は saas_admin ロールでも禁止".
-- The regression test `tenant-isolation.test.ts` asserts this guarantee.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "AuditLog_select" ON "AuditLog";
CREATE POLICY "AuditLog_select" ON "AuditLog"
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    "tenantId" = current_setting('app.current_wholesaler_id', true)::text
    OR "tenantId" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

DROP POLICY IF EXISTS "AuditLog_insert" ON "AuditLog";
CREATE POLICY "AuditLog_insert" ON "AuditLog"
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    "tenantId" = current_setting('app.current_wholesaler_id', true)::text
    OR "tenantId" = current_setting('app.current_dealer_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

-- Drop any UPDATE/DELETE policies that may exist from earlier iterations of
-- this migration. New deployments will not have them; existing deployments
-- (the dev/test DBs of operators who applied the previous version of this
-- file) get cleaned up here so behaviour is uniform.
DROP POLICY IF EXISTS "AuditLog_update_saas_admin_only" ON "AuditLog";
DROP POLICY IF EXISTS "AuditLog_delete_saas_admin_only" ON "AuditLog";

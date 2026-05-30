-- Solar-SaaS — Tenant plan-change history (T-02-09 / F-005 / docs/05 §3.2).
--
-- Append-only audit table consumed exclusively by the SaaS-admin S-016/S-017
-- screens. A row is inserted every time `updatePlanAction` materialises a real
-- plan change (no-ops are not recorded). The before/after values let the
-- operator reconstruct the plan timeline per tenant without scanning AuditLog.
--
-- RLS contract: SAAS_ADMIN-only. The policy mirrors AuditLog's stance —
-- `is_saas_admin = 'true'` is the only path to read or write. The bypass GUC
-- is set by the auth layer when the active user holds the SAAS_ADMIN role
-- (see 20260523231622_rls/migration.sql), so wholesaler / dealer roles see
-- zero rows regardless of `current_wholesaler_id`.

-- CreateTable
CREATE TABLE "TenantPlanHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planBefore" "TenantPlan",
    "planAfter" "TenantPlan" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "changedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPlanHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantPlanHistory_tenantId_createdAt_idx" ON "TenantPlanHistory"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantPlanHistory" ADD CONSTRAINT "TenantPlanHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security — SAAS_ADMIN only.
-- ---------------------------------------------------------------------------

ALTER TABLE "TenantPlanHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPlanHistory" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TenantPlanHistory_isolation" ON "TenantPlanHistory";
CREATE POLICY "TenantPlanHistory_isolation" ON "TenantPlanHistory"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
  );

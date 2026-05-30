-- Solar-SaaS — Store master (店舗マスタ)
--
-- Wholesaler-scoped store master, mirroring the Area master added in
-- 20260528000000. RLS: wholesaler-scoped PERMISSIVE policy with the
-- `is_saas_admin = 'true'` bypass; fail-closed without GUCs.

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Store_wholesalerId_isActive_idx" ON "Store"("wholesalerId", "isActive");

-- ---------------------------------------------------------------------------
-- Row-Level Security — Store (wholesaler-scoped)
-- ---------------------------------------------------------------------------

ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store_isolation" ON "Store";
CREATE POLICY "Store_isolation" ON "Store"
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

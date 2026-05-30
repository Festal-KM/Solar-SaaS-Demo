-- Solar-SaaS — Master tables (T-02-01, SP-02, docs/05 §3.3 §3.9).
--
-- Adds the five wholesaler-scoped master tables required by F-011..F-014:
--   VenueProvider / Product / ProductPriceHistory / Installer / IncentiveRate
--
-- The CreateTable / CreateIndex / AddForeignKey blocks below are the output of
-- `prisma migrate diff` against schema.prisma. The CHECK constraints and the
-- RLS section that follow are hand-written because Prisma DSL cannot express
-- either. The migration is structured so re-running it through
-- `prisma migrate deploy` produces a deterministic result (CHECK constraints
-- use named identifiers, RLS uses DROP POLICY IF EXISTS first).
--
-- RLS contract (mirrors 20260523231622_rls):
--   - Every wholesaler-keyed table policy: `wholesalerId = current_wholesaler_id`
--     OR `is_saas_admin = 'true'`. Fail-closed when GUC is missing.
--   - ProductPriceHistory is keyed via parent Product (correlated EXISTS).
--   - IncentiveRate is keyed via Relationship; visible when the relationship
--     belongs to the active wholesaler tenant OR to the active dealer (via
--     comma-separated `current_relationship_ids` GUC) OR is_saas_admin.

-- CreateEnum
CREATE TYPE "VenueContractType" AS ENUM ('FIXED', 'PERFORMANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('PANEL', 'BATTERY', 'POWER_CONDITIONER', 'MOUNT', 'OTHER_PART', 'SET');

-- CreateEnum
CREATE TYPE "IncentiveTargetType" AS ENUM ('PROJECT_PROFIT', 'WHOLESALE_PROFIT', 'MANUAL');

-- CreateTable
CREATE TABLE "VenueProvider" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "postalCode" TEXT,
    "address" TEXT,
    "area" TEXT,
    "contractType" "VenueContractType",
    "fixedFee" DECIMAL(14,2),
    "performanceRate" DECIMAL(5,2),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "maker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelNo" TEXT,
    "capacity" DECIMAL(10,2),
    "unit" TEXT NOT NULL,
    "purchasePrice" DECIMAL(14,2) NOT NULL,
    "dealerPrice" DECIMAL(14,2) NOT NULL,
    "listPrice" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installer" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "contactName" TEXT,
    "area" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncentiveRate" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "targetType" "IncentiveTargetType" NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "IncentiveRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueProvider_wholesalerId_isActive_idx" ON "VenueProvider"("wholesalerId", "isActive");

-- CreateIndex
CREATE INDEX "Product_wholesalerId_category_isActive_idx" ON "Product"("wholesalerId", "category", "isActive");

-- CreateIndex
CREATE INDEX "Product_wholesalerId_effectiveFrom_effectiveTo_idx" ON "Product"("wholesalerId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_changedAt_idx" ON "ProductPriceHistory"("productId", "changedAt");

-- CreateIndex
CREATE INDEX "Installer_wholesalerId_isActive_idx" ON "Installer"("wholesalerId", "isActive");

-- CreateIndex
CREATE INDEX "IncentiveRate_relationshipId_effectiveFrom_effectiveTo_idx" ON "IncentiveRate"("relationshipId", "effectiveFrom", "effectiveTo");

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncentiveRate" ADD CONSTRAINT "IncentiveRate_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma DSL cannot express these)
--
-- effectiveFrom < effectiveTo when effectiveTo is non-null. This applies to
-- Product and IncentiveRate (ProductPriceHistory no longer carries an
-- effective interval — it is a JSON before/after audit row only). The check
-- passes when effectiveTo is NULL (open-ended interval).
-- ---------------------------------------------------------------------------

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_effective_period_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");

ALTER TABLE "IncentiveRate"
  ADD CONSTRAINT "IncentiveRate_effective_period_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- The auth layer (`@solar/db withTenant`) issues five SET LOCAL GUCs at the
-- top of every transaction; see 20260523231622_rls/migration.sql for the
-- contract. Every policy below is PERMISSIVE FOR ALL and accepts the
-- `is_saas_admin = 'true'` bypass. Without GUCs every predicate evaluates
-- to false → fail-closed (zero rows).
-- ---------------------------------------------------------------------------

ALTER TABLE "VenueProvider"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueProvider"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Product"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "ProductPriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPriceHistory" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Installer"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Installer"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "IncentiveRate"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncentiveRate"       FORCE  ROW LEVEL SECURITY;

-- VenueProvider — wholesaler-scoped.
DROP POLICY IF EXISTS "VenueProvider_isolation" ON "VenueProvider";
CREATE POLICY "VenueProvider_isolation" ON "VenueProvider"
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

-- Product — wholesaler-scoped.
DROP POLICY IF EXISTS "Product_isolation" ON "Product";
CREATE POLICY "Product_isolation" ON "Product"
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

-- ProductPriceHistory — keyed via parent Product.wholesalerId.
DROP POLICY IF EXISTS "ProductPriceHistory_isolation" ON "ProductPriceHistory";
CREATE POLICY "ProductPriceHistory_isolation" ON "ProductPriceHistory"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p."id" = "ProductPriceHistory"."productId"
        AND (
          p."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p."id" = "ProductPriceHistory"."productId"
        AND (
          p."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Installer — wholesaler-scoped.
DROP POLICY IF EXISTS "Installer_isolation" ON "Installer";
CREATE POLICY "Installer_isolation" ON "Installer"
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

-- IncentiveRate — three exclusive branches:
--   * saas-admin sees every row.
--   * Wholesaler members (current_dealer_id IS empty) see every IncentiveRate
--     for a Relationship owned by their wholesaler tenant (docs/05 §3.9
--     "卸業者ロール時").
--   * Dealer members (current_dealer_id IS NOT empty) see only the rates
--     attached to relationships listed in `current_relationship_ids` GUC
--     (docs/05 §3.9 "二次店ロール時"). The wholesaler-branch is gated off
--     in dealer context to prevent siblings on the same wholesaler from
--     leaking through.
DROP POLICY IF EXISTS "IncentiveRate_isolation" ON "IncentiveRate";
CREATE POLICY "IncentiveRate_isolation" ON "IncentiveRate"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "IncentiveRate"."relationshipId"
          AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR "relationshipId" = ANY (
      string_to_array(
        COALESCE(current_setting('app.current_relationship_ids', true), ''),
        ','
      )
    )
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "IncentiveRate"."relationshipId"
          AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR "relationshipId" = ANY (
      string_to_array(
        COALESCE(current_setting('app.current_relationship_ids', true), ''),
        ','
      )
    )
  );

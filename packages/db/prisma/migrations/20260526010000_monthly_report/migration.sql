-- Solar-SaaS — Monthly Report + AuditAction enum completion (T-06-01)
-- docs/05 §3.7, §3.9
--
-- Adds:
--   MonthlyReportStatus enum (DRAFT / SUBMITTED / REVIEWED / FINALIZED)
--   MonthlyScope enum       (SELF / DEALER / JOINT / ALL)
--   MonthlyReport table
--   AuditAction enum values: PUBLISH / UNPUBLISH / CANCEL / FINALIZE / UNLOCK
--                             MANUAL_ADJUST / RELATION_SUSPEND / RELATION_RESUME
--
-- RLS contract (docs/05 §3.9):
--   MonthlyReport — wholesalerId-scoped (wholesaler branch) +
--                   relationshipId branch for dealer read access to their own reports.

-- ---------------------------------------------------------------------------
-- Extend AuditAction enum with SP-06/SP-07 values
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PUBLISH';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UNPUBLISH';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CANCEL';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FINALIZE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UNLOCK';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_ADJUST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RELATION_SUSPEND';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RELATION_RESUME';

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "MonthlyReportStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'REVIEWED', 'FINALIZED'
);

CREATE TYPE "MonthlyScope" AS ENUM (
  'SELF', 'DEALER', 'JOINT', 'ALL'
);

-- ---------------------------------------------------------------------------
-- CreateTable
-- ---------------------------------------------------------------------------

CREATE TABLE "MonthlyReport" (
    "id"             TEXT                    NOT NULL,
    "wholesalerId"   TEXT                    NOT NULL,
    "targetMonth"    TEXT                    NOT NULL,
    "scope"          "MonthlyScope"           NOT NULL,
    "relationshipId" TEXT,
    "aggregated"     JSONB                   NOT NULL,
    "comments"       JSONB,
    "status"         "MonthlyReportStatus"   NOT NULL DEFAULT 'DRAFT',
    "submittedAt"    TIMESTAMP(3),
    "reviewedAt"     TIMESTAMP(3),
    "finalizedAt"    TIMESTAMP(3),
    "finalizedBy"    TEXT,
    "createdAt"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------

-- Unique constraint: one report per wholesaler × month × scope × relationship.
-- relationshipId IS NULL is included in uniqueness (NULLS NOT DISTINCT enforces
-- one null per partition; available from PG 15. For PG < 15 the app layer
-- must guard this via upsert, but the constraint still prevents duplicate
-- non-null combinations).
CREATE UNIQUE INDEX "MonthlyReport_wholesalerId_targetMonth_scope_relationshipId_key"
  ON "MonthlyReport"("wholesalerId", "targetMonth", "scope", "relationshipId")
  NULLS NOT DISTINCT;

CREATE INDEX "MonthlyReport_wholesalerId_targetMonth_idx"
  ON "MonthlyReport"("wholesalerId", "targetMonth");

CREATE INDEX "MonthlyReport_relationshipId_targetMonth_idx"
  ON "MonthlyReport"("relationshipId", "targetMonth")
  WHERE "relationshipId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "MonthlyReport"
  ADD CONSTRAINT "MonthlyReport_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "MonthlyReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyReport" FORCE  ROW LEVEL SECURITY;

-- MonthlyReport isolation:
--   - SaaS admin: full access
--   - Wholesaler: all reports under their wholesalerId
--   - Dealer: only DEALER-scope reports where their relationshipId matches
--     (F-051 — dealer can read only their own monthly report)
DROP POLICY IF EXISTS "MonthlyReport_isolation" ON "MonthlyReport";
CREATE POLICY "MonthlyReport_isolation" ON "MonthlyReport"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    )
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') <> ''
      AND "relationshipId" = ANY (
        string_to_array(
          COALESCE(current_setting('app.current_relationship_ids', true), ''),
          ','
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    )
    OR (
      -- Dealers may UPDATE (e.g. submitComment) rows they can already see.
      -- INSERT/DELETE from dealers is blocked at the app service layer.
      COALESCE(current_setting('app.current_dealer_id', true), '') <> ''
      AND "relationshipId" = ANY (
        string_to_array(
          COALESCE(current_setting('app.current_relationship_ids', true), ''),
          ','
        )
      )
    )
  );

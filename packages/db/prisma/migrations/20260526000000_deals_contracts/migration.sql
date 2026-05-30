-- Solar-SaaS — Deals / Contracts / Gross Profit / Construction / Application (T-05-01)
-- docs/05 §3.6
--
-- Adds 7 enums and 9 models:
--   DealStatus / ContractStatus / IncentiveStatus / IncentiveAdjustmentKind /
--   ConstructionStatus / ApplicationStatus
--
--   Deal / Contract / ContractItem / GrossProfit /
--   Incentive / IncentiveAdjustment / ContractCancellation /
--   Construction / Application
--
-- RLS contract (docs/05 §3.9):
--   Deal              — ownerRelationshipId (three-branch: saas_admin / wholesaler / dealer)
--   Contract          — wholesalerId (direct)
--   ContractItem      — derived from Contract.wholesalerId via correlated EXISTS
--   GrossProfit       — derived from Contract.wholesalerId via correlated EXISTS
--   Incentive         — three-branch: saas_admin / wholesaler-via-join / dealer-via-relationship_ids
--   IncentiveAdjustment — derived from Incentive via correlated EXISTS
--   ContractCancellation — derived from Contract.wholesalerId via correlated EXISTS
--   Construction      — derived from Contract.wholesalerId via correlated EXISTS
--   Application       — derived from Contract.wholesalerId via correlated EXISTS

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "DealStatus" AS ENUM (
  'VISIT_PLANNED', 'VISITED', 'PROPOSING', 'QUOTED',
  'CONSIDERING', 'LIKELY_CONTRACT', 'CONTRACTED', 'LOST'
);

CREATE TYPE "ContractStatus" AS ENUM (
  'CONTRACTED', 'CONSTRUCTING', 'DONE', 'CANCELLED'
);

CREATE TYPE "IncentiveStatus" AS ENUM (
  'DRAFT', 'FINALIZED', 'CANCELLED', 'NEGATIVE_ADJUSTED'
);

CREATE TYPE "IncentiveAdjustmentKind" AS ENUM (
  'MANUAL', 'JOINT_DISTRIBUTION', 'NEGATIVE_AFTER_DEADLINE'
);

CREATE TYPE "ConstructionStatus" AS ENUM (
  'REQUEST_PENDING', 'REQUESTED', 'SURVEYED', 'CONSTRUCTING', 'DONE', 'PAUSED'
);

CREATE TYPE "ApplicationStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'
);

-- ---------------------------------------------------------------------------
-- CreateTable
-- ---------------------------------------------------------------------------

CREATE TABLE "Deal" (
    "id"                   TEXT                NOT NULL,
    "customerId"           TEXT                NOT NULL,
    "ownerType"            "TenantType"         NOT NULL,
    "ownerUserId"          TEXT                NOT NULL,
    "ownerRelationshipId"  TEXT,
    "firstVisitAt"         TIMESTAMP(3),
    "status"               "DealStatus"         NOT NULL DEFAULT 'VISIT_PLANNED',
    "proposedProduct"      TEXT,
    "proposedAmount"       DECIMAL(14,2),
    "expectedProfit"       DECIMAL(14,2),
    "expectedContractDate" TIMESTAMP(3),
    "lostReason"           TEXT,
    "nextAction"           TEXT,
    "note"                 TEXT,
    "createdAt"            TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contract" (
    "id"                          TEXT                 NOT NULL,
    "wholesalerId"                TEXT                 NOT NULL,
    "dealId"                      TEXT                 NOT NULL,
    "customerId"                  TEXT                 NOT NULL,
    "ownerRelationshipId"         TEXT,
    "eventModeAtContract"         "EventMode",
    "contractDate"                TIMESTAMP(3)          NOT NULL,
    "contractAmount"              DECIMAL(14,2)         NOT NULL,
    "maker"                       TEXT,
    "panelCapacity"               DECIMAL(10,2),
    "hasBattery"                  BOOLEAN               NOT NULL DEFAULT false,
    "hasSubsidy"                  BOOLEAN               NOT NULL DEFAULT false,
    "fileKey"                     TEXT,
    "cancelDeadline"              TIMESTAMP(3)          NOT NULL,
    "incentiveRateSnapshot"       DECIMAL(5,2),
    "incentiveTargetTypeSnapshot" "IncentiveTargetType",
    "isSelfHosted"                BOOLEAN               NOT NULL DEFAULT false,
    "status"                      "ContractStatus"      NOT NULL DEFAULT 'CONTRACTED',
    "createdBy"                   TEXT                  NOT NULL,
    "createdAt"                   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                   TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractItem" (
    "id"                    TEXT          NOT NULL,
    "contractId"            TEXT          NOT NULL,
    "productId"             TEXT          NOT NULL,
    "productName"           TEXT          NOT NULL,
    "maker"                 TEXT          NOT NULL,
    "modelNo"               TEXT,
    "qty"                   DECIMAL(10,2) NOT NULL,
    "unit"                  TEXT          NOT NULL,
    "snapshotPurchasePrice" DECIMAL(14,2) NOT NULL,
    "snapshotDealerPrice"   DECIMAL(14,2) NOT NULL,
    "snapshotListPrice"     DECIMAL(14,2) NOT NULL,
    "createdAt"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrossProfit" (
    "id"                     TEXT                 NOT NULL,
    "contractId"             TEXT                 NOT NULL,
    "salesPrice"             DECIMAL(14,2)         NOT NULL,
    "purchaseTotal"          DECIMAL(14,2)         NOT NULL,
    "dealerTotal"            DECIMAL(14,2)         NOT NULL,
    "constructionFee"        DECIMAL(14,2)         NOT NULL DEFAULT 0,
    "otherCost"              DECIMAL(14,2)         NOT NULL DEFAULT 0,
    "discount"               DECIMAL(14,2)         NOT NULL DEFAULT 0,
    "projectProfit"          DECIMAL(14,2)         NOT NULL,
    "wholesaleProfit"        DECIMAL(14,2)         NOT NULL,
    "profitRate"             DECIMAL(5,4)          NOT NULL,
    "incentiveTargetProfit"  DECIMAL(14,2)         NOT NULL,
    "incentiveTargetType"    "IncentiveTargetType" NOT NULL,
    "manualAdjustedBy"       TEXT,
    "manualAdjustedAt"       TIMESTAMP(3),
    "manualAdjustmentReason" TEXT,
    "createdAt"              TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "GrossProfit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Incentive" (
    "id"             TEXT              NOT NULL,
    "contractId"     TEXT              NOT NULL,
    "relationshipId" TEXT              NOT NULL,
    "targetProfit"   DECIMAL(14,2)     NOT NULL,
    "rate"           DECIMAL(5,2)      NOT NULL,
    "amount"         DECIMAL(14,2)     NOT NULL,
    "status"         "IncentiveStatus" NOT NULL DEFAULT 'DRAFT',
    "settledMonth"   TEXT              NOT NULL,
    "finalizedAt"    TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncentiveAdjustment" (
    "id"           TEXT                      NOT NULL,
    "incentiveId"  TEXT                      NOT NULL,
    "kind"         "IncentiveAdjustmentKind" NOT NULL,
    "beforeAmount" DECIMAL(14,2)              NOT NULL,
    "afterAmount"  DECIMAL(14,2)              NOT NULL,
    "reason"       TEXT                      NOT NULL,
    "adjustedBy"   TEXT                      NOT NULL,
    "adjustedAt"   TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedMonth" TEXT,

    CONSTRAINT "IncentiveAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractCancellation" (
    "id"                    TEXT          NOT NULL,
    "contractId"            TEXT          NOT NULL,
    "cancelledAt"           TIMESTAMP(3)  NOT NULL,
    "reason"                TEXT,
    "isWithinDeadline"      BOOLEAN       NOT NULL,
    "negativeAdjustmentIds" TEXT[]        NOT NULL,
    "recordedBy"            TEXT          NOT NULL,
    "createdAt"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractCancellation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Construction" (
    "id"            TEXT                 NOT NULL,
    "contractId"    TEXT                 NOT NULL,
    "installerId"   TEXT,
    "surveyDate"    TIMESTAMP(3),
    "plannedDate"   TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "status"        "ConstructionStatus" NOT NULL DEFAULT 'REQUEST_PENDING',
    "fee"           DECIMAL(14,2),
    "note"          TEXT,
    "fileKeys"      TEXT[]               NOT NULL,
    "createdAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "Construction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Application" (
    "id"             TEXT                NOT NULL,
    "contractId"     TEXT                NOT NULL,
    "type"           TEXT                NOT NULL,
    "agency"         TEXT,
    "plannedDate"    TIMESTAMP(3),
    "submittedDate"  TIMESTAMP(3),
    "approvedDate"   TIMESTAMP(3),
    "status"         "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAmount" DECIMAL(14,2),
    "grantedAmount"  DECIMAL(14,2),
    "note"           TEXT,
    "fileKeys"       TEXT[]              NOT NULL,
    "createdAt"      TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)        NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------

CREATE INDEX "Deal_customerId_idx"           ON "Deal"("customerId");
CREATE INDEX "Deal_status_createdAt_idx"     ON "Deal"("status", "createdAt");
CREATE INDEX "Deal_ownerRelationshipId_idx"  ON "Deal"("ownerRelationshipId");

CREATE UNIQUE INDEX "Contract_dealId_key"                   ON "Contract"("dealId");
CREATE INDEX "Contract_wholesalerId_status_contractDate_idx" ON "Contract"("wholesalerId", "status", "contractDate");
CREATE INDEX "Contract_ownerRelationshipId_status_idx"       ON "Contract"("ownerRelationshipId", "status");

CREATE INDEX "ContractItem_contractId_idx" ON "ContractItem"("contractId");

CREATE UNIQUE INDEX "GrossProfit_contractId_key" ON "GrossProfit"("contractId");

CREATE UNIQUE INDEX "Incentive_contractId_relationshipId_key"    ON "Incentive"("contractId", "relationshipId");
CREATE INDEX        "Incentive_relationshipId_settledMonth_status_idx" ON "Incentive"("relationshipId", "settledMonth", "status");

CREATE INDEX "IncentiveAdjustment_incentiveId_idx"  ON "IncentiveAdjustment"("incentiveId");
CREATE INDEX "IncentiveAdjustment_appliedMonth_idx" ON "IncentiveAdjustment"("appliedMonth");

CREATE UNIQUE INDEX "ContractCancellation_contractId_key" ON "ContractCancellation"("contractId");

CREATE INDEX "Construction_contractId_idx"  ON "Construction"("contractId");
CREATE INDEX "Construction_plannedDate_idx" ON "Construction"("plannedDate");

CREATE INDEX "Application_contractId_idx" ON "Application"("contractId");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractItem"
  ADD CONSTRAINT "ContractItem_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GrossProfit"
  ADD CONSTRAINT "GrossProfit_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Incentive"
  ADD CONSTRAINT "Incentive_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Incentive"
  ADD CONSTRAINT "Incentive_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncentiveAdjustment"
  ADD CONSTRAINT "IncentiveAdjustment_incentiveId_fkey"
  FOREIGN KEY ("incentiveId") REFERENCES "Incentive"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractCancellation"
  ADD CONSTRAINT "ContractCancellation_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Construction"
  ADD CONSTRAINT "Construction_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Construction"
  ADD CONSTRAINT "Construction_installerId_fkey"
  FOREIGN KEY ("installerId") REFERENCES "Installer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Application"
  ADD CONSTRAINT "Application_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "Deal"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal"                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Contract"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "ContractItem"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractItem"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "GrossProfit"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GrossProfit"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Incentive"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Incentive"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "IncentiveAdjustment"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncentiveAdjustment"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "ContractCancellation"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractCancellation"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Construction"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Construction"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Application"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Application"           FORCE  ROW LEVEL SECURITY;

-- Deal — three-branch: saas_admin / wholesaler (join through ownerRelationshipId
-- or fallback to Customer.wholesalerId) / dealer (own relationshipId only).
-- Deals without ownerRelationshipId (self-hosted) are visible to the wholesaler only.
DROP POLICY IF EXISTS "Deal_isolation" ON "Deal";
CREATE POLICY "Deal_isolation" ON "Deal"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Customer" c
        WHERE c."id" = "Deal"."customerId"
          AND c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') <> ''
      AND "ownerRelationshipId" = ANY (
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
      AND EXISTS (
        SELECT 1 FROM "Customer" c
        WHERE c."id" = "Deal"."customerId"
          AND c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
      )
    )
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') <> ''
      AND "ownerRelationshipId" = ANY (
        string_to_array(
          COALESCE(current_setting('app.current_relationship_ids', true), ''),
          ','
        )
      )
    )
  );

-- Contract — wholesalerId-scoped directly (same pattern as Customer).
DROP POLICY IF EXISTS "Contract_isolation" ON "Contract";
CREATE POLICY "Contract_isolation" ON "Contract"
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

-- ContractItem — derived from Contract.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "ContractItem_isolation" ON "ContractItem";
CREATE POLICY "ContractItem_isolation" ON "ContractItem"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractItem"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractItem"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- GrossProfit — derived from Contract.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "GrossProfit_isolation" ON "GrossProfit";
CREATE POLICY "GrossProfit_isolation" ON "GrossProfit"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "GrossProfit"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "GrossProfit"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Incentive — three-branch: saas_admin / wholesaler sees all in their
-- relationships / dealer sees rows for its own relationship_ids only.
DROP POLICY IF EXISTS "Incentive_isolation" ON "Incentive";
CREATE POLICY "Incentive_isolation" ON "Incentive"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "Incentive"."relationshipId"
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
        WHERE r."id" = "Incentive"."relationshipId"
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

-- IncentiveAdjustment — derived from Incentive via correlated EXISTS
-- (inherits the three-branch logic through Incentive).
DROP POLICY IF EXISTS "IncentiveAdjustment_isolation" ON "IncentiveAdjustment";
CREATE POLICY "IncentiveAdjustment_isolation" ON "IncentiveAdjustment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Incentive" i
      JOIN "Relationship" r ON r."id" = i."relationshipId"
      WHERE i."id" = "IncentiveAdjustment"."incentiveId"
        AND (
          current_setting('app.is_saas_admin', true)::text = 'true'
          OR (
            COALESCE(current_setting('app.current_dealer_id', true), '') = ''
            AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          )
          OR i."relationshipId" = ANY (
            string_to_array(
              COALESCE(current_setting('app.current_relationship_ids', true), ''),
              ','
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Incentive" i
      JOIN "Relationship" r ON r."id" = i."relationshipId"
      WHERE i."id" = "IncentiveAdjustment"."incentiveId"
        AND (
          current_setting('app.is_saas_admin', true)::text = 'true'
          OR (
            COALESCE(current_setting('app.current_dealer_id', true), '') = ''
            AND r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          )
          OR i."relationshipId" = ANY (
            string_to_array(
              COALESCE(current_setting('app.current_relationship_ids', true), ''),
              ','
            )
          )
        )
    )
  );

-- ContractCancellation — derived from Contract.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "ContractCancellation_isolation" ON "ContractCancellation";
CREATE POLICY "ContractCancellation_isolation" ON "ContractCancellation"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractCancellation"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractCancellation"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Construction — derived from Contract.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "Construction_isolation" ON "Construction";
CREATE POLICY "Construction_isolation" ON "Construction"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "Construction"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "Construction"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Application — derived from Contract.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "Application_isolation" ON "Application";
CREATE POLICY "Application_isolation" ON "Application"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "Application"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "Application"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

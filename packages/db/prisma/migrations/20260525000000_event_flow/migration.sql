-- Solar-SaaS — Event-flow tables (T-03-01, SP-03, docs/05 §3.4 §3.9).
--
-- Adds the 8 tables (+ 5 enums) required for the "場所取り〜開催体制 + シフト"
-- pipeline (F-017〜F-025):
--   VenueNegotiation / EventCandidate / EventCandidateVisibility /
--   DealerPreference / Event / EventDealer / EventShift / EventChange
--
-- This file is hand-written to match the same shape as the existing
-- 20260524110000_masters migration: CreateEnum / CreateTable / CreateIndex /
-- AddForeignKey blocks first, then the RLS section.
--
-- RLS contract (docs/05 §3.9):
--   - VenueNegotiation / EventCandidate / Event           — `wholesalerId = current_wholesaler_id`
--   - EventCandidateVisibility / DealerPreference /
--     EventDealer                                         — `relationshipId ∈ current_relationship_ids`
--                                                           OR (wholesaler-branch) the parent
--                                                           Relationship.wholesalerId matches
--   - EventShift / EventChange                            — derived from parent Event.wholesalerId
--                                                           via correlated EXISTS.
--   - is_saas_admin = 'true' bypasses every policy.
--
-- Shift uniqueness: docs/05 §3.4 + T-03-01 requirement → `(userId, startPlanned)`
-- UNIQUE constraint catches the exact same-start collisions at the DB layer;
-- range overlap detection lives in the service layer (T-03-10).

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "VenueNegotiationStatus" AS ENUM (
  'NOT_CONTACTED', 'CONTACTING', 'CONDITION_REVIEW', 'FEASIBLE', 'INFEASIBLE', 'FIXED', 'CANCELLED'
);

CREATE TYPE "EventCandidateStatus" AS ENUM (
  'DRAFT', 'OPEN', 'CLOSED', 'DECIDED', 'CANCELLED'
);

CREATE TYPE "EventMode" AS ENUM (
  'SELF', 'DEALER', 'JOINT', 'CANCELLED'
);

CREATE TYPE "EventStatus" AS ENUM (
  'PLANNED', 'ONGOING', 'CLOSED', 'CANCELLED'
);

CREATE TYPE "ShiftRole" AS ENUM (
  'LEAD', 'CATCH', 'RECEPTION', 'PITCH', 'OTHER'
);

CREATE TYPE "ShiftStatus" AS ENUM (
  'ASSIGNED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW'
);

-- ---------------------------------------------------------------------------
-- CreateTable
-- ---------------------------------------------------------------------------

CREATE TABLE "VenueNegotiation" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "venueProviderId" TEXT NOT NULL,
    "candidateDates" JSONB NOT NULL,
    "decidedDate" TIMESTAMP(3),
    "contractType" "VenueContractType",
    "fixedFee" DECIMAL(14,2),
    "performanceRate" DECIMAL(5,2),
    "conditionNote" TEXT,
    "status" "VenueNegotiationStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
    "nextAction" TEXT,
    "assigneeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueNegotiation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventCandidate" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "venueProviderId" TEXT,
    "venueNegotiationId" TEXT,
    "targetMonth" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "storeName" TEXT NOT NULL,
    "address" TEXT,
    "area" TEXT,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "contractType" "VenueContractType",
    "fixedFee" DECIMAL(14,2),
    "performanceRate" DECIMAL(5,2),
    "internalNote" TEXT,
    "status" "EventCandidateStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventCandidateVisibility" (
    "eventCandidateId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "EventCandidateVisibility_pkey" PRIMARY KEY ("eventCandidateId", "relationshipId")
);

CREATE TABLE "DealerPreference" (
    "id" TEXT NOT NULL,
    "eventCandidateId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "priority" INTEGER,
    "availableDates" JSONB,
    "availablePeople" INTEGER,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT NOT NULL,

    CONSTRAINT "DealerPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "eventCandidateId" TEXT NOT NULL,
    "mode" "EventMode" NOT NULL,
    "requiredPeople" INTEGER,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventDealer" (
    "eventId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "scopeOverride" "DealerScope",
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDealer_pkey" PRIMARY KEY ("eventId", "relationshipId")
);

CREATE TABLE "EventShift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ShiftRole" NOT NULL,
    "startPlanned" TIMESTAMP(3) NOT NULL,
    "endPlanned" TIMESTAMP(3) NOT NULL,
    "startActual" TIMESTAMP(3),
    "endActual" TIMESTAMP(3),
    "status" "ShiftStatus" NOT NULL DEFAULT 'ASSIGNED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventChange_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------

CREATE INDEX "VenueNegotiation_wholesalerId_status_idx" ON "VenueNegotiation"("wholesalerId", "status");
CREATE INDEX "VenueNegotiation_wholesalerId_venueProviderId_idx" ON "VenueNegotiation"("wholesalerId", "venueProviderId");

CREATE INDEX "EventCandidate_wholesalerId_targetMonth_status_idx" ON "EventCandidate"("wholesalerId", "targetMonth", "status");
CREATE INDEX "EventCandidate_wholesalerId_scheduledDate_idx" ON "EventCandidate"("wholesalerId", "scheduledDate");

CREATE INDEX "EventCandidateVisibility_relationshipId_isVisible_idx" ON "EventCandidateVisibility"("relationshipId", "isVisible");

CREATE UNIQUE INDEX "DealerPreference_eventCandidateId_relationshipId_key" ON "DealerPreference"("eventCandidateId", "relationshipId");
CREATE INDEX "DealerPreference_relationshipId_targetMonth_idx" ON "DealerPreference"("relationshipId", "targetMonth");

CREATE UNIQUE INDEX "Event_eventCandidateId_key" ON "Event"("eventCandidateId");
CREATE INDEX "Event_wholesalerId_status_idx" ON "Event"("wholesalerId", "status");

CREATE INDEX "EventDealer_relationshipId_idx" ON "EventDealer"("relationshipId");

CREATE UNIQUE INDEX "EventShift_userId_startPlanned_key" ON "EventShift"("userId", "startPlanned");
CREATE INDEX "EventShift_eventId_idx" ON "EventShift"("eventId");
CREATE INDEX "EventShift_userId_startPlanned_endPlanned_idx" ON "EventShift"("userId", "startPlanned", "endPlanned");

CREATE INDEX "EventChange_eventId_changedAt_idx" ON "EventChange"("eventId", "changedAt");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "VenueNegotiation"
  ADD CONSTRAINT "VenueNegotiation_venueProviderId_fkey"
  FOREIGN KEY ("venueProviderId") REFERENCES "VenueProvider"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventCandidateVisibility"
  ADD CONSTRAINT "EventCandidateVisibility_eventCandidateId_fkey"
  FOREIGN KEY ("eventCandidateId") REFERENCES "EventCandidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventCandidateVisibility"
  ADD CONSTRAINT "EventCandidateVisibility_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerPreference"
  ADD CONSTRAINT "DealerPreference_eventCandidateId_fkey"
  FOREIGN KEY ("eventCandidateId") REFERENCES "EventCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerPreference"
  ADD CONSTRAINT "DealerPreference_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_eventCandidateId_fkey"
  FOREIGN KEY ("eventCandidateId") REFERENCES "EventCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventDealer"
  ADD CONSTRAINT "EventDealer_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventDealer"
  ADD CONSTRAINT "EventDealer_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventShift"
  ADD CONSTRAINT "EventShift_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventChange"
  ADD CONSTRAINT "EventChange_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma DSL cannot express these)
--
-- EventShift.endPlanned MUST be strictly after EventShift.startPlanned. The
-- service layer (T-03-10) also validates this with a Zod refine, but the DB
-- gate prevents any direct INSERT path from getting through.
-- ---------------------------------------------------------------------------

ALTER TABLE "EventShift"
  ADD CONSTRAINT "EventShift_planned_range_check"
  CHECK ("endPlanned" > "startPlanned");

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "VenueNegotiation"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueNegotiation"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "EventCandidate"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventCandidate"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "EventCandidateVisibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventCandidateVisibility" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "DealerPreference"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealerPreference"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Event"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event"                    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "EventDealer"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventDealer"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "EventShift"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventShift"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "EventChange"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventChange"              FORCE  ROW LEVEL SECURITY;

-- VenueNegotiation — wholesaler-scoped.
DROP POLICY IF EXISTS "VenueNegotiation_isolation" ON "VenueNegotiation";
CREATE POLICY "VenueNegotiation_isolation" ON "VenueNegotiation"
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

-- EventCandidate — wholesaler-scoped.
DROP POLICY IF EXISTS "EventCandidate_isolation" ON "EventCandidate";
CREATE POLICY "EventCandidate_isolation" ON "EventCandidate"
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

-- Event — wholesaler-scoped.
DROP POLICY IF EXISTS "Event_isolation" ON "Event";
CREATE POLICY "Event_isolation" ON "Event"
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

-- EventCandidateVisibility — relationship-scoped (mirrors IncentiveRate).
--   * saas-admin sees every row.
--   * Wholesaler members (current_dealer_id IS empty) see every row attached
--     to a Relationship owned by their wholesaler tenant.
--   * Dealer members (current_dealer_id IS NOT empty) see only rows whose
--     relationshipId is listed in `current_relationship_ids`.
DROP POLICY IF EXISTS "EventCandidateVisibility_isolation" ON "EventCandidateVisibility";
CREATE POLICY "EventCandidateVisibility_isolation" ON "EventCandidateVisibility"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "EventCandidateVisibility"."relationshipId"
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
        WHERE r."id" = "EventCandidateVisibility"."relationshipId"
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

-- DealerPreference — same three-branch relationship scope as above.
DROP POLICY IF EXISTS "DealerPreference_isolation" ON "DealerPreference";
CREATE POLICY "DealerPreference_isolation" ON "DealerPreference"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "DealerPreference"."relationshipId"
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
        WHERE r."id" = "DealerPreference"."relationshipId"
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

-- EventDealer — same three-branch relationship scope as above.
DROP POLICY IF EXISTS "EventDealer_isolation" ON "EventDealer";
CREATE POLICY "EventDealer_isolation" ON "EventDealer"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "EventDealer"."relationshipId"
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
        WHERE r."id" = "EventDealer"."relationshipId"
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

-- EventShift — derived from parent Event.wholesalerId via correlated EXISTS.
-- Mirrors the TotpSecret / Session pattern but keyed on wholesalerId.
DROP POLICY IF EXISTS "EventShift_isolation" ON "EventShift";
CREATE POLICY "EventShift_isolation" ON "EventShift"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventShift"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventShift"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- EventChange — derived from parent Event.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "EventChange_isolation" ON "EventChange";
CREATE POLICY "EventChange_isolation" ON "EventChange"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventChange"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventChange"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

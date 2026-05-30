-- Solar-SaaS — Execution tables (T-04-01, SP-04, docs/05 §3.5).
--
-- Adds 6 enums and 5 tables required for event reporting, customer management,
-- appointment tracking, and pre-call notifications:
--   EventReportType / CustomerStatus / AcquisitionChannel /
--   AppointmentStatus / PreCallResult / PreCallNotificationStatus
--
--   EventReport / Customer / Appointment / PreCall / PreCallNotification
--
-- Also adds back-relation columns on Event (reports[], appointments[],
-- customers[]) and PreCallNotification[] on Relationship.
--
-- RLS contract (docs/05 §3.9):
--   EventReport     — derived from parent Event.wholesalerId (correlated EXISTS)
--   Customer        — wholesalerId = current_wholesaler_id
--   Appointment     — derived from Customer.wholesalerId (correlated EXISTS)
--   PreCall         — derived from Appointment → Customer.wholesalerId
--   PreCallNotification — relationshipId-scoped (three-branch: saas_admin /
--                         wholesaler sees all in their rel / dealer sees own)

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "EventReportType" AS ENUM (
  'START', 'END', 'RESULT'
);

CREATE TYPE "CustomerStatus" AS ENUM (
  'NEW', 'PRE_CALL_WAIT', 'PRE_CALL_DONE', 'VISIT_PLANNED',
  'IN_NEGOTIATION', 'CONTRACTED', 'LOST', 'IN_CONSTRUCTION', 'COMPLETED'
);

CREATE TYPE "AcquisitionChannel" AS ENUM (
  'EVENT', 'WALK_IN', 'TELE', 'REFERRAL', 'OTHER'
);

CREATE TYPE "AppointmentStatus" AS ENUM (
  'UNCONFIRMED', 'PRE_CALL_DONE', 'VISITED', 'ABSENT', 'CANCELLED', 'RESCHEDULED'
);

CREATE TYPE "PreCallResult" AS ENUM (
  'APPROVED', 'ABSENT', 'CALLBACK', 'CANCELLED', 'RESCHEDULED'
);

CREATE TYPE "PreCallNotificationStatus" AS ENUM (
  'PENDING', 'SENT', 'ACKNOWLEDGED'
);

-- ---------------------------------------------------------------------------
-- CreateTable
-- ---------------------------------------------------------------------------

CREATE TABLE "EventReport" (
    "id"              TEXT NOT NULL,
    "eventId"         TEXT NOT NULL,
    "type"            "EventReportType" NOT NULL,
    "reporterUserId"  TEXT NOT NULL,
    "reporterOrgType" "TenantType" NOT NULL,
    "payload"         JSONB NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "id"                         TEXT NOT NULL,
    "wholesalerId"               TEXT NOT NULL,
    "ownerRelationshipId"        TEXT,
    "name"                       TEXT NOT NULL,
    "kana"                       TEXT,
    "phone"                      TEXT NOT NULL,
    "email"                      TEXT,
    "postalCode"                 TEXT,
    "address"                    TEXT,
    "housingType"                TEXT,
    "pvInstalled"                BOOLEAN,
    "batteryInstalled"           BOOLEAN,
    "electricBill"               TEXT,
    "household"                  TEXT,
    "channel"                    "AcquisitionChannel" NOT NULL,
    "sourceEventId"              TEXT,
    "registeredByUserId"         TEXT NOT NULL,
    "registeredByOrgType"        "TenantType" NOT NULL,
    "registeredByRelationshipId" TEXT,
    "status"                     "CustomerStatus" NOT NULL DEFAULT 'NEW',
    "note"                       TEXT,
    "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Appointment" (
    "id"                     TEXT NOT NULL,
    "customerId"             TEXT NOT NULL,
    "eventId"                TEXT,
    "scheduledAt"            TIMESTAMP(3) NOT NULL,
    "location"               TEXT,
    "acquiredByUserId"       TEXT NOT NULL,
    "acquiredOrgType"        "TenantType" NOT NULL,
    "acquiredRelationshipId" TEXT,
    "appointmentType"        TEXT,
    "status"                 "AppointmentStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "note"                   TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreCall" (
    "id"                     TEXT NOT NULL,
    "appointmentId"          TEXT NOT NULL,
    "calledAt"               TIMESTAMP(3) NOT NULL,
    "visitConfirmedAt"       TIMESTAMP(3),
    "visitConfirmedLocation" TEXT,
    "personConfirmed"        BOOLEAN NOT NULL DEFAULT false,
    "result"                 "PreCallResult" NOT NULL,
    "cancelRequested"        BOOLEAN NOT NULL DEFAULT false,
    "rescheduleRequested"    BOOLEAN NOT NULL DEFAULT false,
    "note"                   TEXT,
    "nextAction"             TEXT,
    "calledByUserId"         TEXT NOT NULL,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreCallNotification" (
    "id"             TEXT NOT NULL,
    "preCallId"      TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "status"         "PreCallNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "notifiedAt"     TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "note"           TEXT,

    CONSTRAINT "PreCallNotification_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------

CREATE INDEX "EventReport_eventId_type_idx" ON "EventReport"("eventId", "type");

CREATE INDEX "Customer_wholesalerId_phone_idx" ON "Customer"("wholesalerId", "phone");
CREATE INDEX "Customer_wholesalerId_status_createdAt_idx" ON "Customer"("wholesalerId", "status", "createdAt");
CREATE INDEX "Customer_ownerRelationshipId_idx" ON "Customer"("ownerRelationshipId");

CREATE UNIQUE INDEX "PreCall_appointmentId_key" ON "PreCall"("appointmentId");

CREATE INDEX "Appointment_customerId_idx" ON "Appointment"("customerId");
CREATE INDEX "Appointment_status_scheduledAt_idx" ON "Appointment"("status", "scheduledAt");
CREATE INDEX "Appointment_acquiredRelationshipId_idx" ON "Appointment"("acquiredRelationshipId");

CREATE INDEX "PreCall_calledAt_idx" ON "PreCall"("calledAt");

CREATE INDEX "PreCallNotification_relationshipId_status_idx" ON "PreCallNotification"("relationshipId", "status");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "EventReport"
  ADD CONSTRAINT "EventReport_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_sourceEventId_fkey"
  FOREIGN KEY ("sourceEventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreCall"
  ADD CONSTRAINT "PreCall_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PreCallNotification"
  ADD CONSTRAINT "PreCallNotification_preCallId_fkey"
  FOREIGN KEY ("preCallId") REFERENCES "PreCall"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreCallNotification"
  ADD CONSTRAINT "PreCallNotification_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "EventReport"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventReport"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Customer"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Appointment"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "PreCall"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreCall"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "PreCallNotification"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreCallNotification"  FORCE  ROW LEVEL SECURITY;

-- EventReport — derived from parent Event.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "EventReport_isolation" ON "EventReport";
CREATE POLICY "EventReport_isolation" ON "EventReport"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventReport"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventReport"."eventId"
        AND (
          e."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Customer — wholesaler-scoped directly.
DROP POLICY IF EXISTS "Customer_isolation" ON "Customer";
CREATE POLICY "Customer_isolation" ON "Customer"
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

-- Appointment — derived from parent Customer.wholesalerId via correlated EXISTS.
DROP POLICY IF EXISTS "Appointment_isolation" ON "Appointment";
CREATE POLICY "Appointment_isolation" ON "Appointment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "Appointment"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "Appointment"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- PreCall — derived from Appointment → Customer.wholesalerId via nested EXISTS.
DROP POLICY IF EXISTS "PreCall_isolation" ON "PreCall";
CREATE POLICY "PreCall_isolation" ON "PreCall"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Appointment" a
      JOIN "Customer" c ON c."id" = a."customerId"
      WHERE a."id" = "PreCall"."appointmentId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Appointment" a
      JOIN "Customer" c ON c."id" = a."customerId"
      WHERE a."id" = "PreCall"."appointmentId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- PreCallNotification — relationship-scoped (three-branch: saas_admin /
-- wholesaler sees all rows in their relationships / dealer sees own).
DROP POLICY IF EXISTS "PreCallNotification_isolation" ON "PreCallNotification";
CREATE POLICY "PreCallNotification_isolation" ON "PreCallNotification"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR (
      COALESCE(current_setting('app.current_dealer_id', true), '') = ''
      AND EXISTS (
        SELECT 1 FROM "Relationship" r
        WHERE r."id" = "PreCallNotification"."relationshipId"
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
        WHERE r."id" = "PreCallNotification"."relationshipId"
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

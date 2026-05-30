-- Solar-SaaS — LineEvent (ラインイベント)
--
-- 懇意の場所提供元と月単位で複数開催日を契約するイベント。単発イベント
-- (EventCandidate, 1日1件) と直交する新概念。scheduledDates(JSONB) に
-- 月内の開催日(YYYY-MM-DD)配列を保持する。
--
-- RLS: wholesaler-scoped PERMISSIVE policy with the `is_saas_admin = 'true'`
-- bypass; fail-closed without GUCs (mirrors 20260524110000_masters).

-- CreateEnum
CREATE TYPE "LineEventStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LineEvent" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "venueProviderId" TEXT,
    "name" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "area" TEXT,
    "scheduledDates" JSONB NOT NULL,
    "contractType" "VenueContractType",
    "fixedFee" DECIMAL(14,2),
    "performanceRate" DECIMAL(5,2),
    "contractNote" TEXT,
    "status" "LineEventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineEvent_wholesalerId_targetMonth_idx" ON "LineEvent"("wholesalerId", "targetMonth");
CREATE INDEX "LineEvent_wholesalerId_status_idx" ON "LineEvent"("wholesalerId", "status");

-- ---------------------------------------------------------------------------
-- Row-Level Security — LineEvent (wholesaler-scoped)
-- ---------------------------------------------------------------------------

ALTER TABLE "LineEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineEvent" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LineEvent_isolation" ON "LineEvent";
CREATE POLICY "LineEvent_isolation" ON "LineEvent"
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

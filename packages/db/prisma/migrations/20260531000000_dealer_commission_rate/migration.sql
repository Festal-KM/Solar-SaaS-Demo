-- 手数料設定（二次店ごとのインセンティブ率） + 変更履歴。
-- テナント分離: DealerCommissionRate は直接 wholesalerId カラムで分離（Customer
-- と同じ直接パターン）。DealerCommissionRateChange は親 DealerCommissionRate の
-- wholesalerId 経由の相関 EXISTS（Appointment/PreCall と同じ間接パターン）。

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE "DealerCommissionRate" (
    "id"              TEXT NOT NULL,
    "wholesalerId"    TEXT NOT NULL,
    "relationshipId"  TEXT NOT NULL,
    "tossUpRate"      DECIMAL(5,2) NOT NULL,
    "closingRate"     DECIMAL(5,2) NOT NULL,
    "applyFrom"       TIMESTAMP(3) NOT NULL,
    "applyTo"         TIMESTAMP(3),
    "updatedByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DealerCommissionRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DealerCommissionRateChange" (
    "id"              TEXT NOT NULL,
    "rateId"          TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "summary"         TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerCommissionRateChange_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "DealerCommissionRate_relationshipId_key" ON "DealerCommissionRate"("relationshipId");
CREATE INDEX "DealerCommissionRate_wholesalerId_idx" ON "DealerCommissionRate"("wholesalerId");
CREATE INDEX "DealerCommissionRateChange_rateId_createdAt_idx" ON "DealerCommissionRateChange"("rateId", "createdAt");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "DealerCommissionRate"
  ADD CONSTRAINT "DealerCommissionRate_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerCommissionRateChange"
  ADD CONSTRAINT "DealerCommissionRateChange_rateId_fkey"
  FOREIGN KEY ("rateId") REFERENCES "DealerCommissionRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE "DealerCommissionRate"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealerCommissionRate"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "DealerCommissionRateChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealerCommissionRateChange" FORCE  ROW LEVEL SECURITY;

-- DealerCommissionRate — wholesaler-scoped directly（Customer と同じ）。
DROP POLICY IF EXISTS "DealerCommissionRate_isolation" ON "DealerCommissionRate";
CREATE POLICY "DealerCommissionRate_isolation" ON "DealerCommissionRate"
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

-- DealerCommissionRateChange — derived from parent rate.wholesalerId via EXISTS。
DROP POLICY IF EXISTS "DealerCommissionRateChange_isolation" ON "DealerCommissionRateChange";
CREATE POLICY "DealerCommissionRateChange_isolation" ON "DealerCommissionRateChange"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "DealerCommissionRate" r
      WHERE r."id" = "DealerCommissionRateChange"."rateId"
        AND (
          r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "DealerCommissionRate" r
      WHERE r."id" = "DealerCommissionRateChange"."rateId"
        AND (
          r."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

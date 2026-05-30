-- 商談履歴 / 発生タスク / 関連ファイル（顧客詳細の「新規記録」で作成）。
-- テナント分離: いずれも Customer.wholesalerId 経由の相関 EXISTS（Appointment と同パターン）。

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE "CustomerActivity" (
    "id"              TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "occurredAt"      TIMESTAMP(3) NOT NULL,
    "category"        TEXT NOT NULL,
    "detail"          TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTask" (
    "id"              TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "activityId"      TEXT,
    "content"         TEXT NOT NULL,
    "dueDate"         TIMESTAMP(3),
    "assigneeUserId"  TEXT,
    "done"            BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerFile" (
    "id"               TEXT NOT NULL,
    "customerId"       TEXT NOT NULL,
    "activityId"       TEXT,
    "fileKey"          TEXT NOT NULL,
    "fileName"         TEXT NOT NULL,
    "contentType"      TEXT,
    "size"             INTEGER,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerFile_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX "CustomerActivity_customerId_occurredAt_idx" ON "CustomerActivity"("customerId", "occurredAt");
CREATE INDEX "CustomerTask_customerId_dueDate_idx" ON "CustomerTask"("customerId", "dueDate");
CREATE INDEX "CustomerTask_activityId_idx" ON "CustomerTask"("activityId");
CREATE INDEX "CustomerFile_customerId_createdAt_idx" ON "CustomerFile"("customerId", "createdAt");
CREATE INDEX "CustomerFile_activityId_idx" ON "CustomerFile"("activityId");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "CustomerActivity"
  ADD CONSTRAINT "CustomerActivity_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerTask"
  ADD CONSTRAINT "CustomerTask_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTask"
  ADD CONSTRAINT "CustomerTask_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "CustomerActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerFile"
  ADD CONSTRAINT "CustomerFile_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerFile"
  ADD CONSTRAINT "CustomerFile_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "CustomerActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security — derived from Customer.wholesalerId (correlated EXISTS),
-- mirroring the Appointment_isolation policy.
-- ---------------------------------------------------------------------------
ALTER TABLE "CustomerActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerActivity" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "CustomerTask"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerTask"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "CustomerFile"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerFile"     FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerActivity_isolation" ON "CustomerActivity";
CREATE POLICY "CustomerActivity_isolation" ON "CustomerActivity"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerActivity"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerActivity"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

DROP POLICY IF EXISTS "CustomerTask_isolation" ON "CustomerTask";
CREATE POLICY "CustomerTask_isolation" ON "CustomerTask"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerTask"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerTask"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

DROP POLICY IF EXISTS "CustomerFile_isolation" ON "CustomerFile";
CREATE POLICY "CustomerFile_isolation" ON "CustomerFile"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerFile"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerFile"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

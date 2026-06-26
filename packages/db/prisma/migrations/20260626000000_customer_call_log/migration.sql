-- 過去コール履歴（CustomerCallLog）+ 次回アポ担当者列（Customer.nextAppointmentAssigneeUserId）。
-- 非破壊: 新テーブル追加 + 列追加のみ。
-- テナント分離: CustomerCallLog は Customer.wholesalerId 経由の相関 EXISTS（CustomerActivity と同パターン）。

-- ---------------------------------------------------------------------------
-- Customer: 次回アポ担当者（自社 User）。商談タブで編集、コールタブで read-only 表示。
-- ---------------------------------------------------------------------------
ALTER TABLE "Customer" ADD COLUMN "nextAppointmentAssigneeUserId" TEXT;

-- ---------------------------------------------------------------------------
-- CustomerCallLog テーブル
-- ---------------------------------------------------------------------------
CREATE TABLE "CustomerCallLog" (
    "id"              TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "calledAt"        TIMESTAMP(3) NOT NULL,
    "handlerUserId"   TEXT,
    "note"            TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerCallLog_customerId_calledAt_idx" ON "CustomerCallLog"("customerId", "calledAt");

ALTER TABLE "CustomerCallLog"
  ADD CONSTRAINT "CustomerCallLog_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security — derived from Customer.wholesalerId (correlated EXISTS),
-- mirroring the CustomerActivity_isolation policy.
-- ---------------------------------------------------------------------------
ALTER TABLE "CustomerCallLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerCallLog" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerCallLog_isolation" ON "CustomerCallLog";
CREATE POLICY "CustomerCallLog_isolation" ON "CustomerCallLog"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerCallLog"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerCallLog"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- 顧客ごとのチャット（担当者間のやり取り）。
-- テナント分離: Customer.wholesalerId 経由の相関 EXISTS（CustomerActivity と同パターン）。

CREATE TABLE "CustomerMessage" (
    "id"           TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body"         TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerMessage_customerId_createdAt_idx" ON "CustomerMessage"("customerId", "createdAt");

ALTER TABLE "CustomerMessage"
  ADD CONSTRAINT "CustomerMessage_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security — derived from Customer.wholesalerId (correlated EXISTS).
ALTER TABLE "CustomerMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerMessage" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerMessage_isolation" ON "CustomerMessage";
CREATE POLICY "CustomerMessage_isolation" ON "CustomerMessage"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerMessage"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerMessage"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

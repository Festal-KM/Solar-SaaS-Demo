-- 顧客に提示した見積情報。
-- テナント分離: Customer.wholesalerId 経由の相関 EXISTS（CustomerMessage と同パターン）。

CREATE TABLE "CustomerQuote" (
    "id"              TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "amount"          INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'draft',
    "presentedDate"   TIMESTAMP(3),
    "note"            TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerQuote_customerId_createdAt_idx" ON "CustomerQuote"("customerId", "createdAt");

ALTER TABLE "CustomerQuote"
  ADD CONSTRAINT "CustomerQuote_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security — derived from Customer.wholesalerId (correlated EXISTS).
ALTER TABLE "CustomerQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerQuote" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerQuote_isolation" ON "CustomerQuote";
CREATE POLICY "CustomerQuote_isolation" ON "CustomerQuote"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerQuote"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "CustomerQuote"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

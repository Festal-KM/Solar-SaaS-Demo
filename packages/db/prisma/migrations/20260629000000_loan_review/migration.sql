-- ローン審査（LoanReview）+ ローン審査履歴ログ（LoanReviewLog）。
-- 顧客詳細「ローン審査」タブを独立エンティティ N 件のサブタブ構成へ（契約タブと同型）。
-- 非破壊: 新テーブル 2 つの追加のみ（Contract のローン列は残置）。
-- テナント分離: 両テーブルとも Customer.wholesalerId 経由の相関 EXISTS（CustomerCallLog と同パターン）。

-- ---------------------------------------------------------------------------
-- LoanReview テーブル（顧客 1:N）
-- ---------------------------------------------------------------------------
CREATE TABLE "LoanReview" (
    "id"                  TEXT NOT NULL,
    "customerId"          TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'not_reviewed',
    "loanCompany"         TEXT,
    "downPayment"         INTEGER,
    "creditLifeInsurance" BOOLEAN,
    "note"                TEXT,
    "defectContent"       TEXT,
    "defectStatus"        TEXT,
    "reviewedAt"          TIMESTAMP(3),
    "createdByUserId"     TEXT NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoanReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanReview_customerId_createdAt_idx" ON "LoanReview"("customerId", "createdAt");

ALTER TABLE "LoanReview"
  ADD CONSTRAINT "LoanReview_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- LoanReviewLog テーブル（各審査の履歴ログ・画面から追加可能）
-- ---------------------------------------------------------------------------
CREATE TABLE "LoanReviewLog" (
    "id"              TEXT NOT NULL,
    "loanReviewId"    TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "reviewedAt"      TIMESTAMP(3) NOT NULL,
    "result"          TEXT NOT NULL,
    "note"            TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanReviewLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanReviewLog_loanReviewId_reviewedAt_idx" ON "LoanReviewLog"("loanReviewId", "reviewedAt");

ALTER TABLE "LoanReviewLog"
  ADD CONSTRAINT "LoanReviewLog_loanReviewId_fkey"
  FOREIGN KEY ("loanReviewId") REFERENCES "LoanReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security — both tables derive isolation from Customer.wholesalerId
-- (correlated EXISTS), mirroring the CustomerCallLog_isolation policy.
-- ---------------------------------------------------------------------------
ALTER TABLE "LoanReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoanReview" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LoanReview_isolation" ON "LoanReview";
CREATE POLICY "LoanReview_isolation" ON "LoanReview"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "LoanReview"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "LoanReview"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

ALTER TABLE "LoanReviewLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoanReviewLog" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LoanReviewLog_isolation" ON "LoanReviewLog";
CREATE POLICY "LoanReviewLog_isolation" ON "LoanReviewLog"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "LoanReviewLog"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" c
      WHERE c."id" = "LoanReviewLog"."customerId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- Manual status + detail columns on Customer (顧客詳細で手動管理する
-- 契約状況 / 施工状況 / 補助金申請状況)。一覧・詳細はこの手動値を表示する。
ALTER TABLE "Customer"
  ADD COLUMN "contractStatus" TEXT NOT NULL DEFAULT 'negotiating',
  ADD COLUMN "contractPlan" TEXT,
  ADD COLUMN "contractExpectedDate" TIMESTAMP(3),
  ADD COLUMN "constructionStatus" TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN "constructionPlannedDate" TIMESTAMP(3),
  ADD COLUMN "constructionCompletedDate" TIMESTAMP(3),
  ADD COLUMN "subsidyStatus" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "subsidyType" TEXT,
  ADD COLUMN "subsidySubmittedDate" TIMESTAMP(3),
  ADD COLUMN "subsidyGrantedDate" TIMESTAMP(3);

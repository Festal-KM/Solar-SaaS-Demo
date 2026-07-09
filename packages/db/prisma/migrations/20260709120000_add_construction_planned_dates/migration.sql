-- 工事予定日（開始/終了）を Construction に追加。既存 plannedDate は plannedStartDate へバックフィル。
ALTER TABLE "Construction" ADD COLUMN "plannedStartDate" TIMESTAMP(3);
ALTER TABLE "Construction" ADD COLUMN "plannedEndDate" TIMESTAMP(3);
UPDATE "Construction" SET "plannedStartDate" = "plannedDate" WHERE "plannedDate" IS NOT NULL;

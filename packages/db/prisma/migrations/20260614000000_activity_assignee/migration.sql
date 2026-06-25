-- 商談履歴（CustomerActivity）に記録の担当者を追加。nullable・非破壊 ADD COLUMN。
-- createdByUserId（作成者/監査）とは別概念。既存行/RLS ポリシー不変。
ALTER TABLE "CustomerActivity" ADD COLUMN "assigneeUserId" TEXT;

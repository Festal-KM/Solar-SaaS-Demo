-- 顧客ファイルの用途カテゴリ追加。GENERAL=関連ファイルタブ、APPLICATION=設置申請タブの
-- 申請関連ドキュメント。既存行は DEFAULT 'GENERAL' で後方互換（非破壊）。
--
-- CustomerFile の RLS は Customer.wholesalerId 経由の相関 EXISTS で既に効いており、
-- 列追加でポリシー変更は不要。採番: 20260607000000（F-063）適用済みのため 20260608000000。

CREATE TYPE "CustomerFileCategory" AS ENUM ('GENERAL', 'APPLICATION');

ALTER TABLE "CustomerFile"
  ADD COLUMN "category" "CustomerFileCategory" NOT NULL DEFAULT 'GENERAL';

CREATE INDEX "CustomerFile_customerId_category_createdAt_idx"
  ON "CustomerFile"("customerId", "category", "createdAt");

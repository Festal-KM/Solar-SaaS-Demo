-- コールタブ 4 セクション再設計（マエカク/サンキュー/ローン審査完了/施工完了）。
-- 各コールのメモ列 + サンキューコール（ステータス/希望日時/メモ）を Customer に追加。
-- 全て nullable・非破壊（ADD COLUMN のみ）。施工タブ Construction.thankYouCallAt とは別概念。
ALTER TABLE "Customer" ADD COLUMN "postCompletionCallNote" TEXT;
ALTER TABLE "Customer" ADD COLUMN "loanCompletionCallNote" TEXT;
ALTER TABLE "Customer" ADD COLUMN "maekakuCallNote" TEXT;
ALTER TABLE "Customer" ADD COLUMN "thankYouCallStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "thankYouCallPreferredAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "thankYouCallNote" TEXT;

-- 顧客の担当者を 2 役割（トスアップ担当 / クロージング担当）で管理するためのカラム追加。
-- どちらも任意（NULL 許容）。既存行は NULL（未設定）のまま。
ALTER TABLE "Customer" ADD COLUMN "tossUpUserId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "closingUserId" TEXT;

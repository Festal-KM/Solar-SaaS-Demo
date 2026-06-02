-- 契約状況タブの契約金額、施工状況タブの対応事業者を追加。いずれも任意。
ALTER TABLE "Customer" ADD COLUMN "contractAmount" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "constructionVendor" TEXT;

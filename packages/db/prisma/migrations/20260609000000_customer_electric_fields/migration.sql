-- 電気契約・設備項目（基本情報タブ手動編集・全て nullable・非破壊 ADD COLUMN）。
-- RLS は Customer 既存ポリシーのまま（列追加でポリシー変更不要）。
ALTER TABLE "Customer" ADD COLUMN "electricContractStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "electricAccountNo" TEXT;
ALTER TABLE "Customer" ADD COLUMN "supplyPointNo" TEXT;
ALTER TABLE "Customer" ADD COLUMN "equipmentId" TEXT;

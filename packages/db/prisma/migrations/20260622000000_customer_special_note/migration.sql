-- 特記事項（契約タブのフリーテキストメモ）。nullable・非破壊 ADD COLUMN（既存行/RLS ポリシー不変）。
ALTER TABLE "Customer" ADD COLUMN "specialNote" TEXT;

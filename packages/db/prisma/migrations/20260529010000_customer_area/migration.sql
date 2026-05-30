-- Customer.area: 顧客のエリア（エリアマスタ名を保持）。基本情報の編集ポップアップ
-- でプルダウン選択。未設定の既存行は住所からの導出表示にフォールバックする。
ALTER TABLE "Customer" ADD COLUMN "area" TEXT;

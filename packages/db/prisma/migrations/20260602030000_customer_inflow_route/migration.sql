-- 流入経路（顧客情報で手動選択）。"EVENT" | "OUTBOUND_CALL" | "DIRECT_VISIT"。
-- 既存の channel（獲得チャネル、登録時確定）とは別の手動編集値。任意（NULL 許容）。
ALTER TABLE "Customer" ADD COLUMN "inflowRoute" TEXT;

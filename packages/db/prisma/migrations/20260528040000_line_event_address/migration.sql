-- Solar-SaaS — LineEvent.address
--
-- ラインイベントに住所カラムを追加（カラム追加のみ、RLS は既存ポリシー適用）。

-- AlterTable
ALTER TABLE "LineEvent" ADD COLUMN "address" TEXT;

-- Solar-SaaS — LineEvent assign info
--
-- ラインイベントにアサイン情報を追加する。assignMode は既存 EventMode を
-- 再利用（SELF/DEALER/JOINT）。assignStaffIds(User.id[]) / assignDealerIds
-- (Relationship.id[]) は JSONB 配列。RLS は LineEvent の既存ポリシーが
-- そのまま適用される（カラム追加のみ）。

-- CreateEnum
CREATE TYPE "LineAssignStatus" AS ENUM ('CONFIRMED', 'ADJUSTING');

-- AlterTable
ALTER TABLE "LineEvent" ADD COLUMN "assignMode" "EventMode";
ALTER TABLE "LineEvent" ADD COLUMN "assignStatus" "LineAssignStatus";
ALTER TABLE "LineEvent" ADD COLUMN "assignStaffIds" JSONB;
ALTER TABLE "LineEvent" ADD COLUMN "assignDealerIds" JSONB;
ALTER TABLE "LineEvent" ADD COLUMN "assignNote" TEXT;

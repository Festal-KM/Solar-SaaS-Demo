-- CreateEnum: イベント / 顧客エリアを区別するための種別
CREATE TYPE "AreaType" AS ENUM ('EVENT', 'CUSTOMER');

-- AlterTable: Area に type 列を追加。既存レコードはイベント用として
-- 扱っていたので EVENT をデフォルトに。
ALTER TABLE "Area" ADD COLUMN "type" "AreaType" NOT NULL DEFAULT 'EVENT';

-- CreateIndex: type + isActive で絞り込むクエリ用
CREATE INDEX "Area_wholesalerId_type_isActive_idx" ON "Area"("wholesalerId", "type", "isActive");

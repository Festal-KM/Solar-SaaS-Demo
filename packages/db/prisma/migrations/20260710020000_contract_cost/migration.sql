-- 損益タブ 契約別コスト明細（ContractCost）+ Contract.commissionRate（docs/05 §20）。
-- 追加列・追加テーブルのみで破壊的変更を避ける（§17.10 と同方針）。
-- 適用順序: CREATE TYPE → ALTER TABLE → CREATE TABLE → FK → RLS。

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContractCostCategory" AS ENUM ('CONSTRUCTION_FEE', 'VENUE_FEE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable — 手数料率（0.10 = 10%）。null 可。
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "commissionRate" DECIMAL(5,4);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContractCost" (
  "id"             TEXT NOT NULL,
  "contractId"     TEXT NOT NULL,
  "category"       "ContractCostCategory" NOT NULL,
  "amount"         DECIMAL(14,2) NOT NULL,
  "constructionId" TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContractCost_contractId_idx" ON "ContractCost"("contractId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ContractCost" ADD CONSTRAINT "ContractCost_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContractCost" ADD CONSTRAINT "ContractCost_constructionId_fkey"
    FOREIGN KEY ("constructionId") REFERENCES "Construction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- RLS — 親 Contract.wholesalerId 経由の相関 EXISTS（docs/05 §16.4 / §20.1）
-- ---------------------------------------------------------------------------
ALTER TABLE "ContractCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractCost" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContractCost_isolation" ON "ContractCost";
CREATE POLICY "ContractCost_isolation" ON "ContractCost"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractCost"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractCost"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

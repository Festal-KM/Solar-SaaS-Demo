-- Solar-SaaS — Area master + EventCandidate.contractNote
--
-- 1. Adds the wholesaler-scoped `Area` master table (エリアマスタ).
-- 2. Adds `contractNote` to EventCandidate for per-contract-type memos.
--
-- RLS contract mirrors 20260524110000_masters: wholesaler-scoped PERMISSIVE
-- policy with the `is_saas_admin = 'true'` bypass; fail-closed without GUCs.

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_wholesalerId_isActive_idx" ON "Area"("wholesalerId", "isActive");

-- AlterTable
ALTER TABLE "EventCandidate" ADD COLUMN "contractNote" TEXT;

-- ---------------------------------------------------------------------------
-- Row-Level Security — Area (wholesaler-scoped)
-- ---------------------------------------------------------------------------

ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Area" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Area_isolation" ON "Area";
CREATE POLICY "Area_isolation" ON "Area"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  )
  WITH CHECK (
    "wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
    OR current_setting('app.is_saas_admin', true)::text = 'true'
  );

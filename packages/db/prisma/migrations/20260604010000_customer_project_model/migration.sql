-- 詳細顧客・案件管理データモデル拡張（docs/05 §16-B / §16-C）。
--
-- 16-B: Contract / Construction 運用列 + enum（CallStatus / DefectStatus /
--        PostCompletionStatus）。ContractItem ↔ ContractEquipment 逆リレーション。
-- 16-C: 新規子テーブル ContractEquipment / ContractPayment + enum
--        （EquipmentCategory / ContractPaymentStatus）+ RLS（§16.4）。
--
-- テナント分離: 新規子テーブルは親 Contract.wholesalerId 経由の相関 EXISTS。
--   FORCE ROW LEVEL SECURITY / USING + WITH CHECK 両方 / 既存 §3.9 の
--   app.current_wholesaler_id / app.is_saas_admin GUC パターン踏襲。

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "CallStatus"            AS ENUM ('NONE', 'SCHEDULED', 'DONE', 'CALLBACK_WAIT', 'NG');
CREATE TYPE "DefectStatus"          AS ENUM ('NONE', 'OPEN', 'RESOLVED');
CREATE TYPE "PostCompletionStatus"  AS ENUM ('NONE', 'IN_PROGRESS', 'DONE');
CREATE TYPE "EquipmentCategory"     AS ENUM ('PV', 'BT', 'EQ', 'IH', 'AC', 'ACCESSORY', 'GIFT');
CREATE TYPE "ContractPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- ---------------------------------------------------------------------------
-- 16-B: Contract 追加列
-- ---------------------------------------------------------------------------

ALTER TABLE "Contract" ADD COLUMN "docsUrl"              TEXT;
ALTER TABLE "Contract" ADD COLUMN "equipmentSerialId"    TEXT;
ALTER TABLE "Contract" ADD COLUMN "loanReviewCallAt"     TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN "thankYouCallAt"       TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN "callStatus"           "CallStatus"           NOT NULL DEFAULT 'NONE';
ALTER TABLE "Contract" ADD COLUMN "defectStatus"         "DefectStatus"         NOT NULL DEFAULT 'NONE';
ALTER TABLE "Contract" ADD COLUMN "defectDetail"         TEXT;
ALTER TABLE "Contract" ADD COLUMN "postCompletionStatus" "PostCompletionStatus" NOT NULL DEFAULT 'NONE';

-- ---------------------------------------------------------------------------
-- 16-B: Construction 追加列
-- ---------------------------------------------------------------------------

ALTER TABLE "Construction" ADD COLUMN "startedDate"            TIMESTAMP(3);
ALTER TABLE "Construction" ADD COLUMN "powerSaleStartDate"     TIMESTAMP(3);
ALTER TABLE "Construction" ADD COLUMN "surveyCandidates"       JSONB;
ALTER TABLE "Construction" ADD COLUMN "constructionCandidates" JSONB;
ALTER TABLE "Construction" ADD COLUMN "vendorName"             TEXT;

-- ---------------------------------------------------------------------------
-- 16-C: 新規テーブル ContractEquipment
-- ---------------------------------------------------------------------------

CREATE TABLE "ContractEquipment" (
    "id"               TEXT                NOT NULL,
    "contractId"       TEXT                NOT NULL,
    "contractItemId"   TEXT,
    "category"         "EquipmentCategory" NOT NULL,
    "contracted"       BOOLEAN             NOT NULL DEFAULT false,
    "manufacturer"     TEXT,
    "model"            TEXT,
    "capacity"         TEXT,
    "quantity"         INTEGER,
    "installLocation"  TEXT,
    "introducedStatus" TEXT,
    "warrantyStandard" BOOLEAN,
    "warrantyExtended" BOOLEAN,
    "warrantyDisaster" BOOLEAN,
    "detail"           TEXT,
    "attributes"       JSONB,
    "createdAt"        TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)        NOT NULL,

    CONSTRAINT "ContractEquipment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractEquipment_contractId_category_idx"
    ON "ContractEquipment"("contractId", "category");

ALTER TABLE "ContractEquipment"
    ADD CONSTRAINT "ContractEquipment_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractEquipment"
    ADD CONSTRAINT "ContractEquipment_contractItemId_fkey"
    FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 16-C: 新規テーブル ContractPayment (Contract 1:1)
-- ---------------------------------------------------------------------------

CREATE TABLE "ContractPayment" (
    "id"                  TEXT                    NOT NULL,
    "contractId"          TEXT                    NOT NULL,
    "paymentStatus"       "ContractPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentCount"        INTEGER,
    "loanCompany"         TEXT,
    "downPayment"         INTEGER,
    "creditLifeInsurance" BOOLEAN,
    "loanNote"            TEXT,
    "depositDate"         TIMESTAMP(3),
    "dealerPayoutDate"    TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "ContractPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractPayment_contractId_key" ON "ContractPayment"("contractId");

ALTER TABLE "ContractPayment"
    ADD CONSTRAINT "ContractPayment_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — 親 Contract.wholesalerId 経由の相関 EXISTS（docs/05 §16.4 / §3.9）
-- ---------------------------------------------------------------------------

ALTER TABLE "ContractEquipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractEquipment" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContractEquipment_isolation" ON "ContractEquipment";
CREATE POLICY "ContractEquipment_isolation" ON "ContractEquipment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractEquipment"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractEquipment"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

ALTER TABLE "ContractPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractPayment" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContractPayment_isolation" ON "ContractPayment";
CREATE POLICY "ContractPayment_isolation" ON "ContractPayment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractPayment"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contract" c
      WHERE c."id" = "ContractPayment"."contractId"
        AND (
          c."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

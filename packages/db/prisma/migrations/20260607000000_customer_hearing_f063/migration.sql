-- F-063 アポ取り顧客 住環境・家族属性ヒアリングデータモデル（docs/05 §17）。
--
-- 17-A: enum GuideAttendee + Customer 追加列（連絡先 2 系統分離・家族属性・案内者・
--        提案商材・マエカク希望日時）+ Appointment.acquiredAt。
-- 17-B: enum（ExistingEquipmentCategory / ExistingEquipmentPresence）+ 新規子テーブル
--        CustomerExistingEquipment + RLS（親 Customer.wholesalerId 経由の相関 EXISTS）。
--
-- すべて追加列・追加テーブルのみで破壊的変更なし（NULL 許容）。Customer.phone は併存
-- （後方互換 §17.6）。ContractEquipment（§16-C）への影響はゼロ（別テーブル・別 enum）。
-- 採番: 20260606000000/010000（lane preference）適用済みのため 20260607000000 で採番。

-- ---------------------------------------------------------------------------
-- 17-A: enum + Customer / Appointment 追加列
-- ---------------------------------------------------------------------------

CREATE TYPE "GuideAttendee" AS ENUM ('HUSBAND', 'WIFE', 'BOTH', 'OTHER');

ALTER TABLE "Customer" ADD COLUMN "landlinePhone"      TEXT;
ALTER TABLE "Customer" ADD COLUMN "mobilePhone"        TEXT;
ALTER TABLE "Customer" ADD COLUMN "husbandAge"         INTEGER;
ALTER TABLE "Customer" ADD COLUMN "wifeAge"            INTEGER;
ALTER TABLE "Customer" ADD COLUMN "childAge"           INTEGER;
ALTER TABLE "Customer" ADD COLUMN "guideAttendee"      "GuideAttendee";
ALTER TABLE "Customer" ADD COLUMN "faceToFace"         BOOLEAN;
ALTER TABLE "Customer" ADD COLUMN "proposedProduct"    TEXT;
ALTER TABLE "Customer" ADD COLUMN "proposedProductId"  TEXT;
ALTER TABLE "Customer" ADD COLUMN "maekakuPreferredAt" TIMESTAMP(3);

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_proposedProductId_fkey"
  FOREIGN KEY ("proposedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD COLUMN "acquiredAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 17-B: enum + 新規テーブル CustomerExistingEquipment
-- ---------------------------------------------------------------------------

CREATE TYPE "ExistingEquipmentCategory" AS ENUM ('GAS_WATER_HEATER', 'ECO_CUTE', 'PV');
CREATE TYPE "ExistingEquipmentPresence" AS ENUM ('YES', 'NO', 'UNKNOWN');

CREATE TABLE "CustomerExistingEquipment" (
    "id"          TEXT                        NOT NULL,
    "customerId"  TEXT                        NOT NULL,
    "category"    "ExistingEquipmentCategory" NOT NULL,
    "installed"   "ExistingEquipmentPresence" NOT NULL DEFAULT 'UNKNOWN',
    "installDate" TIMESTAMP(3),
    "maker"       TEXT,
    "capacityKw"  DECIMAL(8,2),
    "panelCount"  INTEGER,
    "attributes"  JSONB,
    "createdAt"   TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)                NOT NULL,

    CONSTRAINT "CustomerExistingEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerExistingEquipment_customerId_category_key"
    ON "CustomerExistingEquipment"("customerId", "category");

CREATE INDEX "CustomerExistingEquipment_customerId_idx"
    ON "CustomerExistingEquipment"("customerId");

ALTER TABLE "CustomerExistingEquipment"
    ADD CONSTRAINT "CustomerExistingEquipment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — 親 Customer.wholesalerId 経由の相関 EXISTS（docs/05 §17.4 / §3.9）
-- ---------------------------------------------------------------------------

ALTER TABLE "CustomerExistingEquipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerExistingEquipment" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "CustomerExistingEquipment_isolation" ON "CustomerExistingEquipment";
CREATE POLICY "CustomerExistingEquipment_isolation" ON "CustomerExistingEquipment"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "Customer" cu
      WHERE cu."id" = "CustomerExistingEquipment"."customerId"
        AND (
          cu."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Customer" cu
      WHERE cu."id" = "CustomerExistingEquipment"."customerId"
        AND (
          cu."wholesalerId" = current_setting('app.current_wholesaler_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

-- AlterTable: Store gains a nullable foreign key to VenueProvider so chain → store
-- 1 : N hierarchies are representable (場所提供元マスタと店舗マスタの親子関係).
ALTER TABLE "Store" ADD COLUMN "venueProviderId" TEXT;

-- CreateIndex: speed up child-store lookup per provider.
CREATE INDEX "Store_venueProviderId_idx" ON "Store"("venueProviderId");

-- AddForeignKey: SetNull on parent delete so a provider can be retired without
-- losing child store rows (匿名化フロー: 親 provider を削除しても店舗は残す).
ALTER TABLE "Store" ADD CONSTRAINT "Store_venueProviderId_fkey"
  FOREIGN KEY ("venueProviderId") REFERENCES "VenueProvider"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

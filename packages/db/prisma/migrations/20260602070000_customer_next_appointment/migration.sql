-- 商談履歴タブの「現在の商談状況」で記録する次回アポ日程。任意（NULL 許容）。
ALTER TABLE "Customer" ADD COLUMN "nextAppointmentAt" TIMESTAMP(3);

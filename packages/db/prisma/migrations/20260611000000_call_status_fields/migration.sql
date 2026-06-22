-- バッチ B コール状況。全列 nullable・非破壊 ADD COLUMN（既存行/RLS ポリシー不変）。
ALTER TABLE "Customer" ADD COLUMN "postCompletionCallStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "postCompletionCallPreferredAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "loanCompletionCallStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN "loanCompletionCallPreferredAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "generalCallPreferredTime" TEXT;
ALTER TABLE "Customer" ADD COLUMN "maekakuPreferredPhone" TEXT;

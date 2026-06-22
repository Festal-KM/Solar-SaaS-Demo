-- バッチ C ローン審査ステータス。ContractPayment.loanReviewStatus（nullable）。
-- 値域: not_reviewed(審査前) / reviewing(審査中) / completed(完了) / defect(不備在り)。
-- 非破壊 ADD COLUMN（既存行/RLS ポリシー不変）。
ALTER TABLE "ContractPayment" ADD COLUMN "loanReviewStatus" TEXT;

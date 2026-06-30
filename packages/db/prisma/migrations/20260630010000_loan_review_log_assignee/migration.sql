-- ローン審査ログ（LoanReviewLog）の不備に担当者を持たせる。
-- 担当者は自社 User の素の String（FK 無し。Customer.nextAppointmentAssigneeUserId と同流儀）で、
-- 記録者（createdByUserId）とは別概念。専用の不備追加フォームから登録する。
-- RLS: LoanReviewLog の既存ポリシー（customerId→Customer.wholesalerId 相関 EXISTS）のまま
--      （カラム追加のみのため新ポリシー不要）。
ALTER TABLE "LoanReviewLog" ADD COLUMN "assigneeUserId" TEXT;

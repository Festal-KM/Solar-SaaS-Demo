-- ローン審査の不備管理をログ単位（LoanReviewLog）へ移行する。
-- 不備は審査履歴ログの登録時に記録し、「不備内容・解消状況」セクションはログ横断で一覧表示する。
-- LoanReview サマリの単一 defectContent/defectStatus は廃止する。
-- 非破壊範囲: LoanReviewLog へ列追加 2 本 + LoanReview から列削除 2 本のみ。
-- RLS: LoanReviewLog の既存ポリシー（customerId→Customer.wholesalerId 相関 EXISTS）のまま
--      （カラム追加のみのため新ポリシー不要）。

-- ---------------------------------------------------------------------------
-- LoanReviewLog: 不備内容・解消フラグを追加
-- ---------------------------------------------------------------------------
ALTER TABLE "LoanReviewLog" ADD COLUMN "defectContent" TEXT;
ALTER TABLE "LoanReviewLog" ADD COLUMN "defectResolved" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- LoanReview: サマリ単一の不備列を廃止（ログ単位へ移行済み）
-- ---------------------------------------------------------------------------
ALTER TABLE "LoanReview" DROP COLUMN "defectContent";
ALTER TABLE "LoanReview" DROP COLUMN "defectStatus";

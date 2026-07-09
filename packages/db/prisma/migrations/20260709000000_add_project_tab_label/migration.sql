-- 顧客詳細「施工 / ローン審査 / 契約」タブのサブタブ表示名（業務ラベル・PII 非該当）。
-- レコードごとにユーザーが右クリックで改名・永続化する。null はデフォルト表記（施工#N 等）。
-- 非破壊: 既存 3 テーブルへ nullable カラムを追加するのみ。

ALTER TABLE "Construction" ADD COLUMN "tabLabel" TEXT;
ALTER TABLE "Contract" ADD COLUMN "tabLabel" TEXT;
ALTER TABLE "LoanReview" ADD COLUMN "tabLabel" TEXT;

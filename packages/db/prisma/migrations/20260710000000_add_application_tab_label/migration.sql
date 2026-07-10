-- 設置申請（Application）サブタブの表示名（業務ラベル・PII 非該当）。
-- レコードごとにユーザーが右クリックで改名・永続化する。null はデフォルト表記（申請#N）。
-- 非破壊: 既存テーブルへ nullable カラムを追加するのみ。

ALTER TABLE "Application" ADD COLUMN "tabLabel" TEXT;

-- 契約状況タブの関連ファイル。CustomerFileCategory に CONTRACT を追加（非破壊）。
-- 注意: Postgres の ALTER TYPE ... ADD VALUE は同一トランザクション内で即時利用できない
-- 制約があるため、他の DDL と混ぜず単独マイグレーションとして実行する。
ALTER TYPE "CustomerFileCategory" ADD VALUE 'CONTRACT';

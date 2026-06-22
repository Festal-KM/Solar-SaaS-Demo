-- バッチ C PV設置図面スロット。CustomerFileCategory に PV_DRAWING を追加（非破壊）。
-- 注意: Postgres の ALTER TYPE ... ADD VALUE は同一トランザクション内で即時利用できない
-- 制約があるため、他の DDL と混ぜず単独マイグレーションとして実行する。
ALTER TYPE "CustomerFileCategory" ADD VALUE 'PV_DRAWING';

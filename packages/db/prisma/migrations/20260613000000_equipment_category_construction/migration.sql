-- 商材ライン「施工」（契約上の施工金額）。EquipmentCategory に CONSTRUCTION を追加（非破壊）。
-- これは契約商材ラインの 1 つ（金額・業者・内容を ContractEquipment 行として保持）であり、
-- 施工状況タブの Construction（工事進捗・fee 原価）とは別概念。
-- 注意: Postgres の ALTER TYPE ... ADD VALUE は同一トランザクション内で即時利用できない
-- 制約があるため、他の DDL と混ぜず単独マイグレーションとして実行する。
ALTER TYPE "EquipmentCategory" ADD VALUE 'CONSTRUCTION';

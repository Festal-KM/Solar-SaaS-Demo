-- 商材ごとの契約金額。ContractEquipment.amount（顧客向け商材金額・原価ではない）を追加。
-- nullable・非破壊 ADD COLUMN（既存行/RLS ポリシー不変）。仕入値スナップショット
-- （ContractItem.snapshot*）とは無関係で、二次店にも表示してよい顧客向け金額。
ALTER TABLE "ContractEquipment" ADD COLUMN "amount" DECIMAL(14,2);

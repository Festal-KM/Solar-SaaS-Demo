-- 見積は専用テーブルをやめ、商談履歴（CustomerActivity）の "quote" カテゴリとして
-- 記録する方針に変更。CustomerQuote を廃止し、CustomerActivity に提示金額 amount を追加。

-- 見積提示金額（category = 'quote' のときに使用）。任意。
ALTER TABLE "CustomerActivity" ADD COLUMN "amount" INTEGER;

-- 専用見積テーブルを廃止（ポリシー・インデックスはテーブルと共に破棄される）。
DROP TABLE IF EXISTS "CustomerQuote";

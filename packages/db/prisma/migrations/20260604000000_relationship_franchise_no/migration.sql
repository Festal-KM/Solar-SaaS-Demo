-- 二次店（Relationship）に加盟店番号を追加。
ALTER TABLE "Relationship" ADD COLUMN IF NOT EXISTS "franchiseNo" TEXT;

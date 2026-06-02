-- 担当者（トスアップ / クロージング）を二次店(Relationship)からも選べるようにするための
-- カラム追加。User 用カラムとは排他で運用する（アプリ層で保証）。
ALTER TABLE "Customer" ADD COLUMN "tossUpRelationshipId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "closingRelationshipId" TEXT;

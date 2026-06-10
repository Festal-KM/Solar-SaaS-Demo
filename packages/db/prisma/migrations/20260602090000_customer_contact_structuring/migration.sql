-- docs/05 §16-A: 顧客の連絡先構造化・個人属性・部署。住所は当面 address と併存。
ALTER TABLE "Customer" ADD COLUMN "prefecture"  TEXT;
ALTER TABLE "Customer" ADD COLUMN "city"        TEXT;
ALTER TABLE "Customer" ADD COLUMN "addressLine" TEXT;
ALTER TABLE "Customer" ADD COLUMN "birthDate"   TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "buildYear"   TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "tossDept"    TEXT;
ALTER TABLE "Customer" ADD COLUMN "belongDept"  TEXT;

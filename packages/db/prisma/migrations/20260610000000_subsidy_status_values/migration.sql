-- Customer.subsidyStatus value-domain redefinition (batch A).
-- Old domain: none / applying / granted.
-- New domain: not_applied / preparing / applied / revising / completed.
-- Non-destructive remap of existing rows (idempotent — only touches old keys).
UPDATE "Customer" SET "subsidyStatus" = 'not_applied' WHERE "subsidyStatus" = 'none';
UPDATE "Customer" SET "subsidyStatus" = 'applied' WHERE "subsidyStatus" = 'applying';
UPDATE "Customer" SET "subsidyStatus" = 'completed' WHERE "subsidyStatus" = 'granted';

-- New column default.
ALTER TABLE "Customer" ALTER COLUMN "subsidyStatus" SET DEFAULT 'not_applied';

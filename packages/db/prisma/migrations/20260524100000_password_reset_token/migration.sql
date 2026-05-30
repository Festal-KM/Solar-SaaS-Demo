-- Solar-SaaS — Password reset tokens (T-01-07, F-003, docs/05 §6.10).
--
-- 30-minute single-use email-based password reset tokens. The plaintext token
-- (32 random bytes / 64 hex chars) is embedded in the reset URL only; the DB
-- holds the argon2id hash. `usedAt` is stamped on successful reset so a token
-- can be replayed at most once.
--
-- RLS: the table is enabled + forced. The policy derives ownership from the
-- related `User.tenantId` (correlated EXISTS), mirroring the pattern used for
-- TotpSecret / BackupCode in 20260523231622_rls. The auth layer always runs
-- under `SYSTEM_TENANT_CONTEXT` (isSaasAdmin=true) so policy lookups during
-- request / reset always pass; an attempt without context fails closed.

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security — owned by the related User.tenantId.
-- ---------------------------------------------------------------------------

ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PasswordResetToken_isolation" ON "PasswordResetToken";
CREATE POLICY "PasswordResetToken_isolation" ON "PasswordResetToken"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "PasswordResetToken"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = "PasswordResetToken"."userId"
        AND (
          u."tenantId" = current_setting('app.current_tenant_id', true)::text
          OR current_setting('app.is_saas_admin', true)::text = 'true'
        )
    )
  );

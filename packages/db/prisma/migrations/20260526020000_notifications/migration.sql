-- Solar-SaaS — Notification / NotificationDelivery / NotificationPreference (T-07-01)
-- docs/05 §3.7, §3.9
--
-- Adds:
--   NotificationType enum  (27 values, docs/05 §3.7)
--   DeliveryChannel  enum  (IN_APP / EMAIL / LINE)
--   DeliveryStatus   enum  (PENDING / SENT / FAILED / CANCELLED)
--   Notification             table
--   NotificationDelivery     table
--   NotificationPreference   table
--
-- RLS contract (docs/05 §3.9):
--   Notification           — recipientUserId = app.current_actor_user_id  (saas_admin bypass)
--   NotificationDelivery   — correlated EXISTS through Notification
--   NotificationPreference — userId = app.current_actor_user_id           (saas_admin bypass)

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "NotificationType" AS ENUM (
  'DEALER_PREFERENCE_SUBMITTED',
  'DEALER_PREFERENCE_MISSING',
  'EVENT_DECISION_PENDING',
  'EVENT_SHIFT_SHORTAGE',
  'EVENT_START_REPORTED',
  'EVENT_END_REPORTED',
  'EVENT_RESULT_REPORTED',
  'CUSTOMER_NEW',
  'PRE_CALL_PENDING',
  'PRE_CALL_NOTIFICATION_PENDING',
  'PRE_CALL_RESULT_SHARED',
  'DEAL_STATUS_TO_CONTRACT',
  'MONTHLY_REPORT_SUBMITTED',
  'MONTHLY_REPORT_REVIEW_PENDING',
  'GROSS_PROFIT_PENDING',
  'INCENTIVE_PENDING',
  'INCENTIVE_FINALIZED',
  'CONSTRUCTION_UPCOMING',
  'APPLICATION_DEADLINE',
  'EVENT_PUBLISHED',
  'EVENT_PREFERENCE_DEADLINE',
  'EVENT_ASSIGNED',
  'EVENT_DAY_BEFORE',
  'CONTRACT_CONTRACTED',
  'SHIFT_ASSIGNED',
  'SHIFT_CHANGED',
  'REPORT_PENDING'
);

CREATE TYPE "DeliveryChannel" AS ENUM (
  'IN_APP',
  'EMAIL',
  'LINE'
);

CREATE TYPE "DeliveryStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
);

-- ---------------------------------------------------------------------------
-- CreateTable: Notification
-- ---------------------------------------------------------------------------

CREATE TABLE "Notification" (
    "id"              TEXT                  NOT NULL,
    "recipientUserId" TEXT                  NOT NULL,
    "tenantId"        TEXT                  NOT NULL,
    "type"            "NotificationType"    NOT NULL,
    "title"           TEXT                  NOT NULL,
    "body"            TEXT                  NOT NULL,
    "payload"         JSONB                 NOT NULL,
    "readAt"          TIMESTAMP(3),
    "dedupKey"        TEXT,
    "createdAt"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateTable: NotificationDelivery
-- ---------------------------------------------------------------------------

CREATE TABLE "NotificationDelivery" (
    "id"             TEXT               NOT NULL,
    "notificationId" TEXT               NOT NULL,
    "channel"        "DeliveryChannel"  NOT NULL,
    "status"         "DeliveryStatus"   NOT NULL DEFAULT 'PENDING',
    "attemptedCount" INTEGER            NOT NULL DEFAULT 0,
    "lastError"      TEXT,
    "sentAt"         TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)       NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateTable: NotificationPreference
-- ---------------------------------------------------------------------------

CREATE TABLE "NotificationPreference" (
    "userId"  TEXT                  NOT NULL,
    "type"    "NotificationType"    NOT NULL,
    "channel" "DeliveryChannel"     NOT NULL,
    "enabled" BOOLEAN               NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "type", "channel")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "Notification_dedupKey_key"
  ON "Notification"("dedupKey")
  WHERE "dedupKey" IS NOT NULL;

CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx"
  ON "Notification"("recipientUserId", "readAt", "createdAt");

CREATE INDEX "Notification_tenantId_createdAt_idx"
  ON "Notification"("tenantId", "createdAt");

CREATE INDEX "NotificationDelivery_notificationId_idx"
  ON "NotificationDelivery"("notificationId");

CREATE INDEX "NotificationDelivery_status_channel_idx"
  ON "NotificationDelivery"("status", "channel");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "Notification"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "NotificationDelivery"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDelivery"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE  ROW LEVEL SECURITY;

-- Notification: each user sees only their own notifications.
-- SaaS admin (and the worker running as saas_admin) can see all rows so
-- notification.purge jobs and delivery-status updates work without per-user
-- context.
DROP POLICY IF EXISTS "Notification_isolation" ON "Notification";
CREATE POLICY "Notification_isolation" ON "Notification"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR "recipientUserId" = current_setting('app.current_actor_user_id', true)::text
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR "recipientUserId" = current_setting('app.current_actor_user_id', true)::text
  );

-- NotificationDelivery: scoped via the parent Notification row.
-- Workers update delivery status so saas_admin bypass is required.
DROP POLICY IF EXISTS "NotificationDelivery_isolation" ON "NotificationDelivery";
CREATE POLICY "NotificationDelivery_isolation" ON "NotificationDelivery"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR EXISTS (
      SELECT 1 FROM "Notification" n
      WHERE n."id" = "NotificationDelivery"."notificationId"
        AND n."recipientUserId" = current_setting('app.current_actor_user_id', true)::text
    )
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR EXISTS (
      SELECT 1 FROM "Notification" n
      WHERE n."id" = "NotificationDelivery"."notificationId"
        AND n."recipientUserId" = current_setting('app.current_actor_user_id', true)::text
    )
  );

-- NotificationPreference: each user manages only their own preferences.
DROP POLICY IF EXISTS "NotificationPreference_isolation" ON "NotificationPreference";
CREATE POLICY "NotificationPreference_isolation" ON "NotificationPreference"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR "userId" = current_setting('app.current_actor_user_id', true)::text
  )
  WITH CHECK (
    current_setting('app.is_saas_admin', true)::text = 'true'
    OR "userId" = current_setting('app.current_actor_user_id', true)::text
  );

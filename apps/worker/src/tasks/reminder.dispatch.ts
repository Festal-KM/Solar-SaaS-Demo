// graphile-worker cron task: reminder.dispatch (T-07-07 / docs/05 §5.2 §5.3).
//
// Runs every 5 minutes. Scans for 6 kinds of upcoming-deadline records and
// fires in-app (+ email) notifications for each. Uses a date-level dedupKey so
// each reminder fires at most once per calendar day per target entity.
//
// Notifications are created directly via Prisma (the worker cannot import the
// web layer's NotificationService which depends on Next.js path aliases).
// Email delivery jobs are enqueued via quickAddJob so the same backoff/retry
// chain applies.
//
// Reminder types:
//   a. EVENT_PREFERENCE_DEADLINE  — EventCandidate.deadlineAt within next 24 h
//   b. EVENT_DAY_BEFORE           — EventCandidate.scheduledDate is tomorrow
//   c. CONSTRUCTION_UPCOMING      — Construction.plannedDate in 7 days
//   d. APPLICATION_DEADLINE       — Application.plannedDate in 14 days
//   e. PRE_CALL_NOTIFICATION_PENDING — PreCallNotification status=PENDING,
//                                       notifiedAt + 24 h < now
//   f. REPORT_PENDING             — MonthlyReport status=DRAFT for current month,
//                                   day of month >= 25

import { buildNotificationContent, defaultChannelsForType, type NotificationType } from "@solar/contracts";
import { withTenant, SYSTEM_TENANT_CONTEXT, type TxClient } from "@solar/db";
import { quickAddJob } from "graphile-worker";

import type { Task } from "graphile-worker";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD string for today in JST. Used as the per-day dedup window. */
function todayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** Current YYYY-MM string for the monthly-report check. */
function currentMonth(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

/** Day-of-month in JST (1–31). */
function dayOfMonthJst(): number {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCDate();
}

/**
 * Resolve the active WHOLESALER_ADMIN user IDs for a given wholesaler tenant.
 * Returns an empty array if none exist.
 */
async function resolveWholesalerAdmins(tx: TxClient, wholesalerId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      tenantId: wholesalerId,
      status: "ACTIVE",
      roles: { some: { role: "WHOLESALER_ADMIN" } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Resolve ACTIVE DEALER_ADMIN users for a given relationship.
 */
async function resolveDealerAdmins(tx: TxClient, relationshipId: string): Promise<string[]> {
  const rel = await tx.relationship.findUnique({
    where: { id: relationshipId },
    select: { dealerId: true },
  });
  if (!rel) return [];

  const rows = await tx.user.findMany({
    where: {
      tenantId: rel.dealerId,
      status: "ACTIVE",
      roles: { some: { role: "DEALER_ADMIN" } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

interface FireReminderInput {
  type: NotificationType;
  recipientUserIds: string[];
  tenantId: string;
  params?: Record<string, string>;
  dedupKey: string;
}

/**
 * Create Notification + NotificationDelivery rows and enqueue email jobs.
 * Skips recipients that already received a notification with the same dedupKey.
 * Returns the number of notifications created.
 */
async function fireReminder(
  tx: TxClient,
  input: FireReminderInput,
  connectionString: string,
): Promise<number> {
  if (input.recipientUserIds.length === 0) return 0;

  const { type, recipientUserIds, tenantId, dedupKey } = input;
  const { title, body } = buildNotificationContent(type, input.params ?? {});
  const channels = defaultChannelsForType(type);
  let created = 0;

  for (const userId of recipientUserIds) {
    // Deduplicate — skip if same dedupKey already exists for this user.
    const existing = await tx.notification.findFirst({
      where: { dedupKey, recipientUserId: userId },
      select: { id: true },
    });
    if (existing) continue;

    // Resolve which channels are enabled for this user × type.
    const prefs = await tx.notificationPreference.findMany({
      where: { userId, type, channel: { in: channels } },
      select: { channel: true, enabled: true },
    });
    const disabled = new Set(prefs.filter((p) => !p.enabled).map((p) => p.channel));
    const enabled = channels.filter((ch) => !disabled.has(ch));
    if (enabled.length === 0) continue;

    const notification = await tx.notification.create({
      data: { recipientUserId: userId, tenantId, type, title, body, payload: {}, dedupKey },
      select: { id: true },
    });

    for (const channel of enabled) {
      const delivery = await tx.notificationDelivery.create({
        data: { notificationId: notification.id, channel, status: "PENDING" },
        select: { id: true },
      });

      if (channel === "EMAIL") {
        // Enqueue email delivery job outside the transaction (best-effort;
        // if this fails the notification row still exists and can be retried).
        await quickAddJob(
          { connectionString },
          "notification.send_email",
          { kind: "delivery", deliveryId: delivery.id },
          {
            jobKey: `notification.send_email:${delivery.id}`,
            maxAttempts: 3,
          },
        );
      }
    }

    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// Task entry point
// ---------------------------------------------------------------------------

export const reminderDispatchTask: Task = async (_rawPayload, helpers) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    helpers.logger.error("reminder.dispatch: DATABASE_URL not set, aborting");
    return;
  }

  const start = Date.now();
  const today = todayJst();
  const now = new Date();

  // Window boundaries
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in14days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const minus24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let totalFired = 0;

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    // -----------------------------------------------------------------------
    // a. EVENT_PREFERENCE_DEADLINE — EventCandidate.deadlineAt within next 24h
    // -----------------------------------------------------------------------
    const preferenceDeadlineCandidates = await tx.eventCandidate.findMany({
      where: {
        deadlineAt: { gte: now, lte: in24h },
        status: { in: ["OPEN"] },
      },
      select: {
        id: true,
        wholesalerId: true,
        storeName: true,
        deadlineAt: true,
      },
    });

    for (const ec of preferenceDeadlineCandidates) {
      const visibilities = await tx.eventCandidateVisibility.findMany({
        where: { eventCandidateId: ec.id, isVisible: true },
        select: { relationshipId: true },
      });

      // Notify dealer admins for each visible relationship.
      for (const vis of visibilities) {
        const userIds = await resolveDealerAdmins(tx, vis.relationshipId);
        const rel = await tx.relationship.findUnique({
          where: { id: vis.relationshipId },
          select: { dealerId: true },
        });
        if (!rel) continue;

        const count = await fireReminder(
          tx,
          {
            type: "EVENT_PREFERENCE_DEADLINE",
            recipientUserIds: userIds,
            tenantId: rel.dealerId,
            params: {
              eventTitle: ec.storeName,
              deadline: ec.deadlineAt.toLocaleDateString("ja-JP"),
            },
            dedupKey: `EVENT_PREFERENCE_DEADLINE:${ec.id}:${vis.relationshipId}:${today}`,
          },
          connectionString,
        );
        totalFired += count;
      }
    }

    // -----------------------------------------------------------------------
    // b. EVENT_DAY_BEFORE — EventCandidate.scheduledDate is tomorrow
    // -----------------------------------------------------------------------
    const tomorrowStart = new Date(now);
    tomorrowStart.setUTCHours(0, 0, 0, 0);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setUTCDate(tomorrowEnd.getUTCDate() + 1);

    const dayBeforeEvents = await tx.eventCandidate.findMany({
      where: {
        scheduledDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: { in: ["OPEN", "DECIDED"] },
      },
      select: {
        id: true,
        wholesalerId: true,
        storeName: true,
        scheduledDate: true,
      },
    });

    for (const ec of dayBeforeEvents) {
      const visibilities = await tx.eventCandidateVisibility.findMany({
        where: { eventCandidateId: ec.id, isVisible: true },
        select: { relationshipId: true },
      });

      // Notify wholesaler admins.
      const wsAdmins = await resolveWholesalerAdmins(tx, ec.wholesalerId);
      const wsCount = await fireReminder(
        tx,
        {
          type: "EVENT_DAY_BEFORE",
          recipientUserIds: wsAdmins,
          tenantId: ec.wholesalerId,
          params: {
            eventTitle: ec.storeName,
            eventDate: ec.scheduledDate.toLocaleDateString("ja-JP"),
          },
          dedupKey: `EVENT_DAY_BEFORE:${ec.id}:ws:${today}`,
        },
        connectionString,
      );
      totalFired += wsCount;

      // Notify dealer admins for assigned relationships.
      for (const vis of visibilities) {
        const dlAdmins = await resolveDealerAdmins(tx, vis.relationshipId);
        const rel = await tx.relationship.findUnique({
          where: { id: vis.relationshipId },
          select: { dealerId: true },
        });
        if (!rel) continue;

        const dlCount = await fireReminder(
          tx,
          {
            type: "EVENT_DAY_BEFORE",
            recipientUserIds: dlAdmins,
            tenantId: rel.dealerId,
            params: {
              eventTitle: ec.storeName,
              eventDate: ec.scheduledDate.toLocaleDateString("ja-JP"),
            },
            dedupKey: `EVENT_DAY_BEFORE:${ec.id}:${vis.relationshipId}:${today}`,
          },
          connectionString,
        );
        totalFired += dlCount;
      }
    }

    // -----------------------------------------------------------------------
    // c. CONSTRUCTION_UPCOMING — Construction.plannedDate in 7 days
    // -----------------------------------------------------------------------
    const constructionWindow7Start = new Date(now);
    constructionWindow7Start.setUTCHours(0, 0, 0, 0);
    constructionWindow7Start.setUTCDate(constructionWindow7Start.getUTCDate() + 7);
    const constructionWindow7End = new Date(constructionWindow7Start);
    constructionWindow7End.setUTCDate(constructionWindow7End.getUTCDate() + 1);

    const upcomingConstructions = await tx.construction.findMany({
      where: {
        plannedDate: { gte: constructionWindow7Start, lt: constructionWindow7End },
        // DONE is the terminal status; no CANCELLED in this enum
        status: { notIn: ["DONE"] },
      },
      select: {
        id: true,
        plannedDate: true,
        contractId: true,
      },
    });

    for (const cons of upcomingConstructions) {
      const contract = await tx.contract.findUnique({
        where: { id: cons.contractId },
        select: { wholesalerId: true, ownerRelationshipId: true },
      });
      if (!contract) continue;

      const { wholesalerId, ownerRelationshipId } = contract;
      const wsAdmins = await resolveWholesalerAdmins(tx, wholesalerId);
      const dateStr = cons.plannedDate?.toLocaleDateString("ja-JP") ?? "";
      const wsCount = await fireReminder(
        tx,
        {
          type: "CONSTRUCTION_UPCOMING",
          recipientUserIds: wsAdmins,
          tenantId: wholesalerId,
          params: { constructionDate: dateStr },
          dedupKey: `CONSTRUCTION_UPCOMING:${cons.id}:ws:${today}`,
        },
        connectionString,
      );
      totalFired += wsCount;

      if (ownerRelationshipId) {
        const dlAdmins = await resolveDealerAdmins(tx, ownerRelationshipId);
        const rel = await tx.relationship.findUnique({
          where: { id: ownerRelationshipId },
          select: { dealerId: true },
        });
        if (rel) {
          const dlCount = await fireReminder(
            tx,
            {
              type: "CONSTRUCTION_UPCOMING",
              recipientUserIds: dlAdmins,
              tenantId: rel.dealerId,
              params: { constructionDate: dateStr },
              dedupKey: `CONSTRUCTION_UPCOMING:${cons.id}:${ownerRelationshipId}:${today}`,
            },
            connectionString,
          );
          totalFired += dlCount;
        }
      }
    }

    // -----------------------------------------------------------------------
    // d. APPLICATION_DEADLINE — Application.plannedDate in 14 days
    // -----------------------------------------------------------------------
    const appWindow14Start = new Date(now);
    appWindow14Start.setUTCHours(0, 0, 0, 0);
    appWindow14Start.setUTCDate(appWindow14Start.getUTCDate() + 14);
    const appWindow14End = new Date(appWindow14Start);
    appWindow14End.setUTCDate(appWindow14End.getUTCDate() + 1);

    const upcomingApplications = await tx.application.findMany({
      where: {
        plannedDate: { gte: appWindow14Start, lt: appWindow14End },
        status: { notIn: ["APPROVED", "CANCELLED", "REJECTED"] },
      },
      select: {
        id: true,
        plannedDate: true,
        contractId: true,
      },
    });

    for (const app of upcomingApplications) {
      const appContract = await tx.contract.findUnique({
        where: { id: app.contractId },
        select: { wholesalerId: true, ownerRelationshipId: true },
      });
      if (!appContract) continue;

      const { wholesalerId, ownerRelationshipId } = appContract;
      const wsAdmins = await resolveWholesalerAdmins(tx, wholesalerId);
      const deadlineStr = app.plannedDate?.toLocaleDateString("ja-JP") ?? "";
      const wsCount = await fireReminder(
        tx,
        {
          type: "APPLICATION_DEADLINE",
          recipientUserIds: wsAdmins,
          tenantId: wholesalerId,
          params: { deadline: deadlineStr },
          dedupKey: `APPLICATION_DEADLINE:${app.id}:ws:${today}`,
        },
        connectionString,
      );
      totalFired += wsCount;

      if (ownerRelationshipId) {
        const dlAdmins = await resolveDealerAdmins(tx, ownerRelationshipId);
        const rel = await tx.relationship.findUnique({
          where: { id: ownerRelationshipId },
          select: { dealerId: true },
        });
        if (rel) {
          const dlCount = await fireReminder(
            tx,
            {
              type: "APPLICATION_DEADLINE",
              recipientUserIds: dlAdmins,
              tenantId: rel.dealerId,
              params: { deadline: deadlineStr },
              dedupKey: `APPLICATION_DEADLINE:${app.id}:${ownerRelationshipId}:${today}`,
            },
            connectionString,
          );
          totalFired += dlCount;
        }
      }
    }

    // -----------------------------------------------------------------------
    // e. PRE_CALL_NOTIFICATION_PENDING — notifiedAt + 24h < now, status=PENDING
    // -----------------------------------------------------------------------
    const pendingPreCallNotifications = await tx.preCallNotification.findMany({
      where: {
        status: "PENDING",
        notifiedAt: { lte: minus24h },
      },
      select: {
        id: true,
        relationshipId: true,
        preCallId: true,
      },
    });

    for (const pcn of pendingPreCallNotifications) {
      // Resolve wholesalerId + customerName via preCall → appointment → customer.
      const preCall = await tx.preCall.findUnique({
        where: { id: pcn.preCallId },
        select: {
          appointment: {
            select: {
              customer: { select: { wholesalerId: true, name: true } },
            },
          },
        },
      });
      if (!preCall) continue;

      const customerName = preCall.appointment.customer.name;
      const wholesalerId = preCall.appointment.customer.wholesalerId;

      // Notify wholesaler admins about the pending notification.
      const wsAdmins = await resolveWholesalerAdmins(tx, wholesalerId);
      const wsCount = await fireReminder(
        tx,
        {
          type: "PRE_CALL_NOTIFICATION_PENDING",
          recipientUserIds: wsAdmins,
          tenantId: wholesalerId,
          params: { customerName },
          dedupKey: `PRE_CALL_NOTIFICATION_PENDING:${pcn.id}:ws:${today}`,
        },
        connectionString,
      );
      totalFired += wsCount;
    }

    // -----------------------------------------------------------------------
    // f. REPORT_PENDING — MonthlyReport status=DRAFT, targetMonth=current, day>=25
    // -----------------------------------------------------------------------
    if (dayOfMonthJst() >= 25) {
      const month = currentMonth();
      const draftReports = await tx.monthlyReport.findMany({
        where: {
          targetMonth: month,
          status: "DRAFT",
          scope: { in: ["DEALER", "JOINT"] },
          relationshipId: { not: null },
        },
        select: {
          id: true,
          wholesalerId: true,
          relationshipId: true,
        },
      });

      for (const report of draftReports) {
        // Notify dealer admins (the submitting party) that report is overdue.
        if (report.relationshipId) {
          const dlAdmins = await resolveDealerAdmins(tx, report.relationshipId);
          const rel = await tx.relationship.findUnique({
            where: { id: report.relationshipId },
            select: { dealerId: true },
          });
          if (rel) {
            const dlCount = await fireReminder(
              tx,
              {
                type: "REPORT_PENDING",
                recipientUserIds: dlAdmins,
                tenantId: rel.dealerId,
                params: { eventTitle: `${month}月次報告` },
                dedupKey: `REPORT_PENDING:${report.id}:${today}`,
              },
              connectionString,
            );
            totalFired += dlCount;
          }
        }
      }
    }
  });

  helpers.logger.info(
    `reminder.dispatch: ok totalFired=${totalFired} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
  );
};

export default reminderDispatchTask;

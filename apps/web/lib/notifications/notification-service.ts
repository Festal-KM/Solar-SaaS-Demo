// NotificationService — T-07-02 / F-052 / docs/05 §6.7.
//
// `fire()` resolves the audience, guards against duplicates within a 1-hour
// window (dedupKey), respects per-user NotificationPreference rows, creates
// Notification + NotificationDelivery records, and enqueues the email delivery
// job for EMAIL channel rows.
//
// Responsibilities in this file (Prisma-backed):
//   1. Resolve recipient User IDs from `AudienceQuery`.
//   2. For each recipient: dedup-check via dedupKey + createdAt window.
//   3. Skip channels disabled in NotificationPreference (absence = enabled).
//   4. INSERT Notification (+ dedupKey) + NotificationDelivery rows in the
//      caller-supplied transaction.
//   5. Enqueue `notification.send_email` jobs for EMAIL deliveries.

import type { TxClient } from "@solar/db";
import { enqueueEmail } from "@/lib/jobs/queue";
import {
  buildNotificationContent,
  defaultChannelsForType,
  type NotificationType,
  type DeliveryChannel,
} from "@solar/contracts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Audience resolution query.
 * At least one field must be non-empty at call time.
 */
export interface AudienceQuery {
  /** Resolve all users that hold one of these roles inside the tenant. */
  userIds?: string[];
  /** Resolved directly — no DB lookup needed. */
  relationshipIds?: string[];
  /** Filter users by wholesaler if combined with role/relationship. */
  wholesalerId?: string;
}

export interface FireInput {
  type: NotificationType;
  /** Pre-resolved list of recipient user IDs. */
  recipientUserIds: string[];
  /** Tenant ID to stamp on Notification.tenantId. */
  tenantId: string;
  /** Override title — if omitted, uses buildNotificationContent(). */
  title?: string;
  /** Override body — if omitted, uses buildNotificationContent(). */
  body?: string;
  /** Template params passed to buildNotificationContent when title/body are absent. */
  params?: Record<string, string>;
  payload?: unknown;
  /** Channels to use. Defaults to the type's defaultChannels (LINE excluded in Phase 1). */
  channels?: Exclude<DeliveryChannel, "LINE">[];
  /**
   * Duplicate-guard key. When set, a Notification with the same dedupKey
   * created within the last hour causes a skip (no-op).
   *
   * Default format when not provided: `${type}:${userId}:${targetId}` — but
   * callers that do not supply `targetId` will receive no automatic dedup key;
   * they must either pass one explicitly or accept potential duplicates.
   */
  dedupKey?: string;
}

export interface FireResult {
  /** IDs of newly created Notification rows (one per recipient). */
  notificationIds: string[];
  /** Number of recipients skipped due to dedupKey collision. */
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export class NotificationService {
  /**
   * Create Notification + Delivery records for each recipient, respecting
   * dedupKey (1-hour window) and NotificationPreference.
   *
   * Must be called inside an active withTenant transaction so that RLS is
   * correctly applied.
   */
  async fire(tx: TxClient, input: FireInput): Promise<FireResult> {
    const {
      type,
      recipientUserIds,
      tenantId,
      payload = {},
      channels,
      dedupKey,
    } = input;

    const { title, body } = resolveContent(input);
    const effectiveChannels: Exclude<DeliveryChannel, "LINE">[] =
      channels ?? defaultChannelsForType(type);

    const notificationIds: string[] = [];
    let skippedCount = 0;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const userId of recipientUserIds) {
      // Dedup guard — skip if an identical notification exists within 1 hour.
      if (dedupKey) {
        const existing = await tx.notification.findFirst({
          where: {
            dedupKey,
            recipientUserId: userId,
            createdAt: { gte: oneHourAgo },
          },
          select: { id: true },
        });
        if (existing) {
          skippedCount++;
          continue;
        }
      }

      // Resolve which channels are enabled for this user × type combination.
      const enabledChannels = await resolveEnabledChannels(tx, userId, type, effectiveChannels);
      if (enabledChannels.length === 0) {
        skippedCount++;
        continue;
      }

      // Create the Notification row.
      const notification = await tx.notification.create({
        data: {
          recipientUserId: userId,
          tenantId,
          type,
          title,
          body,
          payload: payload as object,
          ...(dedupKey ? { dedupKey } : {}),
        },
        select: { id: true },
      });

      notificationIds.push(notification.id);

      // Create a NotificationDelivery for each enabled channel and enqueue jobs.
      for (const channel of enabledChannels) {
        const delivery = await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel,
            status: "PENDING",
          },
          select: { id: true },
        });

        if (channel === "EMAIL") {
          // Enqueue the email job — actual send happens in apps/worker.
          // The worker loads NotificationDelivery + Notification from DB
          // and resolves the recipient/template at run time (T-07-05).
          await enqueueEmail(
            { kind: "delivery", deliveryId: delivery.id },
            {
              jobKey: `notification.send_email:${delivery.id}`,
              maxAttempts: 3,
            },
          );
        }
      }
    }

    return { notificationIds, skippedCount };
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function resolveContent(input: FireInput): { title: string; body: string } {
  if (input.title && input.body) {
    return { title: input.title, body: input.body };
  }
  const built = buildNotificationContent(input.type, input.params ?? {});
  return {
    title: input.title ?? built.title,
    body: input.body ?? built.body,
  };
}

/**
 * Return the subset of `requested` channels that are not explicitly disabled
 * in NotificationPreference for this user × type pair.
 * Absence of a preference row = enabled (system default).
 */
async function resolveEnabledChannels(
  tx: TxClient,
  userId: string,
  type: NotificationType,
  requested: Exclude<DeliveryChannel, "LINE">[],
): Promise<Exclude<DeliveryChannel, "LINE">[]> {
  const prefs = await tx.notificationPreference.findMany({
    where: {
      userId,
      type,
      channel: { in: requested },
    },
    select: { channel: true, enabled: true },
  });

  const disabledChannels = new Set(
    prefs.filter((p) => !p.enabled).map((p) => p.channel as Exclude<DeliveryChannel, "LINE">),
  );

  return requested.filter((ch) => !disabledChannels.has(ch));
}

// Singleton for use in Server Actions.
export const notificationService = new NotificationService();

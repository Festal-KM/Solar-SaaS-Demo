"use server";

// Pre-call notification Server Action — dealer side (T-04-10 / F-037 /
// docs/05 §4.7).
//
// `acknowledgePreCallNotificationAction(input)`:
//   1. Parse + validate via PreCallNotificationAcknowledgeSchema.
//   2. assertCan('pre_call_notification.acknowledge') — DEALER_ADMIN / DEALER_STAFF only.
//   3. withTenant tx:
//      a. Load the PreCallNotification — verify it belongs to one of the
//         caller's relationshipIds (tenant isolation).
//      b. If already ACKNOWLEDGED, return current state (idempotent).
//      c. Update status → ACKNOWLEDGED, acknowledgedAt → now().
//   4. Return { id, acknowledgedAt }.

import { revalidatePath } from "next/cache";

import {
  PreCallNotificationAcknowledgeSchema,
  type PreCallNotificationAcknowledgeInput,
} from "@solar/contracts";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface AcknowledgeNotificationResult {
  id: string;
  acknowledgedAt: string;
}

export const acknowledgePreCallNotificationAction = withServerActionContext<
  PreCallNotificationAcknowledgeInput,
  AcknowledgeNotificationResult
>(
  { action: "pre_call_notification.acknowledge" },
  async ({ tx, ctx, input }) => {
    const parsed = PreCallNotificationAcknowledgeSchema.parse(input);

    const notification = await tx.preCallNotification.findUnique({
      where: { id: parsed.notificationId },
      select: {
        id: true,
        relationshipId: true,
        status: true,
        acknowledgedAt: true,
      },
    });

    if (!notification) {
      throw new NotFoundError("通知が見つかりません");
    }

    // Tenant isolation — the notification must belong to one of the caller's
    // relationship IDs. RLS covers wholesalerId but relationshipId-level check
    // is enforced here to prevent cross-dealer access within the same wholesaler.
    if (!ctx.relationshipIds.includes(notification.relationshipId)) {
      throw new ForbiddenError("この通知にアクセスできません");
    }

    if (notification.status === "ACKNOWLEDGED" && notification.acknowledgedAt) {
      return {
        id: notification.id,
        acknowledgedAt: notification.acknowledgedAt.toISOString(),
      };
    }

    const acknowledgedAt = new Date();
    await tx.preCallNotification.update({
      where: { id: parsed.notificationId },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt,
      },
    });

    revalidatePath("/notifications/pre-call");

    return {
      id: notification.id,
      acknowledgedAt: acknowledgedAt.toISOString(),
    };
  },
);

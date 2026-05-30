"use server";

// Re-exports the shared acknowledgePreCallNotificationAction for the
// /d-notifications/pre-call page. Also adds revalidatePath for the new route.

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

    revalidatePath("/d-notifications/pre-call");
    revalidatePath("/notifications/pre-call");

    return {
      id: notification.id,
      acknowledgedAt: acknowledgedAt.toISOString(),
    };
  },
);

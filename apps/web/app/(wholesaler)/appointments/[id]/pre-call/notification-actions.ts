"use server";

// Pre-call notification Server Action — wholesaler side (T-04-10 / F-036 /
// docs/05 §4.7).
//
// `sendPreCallNotificationAction(input)`:
//   1. Parse + validate via PreCallNotificationSendSchema.
//   2. assertCan('pre_call_notification.send') — WS_ADMIN / WS_CALL_TEAM only.
//   3. withTenant tx:
//      a. Verify the PreCall exists and belongs to this wholesaler's tenant.
//      b. For each relationshipId, upsert a PreCallNotification row.
//         - If a row already exists (PENDING / SENT), skip (idempotent).
//         - If ACKNOWLEDGED, skip as well (already confirmed).
//         - Otherwise create with status=PENDING.
//   4. Return { created, skipped } counts.

import { revalidatePath } from "next/cache";

import {
  PreCallNotificationSendSchema,
  type PreCallNotificationSendInput,
} from "@solar/contracts";

import { NotFoundError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface SendNotificationResult {
  created: number;
  skipped: number;
}

export const sendPreCallNotificationAction = withServerActionContext<
  PreCallNotificationSendInput,
  SendNotificationResult
>(
  { action: "pre_call_notification.send" },
  async ({ tx, ctx, input }) => {
    const parsed = PreCallNotificationSendSchema.parse(input);

    // Verify the PreCall exists (RLS ensures it belongs to the caller's wholesaler).
    const preCall = await tx.preCall.findUnique({
      where: { id: parsed.preCallId },
      select: {
        id: true,
        appointment: {
          select: {
            id: true,
            customer: { select: { name: true } },
          },
        },
      },
    });
    if (!preCall) {
      throw new NotFoundError("マエカクが見つかりません");
    }

    // Fetch existing notifications for this preCall to implement idempotency.
    const existing = await tx.preCallNotification.findMany({
      where: {
        preCallId: parsed.preCallId,
        relationshipId: { in: parsed.relationshipIds },
      },
      select: { relationshipId: true, status: true },
    });

    const existingMap = new Map(existing.map((n) => [n.relationshipId, n.status]));

    let created = 0;
    let skipped = 0;

    for (const relationshipId of parsed.relationshipIds) {
      if (existingMap.has(relationshipId)) {
        skipped++;
        continue;
      }
      await tx.preCallNotification.create({
        data: {
          preCallId: parsed.preCallId,
          relationshipId,
          status: "PENDING",
        },
      });
      created++;
    }

    // Fire in-app / email notification to DEALER_ADMIN of each newly notified relationship.
    if (created > 0 && ctx.wholesalerId) {
      const customerName = preCall.appointment.customer?.name ?? "";
      for (const relationshipId of parsed.relationshipIds) {
        if (existingMap.has(relationshipId)) continue;
        const dealerAdmins = await resolveDealerAdmins(tx, relationshipId);
        if (dealerAdmins.length > 0) {
          await notificationService.fire(tx, {
            type: "PRE_CALL_RESULT_SHARED",
            recipientUserIds: dealerAdmins,
            tenantId: ctx.wholesalerId,
            params: { customerName },
            dedupKey: `PRE_CALL_RESULT_SHARED:${parsed.preCallId}:${relationshipId}`,
          });
        }
      }
    }

    revalidatePath(`/appointments/${preCall.appointment.id}/pre-call`);

    return { created, skipped };
  },
);

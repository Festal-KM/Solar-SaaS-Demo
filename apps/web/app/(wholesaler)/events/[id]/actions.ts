"use server";

// Server Actions for Event status update (イベントステータス変更).
//
// Permission: event_decision.decide (WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM).
// Tenant isolation: wholesalerId check after findUnique.

import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

import type { EventStatus } from "@solar/db";

const VALID_STATUSES: EventStatus[] = ["PLANNED", "ONGOING", "CLOSED", "CANCELLED"];

export interface UpdateEventStatusInput {
  eventId: string;
  status: EventStatus;
}

export const updateEventStatusAction = withServerActionContext<
  UpdateEventStatusInput,
  { eventId: string }
>(
  { action: "event_decision.decide" },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("卸業者コンテキストが必要です");
    }
    if (!VALID_STATUSES.includes(input.status)) {
      throw new ValidationError("無効なステータスです");
    }

    const event = await tx.event.findUnique({
      where: { id: input.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (!ctx.isSaasAdmin && event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    await tx.event.update({
      where: { id: input.eventId },
      data: { status: input.status },
    });

    revalidatePath(`/events/${input.eventId}`);
    return { eventId: input.eventId };
  },
);

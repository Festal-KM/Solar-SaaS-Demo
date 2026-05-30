"use server";

// Pre-call (マエカク) Server Action (T-04-09 / F-035 / docs/05 §4.7).
//
// `recordPreCallAction(input)`:
//   1. Parse + validate via PreCallRecordSchema (RESCHEDULED requires rescheduledAt).
//   2. assertCan('pre_call.record') — WHOLESALER_ADMIN / WHOLESALER_CALL_TEAM only.
//   3. withTenant tx — create PreCall record.
//   4. Auto-update Appointment.status based on result:
//      APPROVED    → PRE_CALL_DONE
//      CANCELLED   → CANCELLED
//      RESCHEDULED → RESCHEDULED + scheduledAt = rescheduledAt
//      ABSENT / CALLBACK → no status change
//
// Duplicate protection: each Appointment has at most one PreCall (@unique).
// If one already exists, ConflictError is thrown.

import { revalidatePath } from "next/cache";

import { PreCallRecordSchema } from "@solar/contracts";
import type { PreCallRecordInput } from "@solar/contracts";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface PreCallResult {
  id: string;
}

export const recordPreCallAction = withServerActionContext<PreCallRecordInput, PreCallResult>(
  { action: "pre_call.record" },
  async ({ tx, ctx, input }) => {
    const parsed = PreCallRecordSchema.parse(input);

    // Load appointment — must belong to the caller's wholesaler (RLS enforces this).
    const appointment = await tx.appointment.findUnique({
      where: { id: parsed.appointmentId },
      select: {
        id: true,
        status: true,
        acquiredByUserId: true,
        customer: { select: { name: true } },
        preCall: { select: { id: true } },
      },
    });
    if (!appointment) {
      throw new NotFoundError("アポが見つかりません");
    }
    if (appointment.preCall) {
      throw new ConflictError("このアポにはすでにマエカクが記録されています");
    }

    // Validate rescheduledAt for RESCHEDULED (belt-and-suspenders in addition to Zod refine).
    if (parsed.result === "RESCHEDULED" && !parsed.rescheduledAt) {
      throw new ValidationError("日程変更の場合は新しい訪問予定日時を入力してください", {
        field: "rescheduledAt",
      });
    }

    // Determine new Appointment.status.
    const appointmentStatusMap: Record<
      string,
      "PRE_CALL_DONE" | "CANCELLED" | "RESCHEDULED" | null
    > = {
      APPROVED: "PRE_CALL_DONE",
      ABSENT: null,
      CALLBACK: null,
      CANCELLED: "CANCELLED",
      RESCHEDULED: "RESCHEDULED",
    };
    const newStatus = appointmentStatusMap[parsed.result] ?? null;

    const created = await tx.preCall.create({
      data: {
        appointmentId: parsed.appointmentId,
        calledAt: new Date(),
        result: parsed.result,
        note: parsed.notes ?? null,
        calledByUserId: ctx.actorUserId,
        rescheduleRequested: parsed.result === "RESCHEDULED",
        cancelRequested: parsed.result === "CANCELLED",
      },
      select: { id: true },
    });

    if (newStatus !== null) {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (parsed.result === "RESCHEDULED" && parsed.rescheduledAt) {
        updateData.scheduledAt = new Date(parsed.rescheduledAt);
      }
      await tx.appointment.update({
        where: { id: parsed.appointmentId },
        data: updateData,
      });
    }

    // Notify the アポ担当者 (person who acquired the appointment) of the result.
    const customerName = appointment.customer?.name ?? "";
    if (appointment.acquiredByUserId && ctx.wholesalerId) {
      await notificationService.fire(tx, {
        type: "PRE_CALL_RESULT_SHARED",
        recipientUserIds: [appointment.acquiredByUserId],
        tenantId: ctx.wholesalerId,
        params: { customerName },
        dedupKey: `PRE_CALL_RESULT_SHARED:${created.id}:${appointment.acquiredByUserId}`,
      });
    }

    revalidatePath(`/appointments/${parsed.appointmentId}`);
    revalidatePath(`/appointments/${parsed.appointmentId}/pre-call`);
    revalidatePath("/appointments");

    return { id: created.id };
  },
);

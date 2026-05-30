"use server";

// Server Actions for EventShift CRUD (T-03-10 / F-025 / docs/05 §4.6 §6.3).
//
// `assignShiftAction`   — create new EventShift; 409 on overlap, 400 on Zod failure
// `updateShiftAction`   — update role / planned times; 409 on overlap
// `unassignShiftAction` — delete EventShift row
//
// Overlap rule (docs/02 §F-025): a user must not have two overlapping shifts
// on any event within the same wholesaler. The app layer checks
// `startPlanned < existing.endPlanned AND endPlanned > existing.startPlanned`
// and throws ConflictError (409). The DB `@@unique([userId, startPlanned])`
// is the last-resort guard only.
//
// Security:
//   - `event.manage_shift`: WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM only.
//   - Cross-tenant: Event.wholesalerId must match ctx.wholesalerId.

import { revalidatePath } from "next/cache";

import {
  ShiftAssignSchema,
  ShiftUpdateSchema,
  ShiftUnassignSchema,
  type ShiftAssignInput,
  type ShiftUpdateInput,
  type ShiftUnassignInput,
} from "@solar/contracts";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface ShiftResult {
  shiftId: string;
  eventId: string;
}

export const assignShiftAction = withServerActionContext<ShiftAssignInput, ShiftResult>(
  {
    action: "event.manage_shift",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for shift assignment");
    }

    const parsed = ShiftAssignSchema.parse(input);

    // Verify Event exists and belongs to this wholesaler.
    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    const startPlanned = new Date(parsed.startPlanned);
    const endPlanned = new Date(parsed.endPlanned);

    // Overlap check: any existing shift for this user where the time windows intersect.
    const overlap = await tx.eventShift.findFirst({
      where: {
        userId: parsed.userId,
        startPlanned: { lt: endPlanned },
        endPlanned: { gt: startPlanned },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictError("この時間帯に既にシフトが割り当てられています");
    }

    const shift = await tx.eventShift.create({
      data: {
        eventId: parsed.eventId,
        userId: parsed.userId,
        role: parsed.role,
        startPlanned,
        endPlanned,
      },
      select: { id: true, eventId: true },
    });

    // Notify the assigned user of their new shift (SHIFT_ASSIGNED).
    const eventForNotif = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: {
        eventCandidate: { select: { storeName: true, scheduledDate: true } },
      },
    });
    const eventTitle = eventForNotif?.eventCandidate?.storeName ?? parsed.eventId;
    const eventDate = eventForNotif?.eventCandidate?.scheduledDate
      ? eventForNotif.eventCandidate.scheduledDate.toISOString().split("T")[0]!
      : "";
    await notificationService.fire(tx, {
      type: "SHIFT_ASSIGNED",
      recipientUserIds: [parsed.userId],
      tenantId: ctx.wholesalerId!,
      params: { eventTitle, eventDate },
      dedupKey: `SHIFT_ASSIGNED:${shift.id}`,
    });

    revalidatePath(`/events/${parsed.eventId}/shifts`);
    return { shiftId: shift.id, eventId: shift.eventId };
  },
);

export const updateShiftAction = withServerActionContext<ShiftUpdateInput, ShiftResult>(
  {
    action: "event.manage_shift",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for shift update");
    }

    const parsed = ShiftUpdateSchema.parse(input);

    // Fetch existing shift and its event (for tenant check).
    const existing = await tx.eventShift.findUnique({
      where: { id: parsed.shiftId },
      select: {
        id: true,
        eventId: true,
        userId: true,
        startPlanned: true,
        endPlanned: true,
        event: { select: { wholesalerId: true } },
      },
    });
    if (!existing) {
      throw new NotFoundError("シフトが見つかりません");
    }
    if (existing.event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("シフトが見つかりません");
    }

    // Resolve the effective planned times for overlap check.
    const newStart = parsed.startPlanned ? new Date(parsed.startPlanned) : existing.startPlanned;
    const newEnd = parsed.endPlanned ? new Date(parsed.endPlanned) : existing.endPlanned;

    if (newStart >= newEnd) {
      throw new ValidationError("終了時刻は開始時刻より後にしてください");
    }

    // Overlap check — exclude the shift being updated itself.
    const overlap = await tx.eventShift.findFirst({
      where: {
        userId: existing.userId,
        id: { not: parsed.shiftId },
        startPlanned: { lt: newEnd },
        endPlanned: { gt: newStart },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictError("この時間帯に既にシフトが割り当てられています");
    }

    const updated = await tx.eventShift.update({
      where: { id: parsed.shiftId },
      data: {
        ...(parsed.role !== undefined && { role: parsed.role }),
        startPlanned: newStart,
        endPlanned: newEnd,
      },
      select: { id: true, eventId: true },
    });

    revalidatePath(`/events/${existing.eventId}/shifts`);
    return { shiftId: updated.id, eventId: updated.eventId };
  },
);

export const unassignShiftAction = withServerActionContext<ShiftUnassignInput, ShiftResult>(
  {
    action: "event.manage_shift",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for shift unassign");
    }

    const parsed = ShiftUnassignSchema.parse(input);

    const existing = await tx.eventShift.findUnique({
      where: { id: parsed.shiftId },
      select: {
        id: true,
        eventId: true,
        event: { select: { wholesalerId: true } },
      },
    });
    if (!existing) {
      throw new NotFoundError("シフトが見つかりません");
    }
    if (existing.event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("シフトが見つかりません");
    }

    await tx.eventShift.delete({ where: { id: parsed.shiftId } });

    revalidatePath(`/events/${existing.eventId}/shifts`);
    return { shiftId: parsed.shiftId, eventId: existing.eventId };
  },
);

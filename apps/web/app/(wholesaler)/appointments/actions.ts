"use server";

// Appointment Server Actions for wholesaler role group (T-04-08 / F-033 /
// docs/05 §4.7).
//
// Three actions:
//   createAppointmentAction  — register a new appointment.
//   updateAppointmentAction  — edit fields + status transition (validated).
//   cancelAppointmentAction  — set status to CANCELLED with mandatory reason.
//
// Security:
//   - wholesalerId is taken from ctx, never from input.
//   - acquiredRelationshipId is taken from ctx for dealers; wholesaler callers
//     may leave it null (self-hosted).
//   - Status transitions are validated via isValidStatusTransition before any
//     DB write. InvalidStateTransitionError is thrown on illegal moves.

import { revalidatePath } from "next/cache";

import {
  AppointmentCreateSchema,
  AppointmentUpdateSchema,
  AppointmentCancelSchema,
  isValidStatusTransition,
} from "@solar/contracts";
import type {
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentCancelInput,
} from "@solar/contracts";

import { NotFoundError, InvalidStateTransitionError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/appointments";

export interface AppointmentResult {
  id: string;
}

export const createAppointmentAction = withServerActionContext<
  AppointmentCreateInput,
  AppointmentResult
>(
  { action: "appointment.create" },
  async ({ tx, ctx, input }) => {
    const parsed = AppointmentCreateSchema.parse(input);

    const acquiredOrgType = ctx.dealerId ? "DEALER" : "WHOLESALER";
    const acquiredRelationshipId =
      parsed.acquiredRelationshipId ?? ctx.relationshipIds[0] ?? null;

    const created = await tx.appointment.create({
      data: {
        customerId: parsed.customerId,
        eventId: parsed.eventId ?? null,
        scheduledAt: new Date(parsed.scheduledAt),
        location: parsed.location ?? null,
        acquiredByUserId: ctx.actorUserId,
        acquiredOrgType,
        acquiredRelationshipId,
        appointmentType: parsed.appointmentType ?? null,
        status: parsed.status ?? "UNCONFIRMED",
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export const updateAppointmentAction = withServerActionContext<
  AppointmentUpdateInput,
  AppointmentResult
>(
  { action: "appointment.update" },
  async ({ tx, input }) => {
    const parsed = AppointmentUpdateSchema.parse(input);

    const existing = await tx.appointment.findUnique({
      where: { id: parsed.id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundError("アポが見つかりません");
    }

    // Validate status transition when status is changing.
    if (parsed.status !== undefined && parsed.status !== existing.status) {
      if (!isValidStatusTransition(existing.status, parsed.status)) {
        throw new InvalidStateTransitionError(
          `${existing.status} から ${parsed.status} への遷移はできません`,
          { from: existing.status, to: parsed.status },
        );
      }
    }

    const updated = await tx.appointment.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.scheduledAt !== undefined
          ? { scheduledAt: new Date(parsed.scheduledAt) }
          : {}),
        ...(parsed.location !== undefined ? { location: parsed.location } : {}),
        ...(parsed.appointmentType !== undefined
          ? { appointmentType: parsed.appointmentType }
          : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.id}`);
    return { id: updated.id };
  },
);

export const cancelAppointmentAction = withServerActionContext<
  AppointmentCancelInput,
  AppointmentResult
>(
  { action: "appointment.cancel" },
  async ({ tx, input }) => {
    const parsed = AppointmentCancelSchema.parse(input);

    const existing = await tx.appointment.findUnique({
      where: { id: parsed.id },
      select: { id: true, status: true, note: true },
    });
    if (!existing) {
      throw new NotFoundError("アポが見つかりません");
    }

    if (!isValidStatusTransition(existing.status, "CANCELLED")) {
      throw new InvalidStateTransitionError(
        `${existing.status} からキャンセルへの遷移はできません`,
        { from: existing.status, to: "CANCELLED" },
      );
    }

    const mergedNote = [parsed.reason, existing.note].filter(Boolean).join("\n---\n") || null;

    const updated = await tx.appointment.update({
      where: { id: parsed.id },
      data: {
        status: "CANCELLED",
        note: mergedNote,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.id}`);
    return { id: updated.id };
  },
);

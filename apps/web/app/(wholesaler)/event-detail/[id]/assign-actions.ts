"use server";

import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface SaveAssignInput {
  eventCandidateId: string;
  mode: "SELF" | "DEALER" | "JOINT";
  staffUserIds: string[];
  dealerRelationshipIds: string[];
  memo: string;
}

export interface SaveAssignResult {
  eventId: string;
}

export const saveAssignAction = withServerActionContext<SaveAssignInput, SaveAssignResult>(
  {
    action: "event_decision.decide",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required");
    }

    const candidate = await tx.eventCandidate.findUnique({
      where: { id: input.eventCandidateId },
      select: { id: true, wholesalerId: true, status: true, event: { select: { id: true } } },
    });
    if (!candidate || candidate.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベント候補が見つかりません");
    }

    let eventId: string;

    if (candidate.event) {
      // Event exists — update mode, sync shifts + dealers
      eventId = candidate.event.id;

      await tx.event.update({
        where: { id: eventId },
        data: { mode: input.mode, note: input.memo || null },
      });

      // Sync shifts: delete existing, re-create from staffUserIds
      if (input.mode === "SELF" || input.mode === "JOINT") {
        await tx.eventShift.deleteMany({ where: { eventId } });
        const candidate = await tx.eventCandidate.findUnique({
          where: { id: input.eventCandidateId },
          select: { scheduledDate: true },
        });
        const base = candidate?.scheduledDate ?? new Date();
        const endDate = new Date(base.getTime() + 8 * 60 * 60 * 1000);
        for (const userId of input.staffUserIds) {
          await tx.eventShift.create({
            data: {
              eventId,
              userId,
              role: "LEAD",
              startPlanned: base,
              endPlanned: endDate,
              status: "ASSIGNED",
            },
          });
        }
      } else {
        await tx.eventShift.deleteMany({ where: { eventId } });
      }

      // Sync dealers: delete existing, re-create from dealerRelationshipIds
      if (input.mode === "DEALER" || input.mode === "JOINT") {
        await tx.eventDealer.deleteMany({ where: { eventId } });
        for (const relationshipId of input.dealerRelationshipIds) {
          await tx.eventDealer.create({
            data: {
              eventId,
              relationshipId,
              assignedBy: ctx.actorUserId,
            },
          });
        }
      } else {
        await tx.eventDealer.deleteMany({ where: { eventId } });
      }
    } else {
      // No Event yet — create one + set candidate to DECIDED
      const event = await tx.event.create({
        data: {
          wholesalerId: ctx.wholesalerId,
          eventCandidateId: input.eventCandidateId,
          mode: input.mode,
          decidedBy: ctx.actorUserId,
          note: input.memo || null,
        },
        select: { id: true },
      });
      eventId = event.id;

      await tx.eventCandidate.update({
        where: { id: input.eventCandidateId },
        data: { status: "DECIDED" },
      });

      // Create shifts
      if (input.mode === "SELF" || input.mode === "JOINT") {
        const candidate = await tx.eventCandidate.findUnique({
          where: { id: input.eventCandidateId },
          select: { scheduledDate: true },
        });
        const base = candidate?.scheduledDate ?? new Date();
        const endDate = new Date(base.getTime() + 8 * 60 * 60 * 1000);
        for (const userId of input.staffUserIds) {
          await tx.eventShift.create({
            data: {
              eventId,
              userId,
              role: "LEAD",
              startPlanned: base,
              endPlanned: endDate,
              status: "ASSIGNED",
            },
          });
        }
      }

      // Create dealers
      if (input.mode === "DEALER" || input.mode === "JOINT") {
        for (const relationshipId of input.dealerRelationshipIds) {
          await tx.eventDealer.create({
            data: {
              eventId,
              relationshipId,
              assignedBy: ctx.actorUserId,
            },
          });
        }
      }
    }

    revalidatePath(`/event-detail/${input.eventCandidateId}`);
    return { eventId };
  },
);

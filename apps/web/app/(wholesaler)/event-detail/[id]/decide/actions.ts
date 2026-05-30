"use server";

// Server Action for the event-decision workflow (T-03-08 / F-023 /
// docs/05 §4.5 / docs/04 §S-027).
//
// `decideEventModeAction` implements the core state transition:
//
//   EventCandidate.status  OPEN or CLOSED  →  DECIDED   (mode ≠ CANCELLED)
//   EventCandidate.status  OPEN or CLOSED  →  CANCELLED (mode = CANCELLED)
//
// Invalid source states (DRAFT, DECIDED, CANCELLED) throw
// `InvalidStateTransitionError` (HTTP 422).
//
// On success (non-CANCELLED):
//   - Event row is created  (eventCandidateId, mode, requiredPeople, decidedBy)
//   - EventDealer rows are created for each dealerRelationshipId   (DEALER / JOINT)
//   - EventChange row is created  (type=DECIDED, before={}, after={mode,...})
//   - EventCandidate.status is set to DECIDED
//   - Redirects to /events/<event.id>/shifts  (S-028)
//
// On CANCELLED:
//   - EventCandidate.status is set to CANCELLED
//   - No Event row is created
//   - Redirects to /event-detail

import { redirect } from "next/navigation";

import {
  EventDecisionSchema,
  EventModeChangeSchema,
  type EventDecisionInput,
  type EventModeChangeInput,
} from "@solar/contracts";

import { InvalidStateTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";

// Allowed source statuses for the decide transition.
// The candidate must be either OPEN or CLOSED to be decided.
// DRAFT is not allowed (must be published first), DECIDED/CANCELLED are terminal.
const ALLOWED_SOURCE_STATUSES = ["OPEN", "CLOSED"] as const;
type AllowedSource = (typeof ALLOWED_SOURCE_STATUSES)[number];

function assertDecidableStatus(status: string): asserts status is AllowedSource {
  if (!ALLOWED_SOURCE_STATUSES.includes(status as AllowedSource)) {
    throw new InvalidStateTransitionError(
      `「${status}」状態のイベント候補は開催体制を決定できません。OPEN または CLOSED の状態にしてください`,
      { from: status, allowed: [...ALLOWED_SOURCE_STATUSES] },
    );
  }
}

export interface DecideEventModeResult {
  eventId: string | null;
  eventCandidateId: string;
  mode: string;
}

export const decideEventModeAction = withServerActionContext<
  EventDecisionInput,
  DecideEventModeResult
>(
  {
    action: "event_decision.decide",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for event decision");
    }

    const parsed = EventDecisionSchema.parse(input);

    const candidate = await tx.eventCandidate.findUnique({
      where: { id: parsed.eventCandidateId },
      select: { id: true, wholesalerId: true, status: true },
    });
    if (!candidate) {
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // Cross-tenant defence: RLS filters but explicit check gives clean error.
    if (candidate.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベント候補が見つかりません");
    }

    assertDecidableStatus(candidate.status);

    // CANCELLED path — no Event created, just update EventCandidate.
    if (parsed.mode === "CANCELLED") {
      await tx.eventCandidate.update({
        where: { id: parsed.eventCandidateId },
        data: { status: "CANCELLED" },
      });
      return {
        eventId: null,
        eventCandidateId: parsed.eventCandidateId,
        mode: "CANCELLED",
      };
    }

    // Deduplicate dealerRelationshipIds once; used for validation, insert, and audit.
    const uniqueRelIds =
      (parsed.mode === "DEALER" || parsed.mode === "JOINT") &&
      parsed.dealerRelationshipIds &&
      parsed.dealerRelationshipIds.length > 0
        ? Array.from(new Set(parsed.dealerRelationshipIds))
        : [];

    // Validate dealerRelationshipIds belong to this wholesaler before writing.
    if (uniqueRelIds.length > 0) {
      const rels = await tx.relationship.findMany({
        where: { id: { in: uniqueRelIds } },
        select: { id: true, wholesalerId: true },
      });
      const foundIds = new Set(rels.map((r) => r.id));
      const missing = uniqueRelIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new ValidationError("指定された二次店関係が見つかりません", {
          offending: missing,
        });
      }
      const foreign = rels.filter((r) => r.wholesalerId !== ctx.wholesalerId);
      if (foreign.length > 0) {
        throw new ValidationError("他テナントの二次店関係は指定できません", {
          offending: foreign.map((r) => r.id),
        });
      }
    }

    // requiredPeople is only meaningful for SELF / JOINT modes.
    const requiredPeople =
      parsed.mode === "SELF" || parsed.mode === "JOINT"
        ? (parsed.requiredPeople ?? null)
        : null;

    // Create Event row.
    const event = await tx.event.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        eventCandidateId: parsed.eventCandidateId,
        mode: parsed.mode,
        requiredPeople,
        decidedBy: ctx.actorUserId,
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    // Create EventDealer rows only for DEALER / JOINT modes.
    for (const relationshipId of uniqueRelIds) {
      await tx.eventDealer.create({
        data: {
          eventId: event.id,
          relationshipId,
          assignedBy: ctx.actorUserId,
        },
      });
    }

    // Create EventChange audit record — values mirror what is persisted in Event / EventDealer.
    await tx.eventChange.create({
      data: {
        eventId: event.id,
        before: {},
        after: {
          type: "DECIDED",
          mode: parsed.mode,
          requiredPeople,
          dealerRelationshipIds: uniqueRelIds,
          reason: parsed.reason ?? null,
          note: parsed.note ?? null,
        },
        changedBy: ctx.actorUserId,
      },
    });

    // Update EventCandidate status to DECIDED.
    const updatedCandidate = await tx.eventCandidate.update({
      where: { id: parsed.eventCandidateId },
      data: { status: "DECIDED" },
      select: { storeName: true, scheduledDate: true },
    });

    // Notify dealer admins of each assigned dealer relationship.
    if (uniqueRelIds.length > 0) {
      const eventTitle = updatedCandidate.storeName ?? parsed.eventCandidateId;
      const eventDate = updatedCandidate.scheduledDate
        ? updatedCandidate.scheduledDate.toISOString().split("T")[0]!
        : "";
      for (const relationshipId of uniqueRelIds) {
        const dealerAdmins = await resolveDealerAdmins(tx, relationshipId);
        if (dealerAdmins.length > 0) {
          await notificationService.fire(tx, {
            type: "EVENT_ASSIGNED",
            recipientUserIds: dealerAdmins,
            tenantId: ctx.wholesalerId!,
            params: { eventTitle, eventDate },
            dedupKey: `EVENT_ASSIGNED:${event.id}:${relationshipId}`,
          });
        }
      }
    }

    return {
      eventId: event.id,
      eventCandidateId: parsed.eventCandidateId,
      mode: parsed.mode,
    };
  },
);

// Wrapper that calls the action and redirects based on the result.
// Used by the page's form submission handler via `formAction`.
export async function decideAndRedirectAction(input: EventDecisionInput): Promise<void> {
  const result = await decideEventModeAction(input);
  if (result.mode === "CANCELLED") {
    redirect("/events");
  } else {
    redirect(`/events/${result.eventId}/shifts`);
  }
}

export interface ChangeModeResult {
  eventId: string;
  mode: string;
}

// Changes the mode of an already-decided Event and records a before/after diff
// in EventChange. The Event must exist and belong to the current wholesaler.
// docs/05 §4.5 — `eventDecision.changeMode`.
export const changeModeAction = withServerActionContext<
  EventModeChangeInput,
  ChangeModeResult
>(
  {
    action: "event_decision.decide",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for mode change");
    }

    const parsed = EventModeChangeSchema.parse(input);

    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: {
        id: true,
        wholesalerId: true,
        mode: true,
        requiredPeople: true,
        dealers: { select: { relationshipId: true } },
      },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Deduplicate dealerRelationshipIds once; used for validation, insert, and audit.
    const uniqueRelIds =
      (parsed.mode === "DEALER" || parsed.mode === "JOINT") &&
      parsed.dealerRelationshipIds &&
      parsed.dealerRelationshipIds.length > 0
        ? Array.from(new Set(parsed.dealerRelationshipIds))
        : [];

    // Validate new dealerRelationshipIds belong to this wholesaler.
    if (uniqueRelIds.length > 0) {
      const rels = await tx.relationship.findMany({
        where: { id: { in: uniqueRelIds } },
        select: { id: true, wholesalerId: true },
      });
      const foundIds = new Set(rels.map((r) => r.id));
      const missing = uniqueRelIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new ValidationError("指定された二次店関係が見つかりません", {
          offending: missing,
        });
      }
      const foreign = rels.filter((r) => r.wholesalerId !== ctx.wholesalerId);
      if (foreign.length > 0) {
        throw new ValidationError("他テナントの二次店関係は指定できません", {
          offending: foreign.map((r) => r.id),
        });
      }
    }

    // Snapshot before state for diff.
    const before = {
      mode: event.mode,
      requiredPeople: event.requiredPeople,
      dealerRelationshipIds: event.dealers.map((d) => d.relationshipId),
    };

    // requiredPeople only applies to SELF / JOINT.
    const newRequiredPeople =
      parsed.mode === "SELF" || parsed.mode === "JOINT"
        ? (parsed.requiredPeople ?? null)
        : null;

    // Update Event mode and requiredPeople.
    await tx.event.update({
      where: { id: parsed.eventId },
      data: {
        mode: parsed.mode,
        requiredPeople: newRequiredPeople,
        note: parsed.note ?? undefined,
      },
    });

    // Replace EventDealer rows: delete existing, insert new set.
    await tx.eventDealer.deleteMany({ where: { eventId: parsed.eventId } });
    for (const relationshipId of uniqueRelIds) {
      await tx.eventDealer.create({
        data: {
          eventId: parsed.eventId,
          relationshipId,
          assignedBy: ctx.actorUserId,
        },
      });
    }

    // Record before/after diff in EventChange.
    await tx.eventChange.create({
      data: {
        eventId: parsed.eventId,
        before,
        after: {
          type: "MODE_CHANGED",
          mode: parsed.mode,
          requiredPeople: newRequiredPeople,
          dealerRelationshipIds: uniqueRelIds,
          note: parsed.note ?? null,
        },
        changedBy: ctx.actorUserId,
      },
    });

    return { eventId: parsed.eventId, mode: parsed.mode };
  },
);

"use server";

// Server Actions for the venue-negotiation workflow (T-03-02 / F-017 /
// docs/05 §4.5).
//
// Four actions, all wired through the canonical `withServerActionContext`
// three-step idiom (auth → assertCan → withTenant). The wholesalerId is
// injected from the tenant context — callers MUST NOT pass it as input.
//
// State machine (enforced here, not in Zod — the schema only validates the
// payload shape):
//
//   CONTACTING       → CONDITION_REVIEW / INFEASIBLE / CANCELLED
//   CONDITION_REVIEW → FEASIBLE / INFEASIBLE / CANCELLED
//   FEASIBLE         → FIXED / INFEASIBLE / CANCELLED
//   FIXED            → CANCELLED only
//   INFEASIBLE       → (terminal — no outgoing transitions)
//   CANCELLED        → (terminal)
//   NOT_CONTACTED    → treated as CONTACTING (legacy default; outgoing edges
//                       match the CONTACTING row)
//
// Invalid transitions throw `InvalidStateTransitionError` (HTTP 422,
// `code:"INVALID_STATE_TRANSITION"`). `promoteToCandidate` is treated as a
// data-creation step (not a status transition) and is only allowed when the
// negotiation is in `FIXED`.

import {
  VenueNegotiationInputSchema,
  VenueNegotiationPromoteSchema,
  VenueNegotiationStatusChangeSchema,
  VenueNegotiationUpdateSchema,
  type VenueNegotiationInput,
  type VenueNegotiationPromote,
  type VenueNegotiationStatus,
  type VenueNegotiationStatusChange,
  type VenueNegotiationUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { InvalidStateTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/venue-negotiations";

// Allowed-transition adjacency table — see header comment for rationale.
const ALLOWED_TRANSITIONS: Record<VenueNegotiationStatus, VenueNegotiationStatus[]> = {
  NOT_CONTACTED: ["CONTACTING", "CONDITION_REVIEW", "INFEASIBLE", "CANCELLED"],
  CONTACTING: ["CONDITION_REVIEW", "INFEASIBLE", "CANCELLED"],
  CONDITION_REVIEW: ["FEASIBLE", "INFEASIBLE", "CANCELLED"],
  FEASIBLE: ["FIXED", "INFEASIBLE", "CANCELLED"],
  FIXED: ["CANCELLED"],
  INFEASIBLE: [],
  CANCELLED: [],
};

function assertTransitionAllowed(from: VenueNegotiationStatus, to: VenueNegotiationStatus): void {
  if (from === to) {
    throw new InvalidStateTransitionError("既に同じ状態です", { from, to });
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(`「${from}」から「${to}」への変更はできません`, {
      from,
      to,
      allowed,
    });
  }
}

function candidateDatesForDb(dates: Date[]): string[] {
  // Persisted as Json — keep them as yyyy-mm-dd strings so list views can
  // deserialize without timezone surprises.
  return dates.map((d) => d.toISOString().slice(0, 10));
}

export interface CreateVenueNegotiationResult {
  id: string;
}

export const createVenueNegotiationAction = withServerActionContext<
  VenueNegotiationInput,
  CreateVenueNegotiationResult
>(
  {
    action: "venue_negotiation.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for venue negotiation");
    }
    const parsed = VenueNegotiationInputSchema.parse(input);

    // Defence in depth — RLS + assertCan already restrict tenants, but we also
    // verify the chosen venue provider is owned by the caller's wholesaler.
    const provider = await tx.venueProvider.findUnique({
      where: { id: parsed.venueProviderId },
      select: { id: true },
    });
    if (!provider) {
      throw new NotFoundError("場所提供元が見つかりません");
    }

    const created = await tx.venueNegotiation.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        venueProviderId: parsed.venueProviderId,
        candidateDates: candidateDatesForDb(parsed.candidateDates),
        contractType: parsed.contractType,
        fixedFee: parsed.fixedFee,
        performanceRate: parsed.performanceRate,
        conditionNote: parsed.conditionNote,
        nextAction: parsed.nextAction,
        assigneeId: parsed.assigneeId,
        note: parsed.note,
        // status defaults to NOT_CONTACTED in Prisma; the UI immediately moves
        // it to CONTACTING via changeStatus when the operator clicks 着手.
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateVenueNegotiationInput {
  id: string;
  patch: VenueNegotiationUpdate;
}

export interface UpdateVenueNegotiationResult {
  id: string;
}

export const updateVenueNegotiationAction = withServerActionContext<
  UpdateVenueNegotiationInput,
  UpdateVenueNegotiationResult
>(
  {
    action: "venue_negotiation.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = VenueNegotiationUpdateSchema.parse(input.patch);

    const existing = await tx.venueNegotiation.findUnique({
      where: { id: input.id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundError("場所提供元対応が見つかりません");
    }

    const updated = await tx.venueNegotiation.update({
      where: { id: input.id },
      data: {
        ...("venueProviderId" in parsed && parsed.venueProviderId !== undefined
          ? { venueProviderId: parsed.venueProviderId }
          : {}),
        ...(parsed.candidateDates !== undefined
          ? { candidateDates: candidateDatesForDb(parsed.candidateDates) }
          : {}),
        ...("contractType" in parsed ? { contractType: parsed.contractType } : {}),
        ...("fixedFee" in parsed ? { fixedFee: parsed.fixedFee } : {}),
        ...("performanceRate" in parsed ? { performanceRate: parsed.performanceRate } : {}),
        ...("conditionNote" in parsed ? { conditionNote: parsed.conditionNote } : {}),
        ...("nextAction" in parsed ? { nextAction: parsed.nextAction } : {}),
        ...("assigneeId" in parsed ? { assigneeId: parsed.assigneeId } : {}),
        ...("note" in parsed ? { note: parsed.note } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);

export interface ChangeStatusInput {
  id: string;
  status: VenueNegotiationStatusChange["status"];
  reason?: string;
}

export interface ChangeStatusResult {
  id: string;
  status: VenueNegotiationStatus;
}

export const changeStatusAction = withServerActionContext<ChangeStatusInput, ChangeStatusResult>(
  {
    action: "venue_negotiation.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = VenueNegotiationStatusChangeSchema.parse({
      status: input.status,
      reason: input.reason,
    });

    const existing = await tx.venueNegotiation.findUnique({
      where: { id: input.id },
      select: { id: true, status: true, note: true },
    });
    if (!existing) {
      throw new NotFoundError("場所提供元対応が見つかりません");
    }

    assertTransitionAllowed(existing.status, parsed.status);

    // Append the transition reason to the free-form `note` field so the
    // detail screen can render a lightweight timeline. We keep this inline
    // on `note` until SP-04 carves out a dedicated audit table.
    const decidedDateUpdate = parsed.status === "FIXED" ? { decidedDate: new Date() } : {};

    const updated = await tx.venueNegotiation.update({
      where: { id: input.id },
      data: {
        status: parsed.status,
        ...decidedDateUpdate,
        ...(parsed.reason !== undefined
          ? { note: appendStatusNote(existing, parsed.status, parsed.reason) }
          : {}),
      },
      select: { id: true, status: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id, status: updated.status };
  },
);

function appendStatusNote(
  existing: { note: string | null },
  status: VenueNegotiationStatus,
  reason: string,
): string {
  // Plain-text append — keeps the audit visible in the detail screen until
  // the dedicated change-history table lands.
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${status}: ${reason}`;
  return existing.note && existing.note.length > 0 ? `${existing.note}\n${line}` : line;
}

export interface PromoteToCandidateInput {
  id: string;
  candidate: VenueNegotiationPromote;
}

export interface PromoteToCandidateResult {
  eventCandidateId: string;
}

export const promoteToCandidateAction = withServerActionContext<
  PromoteToCandidateInput,
  PromoteToCandidateResult
>(
  {
    action: "venue_negotiation.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for promotion");
    }
    const parsed = VenueNegotiationPromoteSchema.parse(input.candidate);

    const existing = await tx.venueNegotiation.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        status: true,
        venueProviderId: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
      },
    });
    if (!existing) {
      throw new NotFoundError("場所提供元対応が見つかりません");
    }

    // Only FIXED negotiations may be promoted — any other state surfaces as
    // 422 INVALID_STATE_TRANSITION so the UI shows a domain message instead
    // of a generic 400.
    if (existing.status !== "FIXED") {
      throw new InvalidStateTransitionError(
        "場所提供元対応が「確定」のときのみイベント候補に昇格できます",
        { currentStatus: existing.status },
      );
    }

    // Same `withTenant` transaction — both rows commit atomically.
    const candidate = await tx.eventCandidate.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        venueProviderId: existing.venueProviderId,
        venueNegotiationId: existing.id,
        targetMonth: parsed.targetMonth,
        scheduledDate: parsed.scheduledDate,
        storeName: parsed.storeName,
        address: parsed.address,
        area: parsed.area,
        deadlineAt: parsed.deadlineAt,
        contractType: existing.contractType,
        fixedFee: existing.fixedFee,
        performanceRate: existing.performanceRate,
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    revalidatePath("/event-detail");
    return { eventCandidateId: candidate.id };
  },
);

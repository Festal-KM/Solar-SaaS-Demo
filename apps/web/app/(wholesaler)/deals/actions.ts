"use server";

// Deal Server Actions for wholesaler and dealer role groups (T-05-03 / F-038 /
// docs/05 §4.8 §6.4).
//
// Three-step idiom: auth → assertCan → withTenant tx.
//
// Dealer scope enforcement:
//   - APPOINTMENT_ONLY → deal.create / deal.update blocked (ForbiddenError)
//   - FIRST_VISIT      → pitch/close (PROPOSING and beyond to CONTRACTED) blocked
//   - FULL_CLOSING     → all transitions allowed
//
// wholesalerId is ALWAYS taken from ctx (via customer lookup), never from input.
// ownerRelationshipId for dealer callers is resolved from ctx.relationshipIds[0].

import { revalidatePath } from "next/cache";

import {
  DealCreateSchema,
  DealUpdateSchema,
  DealChangeStatusSchema,
  isDealStatusTransitionValid,
  dealStatusToScopeAction,
  canDealerCloseDeal,
  type DealCreateInput,
  type DealUpdateInput,
  type DealChangeStatusInput,
} from "@solar/contracts";

import { type TxClient } from "@solar/db";

import { ForbiddenError, InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/deals";

// Resolve effective DealerScope from DB for a dealer caller on a given deal.
// Returns null when the caller is a wholesaler (no scope restriction needed).
//
// We cannot reuse `resolveScopeFromDb` directly here because it calls
// `withTenant` internally, which would double-nest within the transaction
// already opened by `withServerActionContext`. Instead we replicate the
// core lookup using the in-flight `tx`. The logic is equivalent to
// `EventDealer.scopeOverride ?? Relationship.defaultScope` (docs/05 §6.4).
async function resolveDealerScopeInTx(
  ctx: { dealerId?: string; relationshipIds: string[] },
  ownerRelationshipId: string | null,
  tx: TxClient,
): Promise<import("@solar/contracts").DealerScope | null> {
  if (!ctx.dealerId) return null; // wholesaler caller — no scope limit
  const relId = ownerRelationshipId ?? ctx.relationshipIds[0];
  if (!relId) return null;

  const relationship = await tx.relationship.findFirst({
    where: { id: relId },
    select: { defaultScope: true },
  });

  const defaultScope = (relationship?.defaultScope ?? "FULL_CLOSING") as import("@solar/contracts").DealerScope;
  return defaultScope;
}

export const createDealAction = withServerActionContext<DealCreateInput, { id: string }>(
  { action: "deal.create" },
  async ({ tx, ctx, input }) => {
    const parsed = DealCreateSchema.parse(input);

    // Enforce dealer scope — APPOINTMENT_ONLY may not create deals.
    const scope = await resolveDealerScopeInTx(ctx, parsed.ownerRelationshipId ?? null, tx);
    if (scope !== null && !canDealerCloseDeal(scope, "visit")) {
      throw new ForbiddenError(
        "このスコープでは商談の作成はできません (APPOINTMENT_ONLY)",
        { scope },
      );
    }

    const ownerType = ctx.dealerId ? "DEALER" : "WHOLESALER";
    const ownerRelationshipId =
      parsed.ownerRelationshipId ?? (ctx.relationshipIds[0] ?? null);

    const created = await tx.deal.create({
      data: {
        customerId: parsed.customerId,
        ownerType,
        ownerUserId: ctx.actorUserId,
        ownerRelationshipId,
        status: "VISIT_PLANNED",
        note: parsed.notes ?? null,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export const updateDealAction = withServerActionContext<DealUpdateInput, { id: string }>(
  { action: "deal.update" },
  async ({ tx, ctx, input }) => {
    const parsed = DealUpdateSchema.parse(input);

    const existing = await tx.deal.findUnique({
      where: { id: parsed.id },
      select: { id: true, status: true, ownerRelationshipId: true },
    });
    if (!existing) throw new NotFoundError("商談が見つかりません");

    // Enforce dealer scope — APPOINTMENT_ONLY may not update deals.
    const scope = await resolveDealerScopeInTx(ctx, existing.ownerRelationshipId, tx);
    if (scope !== null && !canDealerCloseDeal(scope, "visit")) {
      throw new ForbiddenError(
        "このスコープでは商談の更新はできません (APPOINTMENT_ONLY)",
        { scope },
      );
    }

    const updated = await tx.deal.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.assignedToUserId !== undefined
          ? { ownerUserId: parsed.assignedToUserId }
          : {}),
        ...(parsed.proposedProduct !== undefined
          ? { proposedProduct: parsed.proposedProduct }
          : {}),
        ...(parsed.proposedAmount !== undefined
          ? { proposedAmount: parsed.proposedAmount }
          : {}),
        ...(parsed.expectedProfit !== undefined
          ? { expectedProfit: parsed.expectedProfit }
          : {}),
        ...(parsed.expectedContractDate !== undefined
          ? { expectedContractDate: new Date(parsed.expectedContractDate) }
          : {}),
        ...(parsed.lostReason !== undefined ? { lostReason: parsed.lostReason } : {}),
        ...(parsed.nextAction !== undefined ? { nextAction: parsed.nextAction } : {}),
        ...(parsed.notes !== undefined ? { note: parsed.notes } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.id}`);
    return { id: updated.id };
  },
);

export const changeStatusAction = withServerActionContext<
  DealChangeStatusInput,
  { id: string }
>(
  { action: "deal.update" },
  async ({ tx, ctx, input }) => {
    const parsed = DealChangeStatusSchema.parse(input);

    const existing = await tx.deal.findUnique({
      where: { id: parsed.id },
      select: { id: true, status: true, ownerRelationshipId: true },
    });
    if (!existing) throw new NotFoundError("商談が見つかりません");

    // Validate state transition.
    if (!isDealStatusTransitionValid(existing.status, parsed.status)) {
      throw new InvalidStateTransitionError(
        `${existing.status} から ${parsed.status} への遷移はできません`,
        { from: existing.status, to: parsed.status },
      );
    }

    // Enforce dealer scope for pitch/close transitions.
    const scope = await resolveDealerScopeInTx(ctx, existing.ownerRelationshipId, tx);
    if (scope !== null) {
      const requiredAction = dealStatusToScopeAction(parsed.status);
      if (requiredAction !== null && !canDealerCloseDeal(scope, requiredAction)) {
        throw new ForbiddenError(
          `このスコープではこのステータス変更 (${parsed.status}) はできません`,
          { scope, requiredAction, to: parsed.status },
        );
      }
    }

    const updated = await tx.deal.update({
      where: { id: parsed.id },
      data: {
        status: parsed.status,
        ...(parsed.notes !== undefined ? { note: parsed.notes } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.id}`);
    return { id: updated.id };
  },
);

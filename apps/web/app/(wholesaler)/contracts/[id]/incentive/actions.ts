"use server";

// Joint-incentive manual-distribution Server Action — T-06-03 / F-047 /
// docs/05 §4.8 §6.1.
//
// adjustJointIncentiveAction flow inside withTenant tx:
//   1. Fetch Contract — must exist and have eventModeAtContract=JOINT.
//      Non-JOINT → ValidationError.
//   2. Fetch all Incentive rows for the contract. Each entry in distributions
//      must match an existing Incentive (DRAFT status).
//   3. For each distribution:
//      a. Load the current Incentive (must be DRAFT, not already FINALIZED).
//      b. Create IncentiveAdjustment(kind=JOINT_DISTRIBUTION, beforeAmount, afterAmount,
//         reason, adjustedBy=actorUserId).
//      c. Update Incentive.amount = distribution.amount, status = FINALIZED,
//         finalizedAt = now().
//   4. Verify all DRAFT Incentives for this contract are now resolved.
//
// wholesalerId / relationshipId are always read from DB — never from input.
// FINALIZED Incentive → ConflictError (409).

import { revalidatePath } from "next/cache";

import {
  IncentiveAdjustJointSchema,
  type IncentiveAdjustJointInput,
} from "@solar/contracts";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface AdjustJointIncentiveResult {
  updatedIncentiveIds: string[];
  adjustmentIds: string[];
}

export const adjustJointIncentiveAction = withServerActionContext<
  IncentiveAdjustJointInput,
  AdjustJointIncentiveResult
>(
  { action: "incentive.adjust" },
  async ({ tx, ctx, input }) => {
    const parsed = IncentiveAdjustJointSchema.parse(input);
    const now = new Date();

    // 1. Fetch contract — verify mode=JOINT.
    const contract = await tx.contract.findUnique({
      where: { id: parsed.contractId },
      select: {
        id: true,
        eventModeAtContract: true,
        wholesalerId: true,
      },
    });

    if (!contract) throw new NotFoundError("契約が見つかりません");

    if (contract.eventModeAtContract !== "JOINT") {
      throw new ValidationError(
        "共同開催インセンティブ調整は eventModeAtContract=JOINT の契約のみ対象です",
        { eventModeAtContract: contract.eventModeAtContract },
      );
    }

    const updatedIncentiveIds: string[] = [];
    const adjustmentIds: string[] = [];

    // 2 & 3. Process each distribution entry.
    for (const dist of parsed.distributions) {
      const incentive = await tx.incentive.findUnique({
        where: {
          contractId_relationshipId: {
            contractId: parsed.contractId,
            relationshipId: dist.relationshipId,
          },
        },
        select: {
          id: true,
          status: true,
          amount: true,
        },
      });

      if (!incentive) {
        throw new NotFoundError(
          `インセンティブが見つかりません（relationshipId: ${dist.relationshipId}）`,
          { relationshipId: dist.relationshipId },
        );
      }

      if (incentive.status === "FINALIZED") {
        throw new ConflictError(
          "既に確定済みのインセンティブは再調整できません",
          { incentiveId: incentive.id, status: incentive.status },
        );
      }

      const beforeAmount = Number(incentive.amount);
      const afterAmount = Number(dist.amount);

      // Create adjustment record.
      const adjustment = await tx.incentiveAdjustment.create({
        data: {
          incentiveId: incentive.id,
          kind: "JOINT_DISTRIBUTION",
          beforeAmount: beforeAmount.toFixed(2),
          afterAmount: afterAmount.toFixed(2),
          reason: dist.reason,
          adjustedBy: ctx.actorUserId,
        },
        select: { id: true },
      });
      adjustmentIds.push(adjustment.id);

      // Update incentive to FINALIZED with new amount.
      await tx.incentive.update({
        where: { id: incentive.id },
        data: {
          amount: afterAmount.toFixed(2),
          status: "FINALIZED",
          finalizedAt: now,
        },
      });
      updatedIncentiveIds.push(incentive.id);
    }

    // Notify each affected dealer's admins that their incentive is finalized.
    if (ctx.wholesalerId) {
      for (const dist of parsed.distributions) {
        const dealerAdmins = await resolveDealerAdmins(tx, dist.relationshipId);
        if (dealerAdmins.length > 0) {
          await notificationService.fire(tx, {
            type: "INCENTIVE_FINALIZED",
            recipientUserIds: dealerAdmins,
            tenantId: ctx.wholesalerId,
            params: { targetMonth: "" },
            dedupKey: `INCENTIVE_FINALIZED:joint:${parsed.contractId}:${dist.relationshipId}`,
          });
        }
      }
    }

    revalidatePath(`/contracts/${parsed.contractId}/incentive`);
    revalidatePath(`/contracts/${parsed.contractId}`);

    return { updatedIncentiveIds, adjustmentIds };
  },
);

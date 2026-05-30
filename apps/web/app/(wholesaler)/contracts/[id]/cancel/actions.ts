"use server";

// Contract cancel Server Action — T-06-04 / F-043 / docs/05 §6.1 §4.8.
//
// Five-step flow inside withTenant tx:
//   1. Fetch Contract — must be CONTRACTED or CONSTRUCTING (ACTIVE states).
//      CANCELLED / DONE → InvalidStateTransitionError.
//   2. Determine isWithinDeadline: now <= contract.cancelDeadline.
//   3. Update Contract.status = CANCELLED, create ContractCancellation.
//   4a. Within deadline: Incentive.status = CANCELLED (all related rows).
//   4b. After deadline: Incentive.status = NEGATIVE_ADJUSTED, create
//       IncentiveAdjustment(kind=NEGATIVE_AFTER_DEADLINE, appliedMonth=翌月).
//
// wholesalerId is always taken from ctx — never from input.
// cancelledAt is fixed to server-side now() so the client cannot forge a date.

import { revalidatePath } from "next/cache";

import { ContractCancelSchema, type ContractCancelInput } from "@solar/contracts";

import { InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { recordAudit } from "@/lib/audit/audit-service";

const ACTIVE_CONTRACT_STATUSES = new Set(["CONTRACTED", "CONSTRUCTING"]);

export interface CancelContractResult {
  isWithinDeadline: boolean;
  cancelledIncentiveIds: string[];
  negativeAdjustmentIds: string[];
}

export const cancelContractAction = withServerActionContext<
  ContractCancelInput,
  CancelContractResult
>(
  { action: "contract.cancel" },
  async ({ tx, ctx, input }) => {
    const parsed = ContractCancelSchema.parse(input);
    const now = new Date();

    // 1. Fetch contract — verify it belongs to this tenant and is in an active state.
    const contract = await tx.contract.findUnique({
      where: { id: parsed.contractId },
      select: {
        id: true,
        status: true,
        cancelDeadline: true,
        wholesalerId: true,
        ownerRelationshipId: true,
      },
    });

    if (!contract) throw new NotFoundError("契約が見つかりません");
    if (!ACTIVE_CONTRACT_STATUSES.has(contract.status)) {
      throw new InvalidStateTransitionError(
        `キャンセルできるのは「契約中」または「施工中」の状態のみです（現在: ${contract.status}）`,
        { currentStatus: contract.status },
      );
    }

    // 2. Determine whether we are within the cancellation deadline.
    const isWithinDeadline = now <= contract.cancelDeadline;

    // 3. Update Contract.status = CANCELLED.
    await tx.contract.update({
      where: { id: parsed.contractId },
      data: { status: "CANCELLED" },
    });

    // 4. Handle related Incentive records.
    const incentives = await tx.incentive.findMany({
      where: { contractId: parsed.contractId },
      select: { id: true, amount: true, settledMonth: true },
    });

    const cancelledIncentiveIds: string[] = [];
    const negativeAdjustmentIds: string[] = [];

    if (incentives.length > 0) {
      if (isWithinDeadline) {
        // 4a. Within deadline — mark all incentives as CANCELLED.
        for (const inc of incentives) {
          await tx.incentive.update({
            where: { id: inc.id },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          cancelledIncentiveIds.push(inc.id);
        }
      } else {
        // 4b. After deadline — mark as NEGATIVE_ADJUSTED, create adjustments.
        //     appliedMonth = 翌月 (next month relative to now).
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const appliedMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

        for (const inc of incentives) {
          const amount = Number(inc.amount);
          const adjustment = await tx.incentiveAdjustment.create({
            data: {
              incentiveId: inc.id,
              kind: "NEGATIVE_AFTER_DEADLINE",
              beforeAmount: amount.toFixed(2),
              afterAmount: "0.00",
              reason: parsed.reason,
              adjustedBy: ctx.actorUserId,
              appliedMonth,
            },
            select: { id: true },
          });
          negativeAdjustmentIds.push(adjustment.id);

          await tx.incentive.update({
            where: { id: inc.id },
            data: { status: "NEGATIVE_ADJUSTED" },
          });
        }
      }
    }

    // 5. Create ContractCancellation record.
    await tx.contractCancellation.create({
      data: {
        contractId: parsed.contractId,
        cancelledAt: now,
        reason: parsed.reason,
        isWithinDeadline,
        negativeAdjustmentIds,
        recordedBy: ctx.actorUserId,
      },
    });

    // 6. Audit log — F-055.
    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "CANCEL",
      targetType: "Contract",
      targetId: parsed.contractId,
      tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "",
      before: { status: "CONTRACTED" },
      after: {
        status: "CANCELLED",
        isWithinDeadline,
        reason: parsed.reason,
      },
    });

    // 7. Notify dealer admins that their incentive status changed.
    if (contract.ownerRelationshipId && ctx.wholesalerId) {
      const dealerAdmins = await resolveDealerAdmins(tx, contract.ownerRelationshipId);
      if (dealerAdmins.length > 0) {
        await notificationService.fire(tx, {
          type: "INCENTIVE_PENDING",
          recipientUserIds: dealerAdmins,
          tenantId: ctx.wholesalerId,
          params: { contractId: parsed.contractId },
          dedupKey: `INCENTIVE_PENDING:cancel:${parsed.contractId}`,
        });
      }
    }

    revalidatePath(`/contracts/${parsed.contractId}`);
    revalidatePath("/contracts");

    return {
      isWithinDeadline,
      cancelledIncentiveIds,
      negativeAdjustmentIds,
    };
  },
);

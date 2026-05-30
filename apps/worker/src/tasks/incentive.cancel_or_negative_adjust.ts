// graphile-worker task: incentive.cancel_or_negative_adjust
// (T-06-05 / F-043 / docs/05 §5.2).
//
// Handles incentive side-effects of a contract cancellation:
//   • Within cancelDeadline  → Incentive.status = CANCELLED
//   • After  cancelDeadline  → Incentive.status = NEGATIVE_ADJUSTED +
//                              IncentiveAdjustment(kind=NEGATIVE_AFTER_DEADLINE,
//                              appliedMonth=翌月)
//
// Idempotency: if Contract.status is already CANCELLED when the task runs,
// the Incentive rows must already have been processed (by cancelContractAction
// or a prior run of this task) — log and exit.
//
// The worker runs with SYSTEM_TENANT_CONTEXT (isSaasAdmin=true) so it can
// reach rows across all tenants; identifiers come from the DB, not the payload.

import {
  incentiveCancelOrNegativeAdjustPayloadSchema,
  type IncentiveCancelOrNegativeAdjustPayload,
} from "@solar/contracts";
import { withTenant, SYSTEM_TENANT_CONTEXT } from "@solar/db";

import type { Task } from "graphile-worker";

export const incentiveCancelOrNegativeAdjustTask: Task = async (rawPayload, helpers) => {
  const payload: IncentiveCancelOrNegativeAdjustPayload =
    incentiveCancelOrNegativeAdjustPayloadSchema.parse(rawPayload);
  const { contractId, cancelledByUserId, reason } = payload;
  const cancelledAt = new Date(payload.cancelledAt);
  const start = Date.now();

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, status: true, cancelDeadline: true },
    });

    if (!contract) {
      helpers.logger.warn(
        `incentive.cancel_or_negative_adjust: contract not found contractId=${contractId} jobId=${helpers.job.id}`,
      );
      return;
    }

    // Idempotency: if already CANCELLED the action already ran.
    if (contract.status === "CANCELLED") {
      helpers.logger.info(
        `incentive.cancel_or_negative_adjust: already CANCELLED, skipping contractId=${contractId} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
      );
      return;
    }

    const isWithinDeadline = cancelledAt <= contract.cancelDeadline;

    // Update contract status.
    await tx.contract.update({
      where: { id: contractId },
      data: { status: "CANCELLED" },
    });

    const incentives = await tx.incentive.findMany({
      where: { contractId },
      select: { id: true, amount: true, settledMonth: true },
    });

    const negativeAdjustmentIds: string[] = [];

    if (isWithinDeadline) {
      for (const inc of incentives) {
        await tx.incentive.update({
          where: { id: inc.id },
          data: { status: "CANCELLED", cancelledAt },
        });
      }
    } else {
      const nextMonth = new Date(cancelledAt.getFullYear(), cancelledAt.getMonth() + 1, 1);
      const appliedMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

      for (const inc of incentives) {
        const beforeAmount = Number(inc.amount);
        const adj = await tx.incentiveAdjustment.create({
          data: {
            incentiveId: inc.id,
            kind: "NEGATIVE_AFTER_DEADLINE",
            beforeAmount: beforeAmount.toFixed(2),
            afterAmount: "0.00",
            reason,
            adjustedBy: cancelledByUserId,
            appliedMonth,
          },
          select: { id: true },
        });
        negativeAdjustmentIds.push(adj.id);

        await tx.incentive.update({
          where: { id: inc.id },
          data: { status: "NEGATIVE_ADJUSTED" },
        });
      }
    }

    // Ensure ContractCancellation record exists (idempotent upsert via unique constraint).
    const cancellation = await tx.contractCancellation.findUnique({
      where: { contractId },
    });

    if (!cancellation) {
      await tx.contractCancellation.create({
        data: {
          contractId,
          cancelledAt,
          reason,
          isWithinDeadline,
          negativeAdjustmentIds,
          recordedBy: cancelledByUserId,
        },
      });
    }

    helpers.logger.info(
      `incentive.cancel_or_negative_adjust: ok contractId=${contractId} isWithinDeadline=${isWithinDeadline} incentiveCount=${incentives.length} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
    );
  });
};

export default incentiveCancelOrNegativeAdjustTask;

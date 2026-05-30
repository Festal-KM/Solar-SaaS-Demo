// graphile-worker task: incentive.calculate (T-06-05 / F-046 / docs/05 §5.2).
//
// Upserts an Incentive row for the given contract using:
//   • GrossProfit.incentiveTargetProfit (already computed by createContractAction)
//   • Contract.incentiveRateSnapshot + eventModeAtContract + isSelfHosted
//
// Idempotency: if the Incentive row is already FINALIZED this task is a no-op.
// jobKey = `incentive.calculate:{contractId}` prevents duplicate execution.
//
// The worker runs with SYSTEM_TENANT_CONTEXT (isSaasAdmin=true) to bypass RLS;
// all identifiers come from DB rows, never from the caller-supplied payload.

import {
  incentiveCalculatePayloadSchema,
  computeIncentiveAmount,
  shouldSkipIncentive,
  type IncentiveCalculatePayload,
} from "@solar/contracts";
import { withTenant, SYSTEM_TENANT_CONTEXT } from "@solar/db";

import type { Task } from "graphile-worker";

export const incentiveCalculateTask: Task = async (rawPayload, helpers) => {
  const payload: IncentiveCalculatePayload = incentiveCalculatePayloadSchema.parse(rawPayload);
  const { contractId } = payload;
  const start = Date.now();

  await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        status: true,
        isSelfHosted: true,
        ownerRelationshipId: true,
        incentiveRateSnapshot: true,
        eventModeAtContract: true,
        contractDate: true,
      },
    });

    if (!contract) {
      helpers.logger.warn(
        `incentive.calculate: contract not found contractId=${contractId} jobId=${helpers.job.id}`,
      );
      return;
    }

    const relationshipId = contract.ownerRelationshipId;
    if (!relationshipId) {
      helpers.logger.info(
        `incentive.calculate: no relationshipId (self-hosted with no dealer) contractId=${contractId} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
      );
      return;
    }

    // Idempotency: skip if already FINALIZED.
    const existing = await tx.incentive.findUnique({
      where: { contractId_relationshipId: { contractId, relationshipId } },
      select: { status: true },
    });

    if (existing?.status === "FINALIZED") {
      helpers.logger.info(
        `incentive.calculate: already FINALIZED, skipping contractId=${contractId} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
      );
      return;
    }

    const gp = await tx.grossProfit.findUnique({
      where: { contractId },
      select: { incentiveTargetProfit: true },
    });

    const incentiveTargetProfit = gp ? Number(gp.incentiveTargetProfit) : 0;
    const isCancelled = contract.status === "CANCELLED";
    const rate = contract.incentiveRateSnapshot ? Number(contract.incentiveRateSnapshot) : 0;

    const skip = shouldSkipIncentive({
      isSelfHosted: contract.isSelfHosted,
      relationshipId,
      incentiveTargetProfit,
      isCancelled,
    });

    let amount: number;
    let status: "DRAFT" | "FINALIZED";

    if (skip) {
      amount = 0;
      status = "FINALIZED";
    } else {
      const isJoint = contract.eventModeAtContract === "JOINT";
      amount = computeIncentiveAmount({
        incentiveTargetProfit,
        rate,
        isSelfHosted: contract.isSelfHosted,
        isCancelled,
      });
      status = isJoint ? "DRAFT" : "FINALIZED";
    }

    const d = contract.contractDate;
    const settledMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    await tx.incentive.upsert({
      where: { contractId_relationshipId: { contractId, relationshipId } },
      create: {
        contractId,
        relationshipId,
        targetProfit: incentiveTargetProfit.toFixed(2),
        rate: rate.toFixed(2),
        amount: amount.toFixed(2),
        status,
        settledMonth,
        finalizedAt: status === "FINALIZED" ? new Date() : null,
        note: null,
      },
      update: {
        targetProfit: incentiveTargetProfit.toFixed(2),
        rate: rate.toFixed(2),
        amount: amount.toFixed(2),
        status,
        finalizedAt: status === "FINALIZED" ? new Date() : null,
      },
    });

    helpers.logger.info(
      `incentive.calculate: ok contractId=${contractId} relationshipId=${relationshipId} amount=${amount} status=${status} jobId=${helpers.job.id} durationMs=${Date.now() - start}`,
    );
  });
};

export default incentiveCalculateTask;

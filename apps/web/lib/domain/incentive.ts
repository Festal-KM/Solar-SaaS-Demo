// Prisma-backed IncentiveService.finalizeForContract — T-06-02 / F-046.
//
// Called inside an existing withTenant transaction immediately after a
// Contract row is created (createContractAction) so that Incentive records
// are always present when a contract is in CONTRACTED status.
//
// Logic (docs/05 §6.1):
//   1. Fetch Contract (isSelfHosted, ownerRelationshipId, status, eventModeAtContract,
//      incentiveRateSnapshot, contractDate) + GrossProfit (incentiveTargetProfit).
//   2. shouldSkipIncentive → true: upsert Incentive(amount=0, status=FINALIZED).
//   3. eventModeAtContract=JOINT: upsert Incentive(amount=calculated, status=DRAFT).
//   4. Otherwise (DEALER / SELF with relationship): upsert Incentive(amount=calculated, status=FINALIZED).
//
// Relationships with no rate snapshot produce amount=0 (F-046 "rate unset → 0 yen").
// wholesalerId / relationshipId are always read from the DB row, never from caller input.

import type { TxClient } from "@solar/db";
import { shouldSkipIncentive, computeIncentiveAmount } from "@solar/contracts";
import { getLogger } from "@solar/contracts/logger";

import { NotFoundError } from "@/lib/errors";

export interface FinalizedIncentive {
  id: string;
  contractId: string;
  relationshipId: string;
  amount: string;
  status: string;
  settledMonth: string;
}

/**
 * Upserts Incentive record(s) for the given contract inside the caller's
 * open transaction.
 *
 * Returns the list of upserted Incentive rows. When the contract has no
 * ownerRelationshipId (self-hosted with no dealer), returns an empty array.
 */
export async function finalizeForContract(
  tx: TxClient,
  contractId: string,
  _actorUserId: string,
): Promise<FinalizedIncentive[]> {
  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      isSelfHosted: true,
      status: true,
      ownerRelationshipId: true,
      incentiveRateSnapshot: true,
      eventModeAtContract: true,
      contractDate: true,
    },
  });

  if (!contract) throw new NotFoundError("契約が見つかりません");

  const relationshipId = contract.ownerRelationshipId;
  if (!relationshipId) {
    // No dealer relationship — nothing to incentivize.
    return [];
  }

  const gp = await tx.grossProfit.findUnique({
    where: { contractId },
    select: { incentiveTargetProfit: true },
  });

  const incentiveTargetProfit = gp ? Number(gp.incentiveTargetProfit) : 0;
  const isCancelled = contract.status === "CANCELLED";
  const rate = contract.incentiveRateSnapshot ? Number(contract.incentiveRateSnapshot) : 0;

  if (contract.incentiveRateSnapshot === null) {
    getLogger({ event: "incentive.rate_unset", contractId }).warn(
      "incentiveRateSnapshot is null; incentive amount will be 0",
    );
  }

  // Derive the settledMonth from contractDate (YYYY-MM ISO format).
  const d = contract.contractDate;
  const settledMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

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

  const result = await tx.incentive.upsert({
    where: {
      contractId_relationshipId: { contractId, relationshipId },
    },
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
    select: {
      id: true,
      contractId: true,
      relationshipId: true,
      amount: true,
      status: true,
      settledMonth: true,
    },
  });

  return [
    {
      id: result.id,
      contractId: result.contractId,
      relationshipId: result.relationshipId,
      amount: result.amount.toString(),
      status: result.status,
      settledMonth: result.settledMonth,
    },
  ];
}

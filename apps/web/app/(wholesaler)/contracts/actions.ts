"use server";

// Contract Server Action — createContractAction (T-05-06 / F-040 / F-041 /
// docs/05 §3.6 §4.8 §6.2).
//
// Six-step flow inside a single withTenant transaction:
//   1. Fetch Deal — must be in LIKELY_CONTRACT status (pre-condition for CONTRACTED).
//   2. Compute cancelDeadline from WholesalerSettings + contractDate.
//   3. Snapshot incentive rate from IncentiveRate rows effective at contractDate.
//   4. Create Contract row (wholesalerId + ownerRelationshipId from ctx).
//   5. Advance Deal.status to CONTRACTED, set closedAt = now.
//   6. Create initial GrossProfit row (zero values; recalc is T-05-08).
//
// wholesalerId is always taken from ctx, never from input.
// Deal ownership (ownerRelationshipId) is read from the Deal row itself.
// snapshotIncentiveRate throws when no effective rate exists — the action
// surfaces this as an InvalidStateTransitionError so the UI can show a
// meaningful message.

import { revalidatePath } from "next/cache";

import {
  ContractCreateSchema,
  computeCancelDeadline,
  isDealStatusTransitionValid,
  snapshotIncentiveRate,
  WHOLESALER_SETTINGS_DEFAULTS,
  type ContractCreateInput,
} from "@solar/contracts";

import { InvalidStateTransitionError, NotFoundError } from "@/lib/errors";
import { notificationService } from "@/lib/notifications/notification-service";
import { resolveDealerAdmins, resolveWholesalerAdmins } from "@/lib/notifications/recipient-helpers";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { finalizeForContract } from "@/lib/domain/incentive";

const CONTRACTS_PATH = "/contracts";
const DEALS_PATH = "/deals";

export const createContractAction = withServerActionContext<
  ContractCreateInput,
  { id: string }
>(
  { action: "contract.create" },
  async ({ tx, ctx, input }) => {
    const parsed = ContractCreateSchema.parse(input);
    const contractDate = new Date(parsed.contractDate);

    // 1. Fetch Deal — must exist and be in LIKELY_CONTRACT status.
    const deal = await tx.deal.findUnique({
      where: { id: parsed.dealId },
      select: {
        id: true,
        status: true,
        ownerRelationshipId: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    });
    if (!deal) throw new NotFoundError("商談が見つかりません");
    if (!isDealStatusTransitionValid(deal.status, "CONTRACTED")) {
      throw new InvalidStateTransitionError(
        `契約登録には商談が「契約見込み」状態である必要があります（現在: ${deal.status}）`,
        { currentStatus: deal.status, requiredStatus: "LIKELY_CONTRACT" },
      );
    }

    // 2. Compute cancelDeadline from WholesalerSettings.
    const settings = ctx.wholesalerId
      ? await tx.wholesalerSettings.findUnique({
          where: { wholesalerId: ctx.wholesalerId },
          select: { cancelDeadlineDays: true },
        })
      : null;
    const cancelDeadlineDays =
      settings?.cancelDeadlineDays ?? WHOLESALER_SETTINGS_DEFAULTS.cancelDeadlineDays;
    const cancelDeadline = computeCancelDeadline(contractDate, cancelDeadlineDays);

    // 3. Snapshot incentive rate.
    //    Only possible when a relationship is known (dealer case or wholesaler
    //    with ownerRelationshipId). If no relationship, store nulls and let
    //    T-05-08 handle manual entry.
    const relationshipId = deal.ownerRelationshipId;
    let incentiveRateSnapshot: string | null = null;
    let incentiveTargetTypeSnapshot: string | null = null;

    if (relationshipId) {
      const rates = await tx.incentiveRate.findMany({
        where: { relationshipId },
        select: { effectiveFrom: true, effectiveTo: true, rate: true, targetType: true },
      });

      try {
        const snapshot = snapshotIncentiveRate(contractDate, rates.map((r) => ({
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          rate: r.rate.toString(),
          targetType: r.targetType as import("@solar/contracts").IncentiveTargetType,
        })));
        incentiveRateSnapshot = snapshot.rate;
        incentiveTargetTypeSnapshot = snapshot.targetType;
      } catch {
        // Rate not configured — store nulls and surface a note in GrossProfit.
        // F-046 specifies: "rate unset → incentive 0 yen + warning". The
        // warning comes from the recalc job (T-05-08); here we just proceed.
        incentiveRateSnapshot = null;
        incentiveTargetTypeSnapshot = null;
      }
    }

    // 4. Create Contract.
    const contract = await tx.contract.create({
      data: {
        wholesalerId: ctx.wholesalerId!,
        dealId: parsed.dealId,
        customerId: deal.customerId,
        ownerRelationshipId: deal.ownerRelationshipId ?? null,
        contractDate,
        contractAmount: parsed.totalAmount,
        cancelDeadline,
        incentiveRateSnapshot: incentiveRateSnapshot ?? undefined,
        incentiveTargetTypeSnapshot:
          (incentiveTargetTypeSnapshot as import("@solar/db").IncentiveTargetType | null) ??
          undefined,
        isSelfHosted: parsed.isSelfHosted,
        status: "CONTRACTED",
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    // 5. Advance Deal.status → CONTRACTED.
    await tx.deal.update({
      where: { id: parsed.dealId },
      data: { status: "CONTRACTED" },
    });

    // 6. Create initial GrossProfit row (zero values; full recalc is T-05-08).
    await tx.grossProfit.create({
      data: {
        contractId: contract.id,
        salesPrice: parsed.totalAmount,
        purchaseTotal: "0",
        dealerTotal: "0",
        constructionFee: "0",
        otherCost: "0",
        discount: "0",
        projectProfit: "0",
        wholesaleProfit: "0",
        profitRate: "0",
        incentiveTargetProfit: "0",
        incentiveTargetType:
          (incentiveTargetTypeSnapshot as import("@solar/db").IncentiveTargetType | null) ??
          "PROJECT_PROFIT",
      },
    });

    // 7. Finalize Incentive — auto-triggered at contract creation (T-06-02 / F-046).
    await finalizeForContract(tx, contract.id, ctx.actorUserId);

    // 8. Notify CONTRACT_CONTRACTED — dealer admins of the owning relationship
    //    (if any) + all wholesaler admins.
    const customerName = deal.customer?.name ?? "";
    const tenantId = ctx.wholesalerId!;

    const wsAdmins = await resolveWholesalerAdmins(tx, tenantId);
    const dedupBase = `CONTRACT_CONTRACTED:${contract.id}`;

    const allRecipients = new Set<string>(wsAdmins);
    if (relationshipId) {
      const dealerAdmins = await resolveDealerAdmins(tx, relationshipId);
      dealerAdmins.forEach((id) => allRecipients.add(id));
    }

    if (allRecipients.size > 0) {
      await notificationService.fire(tx, {
        type: "CONTRACT_CONTRACTED",
        recipientUserIds: Array.from(allRecipients),
        tenantId,
        params: { customerName },
        dedupKey: dedupBase,
      });
    }

    revalidatePath(CONTRACTS_PATH);
    revalidatePath(`${DEALS_PATH}/${parsed.dealId}`);

    return { id: contract.id };
  },
);

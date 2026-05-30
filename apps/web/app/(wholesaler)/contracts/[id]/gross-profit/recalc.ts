// Shared gross-profit recalculation helper — T-05-10 / F-042.
//
// recalcGrossProfitInternal accepts an open TxClient so callers that already
// hold a transaction (e.g. updateConstructionAction) can reuse it without
// opening a nested interactive transaction, which would deadlock.

import { computeGrossProfit } from "@solar/contracts";
import type { IncentiveTargetType } from "@solar/db";
import type { TxClient } from "@solar/db";

import { NotFoundError } from "@/lib/errors";

export interface RecalcParams {
  contractId: string;
  salesPrice: string;
  constructionFee: string;
  otherCost: string;
  discount: string;
  incentiveTargetType: "PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL";
  manualValue?: string;
}

export async function recalcGrossProfitInternal(
  tx: TxClient,
  params: RecalcParams,
): Promise<void> {
  const items = await tx.contractItem.findMany({
    where: { contractId: params.contractId },
    select: {
      qty: true,
      snapshotPurchasePrice: true,
      snapshotDealerPrice: true,
      snapshotListPrice: true,
    },
  });

  if (items.length === 0) {
    throw new NotFoundError(
      "契約明細が登録されていません。先に明細を登録してください",
    );
  }

  const contract = await tx.contract.findUnique({
    where: { id: params.contractId },
    select: { id: true },
  });
  if (!contract) throw new NotFoundError("契約が見つかりません");

  const computed = computeGrossProfit({
    items: items.map((i) => ({
      qty: Number(i.qty),
      snapshotPurchasePrice: Number(i.snapshotPurchasePrice),
      snapshotDealerPrice: Number(i.snapshotDealerPrice),
      snapshotListPrice: Number(i.snapshotListPrice),
    })),
    salesPrice: Number(params.salesPrice),
    constructionFee: Number(params.constructionFee),
    otherCost: Number(params.otherCost),
    discount: Number(params.discount),
    incentiveTargetType: params.incentiveTargetType,
    manualValue:
      params.manualValue !== undefined ? Number(params.manualValue) : undefined,
  });

  await tx.grossProfit.upsert({
    where: { contractId: params.contractId },
    create: {
      contractId: params.contractId,
      salesPrice: params.salesPrice,
      purchaseTotal: computed.purchaseTotal.toFixed(2),
      dealerTotal: computed.dealerTotal.toFixed(2),
      constructionFee: params.constructionFee,
      otherCost: params.otherCost,
      discount: params.discount,
      projectProfit: computed.projectProfit.toFixed(2),
      wholesaleProfit: computed.wholesaleProfit.toFixed(2),
      profitRate: computed.profitRate.toFixed(4),
      incentiveTargetProfit: computed.incentiveTargetProfit.toFixed(2),
      incentiveTargetType: params.incentiveTargetType as IncentiveTargetType,
    },
    update: {
      salesPrice: params.salesPrice,
      purchaseTotal: computed.purchaseTotal.toFixed(2),
      dealerTotal: computed.dealerTotal.toFixed(2),
      constructionFee: params.constructionFee,
      otherCost: params.otherCost,
      discount: params.discount,
      projectProfit: computed.projectProfit.toFixed(2),
      wholesaleProfit: computed.wholesaleProfit.toFixed(2),
      profitRate: computed.profitRate.toFixed(4),
      incentiveTargetProfit: computed.incentiveTargetProfit.toFixed(2),
      incentiveTargetType: params.incentiveTargetType as IncentiveTargetType,
    },
  });
}

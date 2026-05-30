// Pure gross-profit calculation helpers — no DB / framework dependencies.
//
// Implements docs/05 §6.1 `IncentiveService` pure-function contract (A).
// All monetary values are passed and returned as numbers (the caller converts
// from Decimal strings before calling and converts back before persisting).

import type { IncentiveTargetType } from "../schemas/incentive-rate.js";

export interface GrossProfitItem {
  qty: number;
  snapshotPurchasePrice: number;
  snapshotDealerPrice: number;
  snapshotListPrice: number;
}

export interface GrossProfitInput {
  items: GrossProfitItem[];
  salesPrice: number;
  constructionFee: number;
  otherCost: number;
  discount: number;
  incentiveTargetType: IncentiveTargetType;
  manualValue?: number;
}

export interface GrossProfitOutput {
  purchaseTotal: number;
  dealerTotal: number;
  projectProfit: number;
  wholesaleProfit: number;
  profitRate: number;
  incentiveTargetProfit: number;
}

/**
 * Compute gross-profit figures from contract line-item snapshots and
 * cost inputs.
 *
 * Formulas (docs/05 §6.1 / F-042):
 *   purchaseTotal      = Σ(snapshotPurchasePrice × qty)
 *   dealerTotal        = Σ(snapshotDealerPrice   × qty)
 *   listTotal          = Σ(snapshotListPrice      × qty)
 *   projectProfit      = salesPrice − purchaseTotal − constructionFee − otherCost − discount
 *   wholesaleProfit    = dealerTotal − purchaseTotal
 *   profitRate         = projectProfit / salesPrice  (0 when salesPrice ≤ 0)
 *   incentiveTargetProfit:
 *     PROJECT_PROFIT  → projectProfit  (floored at 0)
 *     WHOLESALE_PROFIT → wholesaleProfit (floored at 0)
 *     MANUAL          → manualValue ?? 0
 */
export function computeGrossProfit(input: GrossProfitInput): GrossProfitOutput {
  const { items, salesPrice, constructionFee, otherCost, discount, incentiveTargetType, manualValue } =
    input;

  let purchaseTotal = 0;
  let dealerTotal = 0;

  for (const item of items) {
    purchaseTotal += item.snapshotPurchasePrice * item.qty;
    dealerTotal += item.snapshotDealerPrice * item.qty;
  }

  const projectProfit = salesPrice - purchaseTotal - constructionFee - otherCost - discount;
  const wholesaleProfit = dealerTotal - purchaseTotal;
  const profitRate = salesPrice > 0 ? projectProfit / salesPrice : 0;

  let incentiveTargetProfit: number;
  if (incentiveTargetType === "PROJECT_PROFIT") {
    incentiveTargetProfit = Math.max(0, projectProfit);
  } else if (incentiveTargetType === "WHOLESALE_PROFIT") {
    incentiveTargetProfit = Math.max(0, wholesaleProfit);
  } else {
    // MANUAL — caller supplies the explicit target
    incentiveTargetProfit = manualValue ?? 0;
  }

  return {
    purchaseTotal,
    dealerTotal,
    projectProfit,
    wholesaleProfit,
    profitRate,
    incentiveTargetProfit,
  };
}

/**
 * Compute the incentive amount from the target profit, rate, and flags.
 *
 * Floored at 0: a negative incentiveTargetProfit with a positive rate
 * should not produce a negative payout (docs/05 §6.1 F-046 note).
 */
export function computeIncentiveAmount(input: {
  incentiveTargetProfit: number;
  rate: number;
  isSelfHosted: boolean;
  isCancelled: boolean;
}): number {
  if (input.isCancelled || input.isSelfHosted) return 0;
  return Math.max(0, (input.incentiveTargetProfit * input.rate) / 100);
}

/**
 * Returns true when no Incentive record should be created for the contract
 * or when the incentive amount should be forced to zero.
 *
 * Rules (docs/05 §6.1 / F-046 / CLAUDE.md rule #7):
 *   - Self-hosted with no relationship (wholesaler's own event, no dealer)
 *   - Gross profit ≤ 0
 *   - Contract already cancelled
 */
export function shouldSkipIncentive(input: {
  isSelfHosted: boolean;
  relationshipId: string | null;
  incentiveTargetProfit: number;
  isCancelled: boolean;
}): boolean {
  if (input.isCancelled) return true;
  if (input.isSelfHosted && !input.relationshipId) return true;
  if (input.incentiveTargetProfit <= 0) return true;
  return false;
}

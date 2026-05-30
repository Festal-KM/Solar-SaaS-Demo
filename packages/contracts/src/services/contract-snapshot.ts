// Pure snapshot helpers for the contract creation flow (F-040 / F-041 / F-015,
// docs/05 §6.2, CLAUDE.md rule #4).
//
// All three functions are DB-agnostic: callers fetch the relevant rows from the
// DB (or pass test fixtures) and hand them in here. This mirrors the pattern
// established by `product-effective.ts` and `incentive-rate-effective.ts`.
//
// subtotal = qty × snapshotListPrice — the "販売価格合計" used in gross-profit
// calculation (F-041, F-042). purchasePrice and dealerPrice are captured for
// gross-profit computation but do NOT flow to dealer-facing DTOs (CLAUDE.md #5).

import type { IncentiveTargetType } from "../schemas/incentive-rate.js";
import { findEffectiveIncentiveRate } from "./incentive-rate-effective.js";

// ---------------------------------------------------------------------------
// snapshotItems
// ---------------------------------------------------------------------------

export interface SnapshotProductRow {
  productId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  productName: string;
  maker: string;
  modelNo?: string | null;
  unit: string;
  /** Stored as string to preserve Decimal precision (no float drift). */
  purchasePrice: string;
  dealerPrice: string;
  listPrice: string;
}

export interface SnapshotItemInput {
  productId: string;
  qty: number;
}

export interface SnapshotItemResult {
  productId: string;
  productName: string;
  maker: string;
  modelNo?: string | null;
  unit: string;
  qty: number;
  snapshotPurchasePrice: string;
  snapshotDealerPrice: string;
  snapshotListPrice: string;
  /** quantity × snapshotListPrice, as a fixed-point string. */
  subtotal: string;
}

/**
 * Snapshot product prices as they stood on `contractDate`.
 *
 * Effective-window semantics (closed-open, identical to F-012 / product-effective):
 *   effectiveFrom <= contractDate AND (effectiveTo is null OR contractDate < effectiveTo)
 *
 * Throws if any requested productId has no effective row on contractDate — the
 * Server Action layer must guard this with the `/api/products/active?asOf=` check
 * before calling, but we throw here as a defensive measure so callers can't
 * silently snapshot a price of 0.
 */
export function snapshotItems(
  items: readonly SnapshotItemInput[],
  contractDate: Date,
  products: readonly SnapshotProductRow[],
): SnapshotItemResult[] {
  const asOfTime = contractDate.getTime();

  // Build a map: productId → effective row at contractDate.
  const effectiveByProduct = new Map<string, SnapshotProductRow>();
  for (const p of products) {
    if (!p.isActive) continue;
    const from = p.effectiveFrom.getTime();
    if (from > asOfTime) continue;
    if (p.effectiveTo !== null && asOfTime >= p.effectiveTo.getTime()) continue;

    const current = effectiveByProduct.get(p.productId);
    // Prefer the row with the later effectiveFrom (defensive: no overlaps expected).
    if (current === undefined || from > current.effectiveFrom.getTime()) {
      effectiveByProduct.set(p.productId, p);
    }
  }

  return items.map((item) => {
    const product = effectiveByProduct.get(item.productId);
    if (product === undefined) {
      throw new Error(
        `契約日時点で有効な商品マスタが見つかりません: productId=${item.productId}`,
      );
    }

    const listPriceNum = Number(product.listPrice);
    const subtotal = (item.qty * listPriceNum).toFixed(2);

    return {
      productId: item.productId,
      productName: product.productName,
      maker: product.maker,
      modelNo: product.modelNo,
      unit: product.unit,
      qty: item.qty,
      snapshotPurchasePrice: product.purchasePrice,
      snapshotDealerPrice: product.dealerPrice,
      snapshotListPrice: product.listPrice,
      subtotal,
    };
  });
}

// ---------------------------------------------------------------------------
// snapshotIncentiveRate
// ---------------------------------------------------------------------------

export interface SnapshotIncentiveRateRow {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rate: string;
  targetType: IncentiveTargetType;
}

export interface SnapshotIncentiveRateResult {
  rate: string;
  targetType: IncentiveTargetType;
}

/**
 * Return the incentive rate that was effective at `contractDate`.
 *
 * Throws when no effective row exists — callers must handle the "rate not
 * configured" case with a warning (F-046: rate unset → 0 yen + warning).
 * Defensive tie-break: if multiple rows match, the one with the latest
 * effectiveFrom wins (mirrors `findEffectiveIncentiveRate`).
 */
export function snapshotIncentiveRate(
  contractDate: Date,
  rates: readonly SnapshotIncentiveRateRow[],
): SnapshotIncentiveRateResult {
  const best = findEffectiveIncentiveRate<SnapshotIncentiveRateRow>(rates, contractDate);

  if (best === null) {
    throw new Error(
      `契約日時点で有効なインセンティブ率が見つかりません: contractDate=${contractDate.toISOString()}`,
    );
  }

  return { rate: best.rate, targetType: best.targetType };
}

// ---------------------------------------------------------------------------
// computeCancelDeadline
// ---------------------------------------------------------------------------

const DEFAULT_CANCEL_DEADLINE_DAYS = 8;

/**
 * Compute the cancellation deadline date (F-015 / docs/02 §F-040).
 *
 * `cancelDeadline = contractDate + cancelDeadlineDays calendar days`.
 * The result is anchored to the same wall-clock time as contractDate so the
 * deadline is always a full-day boundary when dates are passed at midnight UTC.
 */
export function computeCancelDeadline(
  contractDate: Date,
  cancelDeadlineDays: number = DEFAULT_CANCEL_DEADLINE_DAYS,
): Date {
  const result = new Date(contractDate.getTime());
  result.setUTCDate(result.getUTCDate() + cancelDeadlineDays);
  return result;
}

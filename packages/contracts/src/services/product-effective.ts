// Pure helper — pick the products that are effective at a given moment.
//
// Used by `GET /api/products/active?asOf=...` (T-02-03) and by the contract
// snapshot flow in SP-05 which needs the price catalogue as it stood on the
// contract date. DB-agnostic on purpose: contracts is the place where the
// rule lives, and any caller (web, worker, tests) shares the same definition.
//
// Effective window semantics (docs/02 §F-012):
//   `effectiveFrom <= asOf` AND (`effectiveTo` is null OR `asOf < effectiveTo`)
//
// `effectiveTo` is exclusive — the row stops applying at the moment its
// successor's `effectiveFrom` begins, so an asOf equal to `effectiveTo`
// matches the NEXT row, never the previous one. This matches the way
// `reviseProductRatesAction` chains revisions back-to-back.

export interface EffectiveProduct {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
}

export interface FindEffectiveProductsOptions {
  // When true, also exclude rows whose `isActive` flag is false. Defaults to
  // true so the `/api/products/active` endpoint never leaks retired SKUs.
  excludeRetired?: boolean;
}

export function findEffectiveProducts<T extends EffectiveProduct>(
  products: readonly T[],
  asOf: Date,
  options: FindEffectiveProductsOptions = {},
): T[] {
  const excludeRetired = options.excludeRetired ?? true;
  const asOfTime = asOf.getTime();
  return products.filter((p) => {
    if (excludeRetired && !p.isActive) return false;
    const from = p.effectiveFrom.getTime();
    if (from > asOfTime) return false;
    if (p.effectiveTo === null) return true;
    return asOfTime < p.effectiveTo.getTime();
  });
}

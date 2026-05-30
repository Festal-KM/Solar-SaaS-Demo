// Product master DTO layer (T-02-04 / F-012 / docs/03 §4.3 / docs/05 §6.5).
//
// Why a DTO split exists:
//   docs/03 §4.3 forbids exposing the wholesaler's `purchasePrice` to dealer
//   callers. Stripping it inline at every API boundary is brittle (it has to
//   be re-done in every Server Action, Route Handler, and RSC payload). We
//   centralise the projection here so the rule lives in exactly one place and
//   every caller routes through `toDealerDto` / `toWholesalerDto`.
//
// `ProductForWholesalerDto` is the JSON-safe shape exposed to internal
// wholesaler roles and `saas_admin`: all monetary fields included, every
// Decimal already stringified (Prisma serialises `Decimal` as `string` by
// default — docs/03 §4.3 — so the type matches the actual wire format).
//
// `ProductForDealerDto` physically omits `purchasePrice`. We do NOT set it to
// `null` or `undefined` — the key itself must not appear on the JSON response,
// which is how the dealer-mask E2E asserts the leak path is closed.
//
// Both helpers are pure functions with no side effects. They never read env,
// never touch the DB, never log. The test suite invokes them with plain
// fixtures.

export interface ProductForWholesalerDto {
  id: string;
  category: string;
  maker: string;
  name: string;
  modelNo: string | null;
  capacity: string | null;
  unit: string;
  purchasePrice: string;
  dealerPrice: string;
  listPrice: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type ProductForDealerDto = Omit<ProductForWholesalerDto, "purchasePrice">;

/**
 * Project a wholesaler-shaped product onto the dealer-visible shape by
 * physically removing `purchasePrice` from the object. The returned object
 * has no `purchasePrice` key — `Object.keys(result).includes("purchasePrice")`
 * is `false`, which is the property the leak-prevention tests rely on.
 */
export function toDealerDto(product: ProductForWholesalerDto): ProductForDealerDto {
  // Destructure-and-rest is the only way to guarantee the key is absent from
  // the returned object (setting it to undefined would still serialise as a
  // key on some JSON paths, depending on the runtime).
  const { purchasePrice: _purchasePrice, ...rest } = product;
  return rest;
}

/**
 * Identity projection for wholesaler / saas_admin callers. Exists as a named
 * function (rather than a no-op at the call site) so the role × DTO routing
 * is symmetric and grep-friendly — every wire boundary in the codebase
 * funnels through either `toDealerDto` or `toWholesalerDto`.
 */
export function toWholesalerDto(product: ProductForWholesalerDto): ProductForWholesalerDto {
  return product;
}

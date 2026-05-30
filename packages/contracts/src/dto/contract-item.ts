// Contract-item DTO layer (T-05-07 / F-041 / docs/05 §3.6 / CLAUDE.md rule #5).
//
// `ContractItemForWholesalerDto` — full shape including snapshotPurchasePrice.
// `ContractItemForDealerDto`     — snapshotPurchasePrice physically absent.
//
// The key must not appear in the object at all (not `undefined`, not `null`) so
// that `Object.keys(result).includes("snapshotPurchasePrice")` returns false.
// This mirrors the pattern established in `packages/contracts/src/dto/product.ts`.

export interface ContractItemForWholesalerDto {
  id: string;
  contractId: string;
  productId: string;
  productName: string;
  maker: string;
  modelNo: string | null;
  qty: string;
  unit: string;
  snapshotPurchasePrice: string;
  snapshotDealerPrice: string;
  snapshotListPrice: string;
  /** qty × snapshotListPrice */
  subtotal: string;
  createdAt: string;
}

export type ContractItemForDealerDto = Omit<
  ContractItemForWholesalerDto,
  "snapshotPurchasePrice"
>;

/**
 * Full projection for wholesaler / saas_admin callers.
 * Named function so every wire boundary routes through either this or
 * `toContractItemDealerDto` — grep-friendly and symmetric.
 */
export function toContractItemWholesalerDto(
  item: ContractItemForWholesalerDto,
): ContractItemForWholesalerDto {
  return item;
}

/**
 * Dealer projection — physically removes `snapshotPurchasePrice` so the key
 * does not appear in Object.keys() output (CLAUDE.md rule #5).
 */
export function toContractItemDealerDto(
  item: ContractItemForWholesalerDto,
): ContractItemForDealerDto {
  const { snapshotPurchasePrice: _pp, ...rest } = item;
  return rest;
}

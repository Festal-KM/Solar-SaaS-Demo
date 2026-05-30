// Customer DTO layer (T-04-06 / F-031 / docs/05 §4.7 / CLAUDE.md Hard Rule #5 #6).
//
// `CustomerForWholesalerDto` — all fields including masked/unmasked PII as-is
// (masking is applied by the caller using maskPhone/maskAddress/maskName from
// the masking service with the viewer's ViewerContext).
//
// `CustomerForDealerDto` — same shape as wholesaler DTO (Customer has no
// purchasePrice), but callers MUST apply PII masking before serving.
//
// In both cases, the masking decision lives in the Server Action / Route
// Handler layer. The DTO functions themselves are pure identity projections;
// they exist so every wire boundary routes through a named function instead of
// returning the raw Prisma row.

export interface CustomerForWholesalerDto {
  id: string;
  wholesalerId: string;
  ownerRelationshipId: string | null;
  name: string;
  kana: string | null;
  phone: string;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  housingType: string | null;
  pvInstalled: boolean | null;
  batteryInstalled: boolean | null;
  electricBill: string | null;
  household: string | null;
  channel: string;
  sourceEventId: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// Dealer DTO is the same shape — Customer has no purchase-price fields to strip.
// The caller must apply PII masking (maskPhone/maskAddress/maskName) before
// serialising to the wire.
export type CustomerForDealerDto = CustomerForWholesalerDto;

type CustomerRow = {
  id: string;
  wholesalerId: string;
  ownerRelationshipId: string | null;
  name: string;
  kana: string | null;
  phone: string;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  housingType: string | null;
  pvInstalled: boolean | null;
  batteryInstalled: boolean | null;
  electricBill: string | null;
  household: string | null;
  channel: string;
  sourceEventId: string | null;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toCustomerWholesalerDto(row: CustomerRow): CustomerForWholesalerDto {
  return {
    id: row.id,
    wholesalerId: row.wholesalerId,
    ownerRelationshipId: row.ownerRelationshipId,
    name: row.name,
    kana: row.kana,
    phone: row.phone,
    email: row.email,
    postalCode: row.postalCode,
    address: row.address,
    housingType: row.housingType,
    pvInstalled: row.pvInstalled,
    batteryInstalled: row.batteryInstalled,
    electricBill: row.electricBill,
    household: row.household,
    channel: row.channel,
    sourceEventId: row.sourceEventId,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Identity — Customer carries no fields that must be physically stripped for
// dealers. Masking of PII (phone/address/name) is applied by the Server Action
// layer after calling this function, using maskPhone/maskAddress/maskName with
// the caller's ViewerContext.
export function toCustomerDealerDto(row: CustomerRow): CustomerForDealerDto {
  return toCustomerWholesalerDto(row);
}

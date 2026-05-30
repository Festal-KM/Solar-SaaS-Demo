// EventCandidate DTO layer (T-03-03 / F-018 / F-020 / docs/03 §4.3 / docs/05 §4.5).
//
// Why a DTO split exists:
//   docs/02 §F-018 受入基準 explicitly forbids exposing the wholesaler's
//   `internalNote`, `fixedFee` and `performanceRate` to dealer callers — those
//   three fields are the wholesaler's negotiated terms with the venue provider
//   and must remain wholesaler-internal (the dealer view in F-020 is restricted
//   to 場所・日にち・回答期限のみ). Stripping them inline at every API boundary
//   is brittle. We centralise the projection here so the rule lives in exactly
//   one place and every caller routes through `toDealerDto` / `toWholesalerDto`.
//
// `EventCandidateForWholesalerDto` is the JSON-safe shape exposed to internal
// wholesaler roles and `saas_admin`: all fields included, every Decimal already
// stringified (Prisma serialises `Decimal` as `string` by default — docs/03
// §4.3 — so the type matches the actual wire format).
//
// `EventCandidateForDealerDto` physically omits the three wholesaler-sensitive
// fields. We do NOT set them to `null` or `undefined` — the keys themselves
// must not appear on the JSON response, which is how the dealer-mask Vitest
// fixture asserts the leak path is closed.
//
// Function names are prefixed with `toEventCandidate*` so they don't collide
// with the equivalent product helpers (`toDealerDto` / `toWholesalerDto` in
// `dto/product.ts`) — the central re-export in `index.ts` flattens both.

import type { EventCandidateStatus } from "../schemas/event-candidate.js";

export interface EventCandidateForWholesalerDto {
  id: string;
  wholesalerId: string;
  venueProviderId: string | null;
  venueNegotiationId: string | null;
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  address: string | null;
  area: string | null;
  deadlineAt: string;
  contractType: "FIXED" | "PERFORMANCE" | "OTHER" | null;
  fixedFee: string | null;
  performanceRate: string | null;
  internalNote: string | null;
  contractNote: string | null;
  status: EventCandidateStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EventCandidateForDealerDto = Omit<
  EventCandidateForWholesalerDto,
  "fixedFee" | "performanceRate" | "internalNote" | "contractNote"
>;

/**
 * Project a wholesaler-shaped event candidate onto the dealer-visible shape by
 * physically removing the wholesaler-only fields from the object. The returned
 * object has no `fixedFee` / `performanceRate` / `internalNote` keys —
 * `Object.keys(result).includes("internalNote") === false` is the property the
 * leak-prevention tests rely on.
 */
export function toEventCandidateDealerDto(
  candidate: EventCandidateForWholesalerDto,
): EventCandidateForDealerDto {
  // Destructure-and-rest is the only way to guarantee the keys are absent from
  // the returned object (setting them to undefined would still serialise as
  // keys on some JSON paths, depending on the runtime).
  const {
    fixedFee: _fixedFee,
    performanceRate: _performanceRate,
    internalNote: _internalNote,
    contractNote: _contractNote,
    ...rest
  } = candidate;
  return rest;
}

/**
 * Identity projection for wholesaler / saas_admin callers. Exists as a named
 * function (rather than a no-op at the call site) so the role × DTO routing is
 * symmetric and grep-friendly — every wire boundary funnels through either
 * `toEventCandidateDealerDto` or `toEventCandidateWholesalerDto`.
 */
export function toEventCandidateWholesalerDto(
  candidate: EventCandidateForWholesalerDto,
): EventCandidateForWholesalerDto {
  return candidate;
}

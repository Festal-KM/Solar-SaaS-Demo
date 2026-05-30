// Pure helper — resolve the effective DealerScope for a given EventDealer +
// Relationship pair (T-03-09 / F-024 / docs/05 §6.4).
//
// Rule: eventDealer.scopeOverride (non-null) takes precedence over
//       relationship.defaultScope.
//
// This function is DB-agnostic so it can be called from the web layer, the
// worker, and unit tests without any Prisma dependency. The caller is
// responsible for loading the correct rows first.
//
// Usage in SP-05 (deal actions):
//   const scope = resolveScope(eventDealer, relationship);
//   const canClose = scope === 'FULL_CLOSING';

export type DealerScope = "APPOINTMENT_ONLY" | "FIRST_VISIT" | "FULL_CLOSING";

export interface EventDealerScopeInput {
  scopeOverride: DealerScope | null;
}

export interface RelationshipScopeInput {
  defaultScope: DealerScope;
}

/**
 * Returns the effective DealerScope for an EventDealer.
 *
 * - When `eventDealer.scopeOverride` is non-null it is returned as-is.
 * - When null, falls back to `relationship.defaultScope`.
 */
export function resolveScope(
  eventDealer: EventDealerScopeInput,
  relationship: RelationshipScopeInput,
): DealerScope {
  return eventDealer.scopeOverride ?? relationship.defaultScope;
}

/**
 * Pure authorization gate for deal actions (F-024 / F-038 / docs/05 §6.4).
 *
 * Scope semantics:
 *   APPOINTMENT_ONLY  — dealer may only acquire appointments; no visit/pitch/close
 *   FIRST_VISIT       — dealer may perform the initial visit; no pitch or close
 *   FULL_CLOSING      — dealer may visit, pitch, and close
 */
export function canDealerCloseDeal(
  scope: DealerScope,
  action: "visit" | "pitch" | "close",
): boolean {
  switch (scope) {
    case "APPOINTMENT_ONLY":
      return false;
    case "FIRST_VISIT":
      return action === "visit";
    case "FULL_CLOSING":
      return true;
  }
}

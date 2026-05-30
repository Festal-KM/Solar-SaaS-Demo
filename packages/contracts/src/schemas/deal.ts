// Zod schemas for Deal create / update / changeStatus (T-05-03 / F-038 /
// docs/05 §3.6 §4.8).
//
// DealStatus transition table (docs/02 §F-038):
//   VISIT_PLANNED → VISITED, LOST
//   VISITED       → PROPOSING, LOST
//   PROPOSING     → QUOTED, LOST
//   QUOTED        → CONSIDERING, LOST
//   CONSIDERING   → LIKELY_CONTRACT, LOST
//   LIKELY_CONTRACT → CONTRACTED, LOST
//   CONTRACTED    → (terminal)
//   LOST          → (terminal)
//
// Scope-based authorisation (docs/05 §6.4):
//   APPOINTMENT_ONLY  — may not create/update a Deal (403 in action layer)
//   FIRST_VISIT       — may only advance to VISITED; pitch/close (PROPOSING→)
//                       are forbidden (403)
//   FULL_CLOSING      — all transitions allowed

import { z } from "zod";

export const DealStatusEnum = z.enum([
  "VISIT_PLANNED",
  "VISITED",
  "PROPOSING",
  "QUOTED",
  "CONSIDERING",
  "LIKELY_CONTRACT",
  "CONTRACTED",
  "LOST",
]);

export type DealStatus = z.infer<typeof DealStatusEnum>;

// Allowed transitions: source → Set<target>
export const DEAL_ALLOWED_TRANSITIONS: Record<DealStatus, ReadonlySet<DealStatus>> = {
  VISIT_PLANNED: new Set<DealStatus>(["VISITED", "LOST"]),
  VISITED: new Set<DealStatus>(["PROPOSING", "LOST"]),
  PROPOSING: new Set<DealStatus>(["QUOTED", "LOST"]),
  QUOTED: new Set<DealStatus>(["CONSIDERING", "LOST"]),
  CONSIDERING: new Set<DealStatus>(["LIKELY_CONTRACT", "LOST"]),
  LIKELY_CONTRACT: new Set<DealStatus>(["CONTRACTED", "LOST"]),
  CONTRACTED: new Set<DealStatus>(),
  LOST: new Set<DealStatus>(),
};

export const DEAL_TERMINAL_STATUSES: ReadonlySet<DealStatus> = new Set<DealStatus>([
  "CONTRACTED",
  "LOST",
]);

export function isDealStatusTransitionValid(from: DealStatus, to: DealStatus): boolean {
  return DEAL_ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

// Which action (in canDealerCloseDeal terms) a given target status requires.
// Used to enforce dealer scope limits at action layer.
export function dealStatusToScopeAction(
  to: DealStatus,
): "visit" | "pitch" | "close" | null {
  if (to === "VISITED") return "visit";
  if (to === "PROPOSING" || to === "QUOTED" || to === "CONSIDERING" || to === "LIKELY_CONTRACT")
    return "pitch";
  if (to === "CONTRACTED") return "close";
  return null; // LOST — allowed regardless of scope
}

export const DealCreateSchema = z.object({
  customerId: z.string().min(1, "顧客 ID が必要です"),
  appointmentId: z.string().optional(),
  assignedToUserId: z.string().min(1, "担当者 ID が必要です"),
  // ownerRelationshipId — for dealer callers this is injected from ctx in the
  // action; wholesaler callers may supply it or leave null.
  ownerRelationshipId: z.string().optional(),
  notes: z.string().max(5000).optional(),
});

export type DealCreateInput = z.infer<typeof DealCreateSchema>;

export const DealUpdateSchema = z.object({
  id: z.string().min(1, "商談 ID が必要です"),
  assignedToUserId: z.string().optional(),
  proposedProduct: z.string().max(500).optional(),
  proposedAmount: z.number().nonnegative().optional(),
  expectedProfit: z.number().optional(),
  expectedContractDate: z.string().datetime().optional(),
  lostReason: z.string().max(2000).optional(),
  nextAction: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

export type DealUpdateInput = z.infer<typeof DealUpdateSchema>;

export const DealChangeStatusSchema = z.object({
  id: z.string().min(1, "商談 ID が必要です"),
  status: DealStatusEnum,
  notes: z.string().max(2000).optional(),
});

export type DealChangeStatusInput = z.infer<typeof DealChangeStatusSchema>;

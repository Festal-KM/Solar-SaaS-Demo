// Zod schemas for the venue-negotiation workflow (F-017 / docs/05 §4.5).
//
// VenueNegotiation lifecycle (state machine enforced application-side):
//   CONTACTING       → CONDITION_REVIEW / INFEASIBLE / CANCELLED
//   CONDITION_REVIEW → FEASIBLE / INFEASIBLE / CANCELLED
//   FEASIBLE         → FIXED / INFEASIBLE / CANCELLED
//   FIXED            → CANCELLED only
//   INFEASIBLE       → (terminal)
//   CANCELLED        → (terminal)
//
// (`NOT_CONTACTED` is the default for legacy rows but the new flow starts at
// `CONTACTING`; transitions out of `NOT_CONTACTED` reuse the `CONTACTING` rule.)
//
// `promoteToCandidate` is only allowed when the negotiation is in `FIXED`. The
// transition creates a sibling `EventCandidate` row inside the same `withTenant`
// transaction (see actions.ts).

import { z } from "zod";

import { VenueContractTypeSchema } from "./venue-provider.js";

// Reuse the canonical 7-state enum (matches Prisma `VenueNegotiationStatus`).
export const VenueNegotiationStatusSchema = z.enum([
  "NOT_CONTACTED",
  "CONTACTING",
  "CONDITION_REVIEW",
  "FEASIBLE",
  "INFEASIBLE",
  "FIXED",
  "CANCELLED",
]);
export type VenueNegotiationStatus = z.infer<typeof VenueNegotiationStatusSchema>;

// Subset accepted by the Server Action — `NOT_CONTACTED` is reserved for the
// initial default and is not a target state for explicit `changeStatus` calls.
export const VenueNegotiationStatusTargetSchema = z.enum([
  "CONTACTING",
  "CONDITION_REVIEW",
  "FEASIBLE",
  "INFEASIBLE",
  "FIXED",
  "CANCELLED",
]);
export type VenueNegotiationStatusTarget = z.infer<typeof VenueNegotiationStatusTargetSchema>;

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: "数値を入力してください" });

const optionalNonEmpty = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

// ISO yyyy-mm-dd. Accept either a Date or a string the runtime can parse, then
// normalise to a `Date` at the Date boundary. The schema accepts both shapes
// so the form (which posts strings) and direct callers (which already hold
// `Date`s) share one entry point.
const dateLike = z.union([z.string(), z.date()]).transform((v, ctx) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "日付の形式が正しくありません" });
    return z.NEVER;
  }
  return d;
});

const candidateDates = z
  .array(dateLike)
  .min(1, "候補日を 1 件以上入力してください")
  .max(20, "候補日は 20 件までです");

const baseShape = {
  venueProviderId: z.string().min(1, "場所提供元を選択してください"),
  candidateDates,
  contractType: VenueContractTypeSchema.optional(),
  fixedFee: decimalString.optional(),
  performanceRate: decimalString
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, "0〜100 の範囲で入力してください")
    .optional(),
  conditionNote: z.string().trim().max(2000).optional(),
  nextAction: optionalNonEmpty,
  assigneeId: optionalNonEmpty,
  note: z.string().trim().max(2000).optional(),
};

export const VenueNegotiationInputSchema = z.object(baseShape);
export type VenueNegotiationInput = z.infer<typeof VenueNegotiationInputSchema>;

// Every field optional on update. Callers pass only the keys they changed; the
// action writes `?? existing` to keep partial-patch semantics.
export const VenueNegotiationUpdateSchema = z.object({
  venueProviderId: baseShape.venueProviderId.optional(),
  candidateDates: candidateDates.optional(),
  contractType: baseShape.contractType,
  fixedFee: baseShape.fixedFee,
  performanceRate: baseShape.performanceRate,
  conditionNote: baseShape.conditionNote,
  nextAction: baseShape.nextAction,
  assigneeId: baseShape.assigneeId,
  note: baseShape.note,
});
export type VenueNegotiationUpdate = z.infer<typeof VenueNegotiationUpdateSchema>;

export const VenueNegotiationStatusChangeSchema = z.object({
  status: VenueNegotiationStatusTargetSchema,
  reason: z.string().trim().max(2000).optional(),
});
export type VenueNegotiationStatusChange = z.infer<typeof VenueNegotiationStatusChangeSchema>;

// Promotion payload — used when status is FIXED and the operator clicks
// "イベント候補に昇格". `targetMonth` is a YYYY-MM string so the unique-month
// groupby on EventCandidate stays trivial (docs/05 §3.4).
export const VenueNegotiationPromoteSchema = z.object({
  targetMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象年月は YYYY-MM 形式で入力してください"),
  scheduledDate: dateLike,
  storeName: z.string().trim().min(1, "店舗名を入力してください").max(255),
  address: optionalNonEmpty,
  area: optionalNonEmpty,
  deadlineAt: dateLike,
});
export type VenueNegotiationPromote = z.infer<typeof VenueNegotiationPromoteSchema>;

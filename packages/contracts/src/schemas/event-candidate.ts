// Zod schemas for the event-candidate workflow (T-03-03 / F-018 / docs/05 §4.5).
//
// Schema-side responsibilities:
//   - Validate payload shape (required fields, format, value ranges).
//   - Expose the canonical state enum (mirrors Prisma `EventCandidateStatus`).
//
// The state machine itself is enforced application-side in actions.ts (the
// transition table lives there, not in Zod, because the from-state is read
// from the DB row — Zod only sees the inbound target state).
//
// EventCandidate lifecycle (from docs/05 §4.5 and the task brief):
//
//   DRAFT     → OPEN  / CANCELLED                                   (publish / cancel)
//   OPEN      → CLOSED / CANCELLED                                  (close preference / cancel)
//   CLOSED    → DECIDED / OPEN (期限延長で再受付) / CANCELLED       (decide / re-open / cancel)
//   DECIDED   → CANCELLED only                                      (cancel decided event)
//   CANCELLED → (terminal — no outgoing transitions)
//
// The Prisma enum spells the middle states as `OPEN` and `CLOSED` (see
// `packages/db/prisma/schema.prisma` and the T-03-01 migration); the task
// brief's `OPEN_FOR_PREFERENCE` / `PREFERENCE_CLOSED` are semantic aliases
// for those same DB values and we keep the DB spelling on the wire.

import { z } from "zod";

import { VenueContractTypeSchema } from "./venue-provider.js";

export const EventCandidateStatusSchema = z.enum([
  "DRAFT",
  "OPEN",
  "CLOSED",
  "DECIDED",
  "CANCELLED",
]);
export type EventCandidateStatus = z.infer<typeof EventCandidateStatusSchema>;

// Subset accepted by changeStatus-style actions. DRAFT is the initial default
// and is not a valid target — DRAFT is reached by `create`, never by transit.
export const EventCandidateStatusTargetSchema = z.enum(["OPEN", "CLOSED", "DECIDED", "CANCELLED"]);
export type EventCandidateStatusTarget = z.infer<typeof EventCandidateStatusTargetSchema>;

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

// Accept either a Date or a string the runtime can parse and normalise to
// `Date` at the boundary so callers can post either shape.
const dateLike = z.union([z.string(), z.date()]).transform((v, ctx) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "日付の形式が正しくありません" });
    return z.NEVER;
  }
  return d;
});

const targetMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象年月は YYYY-MM 形式で入力してください");

const performanceRate = decimalString
  .refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, "0〜100 の範囲で入力してください")
  .optional();

const baseShape = {
  venueProviderId: optionalNonEmpty,
  venueNegotiationId: optionalNonEmpty,
  targetMonth,
  scheduledDate: dateLike,
  storeName: z.string().trim().min(1, "店舗名を入力してください").max(255),
  address: optionalNonEmpty,
  area: optionalNonEmpty,
  deadlineAt: dateLike,
  contractType: VenueContractTypeSchema.optional(),
  fixedFee: decimalString.optional(),
  performanceRate,
  internalNote: z.string().trim().max(2000).optional(),
  // 契約条件メモ — 契約形態に依らず任意で残す自由記述。internalNote とは別欄
  // （internalNote は廃止方向の旧フィールド、contractNote はフォーム新仕様）。
  contractNote: z.string().trim().max(2000).optional(),
  // 作成時の初期ステータス指定。未指定なら Server Action 側で DRAFT。
  // OPEN/CLOSED は publish/close フローを経るべき中間状態なので、ここで来ても
  // Server Action 側で DRAFT にフォールバックする（Zod は値の検証のみ）。
  status: EventCandidateStatusSchema.optional(),
};

export const EventCandidateInputSchema = z.object(baseShape);
export type EventCandidateInput = z.infer<typeof EventCandidateInputSchema>;

// All fields optional on update — callers patch only the keys they changed.
// The action layer additionally restricts WHICH keys are accepted depending on
// the current status (DRAFT allows full edit; OPEN/CLOSED restrict to a
// curated set such as `deadlineAt` / `internalNote`).
export const EventCandidateUpdateSchema = z.object({
  venueProviderId: baseShape.venueProviderId,
  venueNegotiationId: baseShape.venueNegotiationId,
  targetMonth: targetMonth.optional(),
  scheduledDate: dateLike.optional(),
  storeName: baseShape.storeName.optional(),
  address: baseShape.address,
  area: baseShape.area,
  deadlineAt: dateLike.optional(),
  contractType: baseShape.contractType,
  fixedFee: baseShape.fixedFee,
  performanceRate: baseShape.performanceRate,
  internalNote: baseShape.internalNote,
  contractNote: baseShape.contractNote,
});
export type EventCandidateUpdate = z.infer<typeof EventCandidateUpdateSchema>;

// Fields allowed to be patched once the candidate has left DRAFT. After
// publication the venue / date / store identity is fixed (二次店が既に希望を
// 出している可能性があるため動かさない)。回答期限 (deadlineAt) と内部メモ
// (internalNote) のみ運用上の調整として許容する。
export const EVENT_CANDIDATE_NON_DRAFT_EDITABLE_FIELDS = ["deadlineAt", "internalNote"] as const;
export type EventCandidateNonDraftEditableField =
  (typeof EVENT_CANDIDATE_NON_DRAFT_EDITABLE_FIELDS)[number];

export const EventCandidateStatusChangeSchema = z.object({
  status: EventCandidateStatusTargetSchema,
  reason: z.string().trim().max(2000).optional(),
});
export type EventCandidateStatusChange = z.infer<typeof EventCandidateStatusChangeSchema>;

// T-03-04 / F-019 — 公開トグル (二次店共有設定).
//
// `isVisible=true` で「対象 relationshipIds に対して公開」、`false` で「公開取消」。
// relationshipIds が自テナント (wholesalerId) 配下の Relationship かどうかは
// Server Action 側で DB と突き合わせて検証する（Zod は形だけ）。
//
// 1 リクエストで複数 relationshipId を同時にトグルできる。フロントは
// チェックボックス一括選択で「公開する」「公開取消」を発火する想定。
export const EventCandidateVisibilityUpdateSchema = z.object({
  eventCandidateId: z.string().min(1, "イベント候補 ID が必要です"),
  relationshipIds: z.array(z.string().min(1)).min(1, "対象の二次店を 1 件以上選択してください"),
  isVisible: z.boolean(),
});
export type EventCandidateVisibilityUpdate = z.infer<typeof EventCandidateVisibilityUpdateSchema>;

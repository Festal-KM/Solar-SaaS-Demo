// Zod schemas for the event-decision workflow (T-03-08 / F-023 / docs/05 §4.5).
//
// `EventDecisionSchema` is the main input for `eventDecision.decide` SA.
// Validation is mode-dependent; superRefine enforces the mode-specific rules
// so the schema alone rejects ill-formed payloads before the action layer
// does any DB work.
//
// Mode rules:
//   SELF      — requiredPeople >= 1  (no dealers involved)
//   DEALER    — dealerRelationshipIds.length >= 1  (pure dealer event)
//   JOINT     — both requiredPeople >= 1 AND dealerRelationshipIds.length >= 1
//   CANCELLED — reason required  (Event is NOT created; EventCandidate.status → CANCELLED)

import { z } from "zod";

export const EventModeSchema = z.enum(["SELF", "DEALER", "JOINT", "CANCELLED"]);
export type EventMode = z.infer<typeof EventModeSchema>;

export const EventDecisionSchema = z
  .object({
    eventCandidateId: z.string().min(1, "イベント候補 ID が必要です"),
    mode: EventModeSchema,
    requiredPeople: z.number().int().positive().optional(),
    dealerRelationshipIds: z.array(z.string().min(1)).optional(),
    reason: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "SELF" || val.mode === "JOINT") {
      if (!val.requiredPeople || val.requiredPeople < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requiredPeople"],
          message: "自社開催・共同開催では必要人数（1以上）が必要です",
        });
      }
    }
    if (val.mode === "DEALER" || val.mode === "JOINT") {
      if (!val.dealerRelationshipIds || val.dealerRelationshipIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dealerRelationshipIds"],
          message: "二次店開催・共同開催では担当二次店を 1 件以上選択してください",
        });
      }
    }
    if (val.mode === "CANCELLED") {
      if (!val.reason || val.reason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reason"],
          message: "中止の場合は理由を入力してください",
        });
      }
    }
  });

export type EventDecisionInput = z.infer<typeof EventDecisionSchema>;

// Schema for changing an already-decided event's mode (changeMode action).
// The eventId refers to the Event row (not EventCandidate).
export const EventModeChangeSchema = z
  .object({
    eventId: z.string().min(1, "イベント ID が必要です"),
    mode: EventModeSchema,
    requiredPeople: z.number().int().positive().optional(),
    dealerRelationshipIds: z.array(z.string().min(1)).optional(),
    reason: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "SELF" || val.mode === "JOINT") {
      if (!val.requiredPeople || val.requiredPeople < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requiredPeople"],
          message: "自社開催・共同開催では必要人数（1以上）が必要です",
        });
      }
    }
    if (val.mode === "DEALER" || val.mode === "JOINT") {
      if (!val.dealerRelationshipIds || val.dealerRelationshipIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dealerRelationshipIds"],
          message: "二次店開催・共同開催では担当二次店を 1 件以上選択してください",
        });
      }
    }
  });

export type EventModeChangeInput = z.infer<typeof EventModeChangeSchema>;

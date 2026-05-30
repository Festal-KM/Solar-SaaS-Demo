// Zod schemas for EventReport start / end actions (T-04-03 / F-028 / F-029 /
// docs/05 §4.6).
//
// reporterOrgType is derived from ctx in the action layer (WHOLESALER when ctx
// has wholesalerId, DEALER when ctx has dealerId). It is NOT accepted from
// client input to prevent spoofing.
//
// attachments: JSON array of R2 object keys. Upload itself is done separately
// via /api/files/presign. The keys are persisted in EventReport.payload.
// Full attachment upload UI is a future task; for now the schema accepts an
// optional string array and stores it in the payload.

import { z } from "zod";

// ── EventReportResultSchema ──────────────────────────────────────────────────
//
// T-04-04 / F-030 / docs/05 §4.6
//
// eventId is required; relationshipId is optional and is derived from ctx in
// the action layer (DEALER path) — it is accepted here only when the dealer
// action embeds it for disambiguation in shared-event scenarios.
//
// superRefine: validAppts + invalidAppts must not exceed totalAppts.

const nonNegativeInt = z.number().int("整数で入力してください").min(0, "0 以上の値を入力してください");

export const EventReportResultSchema = z.object({
  eventId: z.string().min(1, "イベント ID が必要です"),
  approachCount: nonNegativeInt,
  surveyCount: nonNegativeInt,
  totalAppts: nonNegativeInt,
  validAppts: nonNegativeInt,
  invalidAppts: nonNegativeInt,
  comment: z.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.validAppts + data.invalidAppts > data.totalAppts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validAppts"],
      message: "有効アポ数 + 無効アポ数 はアポ取得数以下にしてください",
    });
  }
});

export type EventReportResultInput = z.infer<typeof EventReportResultSchema>;

// ── EventReportStartSchema ───────────────────────────────────────────────────

export const EventReportStartSchema = z.object({
  eventId: z.string().min(1, "イベント ID が必要です"),
  comment: z.string().max(1000).optional(),
  attachments: z.array(z.string().min(1)).max(5).optional(),
});

export type EventReportStartInput = z.infer<typeof EventReportStartSchema>;

export const EventReportEndSchema = z.object({
  eventId: z.string().min(1, "イベント ID が必要です"),
  comment: z.string().max(1000).optional(),
  attachments: z.array(z.string().min(1)).max(5).optional(),
});

export type EventReportEndInput = z.infer<typeof EventReportEndSchema>;

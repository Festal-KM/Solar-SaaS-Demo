// Zod schemas for pre-call (マエカク) record input (T-04-09 / F-035 /
// docs/05 §3.5 §4.7).
//
// PreCallResult values mirror the Prisma enum:
//   APPROVED    — 訪問確認済み → Appointment.status = PRE_CALL_DONE
//   ABSENT      — 不在 (status unchanged)
//   CALLBACK    — 折り返し依頼 (status unchanged)
//   CANCELLED   — キャンセル → Appointment.status = CANCELLED
//   RESCHEDULED — 日程変更 → Appointment.status = RESCHEDULED + scheduledAt update
//
// `rescheduledAt` is required when result === RESCHEDULED.

import { z } from "zod";

export const PreCallResultEnum = z.enum([
  "APPROVED",
  "ABSENT",
  "CALLBACK",
  "CANCELLED",
  "RESCHEDULED",
]);

export type PreCallResult = z.infer<typeof PreCallResultEnum>;

export const PreCallRecordSchema = z
  .object({
    appointmentId: z.string().min(1, "アポ ID が必要です"),
    result: PreCallResultEnum,
    notes: z.string().max(2000).optional(),
    rescheduledAt: z
      .string()
      .datetime({ message: "日程変更日時は ISO 8601 形式で入力してください" })
      .optional(),
  })
  .refine(
    (val) => {
      if (val.result === "RESCHEDULED" && !val.rescheduledAt) return false;
      return true;
    },
    {
      message: "日程変更の場合は新しい訪問予定日時を入力してください",
      path: ["rescheduledAt"],
    },
  );

export type PreCallRecordInput = z.input<typeof PreCallRecordSchema>;

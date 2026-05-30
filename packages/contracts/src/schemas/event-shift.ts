// Zod schemas for EventShift CRUD (T-03-10 / F-025 / docs/05 §4.6 §6.3).
//
// `ShiftAssignSchema`   — create a new EventShift row.
// `ShiftUpdateSchema`   — update role / time of an existing shift.
// `ShiftUnassignSchema` — delete (unassign) an existing shift.
//
// Overlap detection is done in the action layer (findFirst before insert);
// the DB `@@unique([userId, startPlanned])` is the final guard.

import { z } from "zod";

export const ShiftRoleSchema = z.enum(["LEAD", "CATCH", "RECEPTION", "PITCH", "OTHER"]);
export type ShiftRole = z.infer<typeof ShiftRoleSchema>;

export const ShiftAssignSchema = z
  .object({
    eventId: z.string().min(1, "イベント ID が必要です"),
    userId: z.string().min(1, "担当者を選択してください"),
    role: ShiftRoleSchema,
    startPlanned: z.string().datetime({ message: "開始時刻は ISO 8601 形式で入力してください" }),
    endPlanned: z.string().datetime({ message: "終了時刻は ISO 8601 形式で入力してください" }),
  })
  .superRefine((val, ctx) => {
    if (val.startPlanned >= val.endPlanned) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endPlanned"],
        message: "終了時刻は開始時刻より後にしてください",
      });
    }
  });

export type ShiftAssignInput = z.infer<typeof ShiftAssignSchema>;

export const ShiftUpdateSchema = z
  .object({
    shiftId: z.string().min(1, "シフト ID が必要です"),
    role: ShiftRoleSchema.optional(),
    startPlanned: z
      .string()
      .datetime({ message: "開始時刻は ISO 8601 形式で入力してください" })
      .optional(),
    endPlanned: z
      .string()
      .datetime({ message: "終了時刻は ISO 8601 形式で入力してください" })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startPlanned !== undefined && val.endPlanned !== undefined) {
      if (val.startPlanned >= val.endPlanned) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endPlanned"],
          message: "終了時刻は開始時刻より後にしてください",
        });
      }
    }
  });

export type ShiftUpdateInput = z.infer<typeof ShiftUpdateSchema>;

export const ShiftUnassignSchema = z.object({
  shiftId: z.string().min(1, "シフト ID が必要です"),
});

export type ShiftUnassignInput = z.infer<typeof ShiftUnassignSchema>;

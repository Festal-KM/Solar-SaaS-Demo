// Zod schemas for subsidy application management (F-045 / docs/05 §3.6 / T-05-11).
//
// ApplicationStatus (from DB):
//   DRAFT → SUBMITTED → APPROVED | REJECTED
//   Any non-APPROVED status → CANCELLED
//
// APPROVED requires confirmedAmount to be set.

import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください");

export const VALID_APPLICATION_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: ["SUBMITTED"],
  CANCELLED: [],
};

export const ApplicationCreateSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  type: z.string().min(1, "申請種別が必要です").max(100),
  agency: z.string().max(200).optional(),
  plannedDate: z.string().optional(),
  estimatedAmount: decimalString.optional(),
  note: z.string().max(2000).optional(),
});
export type ApplicationCreateInput = z.infer<typeof ApplicationCreateSchema>;

export const ApplicationUpdateSchema = z
  .object({
    id: z.string().min(1, "申請 ID が必要です"),
    type: z.string().min(1).max(100).optional(),
    agency: z.string().max(200).optional().nullable(),
    plannedDate: z.string().optional().nullable(),
    submittedDate: z.string().optional().nullable(),
    approvedDate: z.string().optional().nullable(),
    estimatedAmount: decimalString.optional().nullable(),
    confirmedAmount: decimalString.optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
  })
export type ApplicationUpdateInput = z.infer<typeof ApplicationUpdateSchema>;

export const ApplicationChangeStatusSchema = z
  .object({
    id: z.string().min(1, "申請 ID が必要です"),
    status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"]),
    confirmedAmount: decimalString.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === "APPROVED" && !val.confirmedAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "承認時は補助金確定額が必要です",
        path: ["confirmedAmount"],
      });
    }
  });
export type ApplicationChangeStatusInput = z.infer<typeof ApplicationChangeStatusSchema>;

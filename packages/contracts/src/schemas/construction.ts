// Zod schemas for construction management (F-044 / docs/05 §3.6 / T-05-10).
//
// ConstructionStatus transition rules (docs/02 §F-044):
//   REQUEST_PENDING → REQUESTED → SURVEYED → CONSTRUCTING → DONE | PAUSED
//   PAUSED → CONSTRUCTING (resume)
//
// Cost field is a Decimal string matching /^\d+(\.\d{1,2})?$/ default "0".

import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
  .default("0");

export const VALID_CONSTRUCTION_TRANSITIONS: Record<string, string[]> = {
  REQUEST_PENDING: ["REQUESTED"],
  REQUESTED: ["SURVEYED", "PAUSED"],
  SURVEYED: ["CONSTRUCTING", "PAUSED"],
  CONSTRUCTING: ["DONE", "PAUSED"],
  DONE: [],
  PAUSED: ["CONSTRUCTING"],
};

export const ConstructionCreateSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  installerId: z.string().min(1).optional(),
  fee: decimalString,
  surveyDate: z.string().optional(),
  plannedDate: z.string().optional(),
  note: z.string().max(2000).optional(),
});
export type ConstructionCreateInput = z.infer<typeof ConstructionCreateSchema>;

export const ConstructionUpdateSchema = z.object({
  id: z.string().min(1, "施工 ID が必要です"),
  installerId: z.string().min(1).optional().nullable(),
  fee: decimalString.optional(),
  surveyDate: z.string().optional().nullable(),
  plannedDate: z.string().optional().nullable(),
  completedDate: z.string().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
export type ConstructionUpdateInput = z.infer<typeof ConstructionUpdateSchema>;

export const ConstructionChangeStatusSchema = z.object({
  id: z.string().min(1, "施工 ID が必要です"),
  status: z.enum(["REQUEST_PENDING", "REQUESTED", "SURVEYED", "CONSTRUCTING", "DONE", "PAUSED"]),
});
export type ConstructionChangeStatusInput = z.infer<typeof ConstructionChangeStatusSchema>;

// Zod schemas for the line-event workflow (F-059 / docs/05 §4.5b).
//
// ラインイベント = 懇意の場所提供元と月単位で複数開催日を契約するイベント。
// 単発の EventCandidate と異なり、1 行が「対象月内の複数開催日」を保持する
// (`scheduledDates` = 'YYYY-MM-DD' 配列)。本スキーマは payload の形だけを検証し、
// status マッピング (確認中/確定/中止 → DRAFT/CONFIRMED/CANCELLED) はフォーム側で行う。
//
// decimalString / optionalNonEmpty のヘルパーは event-candidate.ts と同じ書き方。

import { z } from "zod";

import { VenueContractTypeSchema } from "./venue-provider.js";

export const LineEventStatusSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);
export type LineEventStatus = z.infer<typeof LineEventStatusSchema>;

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

const performanceRate = decimalString
  .refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, "0〜100 の範囲で入力してください")
  .optional();

export const LineAssignModeSchema = z.enum(["SELF", "DEALER", "JOINT"]);
export type LineAssignMode = z.infer<typeof LineAssignModeSchema>;

export const LineAssignStatusSchema = z.enum(["CONFIRMED", "ADJUSTING"]);
export type LineAssignStatus = z.infer<typeof LineAssignStatusSchema>;

export const LineEventInputSchema = z.object({
  venueProviderId: optionalNonEmpty,
  name: z.string().trim().min(1, "場所名を選択してください").max(255),
  targetMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象月は YYYY-MM 形式で入力してください"),
  area: optionalNonEmpty,
  address: optionalNonEmpty,
  scheduledDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "開催日は YYYY-MM-DD 形式で入力してください"))
    .min(1, "開催日を 1 日以上選択してください"),
  contractType: VenueContractTypeSchema.optional(),
  fixedFee: decimalString.optional(),
  performanceRate,
  contractNote: z.string().trim().max(2000).optional(),
  status: LineEventStatusSchema.optional(),
  assignMode: LineAssignModeSchema.optional(),
  assignStatus: LineAssignStatusSchema.optional(),
  assignStaffIds: z.array(z.string()).optional(),
  assignDealerIds: z.array(z.string()).optional(),
  assignNote: z.string().trim().max(2000).optional(),
});
export type LineEventInput = z.infer<typeof LineEventInputSchema>;

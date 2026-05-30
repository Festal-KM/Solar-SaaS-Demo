// Zod schema for joint-incentive manual distribution (T-06-03 / F-047 / docs/05 §4.8 §6.1).
//
// IncentiveAdjustJointSchema is consumed by adjustJointIncentiveAction (Server Action)
// and shared with the UI form.

import { z } from "zod";

export const JointDistributionSchema = z.object({
  relationshipId: z.string().min(1, "関係 ID が必要です"),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください"),
  reason: z.string().min(1, "調整理由を入力してください").max(1000),
});

export type JointDistribution = z.infer<typeof JointDistributionSchema>;

export const IncentiveAdjustJointSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  distributions: z
    .array(JointDistributionSchema)
    .min(1, "分配先を 1 件以上入力してください"),
});

export type IncentiveAdjustJointInput = z.infer<typeof IncentiveAdjustJointSchema>;

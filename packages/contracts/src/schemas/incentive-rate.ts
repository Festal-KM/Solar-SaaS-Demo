// Zod schemas for the incentive-rate master (F-014 / docs/05 §3.3 / T-02-06).
//
// インセンティブ率は「関係 (Relationship = 卸業者 × 二次店)」単位で時系列管理する。
// `IncentiveTargetType` は Prisma enum と一致（PROJECT_PROFIT / WHOLESALE_PROFIT /
// MANUAL）。`rate` は %（0..100）、`Decimal(5,2)` を文字列で受ける。
//
// 二つのスキーマ:
//   - `IncentiveRateInputSchema`  : create 用。relationshipId / targetType /
//                                   rate / effectiveFrom / effectiveTo? / note?
//   - `IncentiveRateUpdateSchema` : edit 用。targetType / effectiveFrom は
//                                   immutable（時系列の整合性を壊さないため）。
//                                   rate / effectiveTo / note のみ変更可能。
//
// 「同一 relationship 内で重複期間禁止」は Server Action 層（既存 open row を
// 新 effectiveFrom で締める）で担保するため、ここではスキーマレベルの追加チェックは
// 入れない。

import { z } from "zod";

export const IncentiveTargetTypeSchema = z.enum(["PROJECT_PROFIT", "WHOLESALE_PROFIT", "MANUAL"]);
export type IncentiveTargetType = z.infer<typeof IncentiveTargetTypeSchema>;

// `Decimal(5,2)` for %; accept numeric / string, normalise to string. Range
// [0, 100] (rate as percent, schema mirrors docs/05 §3.3).
const rateString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: "数値を入力してください" })
  .refine(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: "0〜100 の範囲で入力してください" },
  );

const dateLike = z
  .union([z.date(), z.string().datetime({ offset: true }), z.string().date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)));

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const baseFields = {
  relationshipId: z.string().trim().min(1, "関係を選択してください"),
  targetType: IncentiveTargetTypeSchema,
  rate: rateString,
  effectiveFrom: dateLike,
  effectiveTo: dateLike.optional(),
  note: optionalNote,
};

// `effectiveFrom < effectiveTo`（effectiveTo non-null のとき）。DB CHECK 制約と
// 同じ条件をクライアント側でも先に弾く。
function applyEffectivePeriodRule<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((data: unknown, ctx) => {
    const v = data as { effectiveFrom?: Date; effectiveTo?: Date };
    if (v.effectiveFrom && v.effectiveTo) {
      if (v.effectiveFrom.getTime() >= v.effectiveTo.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effectiveTo"],
          message: "適用終了日は適用開始日より後にしてください",
        });
      }
    }
  }) as unknown as T;
}

export const IncentiveRateInputSchema = applyEffectivePeriodRule(z.object(baseFields));
export type IncentiveRateInput = z.infer<typeof IncentiveRateInputSchema>;

// Update — targetType / effectiveFrom はスキーマに含めない（immutable）。
// rate / effectiveTo / note のみパッチ可能。
export const IncentiveRateUpdateSchema = z.object({
  rate: baseFields.rate.optional(),
  effectiveTo: baseFields.effectiveTo,
  note: baseFields.note,
});
export type IncentiveRateUpdate = z.infer<typeof IncentiveRateUpdateSchema>;

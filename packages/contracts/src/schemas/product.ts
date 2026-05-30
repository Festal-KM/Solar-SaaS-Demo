// Zod schemas for the product master (F-012 / docs/05 §3.3 §4.4 / T-02-03).
//
// Three schemas are exported:
//   - `ProductInputSchema`        : create a brand-new product master row.
//   - `ProductUpdateSchema`       : edit non-price metadata (name / maker /
//                                   modelNo / note / isActive). Price changes
//                                   MUST flow through `reviseProductRates`
//                                   so the audit history (`ProductPriceHistory`)
//                                   stays append-only.
//   - `ProductReviseRatesSchema`  : price-revision payload — creates a new
//                                   versioned row whose `effectiveFrom` starts
//                                   a new period and closes the previous one.
//
// `category` mirrors the Prisma `ProductCategory` enum (docs/05 §3.3:
// PANEL / BATTERY / POWER_CONDITIONER / MOUNT / OTHER_PART / SET). The schema
// is the source of truth for callers; the Server Action passes the value
// through unchanged.

import { z } from "zod";

export const ProductCategorySchema = z.enum([
  "PANEL",
  "BATTERY",
  "POWER_CONDITIONER",
  "MOUNT",
  "OTHER_PART",
  "SET",
]);
export type ProductCategory = z.infer<typeof ProductCategorySchema>;

// `Decimal(14,2)` — money. Accept both numeric and string, normalise to a
// string so Prisma keeps full precision (no Float drift). Non-negative.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: "数値を入力してください" })
  .refine((v) => Number(v) >= 0, { message: "0 以上の数値を入力してください" });

// `Decimal(10,2)` — capacity (kW など)。負値は許容しない。
const capacityString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), { message: "数値を入力してください" });

// Coerce ISO-8601 strings to Date so callers can pass either.
const dateLike = z
  .union([z.date(), z.string().datetime({ offset: true }), z.string().date()])
  .transform((v) => {
    if (v instanceof Date) return v;
    return new Date(v);
  });

const optionalNonEmpty = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const baseProductFields = {
  category: ProductCategorySchema,
  maker: z.string().trim().min(1, "メーカーを入力してください").max(255),
  name: z.string().trim().min(1, "商品名を入力してください").max(255),
  modelNo: optionalNonEmpty,
  capacity: capacityString.optional(),
  unit: z.string().trim().min(1, "単位を入力してください").max(32),
  purchasePrice: moneyString,
  dealerPrice: moneyString,
  listPrice: moneyString,
  effectiveFrom: dateLike,
  effectiveTo: dateLike.optional(),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
};

// `effectiveFrom < effectiveTo` (only when effectiveTo is provided). Mirrors
// the DB CHECK constraint introduced in T-02-01 so both layers reject the
// same payloads.
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

export const ProductInputSchema = applyEffectivePeriodRule(z.object(baseProductFields));
export type ProductInput = z.infer<typeof ProductInputSchema>;

// Edit only non-price metadata. `isActive=false` is the soft-retire path used
// by `retireProduct`; clients may also set it directly through this schema if
// they need a manual disable without setting `effectiveTo` (rare; the documented
// path is `retireProductAction`).
export const ProductUpdateSchema = z.object({
  name: baseProductFields.name.optional(),
  maker: baseProductFields.maker.optional(),
  modelNo: baseProductFields.modelNo,
  note: baseProductFields.note,
  isActive: z.boolean().optional(),
});
export type ProductUpdate = z.infer<typeof ProductUpdateSchema>;

// Price-revision payload. The Server Action closes the previous row's
// `effectiveTo` to `new effectiveFrom - 1 day` and creates a new row carrying
// the same (wholesalerId, category, maker, name, modelNo) tuple with the
// supplied prices. `reason` is appended to the history JSONB diff so the
// audit trail can answer "なぜ変えたか".
export const ProductReviseRatesSchema = applyEffectivePeriodRule(
  z.object({
    purchasePrice: baseProductFields.purchasePrice,
    dealerPrice: baseProductFields.dealerPrice,
    listPrice: baseProductFields.listPrice,
    effectiveFrom: baseProductFields.effectiveFrom,
    effectiveTo: baseProductFields.effectiveTo,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
  }),
);
export type ProductReviseRates = z.infer<typeof ProductReviseRatesSchema>;

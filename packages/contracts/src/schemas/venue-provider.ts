// Zod schemas for the venue-provider master (F-011 / docs/05 §3.3 §4.4).
//
// `contractType` mirrors the Prisma `VenueContractType` enum (FIXED /
// PERFORMANCE / OTHER) — the schema is the source of truth, and the Server
// Action passes the value through unchanged to `tx.venueProvider.create`.
//
// Conditional required-field refinement:
//   - contractType=FIXED       requires `fixedFee`
//   - contractType=PERFORMANCE requires `performanceRate`
//   - contractType=OTHER       has no extra requirements (use `note`)
// Refinement is applied at the schema level so both the form (zodResolver) and
// the Server Action share the rule.

import { z } from "zod";

export const VenueContractTypeSchema = z.enum(["FIXED", "PERFORMANCE", "OTHER"]);
export type VenueContractType = z.infer<typeof VenueContractTypeSchema>;

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

// Base shape — `name` and `address` are required (docs/02 §F-011 受け入れ
// 基準: 「名称・住所必須」). Everything else is optional. `contractType` is
// optional too (legacy rows in the DB may be null), but when supplied it
// triggers the conditional checks below.
const baseShape = {
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  area: optionalNonEmpty,
  postalCode: optionalNonEmpty,
  address: z.string().trim().min(1, "住所を入力してください").max(255),
  phone: optionalNonEmpty,
  email: z
    .union([z.literal(""), z.string().email("メールアドレスの形式が正しくありません")])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  contactName: optionalNonEmpty,
  contractType: VenueContractTypeSchema.optional(),
  // Money: Decimal(14,2). Accepted as string or number, normalised to string
  // so it can be passed straight to Prisma without precision loss.
  fixedFee: decimalString.optional(),
  // Percentage 0..100: Decimal(5,2).
  performanceRate: decimalString
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, "0〜100 の範囲で入力してください")
    .optional(),
  note: z.string().trim().max(2000).optional(),
};

function applyContractTypeRules<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((data: unknown, ctx) => {
    const v = data as {
      contractType?: VenueContractType;
      fixedFee?: string;
      performanceRate?: string;
    };
    if (v.contractType === "FIXED" && !v.fixedFee) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedFee"],
        message: "固定費型では固定費金額が必須です",
      });
    }
    if (v.contractType === "PERFORMANCE" && !v.performanceRate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["performanceRate"],
        message: "成果報酬型では成果報酬率が必須です",
      });
    }
  }) as unknown as T;
}

export const VenueProviderInputSchema = applyContractTypeRules(z.object(baseShape));
export type VenueProviderInput = z.infer<typeof VenueProviderInputSchema>;

// Update schema: every base field becomes optional. Conditional rule still
// fires when contractType is present in the patch. For `address`, a patch
// MAY omit the field (undefined) but MUST NOT clear it to an empty string —
// docs/02 §F-011 keeps 住所必須 even on edit.
export const VenueProviderUpdateSchema = applyContractTypeRules(
  z.object({
    name: baseShape.name.optional(),
    area: baseShape.area,
    postalCode: baseShape.postalCode,
    address: baseShape.address.optional(),
    phone: baseShape.phone,
    email: baseShape.email,
    contactName: baseShape.contactName,
    contractType: baseShape.contractType,
    fixedFee: baseShape.fixedFee,
    performanceRate: baseShape.performanceRate,
    note: baseShape.note,
  }),
);
export type VenueProviderUpdate = z.infer<typeof VenueProviderUpdateSchema>;

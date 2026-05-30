// Zod schemas for Contract create (T-05-06 / F-040 / docs/05 §3.6 §4.8 §6.2).
//
// `ContractCreateSchema`: dealId, contractDate (ISO datetime string),
// totalAmount (non-negative Decimal string), isSelfHosted.
//
// totalAmount represents the overall contract price the customer signs for
// (docs/05 §3.6 `contractAmount`). It is stored as a Decimal string to avoid
// float-precision drift; the Server Action converts it to a Prisma `Decimal`.

import { z } from "zod";

export const ContractCreateSchema = z.object({
  dealId: z.string().min(1, "商談 ID が必要です"),

  // ISO 8601 datetime string (Date.toISOString() format).
  contractDate: z.string().datetime("契約日は ISO 形式で入力してください"),

  // Non-negative decimal string, e.g. "1500000.00"
  totalAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金額は 0 以上の数値で入力してください")
    .refine((v) => Number(v) >= 0, "金額は 0 以上で入力してください"),

  // 自社開催フラグ — true のとき二次店インセンティブ対象外 (docs/05 §6.1).
  isSelfHosted: z.boolean().default(false),
});

export type ContractCreateInput = z.infer<typeof ContractCreateSchema>;

// Zod schema for contract item replacement (T-05-07 / F-041 / docs/05 §3.6 §4.8).
//
// `ContractItemReplaceSchema`: full-replace payload for a contract's line items.
// Items array must contain at least 1 entry (F-041 受入基準).
// qty is a positive integer — fractional quantities are not supported in this domain.

import { z } from "zod";

export const ContractItemInputSchema = z.object({
  productId: z.string().min(1, "商品 ID が必要です"),
  qty: z
    .number()
    .int("数量は整数で入力してください")
    .min(1, "数量は 1 以上で入力してください"),
});

export type ContractItemInput = z.infer<typeof ContractItemInputSchema>;

export const ContractItemReplaceSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  items: z
    .array(ContractItemInputSchema)
    .min(1, "明細は 1 件以上必要です"),
});

export type ContractItemReplaceInput = z.infer<typeof ContractItemReplaceSchema>;

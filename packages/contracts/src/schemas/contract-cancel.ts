// Zod schema for contract cancellation (T-06-04 / F-043 / docs/05 §6.1 §4.8).
//
// ContractCancelSchema is consumed by cancelContractAction (Server Action) and
// shared with the UI form. The `cancelledAt` datetime defaults to the server's
// now() when omitted — the UI can pass an explicit datetime or rely on the server
// default.

import { z } from "zod";

export const ContractCancelSchema = z.object({
  contractId: z.string().min(1, "契約 ID が必要です"),
  reason: z.string().min(1, "キャンセル理由を入力してください").max(1000),
});

export type ContractCancelInput = z.infer<typeof ContractCancelSchema>;

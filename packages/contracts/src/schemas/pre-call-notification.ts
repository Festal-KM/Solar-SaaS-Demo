// Zod schemas for pre-call notification send / acknowledge (T-04-10 / F-036
// / F-037 / docs/05 §3.5 §4.7).
//
// PreCallNotificationSendSchema:
//   preCallId       — the PreCall whose result is being communicated.
//   relationshipIds — one or more dealer relationships to notify (bulk).
//
// PreCallNotificationAcknowledgeSchema:
//   notificationId  — the PreCallNotification row the dealer is confirming.

import { z } from "zod";

export const PreCallNotificationSendSchema = z.object({
  preCallId: z.string().min(1, "マエカク ID が必要です"),
  relationshipIds: z
    .array(z.string().min(1))
    .min(1, "通知対象の二次店を 1 件以上指定してください"),
});

export type PreCallNotificationSendInput = z.infer<typeof PreCallNotificationSendSchema>;

export const PreCallNotificationAcknowledgeSchema = z.object({
  notificationId: z.string().min(1, "通知 ID が必要です"),
});

export type PreCallNotificationAcknowledgeInput = z.infer<
  typeof PreCallNotificationAcknowledgeSchema
>;

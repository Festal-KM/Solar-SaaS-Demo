// Shared graphile-worker payload types + enqueue helper signatures
// (T-01-10, docs/05 §5).
//
// The actual `quickAddJob` is bound by the web layer in
// `apps/web/lib/jobs/queue.ts` because it owns the Postgres connection. We
// keep the *type* surface here so both the web app and the worker tasks
// reference the same payload contracts.

import { z } from "zod";

// ---------------------------------------------------------------------------
// `notification.send_email` (docs/05 §5.2)
// ---------------------------------------------------------------------------
//
// Two payload shapes are supported in a single discriminated union:
//   - "direct"   (SP-01 bootstrap): inline to/subject/html — no DB read needed.
//   - "delivery" (SP-07 / T-07-05): deliveryId → worker loads NotificationDelivery
//     + parent Notification, renders the appropriate template, then sends.
//
// Both shapes share the same task name (`notification.send_email`) so the
// jobKey convention and enqueue helper stay unchanged.

export const sendEmailDirectPayloadSchema = z.object({
  kind: z.literal("direct"),
  to: z.string().email(),
  subject: z.string().min(1).max(255),
  html: z.string().min(1),
  text: z.string().optional(),
});

export type SendEmailDirectPayload = z.infer<typeof sendEmailDirectPayloadSchema>;

export const sendEmailDeliveryPayloadSchema = z.object({
  kind: z.literal("delivery"),
  deliveryId: z.string().min(1),
});

export type SendEmailDeliveryPayload = z.infer<typeof sendEmailDeliveryPayloadSchema>;

export const sendEmailPayloadSchema = z.union([
  sendEmailDirectPayloadSchema,
  sendEmailDeliveryPayloadSchema,
  // Legacy shape (SP-01 records without `kind`): treat as direct.
  z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(255),
    html: z.string().min(1),
    text: z.string().optional(),
  }).transform((v) => ({ kind: "direct" as const, ...v })),
]);

export type SendEmailPayload = z.infer<typeof sendEmailPayloadSchema>;

// ---------------------------------------------------------------------------
// `notification.send_inapp` — DB-only stub for SP-01 (full impl in SP-07)
// ---------------------------------------------------------------------------

export const sendInappPayloadSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).optional(),
  href: z.string().max(2000).optional(),
});

export type SendInappPayload = z.infer<typeof sendInappPayloadSchema>;

// ---------------------------------------------------------------------------
// `notification.send_line` (Phase 2 stub)
// ---------------------------------------------------------------------------

export const sendLinePayloadSchema = z.object({
  lineUserId: z.string().min(1),
  text: z.string().min(1).max(2000),
});

export type SendLinePayload = z.infer<typeof sendLinePayloadSchema>;

// ---------------------------------------------------------------------------
// `incentive.calculate` (T-06-05 / F-046 / docs/05 §5.2)
// ---------------------------------------------------------------------------
//
// Enqueued by createContractAction after a Contract row is committed. The
// worker re-reads GrossProfit + rate snapshot and upserts the Incentive row.
// jobKey = `incentive.calculate:{contractId}` (docs/05 §5.4).

export const incentiveCalculatePayloadSchema = z.object({
  contractId: z.string().min(1),
});

export type IncentiveCalculatePayload = z.infer<typeof incentiveCalculatePayloadSchema>;

// ---------------------------------------------------------------------------
// `incentive.cancel_or_negative_adjust` (T-06-05 / F-043 / docs/05 §5.2)
// ---------------------------------------------------------------------------
//
// Enqueued by cancelContractAction. cancelledAt is the server-side timestamp
// fixed by the action; cancelledByUserId is used for IncentiveAdjustment.adjustedBy.

export const incentiveCancelOrNegativeAdjustPayloadSchema = z.object({
  contractId: z.string().min(1),
  cancelledAt: z.string().datetime(),
  cancelledByUserId: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

export type IncentiveCancelOrNegativeAdjustPayload = z.infer<
  typeof incentiveCancelOrNegativeAdjustPayloadSchema
>;

// ---------------------------------------------------------------------------
// `event.publish_followups` (T-03-04 / F-019 / docs/05 §5.2)
// ---------------------------------------------------------------------------
//
// Fired when a wholesaler flips an EventCandidate's visibility ON for one
// or more dealer relationships. The full SP-07 implementation will fan out
// in-app + email notifications to the addressed dealers; the SP-03 stub
// only validates the payload and logs (so the enqueue path is observable in
// integration tests right away).
//
// `relationshipIds` is the *delta* the action just opened — the worker
// re-reads `EventCandidateVisibility` at run time to discover the canonical
// recipient set (so a follow-up "公開取消" within the same backoff window
// can still silence stragglers).

export const eventPublishFollowupsPayloadSchema = z.object({
  eventCandidateId: z.string().min(1),
  relationshipIds: z.array(z.string().min(1)).min(1),
});

export type EventPublishFollowupsPayload = z.infer<typeof eventPublishFollowupsPayloadSchema>;

// ---------------------------------------------------------------------------
// `monthly.aggregate` (T-06-06 / F-048 / docs/05 §5.2)
// ---------------------------------------------------------------------------
//
// Enqueued by the monthly cron (0 2 1 * *) or triggered manually via
// monthlyReport.runAggregate Server Action.
// jobKey = `monthly.aggregate:{wholesalerId}:{targetMonth}` (docs/05 §5.4).

export const monthlyAggregatePayloadSchema = z.object({
  wholesalerId: z.string().min(1),
  // 'YYYY-MM'
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export type MonthlyAggregatePayload = z.infer<typeof monthlyAggregatePayloadSchema>;

// ---------------------------------------------------------------------------
// JobPayloads — single source of truth consumed by both web and worker.
// ---------------------------------------------------------------------------

export const TASK_NAMES = {
  NOTIFICATION_SEND_EMAIL: "notification.send_email",
  NOTIFICATION_SEND_INAPP: "notification.send_inapp",
  NOTIFICATION_SEND_LINE: "notification.send_line",
  EVENT_PUBLISH_FOLLOWUPS: "event.publish_followups",
  INCENTIVE_CALCULATE: "incentive.calculate",
  INCENTIVE_CANCEL_OR_NEGATIVE_ADJUST: "incentive.cancel_or_negative_adjust",
  MONTHLY_AGGREGATE: "monthly.aggregate",
  REMINDER_DISPATCH: "reminder.dispatch",
} as const;

export type TaskName = (typeof TASK_NAMES)[keyof typeof TASK_NAMES];

/**
 * Subset of tasks that can be enqueued by application code via `addJob`.
 * Cron-only tasks (e.g. `reminder.dispatch`) are registered in the worker
 * task list but never enqueued directly, so they are excluded here.
 */
export type EnqueueableTaskName = Exclude<TaskName, "reminder.dispatch">;

export interface JobPayloads {
  [TASK_NAMES.NOTIFICATION_SEND_EMAIL]: SendEmailPayload;
  [TASK_NAMES.NOTIFICATION_SEND_INAPP]: SendInappPayload;
  [TASK_NAMES.NOTIFICATION_SEND_LINE]: SendLinePayload;
  [TASK_NAMES.EVENT_PUBLISH_FOLLOWUPS]: EventPublishFollowupsPayload;
  [TASK_NAMES.INCENTIVE_CALCULATE]: IncentiveCalculatePayload;
  [TASK_NAMES.INCENTIVE_CANCEL_OR_NEGATIVE_ADJUST]: IncentiveCancelOrNegativeAdjustPayload;
  [TASK_NAMES.MONTHLY_AGGREGATE]: MonthlyAggregatePayload;
}

export const TASK_PAYLOAD_SCHEMAS = {
  [TASK_NAMES.NOTIFICATION_SEND_EMAIL]: sendEmailPayloadSchema,
  [TASK_NAMES.NOTIFICATION_SEND_INAPP]: sendInappPayloadSchema,
  [TASK_NAMES.NOTIFICATION_SEND_LINE]: sendLinePayloadSchema,
  [TASK_NAMES.EVENT_PUBLISH_FOLLOWUPS]: eventPublishFollowupsPayloadSchema,
  [TASK_NAMES.INCENTIVE_CALCULATE]: incentiveCalculatePayloadSchema,
  [TASK_NAMES.INCENTIVE_CANCEL_OR_NEGATIVE_ADJUST]: incentiveCancelOrNegativeAdjustPayloadSchema,
  [TASK_NAMES.MONTHLY_AGGREGATE]: monthlyAggregatePayloadSchema,
} as const;

export interface EnqueueOptions {
  jobKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Typed enqueue function signature. The actual implementation lives in
 * `apps/web/lib/jobs/queue.ts` (uses `quickAddJob` from graphile-worker
 * against the DATABASE_URL pool). Worker-side tasks should NOT import the
 * binding — tasks never enqueue further jobs at this stage.
 */
export type EnqueueFn = <T extends EnqueueableTaskName>(
  taskName: T,
  payload: JobPayloads[T],
  opts?: EnqueueOptions,
) => Promise<void>;

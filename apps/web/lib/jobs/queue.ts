// Typed enqueue helper bound to the app DATABASE_URL pool (T-01-10).
//
// docs/05 §5.4 — Server Actions / API routes call `enqueue(taskName, payload,
// opts)` and graphile-worker writes a row in `graphile_worker.jobs`. The
// worker process (`apps/worker`) picks it up. Payloads are validated against
// the schema in @solar/contracts before write so a bad shape fails
// synchronously at the caller rather than at job runtime.

import {
  TASK_NAMES,
  TASK_PAYLOAD_SCHEMAS,
  type EnqueueOptions,
  type EnqueueableTaskName,
  type JobPayloads,
} from "@solar/contracts";
import { quickAddJob } from "graphile-worker";

// Augment graphile-worker's global `Tasks` interface so quickAddJob's payload
// generic resolves to our @solar/contracts schemas, not `unknown`. The
// `namespace` is required because that is how graphile-worker declares it
// upstream; we can only augment matching shapes.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace GraphileWorker {
    interface Tasks {
      "notification.send_email": JobPayloads["notification.send_email"];
      "notification.send_inapp": JobPayloads["notification.send_inapp"];
      "notification.send_line": JobPayloads["notification.send_line"];
      "event.publish_followups": JobPayloads["event.publish_followups"];
      "incentive.calculate": JobPayloads["incentive.calculate"];
      "incentive.cancel_or_negative_adjust": JobPayloads["incentive.cancel_or_negative_adjust"];
      "monthly.aggregate": JobPayloads["monthly.aggregate"];
    }
  }
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set to enqueue background jobs");
  }
  return url;
}

export async function enqueue<T extends EnqueueableTaskName>(
  taskName: T,
  payload: JobPayloads[T],
  opts?: EnqueueOptions,
): Promise<void> {
  const schema = TASK_PAYLOAD_SCHEMAS[taskName];
  schema.parse(payload);

  // Cast: TypeScript cannot bridge our `T extends TaskName` generic with
  // graphile-worker's own `T extends keyof GraphileWorker.Tasks` conditional
  // (the shapes are identical because Tasks is augmented from JobPayloads).
  const addJob = quickAddJob as unknown as (
    opts: { connectionString: string },
    taskName: string,
    payload: unknown,
    spec: { jobKey?: string; runAt?: Date; maxAttempts?: number },
  ) => Promise<unknown>;

  await addJob({ connectionString: getConnectionString() }, taskName, payload, {
    jobKey: opts?.jobKey,
    runAt: opts?.runAt,
    maxAttempts: opts?.maxAttempts ?? 3,
  });
}

/** Convenience wrapper for the most common case. */
export async function enqueueEmail(
  payload: JobPayloads["notification.send_email"],
  opts?: EnqueueOptions,
): Promise<void> {
  await enqueue("notification.send_email", payload, opts);
}

/**
 * Enqueue `incentive.calculate` for a newly-created contract.
 * jobKey ensures at-most-once execution per contract (docs/05 §5.4).
 */
export async function enqueueIncentiveCalculate(contractId: string): Promise<void> {
  await enqueue(
    TASK_NAMES.INCENTIVE_CALCULATE,
    { contractId },
    {
      jobKey: `${TASK_NAMES.INCENTIVE_CALCULATE}:${contractId}`,
      maxAttempts: 3,
    },
  );
}

/**
 * Enqueue `incentive.cancel_or_negative_adjust` when a contract is cancelled.
 * No jobKey deduplication — each cancellation event should run exactly once
 * (the task itself is idempotent: skips if Contract.status already CANCELLED).
 */
export async function enqueueIncentiveCancelAdjust(
  contractId: string,
  cancelledAt: Date,
  cancelledByUserId: string,
  reason: string,
): Promise<void> {
  await enqueue(
    TASK_NAMES.INCENTIVE_CANCEL_OR_NEGATIVE_ADJUST,
    {
      contractId,
      cancelledAt: cancelledAt.toISOString(),
      cancelledByUserId,
      reason,
    },
    { maxAttempts: 3 },
  );
}

/**
 * Enqueue `monthly.aggregate` for a specific wholesaler + month.
 * jobKey prevents duplicate runs (docs/05 §5.4).
 */
export async function enqueueMonthlyAggregate(
  wholesalerId: string,
  targetMonth: string,
): Promise<void> {
  await enqueue(
    TASK_NAMES.MONTHLY_AGGREGATE,
    { wholesalerId, targetMonth },
    {
      jobKey: `${TASK_NAMES.MONTHLY_AGGREGATE}:${wholesalerId}:${targetMonth}`,
      maxAttempts: 3,
    },
  );
}

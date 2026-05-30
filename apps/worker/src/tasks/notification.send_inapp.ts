// graphile-worker task: in-app notification stub (T-01-10).
//
// Full implementation lands in SP-07 once the `Notification` model is wired.
// For now we only validate the payload and log; no DB writes happen here
// because the `Notification` row is expected to already exist (the design
// for SP-07 flips this: web inserts the row, the worker marks
// NotificationDelivery=SENT). Until then this task is a noop.

import { sendInappPayloadSchema } from "@solar/contracts";

import type { Task } from "graphile-worker";

export const sendInappTask: Task = async (rawPayload, helpers) => {
  const payload = sendInappPayloadSchema.parse(rawPayload);
  helpers.logger.info(
    `notification.send_inapp stub jobId=${helpers.job.id} userId=${payload.userId} kind=${payload.kind}`,
  );
};

export default sendInappTask;

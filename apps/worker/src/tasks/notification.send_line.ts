// graphile-worker task: LINE notification stub (Phase 2).
//
// Feature flag FEATURE_LINE_NOTIFICATIONS gates real delivery (docs/05 §5.2).
// In MVP the task is a logging noop so enqueuers can still exercise the path.

import { sendLinePayloadSchema } from "@solar/contracts";

import type { Task } from "graphile-worker";

export const sendLineTask: Task = async (rawPayload, helpers) => {
  const payload = sendLinePayloadSchema.parse(rawPayload);
  helpers.logger.info(
    `notification.send_line stub jobId=${helpers.job.id} lineUserId=${payload.lineUserId} (Phase 2 — noop)`,
  );
};

export default sendLineTask;

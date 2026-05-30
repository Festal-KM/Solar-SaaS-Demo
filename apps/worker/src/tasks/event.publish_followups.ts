// graphile-worker task: イベント候補公開時の二次店宛フォローアップ通知
// (T-03-04 / F-019 / docs/05 §5.2).
//
// SP-03 ではジョブ受け口の確立のみ。実通知（in-app + email）は SP-07 で
// `EventCandidateVisibility` を re-read してから配信する。ここでは payload
// 検証 + 構造化ログのみ。失敗時はそのまま throw して graphile-worker の
// 既定 backoff (max_attempts=3) に委ねる。

import {
  eventPublishFollowupsPayloadSchema,
  type EventPublishFollowupsPayload,
} from "@solar/contracts";

import type { Task } from "graphile-worker";

export const eventPublishFollowupsTask: Task = async (rawPayload, helpers) => {
  const payload: EventPublishFollowupsPayload =
    eventPublishFollowupsPayloadSchema.parse(rawPayload);
  helpers.logger.info(
    `event.publish_followups stub jobId=${helpers.job.id} eventCandidateId=${payload.eventCandidateId} relationshipCount=${payload.relationshipIds.length}`,
  );
};

export default eventPublishFollowupsTask;

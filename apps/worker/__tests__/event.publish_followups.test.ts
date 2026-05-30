// Unit tests for `event.publish_followups` graphile-worker task (T-03-04 / F-019).
//
// SP-03 では stub のみ（通知本体は SP-07）。ここでは payload 検証 + 構造化ログ
// 呼び出しを確認する。実 DB / 通知クライアントは触らない。

import { describe, expect, it, vi } from "vitest";

import { eventPublishFollowupsTask } from "../src/tasks/event.publish_followups.js";

function fakeHelpers(jobId = "test-job-pub-1") {
  return {
    job: { id: jobId },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Parameters<typeof eventPublishFollowupsTask>[1];
}

describe("event.publish_followups task (stub)", () => {
  it("validates the payload and logs once (no throws, no further side effects)", async () => {
    const helpers = fakeHelpers();
    const loggerInfo = helpers.logger.info as unknown as ReturnType<typeof vi.fn>;

    await eventPublishFollowupsTask(
      {
        eventCandidateId: "ec_test_1",
        relationshipIds: ["rel_a", "rel_b"],
      },
      helpers,
    );

    expect(loggerInfo).toHaveBeenCalledOnce();
    const message = loggerInfo.mock.calls[0]?.[0];
    expect(String(message)).toContain("event.publish_followups");
    expect(String(message)).toContain("ec_test_1");
    expect(String(message)).toContain("relationshipCount=2");
  });

  it("rejects payloads with an empty relationshipIds array", async () => {
    const helpers = fakeHelpers();
    await expect(
      eventPublishFollowupsTask({ eventCandidateId: "ec_x", relationshipIds: [] }, helpers),
    ).rejects.toThrow();
  });

  it("rejects payloads missing eventCandidateId", async () => {
    const helpers = fakeHelpers();
    await expect(
      eventPublishFollowupsTask({ relationshipIds: ["rel_a"] }, helpers),
    ).rejects.toThrow();
  });
});

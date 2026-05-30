// Unit tests for `updateVisibilityAction` (T-03-04 / F-019).
//
// Strategy:
//   - Mock `@solar/db` so `withTenant` runs handler with an in-memory tx that
//     exposes `eventCandidate.findUnique`, `relationship.findMany`,
//     `eventCandidateVisibility.upsert`.
//   - Mock `next/cache` and `@/auth` (existing pattern, see actions.test.ts).
//   - Mock `@/lib/jobs/queue` to assert enqueue is called only on isVisible=true.
//
// Coverage:
//   1. happy path — publish to two relationships, upsert called twice, job
//      enqueued exactly once with the full relationshipIds list.
//   2. cross-tenant — one of the relationshipIds belongs to a different
//      wholesaler → ValidationError, no upsert, no enqueue.
//   3. DRAFT state — visibility update rejected with
//      InvalidStateTransitionError.
//   4. unpublish path — isVisible=false flips existing rows to false and does
//      NOT enqueue the publish_followups job.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError, ValidationError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const eventCandidateFindUniqueMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const visibilityUpsertMock = vi.fn();
const revalidatePathMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue([]),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    eventCandidate: {
      // updateVisibilityAction calls findUnique to load status + wholesalerId.
      findUnique: (...args: unknown[]) => eventCandidateFindUniqueMock(...args),
      // The other CRUD actions in the file expect these to exist — provide
      // no-op stubs so dynamic-shape access doesn't blow up when the module
      // initialises (top-level mocks share one tx object).
      create: vi.fn(),
      update: vi.fn(),
    },
    venueProvider: { findUnique: vi.fn() },
    venueNegotiation: { findUnique: vi.fn() },
    relationship: {
      findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
    },
    eventCandidateVisibility: {
      upsert: (...args: unknown[]) => visibilityUpsertMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { updateVisibilityAction } = await import("../actions.js");

const WS_SESSION = {
  user: {
    id: "u_ws_event",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_EVENT_TEAM"],
    isSaasAdmin: false,
  },
};

beforeEach(() => {
  authMock.mockReset();
  eventCandidateFindUniqueMock.mockReset();
  relationshipFindManyMock.mockReset();
  visibilityUpsertMock.mockReset();
  revalidatePathMock.mockReset();
  enqueueMock.mockReset();
  visibilityUpsertMock.mockResolvedValue({});
  enqueueMock.mockResolvedValue(undefined);
});

describe("updateVisibilityAction", () => {
  it("publishes to multiple relationships, upserts each, and enqueues the followup job once", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      wholesalerId: "tenant_ws_a",
    });
    relationshipFindManyMock.mockResolvedValue([
      { id: "rel_a", wholesalerId: "tenant_ws_a", status: "ACTIVE" },
      { id: "rel_b", wholesalerId: "tenant_ws_a", status: "ACTIVE" },
    ]);

    const result = await updateVisibilityAction({
      eventCandidateId: "ec_1",
      relationshipIds: ["rel_a", "rel_b"],
      isVisible: true,
    });

    expect(result).toEqual({ eventCandidateId: "ec_1", affectedCount: 2 });
    expect(visibilityUpsertMock).toHaveBeenCalledTimes(2);
    const upsertCalls = visibilityUpsertMock.mock.calls.map(
      (call) => (call[0] as { create: { relationshipId: string; isVisible: boolean } }).create,
    );
    expect(upsertCalls.map((c) => c.relationshipId).sort()).toEqual(["rel_a", "rel_b"]);
    expect(upsertCalls.every((c) => c.isVisible === true)).toBe(true);

    expect(enqueueMock).toHaveBeenCalledOnce();
    const enqueueArgs = enqueueMock.mock.calls[0]!;
    expect(enqueueArgs[0]).toBe("event.publish_followups");
    expect(enqueueArgs[1]).toEqual({
      eventCandidateId: "ec_1",
      relationshipIds: ["rel_a", "rel_b"],
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/event-detail");
    expect(revalidatePathMock).toHaveBeenCalledWith("/event-detail/ec_1");
  });

  it("rejects when any relationshipId belongs to a different wholesaler (no upsert, no enqueue)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      wholesalerId: "tenant_ws_a",
    });
    relationshipFindManyMock.mockResolvedValue([
      { id: "rel_a", wholesalerId: "tenant_ws_a", status: "ACTIVE" },
      { id: "rel_foreign", wholesalerId: "tenant_ws_b", status: "ACTIVE" },
    ]);

    await expect(
      updateVisibilityAction({
        eventCandidateId: "ec_1",
        relationshipIds: ["rel_a", "rel_foreign"],
        isVisible: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(visibilityUpsertMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects visibility update while the candidate is still DRAFT", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_draft",
      status: "DRAFT",
      wholesalerId: "tenant_ws_a",
    });

    await expect(
      updateVisibilityAction({
        eventCandidateId: "ec_draft",
        relationshipIds: ["rel_a"],
        isVisible: true,
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(relationshipFindManyMock).not.toHaveBeenCalled();
    expect(visibilityUpsertMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("unpublish (isVisible=false) updates rows to false and does NOT enqueue the followup job", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      wholesalerId: "tenant_ws_a",
    });
    relationshipFindManyMock.mockResolvedValue([
      { id: "rel_a", wholesalerId: "tenant_ws_a", status: "ACTIVE" },
    ]);

    const result = await updateVisibilityAction({
      eventCandidateId: "ec_1",
      relationshipIds: ["rel_a"],
      isVisible: false,
    });

    expect(result.affectedCount).toBe(1);
    expect(visibilityUpsertMock).toHaveBeenCalledOnce();
    const args = visibilityUpsertMock.mock.calls[0]![0] as {
      create: { isVisible: boolean };
      update: { isVisible: boolean };
    };
    expect(args.create.isVisible).toBe(false);
    expect(args.update.isVisible).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects when a provided relationshipId does not exist at all", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      wholesalerId: "tenant_ws_a",
    });
    relationshipFindManyMock.mockResolvedValue([
      // only rel_a found — rel_missing is absent
      { id: "rel_a", wholesalerId: "tenant_ws_a", status: "ACTIVE" },
    ]);

    await expect(
      updateVisibilityAction({
        eventCandidateId: "ec_1",
        relationshipIds: ["rel_a", "rel_missing"],
        isVisible: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(visibilityUpsertMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

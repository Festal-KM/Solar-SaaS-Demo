// Unit tests for pre-call notification actions (T-04-10 / F-036 / F-037 /
// docs/05 §4.7).
//
// Covers:
//   1. sendPreCallNotificationAction — creates PENDING records for each
//      supplied relationshipId.
//   2. sendPreCallNotificationAction — skips already-existing notification
//      rows (idempotent).
//   3. sendPreCallNotificationAction — throws NotFoundError when PreCall
//      does not exist.
//   4. acknowledgePreCallNotificationAction — sets status to ACKNOWLEDGED and
//      records acknowledgedAt.
//   5. acknowledgePreCallNotificationAction — throws ForbiddenError when the
//      notification's relationshipId is not in the caller's relationshipIds
//      (cross-tenant guard).
//   6. acknowledgePreCallNotificationAction — is idempotent: returns current
//      state without updating when already ACKNOWLEDGED.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const revalidatePathMock = vi.fn();
const relationshipFindManyMock = vi.fn();

const preCallFindUniqueMock = vi.fn();
const preCallNotificationFindManyMock = vi.fn();
const preCallNotificationCreateMock = vi.fn();
const preCallNotificationFindUniqueMock = vi.fn();
const preCallNotificationUpdateMock = vi.fn();

// Stub notification service — isolates this test from notification delivery logic.
const notificationFireMock = vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 });

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: (...args: unknown[]) => notificationFireMock(...args) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    preCall: {
      findUnique: (...args: unknown[]) => preCallFindUniqueMock(...args),
    },
    preCallNotification: {
      findMany: (...args: unknown[]) => preCallNotificationFindManyMock(...args),
      create: (...args: unknown[]) => preCallNotificationCreateMock(...args),
      findUnique: (...args: unknown[]) => preCallNotificationFindUniqueMock(...args),
      update: (...args: unknown[]) => preCallNotificationUpdateMock(...args),
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

// ---------------------------------------------------------------------------
// Top-level imports (after mocks are registered)
// ---------------------------------------------------------------------------

const { sendPreCallNotificationAction } = await import("../notification-actions.js");

// Relative path from __tests__/ to app/(dealer)/notifications/pre-call/actions:
// __tests__/ -> pre-call/ -> [id]/ -> appointments/ -> (wholesaler)/ -> app/
// That is 5 levels up to reach app/, then into (dealer)/...
const { acknowledgePreCallNotificationAction } = await import(
  "../../../../../(dealer)/notifications/pre-call/actions.js"
);

// ---------------------------------------------------------------------------
// Session fixtures
// ---------------------------------------------------------------------------

const WS_CALL_SESSION = {
  user: {
    id: "u_call",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_CALL_TEAM"],
    isSaasAdmin: false,
    relationshipIds: [],
  },
};

const DEALER_SESSION = {
  user: {
    id: "u_dealer_a",
    tenantId: "tenant_dl_a",
    tenantType: "DEALER",
    wholesalerId: null,
    dealerId: "tenant_dl_a",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
    relationshipIds: ["rel_a"],
  },
};

// ---------------------------------------------------------------------------
// sendPreCallNotificationAction
// ---------------------------------------------------------------------------

describe("sendPreCallNotificationAction", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePathMock.mockReset();
    preCallFindUniqueMock.mockReset();
    preCallNotificationFindManyMock.mockReset();
    preCallNotificationCreateMock.mockReset();
    relationshipFindManyMock.mockReset();
  });

  it("creates PENDING notification records for each relationshipId", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    preCallFindUniqueMock.mockResolvedValue({
      id: "pc_1",
      appointment: { id: "appt_1", customer: { name: "田中 太郎" } },
    });
    preCallNotificationFindManyMock.mockResolvedValue([]);
    preCallNotificationCreateMock.mockResolvedValue({ id: "notif_1" });

    const result = await sendPreCallNotificationAction({
      preCallId: "pc_1",
      relationshipIds: ["rel_a", "rel_b"],
    });

    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(preCallNotificationCreateMock).toHaveBeenCalledTimes(2);

    const firstCall = preCallNotificationCreateMock.mock.calls[0]![0] as {
      data: { preCallId: string; relationshipId: string; status: string };
    };
    expect(firstCall.data.preCallId).toBe("pc_1");
    expect(firstCall.data.status).toBe("PENDING");
  });

  it("skips already-existing notifications (idempotent)", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    preCallFindUniqueMock.mockResolvedValue({
      id: "pc_2",
      appointment: { id: "appt_2", customer: { name: "鈴木 花子" } },
    });
    preCallNotificationFindManyMock.mockResolvedValue([
      { relationshipId: "rel_a", status: "PENDING" },
    ]);
    preCallNotificationCreateMock.mockResolvedValue({ id: "notif_2" });

    const result = await sendPreCallNotificationAction({
      preCallId: "pc_2",
      relationshipIds: ["rel_a", "rel_b"],
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(preCallNotificationCreateMock).toHaveBeenCalledTimes(1);
    const createCall = preCallNotificationCreateMock.mock.calls[0]![0] as {
      data: { relationshipId: string };
    };
    expect(createCall.data.relationshipId).toBe("rel_b");
  });

  it("throws NotFoundError when the PreCall does not exist", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    preCallFindUniqueMock.mockResolvedValue(null);

    await expect(
      sendPreCallNotificationAction({
        preCallId: "pc_ghost",
        relationshipIds: ["rel_a"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(preCallNotificationCreateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// acknowledgePreCallNotificationAction
// ---------------------------------------------------------------------------

describe("acknowledgePreCallNotificationAction", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePathMock.mockReset();
    preCallNotificationFindUniqueMock.mockReset();
    preCallNotificationUpdateMock.mockReset();
    relationshipFindManyMock.mockReset();
    // Seed the rawPrisma relationship lookup used by getTenantContext() for
    // dealer sessions. Returns the relationship that DEALER_SESSION owns.
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a" }]);
  });

  it("sets status to ACKNOWLEDGED and records acknowledgedAt", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    preCallNotificationFindUniqueMock.mockResolvedValue({
      id: "notif_1",
      relationshipId: "rel_a",
      status: "PENDING",
      acknowledgedAt: null,
    });
    preCallNotificationUpdateMock.mockResolvedValue({ id: "notif_1" });

    const result = await acknowledgePreCallNotificationAction({
      notificationId: "notif_1",
    });

    expect(result.id).toBe("notif_1");
    expect(result.acknowledgedAt).toBeDefined();

    expect(preCallNotificationUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = preCallNotificationUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; acknowledgedAt: Date };
    };
    expect(updateCall.where.id).toBe("notif_1");
    expect(updateCall.data.status).toBe("ACKNOWLEDGED");
    expect(updateCall.data.acknowledgedAt).toBeInstanceOf(Date);
  });

  it("throws ForbiddenError when notification belongs to a different relationship", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    preCallNotificationFindUniqueMock.mockResolvedValue({
      id: "notif_2",
      relationshipId: "rel_x",
      status: "PENDING",
      acknowledgedAt: null,
    });

    await expect(
      acknowledgePreCallNotificationAction({
        notificationId: "notif_2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(preCallNotificationUpdateMock).not.toHaveBeenCalled();
  });

  it("is idempotent — returns current state without re-updating when already ACKNOWLEDGED", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    const alreadyAt = new Date("2026-05-25T09:00:00.000Z");
    preCallNotificationFindUniqueMock.mockResolvedValue({
      id: "notif_3",
      relationshipId: "rel_a",
      status: "ACKNOWLEDGED",
      acknowledgedAt: alreadyAt,
    });

    const result = await acknowledgePreCallNotificationAction({
      notificationId: "notif_3",
    });

    expect(result.id).toBe("notif_3");
    expect(result.acknowledgedAt).toBe(alreadyAt.toISOString());
    expect(preCallNotificationUpdateMock).not.toHaveBeenCalled();
  });
});

// Unit tests for the event-decision Server Actions (T-03-08 / F-023).
//
// Tests cover:
//   - mode=SELF: Event created, requiredPeople set, EventChange created
//   - mode=DEALER: Event + EventDealer × N created
//   - mode=JOINT: Event + EventDealer × N + requiredPeople
//   - mode=CANCELLED: EventCandidate.status=CANCELLED, Event NOT created
//   - DRAFT status → InvalidStateTransitionError (422)
//   - DECIDED status → InvalidStateTransitionError (422)
//   - EventChange audit record created on non-CANCELLED modes
//   - dealer_admin role → ForbiddenError (403)
//   - changeModeAction: updates Event, replaces EventDealer rows, records diff

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  InvalidStateTransitionError,
} from "../../../../../../lib/errors.js";
import { notificationService } from "@/lib/notifications/notification-service";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const eventCandidateFindUniqueMock = vi.fn();
const eventCandidateUpdateMock = vi.fn();
const eventCreateMock = vi.fn();
const eventFindUniqueMock = vi.fn();
const eventUpdateMock = vi.fn();
const eventDealerCreateMock = vi.fn();
const eventDealerDeleteManyMock = vi.fn();
const eventChangeMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    eventCandidate: {
      findUnique: (...args: unknown[]) => eventCandidateFindUniqueMock(...args),
      update: (...args: unknown[]) => eventCandidateUpdateMock(...args),
    },
    event: {
      create: (...args: unknown[]) => eventCreateMock(...args),
      findUnique: (...args: unknown[]) => eventFindUniqueMock(...args),
      update: (...args: unknown[]) => eventUpdateMock(...args),
    },
    eventDealer: {
      create: (...args: unknown[]) => eventDealerCreateMock(...args),
      deleteMany: (...args: unknown[]) => eventDealerDeleteManyMock(...args),
    },
    eventChange: {
      create: (...args: unknown[]) => eventChangeMock(...args),
    },
    relationship: {
      findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
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

const { decideEventModeAction, changeModeAction } = await import("../actions.js");

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

const DEALER_SESSION = {
  user: {
    id: "u_dl_admin",
    tenantId: "tenant_dl_x",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dl_x",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const CANDIDATE_CLOSED = {
  id: "ec_1",
  wholesalerId: "tenant_ws_a",
  status: "CLOSED",
};

const REL_A = { id: "rel_a", wholesalerId: "tenant_ws_a" };
const REL_B = { id: "rel_b", wholesalerId: "tenant_ws_a" };

beforeEach(() => {
  authMock.mockReset();
  eventCandidateFindUniqueMock.mockReset();
  eventCandidateUpdateMock.mockReset();
  eventCreateMock.mockReset();
  eventFindUniqueMock.mockReset();
  eventUpdateMock.mockReset();
  eventDealerCreateMock.mockReset();
  eventDealerDeleteManyMock.mockReset();
  eventChangeMock.mockReset();
  relationshipFindManyMock.mockReset();
  revalidatePathMock.mockReset();
  vi.mocked(notificationService.fire).mockReset();
  vi.mocked(notificationService.fire).mockResolvedValue({ notificationIds: [], skippedCount: 0 });

  // Default return for eventCandidateUpdate — tests that check `status` will
  // override this if needed; the notification path only needs storeName.
  eventCandidateUpdateMock.mockResolvedValue({ id: "ec_1", status: "DECIDED", storeName: "テスト会場", scheduledDate: null });
});

describe("decideEventModeAction — mode=SELF", () => {
  it("creates Event with requiredPeople and EventChange, sets status to DECIDED", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue(CANDIDATE_CLOSED);
    eventCreateMock.mockResolvedValue({ id: "ev_1" });

    const result = await decideEventModeAction({
      eventCandidateId: "ec_1",
      mode: "SELF",
      requiredPeople: 3,
    });

    expect(result.eventId).toBe("ev_1");
    expect(result.mode).toBe("SELF");

    // Event created with correct data
    const createCall = eventCreateMock.mock.calls[0]![0] as {
      data: {
        mode: string;
        requiredPeople: number;
        wholesalerId: string;
        decidedBy: string;
      };
    };
    expect(createCall.data.mode).toBe("SELF");
    expect(createCall.data.requiredPeople).toBe(3);
    expect(createCall.data.wholesalerId).toBe("tenant_ws_a");
    expect(createCall.data.decidedBy).toBe("u_ws_event");

    // No EventDealer created for SELF mode
    expect(eventDealerCreateMock).not.toHaveBeenCalled();

    // EventChange created
    expect(eventChangeMock).toHaveBeenCalledOnce();
    const changeCall = eventChangeMock.mock.calls[0]![0] as {
      data: {
        eventId: string;
        after: { type: string; mode: string; requiredPeople: number };
        changedBy: string;
      };
    };
    expect(changeCall.data.eventId).toBe("ev_1");
    expect(changeCall.data.after.type).toBe("DECIDED");
    expect(changeCall.data.after.mode).toBe("SELF");
    expect(changeCall.data.after.requiredPeople).toBe(3);
    expect(changeCall.data.changedBy).toBe("u_ws_event");

    // EventCandidate status updated to DECIDED
    const updateCall = eventCandidateUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(updateCall.where.id).toBe("ec_1");
    expect(updateCall.data.status).toBe("DECIDED");
  });
});

describe("decideEventModeAction — mode=DEALER", () => {
  it("creates Event + EventDealer × N, sets status to DECIDED, fires EVENT_ASSIGNED notification", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue(CANDIDATE_CLOSED);
    relationshipFindManyMock.mockResolvedValue([REL_A, REL_B]);
    eventCreateMock.mockResolvedValue({ id: "ev_2" });
    // resolveDealerAdmins returns a non-empty list so fire() is invoked
    const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveDealerAdmins).mockResolvedValue(["u_dealer_admin"]);

    const result = await decideEventModeAction({
      eventCandidateId: "ec_1",
      mode: "DEALER",
      dealerRelationshipIds: ["rel_a", "rel_b"],
    });

    expect(result.eventId).toBe("ev_2");
    expect(result.mode).toBe("DEALER");

    // EventDealer created for both relationships
    expect(eventDealerCreateMock).toHaveBeenCalledTimes(2);
    const calls = eventDealerCreateMock.mock.calls as Array<
      [{ data: { eventId: string; relationshipId: string } }]
    >;
    const relIds = calls.map((c) => c[0].data.relationshipId);
    expect(relIds).toContain("rel_a");
    expect(relIds).toContain("rel_b");

    // EventChange created
    expect(eventChangeMock).toHaveBeenCalledOnce();

    // EventCandidate updated to DECIDED
    const updateCall = eventCandidateUpdateMock.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateCall.data.status).toBe("DECIDED");

    // Notification fired for EVENT_ASSIGNED (once per dealer relationship)
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "EVENT_ASSIGNED" }),
    );
  });
});

describe("decideEventModeAction — mode=JOINT", () => {
  it("creates Event with requiredPeople + EventDealer × N, fires EVENT_ASSIGNED notification", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue(CANDIDATE_CLOSED);
    relationshipFindManyMock.mockResolvedValue([REL_A]);
    eventCreateMock.mockResolvedValue({ id: "ev_3" });
    // resolveDealerAdmins returns a non-empty list so fire() is invoked
    const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveDealerAdmins).mockResolvedValue(["u_dealer_admin"]);

    const result = await decideEventModeAction({
      eventCandidateId: "ec_1",
      mode: "JOINT",
      requiredPeople: 2,
      dealerRelationshipIds: ["rel_a"],
    });

    expect(result.eventId).toBe("ev_3");
    expect(result.mode).toBe("JOINT");

    const createCall = eventCreateMock.mock.calls[0]![0] as {
      data: { mode: string; requiredPeople: number };
    };
    expect(createCall.data.mode).toBe("JOINT");
    expect(createCall.data.requiredPeople).toBe(2);

    expect(eventDealerCreateMock).toHaveBeenCalledOnce();
    expect(eventChangeMock).toHaveBeenCalledOnce();

    // Notification fired for EVENT_ASSIGNED
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "EVENT_ASSIGNED" }),
    );
  });
});

describe("decideEventModeAction — mode=CANCELLED", () => {
  it("sets EventCandidate.status=CANCELLED and does NOT create Event or EventChange", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      wholesalerId: "tenant_ws_a",
      status: "OPEN",
    });

    const result = await decideEventModeAction({
      eventCandidateId: "ec_1",
      mode: "CANCELLED",
      reason: "場所が使えなくなった",
    });

    expect(result.eventId).toBeNull();
    expect(result.mode).toBe("CANCELLED");

    // No Event or EventChange created
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(eventChangeMock).not.toHaveBeenCalled();

    // EventCandidate updated to CANCELLED
    const updateCall = eventCandidateUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(updateCall.where.id).toBe("ec_1");
    expect(updateCall.data.status).toBe("CANCELLED");
  });
});

describe("decideEventModeAction — invalid source status", () => {
  it("rejects DRAFT status with InvalidStateTransitionError (422)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_d",
      wholesalerId: "tenant_ws_a",
      status: "DRAFT",
    });

    await expect(
      decideEventModeAction({
        eventCandidateId: "ec_d",
        mode: "SELF",
        requiredPeople: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(eventCreateMock).not.toHaveBeenCalled();
  });

  it("rejects DECIDED status with InvalidStateTransitionError (422)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_d",
      wholesalerId: "tenant_ws_a",
      status: "DECIDED",
    });

    await expect(
      decideEventModeAction({
        eventCandidateId: "ec_d",
        mode: "SELF",
        requiredPeople: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});

describe("decideEventModeAction — authorization", () => {
  it("rejects dealer_admin with ForbiddenError (403)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      decideEventModeAction({
        eventCandidateId: "ec_1",
        mode: "SELF",
        requiredPeople: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(eventCandidateFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("EventChange audit record", () => {
  it("EventChange is created with correct before={} / after payload on mode=DEALER", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue(CANDIDATE_CLOSED);
    relationshipFindManyMock.mockResolvedValue([REL_A]);
    eventCreateMock.mockResolvedValue({ id: "ev_chk" });

    await decideEventModeAction({
      eventCandidateId: "ec_1",
      mode: "DEALER",
      dealerRelationshipIds: ["rel_a"],
    });

    expect(eventChangeMock).toHaveBeenCalledOnce();
    const changeCall = eventChangeMock.mock.calls[0]![0] as {
      data: {
        before: Record<string, unknown>;
        after: {
          type: string;
          mode: string;
          dealerRelationshipIds: string[];
        };
      };
    };
    expect(changeCall.data.before).toEqual({});
    expect(changeCall.data.after.type).toBe("DECIDED");
    expect(changeCall.data.after.mode).toBe("DEALER");
    expect(changeCall.data.after.dealerRelationshipIds).toContain("rel_a");
  });
});

// ── changeModeAction ────────────────────────────────────────────────────────

const EXISTING_EVENT_DEALER = {
  id: "ev_existing",
  wholesalerId: "tenant_ws_a",
  mode: "SELF",
  requiredPeople: 3,
  dealers: [{ relationshipId: "rel_old" }],
};

describe("changeModeAction — SELF → DEALER", () => {
  it("updates mode, replaces EventDealer rows, records before/after diff", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT_DEALER);
    relationshipFindManyMock.mockResolvedValue([REL_A]);

    const result = await changeModeAction({
      eventId: "ev_existing",
      mode: "DEALER",
      dealerRelationshipIds: ["rel_a"],
    });

    expect(result.eventId).toBe("ev_existing");
    expect(result.mode).toBe("DEALER");

    // Event updated with new mode, requiredPeople=null for DEALER
    const updateCall = eventUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { mode: string; requiredPeople: null };
    };
    expect(updateCall.where.id).toBe("ev_existing");
    expect(updateCall.data.mode).toBe("DEALER");
    expect(updateCall.data.requiredPeople).toBeNull();

    // Old EventDealer rows deleted
    expect(eventDealerDeleteManyMock).toHaveBeenCalledOnce();

    // New EventDealer row created
    expect(eventDealerCreateMock).toHaveBeenCalledOnce();
    const dealerCall = eventDealerCreateMock.mock.calls[0]![0] as {
      data: { eventId: string; relationshipId: string };
    };
    expect(dealerCall.data.relationshipId).toBe("rel_a");

    // EventChange recorded with before/after diff
    expect(eventChangeMock).toHaveBeenCalledOnce();
    const changeCall = eventChangeMock.mock.calls[0]![0] as {
      data: {
        before: { mode: string; requiredPeople: number };
        after: { type: string; mode: string };
      };
    };
    expect(changeCall.data.before.mode).toBe("SELF");
    expect(changeCall.data.before.requiredPeople).toBe(3);
    expect(changeCall.data.after.type).toBe("MODE_CHANGED");
    expect(changeCall.data.after.mode).toBe("DEALER");
  });
});

describe("changeModeAction — DEALER → JOINT", () => {
  it("sets requiredPeople and keeps dealer rows", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue({
      id: "ev_existing",
      wholesalerId: "tenant_ws_a",
      mode: "DEALER",
      requiredPeople: null,
      dealers: [{ relationshipId: "rel_a" }],
    });
    relationshipFindManyMock.mockResolvedValue([REL_A]);

    const result = await changeModeAction({
      eventId: "ev_existing",
      mode: "JOINT",
      requiredPeople: 2,
      dealerRelationshipIds: ["rel_a"],
    });

    expect(result.mode).toBe("JOINT");

    const updateCall = eventUpdateMock.mock.calls[0]![0] as {
      data: { mode: string; requiredPeople: number };
    };
    expect(updateCall.data.mode).toBe("JOINT");
    expect(updateCall.data.requiredPeople).toBe(2);

    expect(eventDealerCreateMock).toHaveBeenCalledOnce();
    expect(eventChangeMock).toHaveBeenCalledOnce();
  });
});

describe("changeModeAction — DEALER → SELF (no dealers)", () => {
  it("deletes EventDealer rows and sets requiredPeople", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue({
      id: "ev_existing",
      wholesalerId: "tenant_ws_a",
      mode: "DEALER",
      requiredPeople: null,
      dealers: [{ relationshipId: "rel_a" }],
    });

    const result = await changeModeAction({
      eventId: "ev_existing",
      mode: "SELF",
      requiredPeople: 4,
    });

    expect(result.mode).toBe("SELF");

    // EventDealer rows deleted, none created
    expect(eventDealerDeleteManyMock).toHaveBeenCalledOnce();
    expect(eventDealerCreateMock).not.toHaveBeenCalled();

    const updateCall = eventUpdateMock.mock.calls[0]![0] as {
      data: { requiredPeople: number };
    };
    expect(updateCall.data.requiredPeople).toBe(4);
  });
});

describe("changeModeAction — authorization", () => {
  it("rejects dealer_admin with ForbiddenError", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      changeModeAction({
        eventId: "ev_existing",
        mode: "SELF",
        requiredPeople: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(eventFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("changeModeAction — not found", () => {
  it("throws NotFoundError when event does not exist", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(null);

    const { NotFoundError } = await import("../../../../../../lib/errors.js");

    await expect(
      changeModeAction({
        eventId: "ev_nonexistent",
        mode: "SELF",
        requiredPeople: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

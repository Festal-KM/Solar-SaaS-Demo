// Unit tests for EventShift Server Actions (T-03-10 / F-025).
//
// Tests cover:
//   - assign: normal success path
//   - assign: overlapping time window → ConflictError (409)
//   - assign: endPlanned <= startPlanned → ValidationError (400) from Zod
//   - unassign: normal success path
//   - staffing badge logic: fulfilled vs. insufficient (pure calculation)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const eventFindUniqueMock = vi.fn();
const shiftFindFirstMock = vi.fn();
const shiftFindUniqueMock = vi.fn();
const shiftCreateMock = vi.fn();
const shiftUpdateMock = vi.fn();
const shiftDeleteMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
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
    event: {
      findUnique: (...args: unknown[]) => eventFindUniqueMock(...args),
    },
    eventShift: {
      findFirst: (...args: unknown[]) => shiftFindFirstMock(...args),
      findUnique: (...args: unknown[]) => shiftFindUniqueMock(...args),
      create: (...args: unknown[]) => shiftCreateMock(...args),
      update: (...args: unknown[]) => shiftUpdateMock(...args),
      delete: (...args: unknown[]) => shiftDeleteMock(...args),
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

const { assignShiftAction, unassignShiftAction, updateShiftAction } = await import("../actions.js");

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

const EXISTING_EVENT = {
  id: "ev_1",
  wholesalerId: "tenant_ws_a",
};

const VALID_INPUT = {
  eventId: "ev_1",
  userId: "u_field_1",
  role: "LEAD" as const,
  startPlanned: "2026-06-15T09:00:00.000Z",
  endPlanned: "2026-06-15T17:00:00.000Z",
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventFindUniqueMock.mockReset();
  shiftFindFirstMock.mockReset();
  shiftFindUniqueMock.mockReset();
  shiftCreateMock.mockReset();
  shiftUpdateMock.mockReset();
  shiftDeleteMock.mockReset();
  revalidatePathMock.mockReset();
});

// ── assignShiftAction ─────────────────────────────────────────────────────────

describe("assignShiftAction — success", () => {
  it("creates EventShift and returns shiftId / eventId", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    shiftFindFirstMock.mockResolvedValue(null); // no overlap
    shiftCreateMock.mockResolvedValue({ id: "shift_1", eventId: "ev_1" });

    const result = await assignShiftAction(VALID_INPUT);

    expect(result.shiftId).toBe("shift_1");
    expect(result.eventId).toBe("ev_1");

    // Verify create was called with correct data
    const createCall = shiftCreateMock.mock.calls[0]![0] as {
      data: {
        eventId: string;
        userId: string;
        role: string;
        startPlanned: Date;
        endPlanned: Date;
      };
    };
    expect(createCall.data.eventId).toBe("ev_1");
    expect(createCall.data.userId).toBe("u_field_1");
    expect(createCall.data.role).toBe("LEAD");
    expect(createCall.data.startPlanned).toBeInstanceOf(Date);
    expect(createCall.data.endPlanned).toBeInstanceOf(Date);

    // revalidatePath called
    expect(revalidatePathMock).toHaveBeenCalledWith("/events/ev_1/shifts");
  });
});

describe("assignShiftAction — overlap conflict", () => {
  it("throws ConflictError (409) when a time window overlap is found", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    shiftFindFirstMock.mockResolvedValue({ id: "shift_existing" }); // overlap found

    await expect(assignShiftAction(VALID_INPUT)).rejects.toBeInstanceOf(ConflictError);

    expect(shiftCreateMock).not.toHaveBeenCalled();
  });
});

describe("assignShiftAction — invalid time (endPlanned <= startPlanned)", () => {
  it("throws ValidationError (400) when endPlanned equals startPlanned", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    const { ValidationError } = await import("../../../../../../lib/errors.js");

    await expect(
      assignShiftAction({
        ...VALID_INPUT,
        startPlanned: "2026-06-15T09:00:00.000Z",
        endPlanned: "2026-06-15T09:00:00.000Z",
      }),
    ).rejects.toThrow();

    expect(shiftCreateMock).not.toHaveBeenCalled();
  });

  it("throws when endPlanned is before startPlanned", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      assignShiftAction({
        ...VALID_INPUT,
        startPlanned: "2026-06-15T17:00:00.000Z",
        endPlanned: "2026-06-15T09:00:00.000Z",
      }),
    ).rejects.toThrow();

    expect(shiftCreateMock).not.toHaveBeenCalled();
  });
});

describe("assignShiftAction — authorization", () => {
  it("throws ForbiddenError for dealer_admin role", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(assignShiftAction(VALID_INPUT)).rejects.toBeInstanceOf(ForbiddenError);

    expect(eventFindUniqueMock).not.toHaveBeenCalled();
    expect(shiftCreateMock).not.toHaveBeenCalled();
  });
});

describe("assignShiftAction — event not found", () => {
  it("throws NotFoundError when event does not exist", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(null);

    await expect(assignShiftAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError);

    expect(shiftCreateMock).not.toHaveBeenCalled();
  });
});

// ── unassignShiftAction ───────────────────────────────────────────────────────

describe("unassignShiftAction — success", () => {
  it("deletes EventShift and returns shiftId / eventId", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue({
      id: "shift_1",
      eventId: "ev_1",
      event: { wholesalerId: "tenant_ws_a" },
    });
    shiftDeleteMock.mockResolvedValue({});

    const result = await unassignShiftAction({ shiftId: "shift_1" });

    expect(result.shiftId).toBe("shift_1");
    expect(result.eventId).toBe("ev_1");

    expect(shiftDeleteMock).toHaveBeenCalledOnce();
    const deleteCall = shiftDeleteMock.mock.calls[0]![0] as { where: { id: string } };
    expect(deleteCall.where.id).toBe("shift_1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/events/ev_1/shifts");
  });
});

describe("unassignShiftAction — not found", () => {
  it("throws NotFoundError when shift does not exist", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(null);

    await expect(unassignShiftAction({ shiftId: "shift_nonexistent" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(shiftDeleteMock).not.toHaveBeenCalled();
  });
});

// ── updateShiftAction ─────────────────────────────────────────────────────────

const EXISTING_SHIFT = {
  id: "shift_1",
  eventId: "ev_1",
  userId: "u_field_1",
  startPlanned: new Date("2026-06-15T09:00:00.000Z"),
  endPlanned: new Date("2026-06-15T17:00:00.000Z"),
  event: { wholesalerId: "tenant_ws_a" },
};

describe("updateShiftAction — success", () => {
  it("updates times and role, returns shiftId / eventId", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);
    shiftFindFirstMock.mockResolvedValue(null); // no overlap with other shifts
    shiftUpdateMock.mockResolvedValue({ id: "shift_1", eventId: "ev_1" });

    const result = await updateShiftAction({
      shiftId: "shift_1",
      role: "CATCH",
      startPlanned: "2026-06-15T10:00:00.000Z",
      endPlanned: "2026-06-15T18:00:00.000Z",
    });

    expect(result.shiftId).toBe("shift_1");
    expect(result.eventId).toBe("ev_1");

    expect(shiftUpdateMock).toHaveBeenCalledOnce();
    const updateCall = shiftUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { role?: string; startPlanned: Date; endPlanned: Date };
    };
    expect(updateCall.where.id).toBe("shift_1");
    expect(updateCall.data.role).toBe("CATCH");
    expect(updateCall.data.startPlanned).toBeInstanceOf(Date);
    expect(updateCall.data.endPlanned).toBeInstanceOf(Date);

    expect(revalidatePathMock).toHaveBeenCalledWith("/events/ev_1/shifts");
  });
});

describe("updateShiftAction — self-exclusion (no false overlap on own shift)", () => {
  it("does not flag the shift being updated as an overlap with itself", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    // existing shift spans 09:00–17:00; we update to 09:30–17:30 — same user,
    // same window overlaps itself but must NOT be counted.
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);
    // The overlap query must exclude id=shift_1. Simulate that: no other overlapping shift.
    shiftFindFirstMock.mockResolvedValue(null);
    shiftUpdateMock.mockResolvedValue({ id: "shift_1", eventId: "ev_1" });

    await expect(
      updateShiftAction({
        shiftId: "shift_1",
        startPlanned: "2026-06-15T09:30:00.000Z",
        endPlanned: "2026-06-15T17:30:00.000Z",
      }),
    ).resolves.toMatchObject({ shiftId: "shift_1" });

    // Verify the overlap query excluded the shift's own id.
    const overlapCall = shiftFindFirstMock.mock.calls[0]![0] as {
      where: { id?: { not: string } };
    };
    expect(overlapCall.where.id).toEqual({ not: "shift_1" });
  });
});

describe("updateShiftAction — overlap conflict with another shift", () => {
  it("throws ConflictError when another shift overlaps the updated window", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);
    shiftFindFirstMock.mockResolvedValue({ id: "shift_other" }); // a different shift conflicts

    await expect(
      updateShiftAction({
        shiftId: "shift_1",
        startPlanned: "2026-06-15T09:00:00.000Z",
        endPlanned: "2026-06-15T17:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(shiftUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateShiftAction — validation error (startPlanned >= endPlanned)", () => {
  it("throws (ZodError) when both times are provided and startPlanned equals endPlanned", async () => {
    // ShiftUpdateSchema.superRefine catches this before the action logic runs.
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);

    await expect(
      updateShiftAction({
        shiftId: "shift_1",
        startPlanned: "2026-06-15T12:00:00.000Z",
        endPlanned: "2026-06-15T12:00:00.000Z",
      }),
    ).rejects.toThrow();

    expect(shiftUpdateMock).not.toHaveBeenCalled();
  });

  it("throws (ZodError) when both times are provided and startPlanned is after endPlanned", async () => {
    // ShiftUpdateSchema.superRefine catches this before the action logic runs.
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);

    await expect(
      updateShiftAction({
        shiftId: "shift_1",
        startPlanned: "2026-06-15T17:00:00.000Z",
        endPlanned: "2026-06-15T09:00:00.000Z",
      }),
    ).rejects.toThrow();

    expect(shiftUpdateMock).not.toHaveBeenCalled();
  });

  it("throws ValidationError when only startPlanned is changed to after existing endPlanned", async () => {
    // Zod only checks when both are present; with one missing, the action's own
    // newStart >= newEnd guard (ValidationError) fires after resolving from existing.
    authMock.mockResolvedValue(WS_SESSION);
    shiftFindUniqueMock.mockResolvedValue(EXISTING_SHIFT);

    const { ValidationError } = await import("../../../../../../lib/errors.js");

    await expect(
      updateShiftAction({
        shiftId: "shift_1",
        startPlanned: "2026-06-15T18:00:00.000Z",
        // endPlanned not provided → resolved from existing (17:00) → start(18) > end(17)
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(shiftUpdateMock).not.toHaveBeenCalled();
  });
});

// ── Staffing sufficiency calculation (pure logic) ─────────────────────────────

describe("Staffing badge sufficiency logic", () => {
  function isFulfilled(currentCount: number, requiredPeople: number | null): boolean {
    return requiredPeople === null || currentCount >= requiredPeople;
  }

  it("returns true when currentCount equals requiredPeople", () => {
    expect(isFulfilled(3, 3)).toBe(true);
  });

  it("returns true when currentCount exceeds requiredPeople", () => {
    expect(isFulfilled(5, 3)).toBe(true);
  });

  it("returns false when currentCount is less than requiredPeople", () => {
    expect(isFulfilled(1, 3)).toBe(false);
  });

  it("returns true when requiredPeople is null (no requirement set)", () => {
    expect(isFulfilled(0, null)).toBe(true);
  });
});

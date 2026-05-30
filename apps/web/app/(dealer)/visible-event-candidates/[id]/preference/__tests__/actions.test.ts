// Unit tests for the dealer preference Server Actions (T-03-06 / F-021).
//
// Mocks `@/auth` and `@solar/db`'s `withTenant` so the actions run end-to-end
// through `withServerActionContext` → `assertCan`. Coverage:
//
//   1. submitPreferenceAction creates a new row when none exists (upsert /create branch)
//   2. submitPreferenceAction updates an existing row in place (upsert /update branch)
//   3. submitPreferenceAction rejects past-deadline with DealerPreferenceClosedError (409)
//   4. submitPreferenceAction rejects when candidate.status !== 'OPEN' (422)
//   5. submitPreferenceAction rejects cross-tenant relationshipId (403 TenantIsolationError)
//   6. withdrawPreferenceAction deletes within deadline, 409 after, 404 if missing,
//      422 if candidate.status !== 'OPEN'

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  DealerPreferenceClosedError,
  InvalidStateTransitionError,
  NotFoundError,
  TenantIsolationError,
} from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const eventCandidateFindUniqueMock = vi.fn();
const visibilityFindUniqueMock = vi.fn();
const preferenceFindUniqueMock = vi.fn();
const preferenceCreateMock = vi.fn();
const preferenceUpdateMock = vi.fn();
const preferenceDeleteMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    eventCandidate: {
      findUnique: (...args: unknown[]) => eventCandidateFindUniqueMock(...args),
    },
    eventCandidateVisibility: {
      findUnique: (...args: unknown[]) => visibilityFindUniqueMock(...args),
    },
    dealerPreference: {
      findUnique: (...args: unknown[]) => preferenceFindUniqueMock(...args),
      create: (...args: unknown[]) => preferenceCreateMock(...args),
      update: (...args: unknown[]) => preferenceUpdateMock(...args),
      delete: (...args: unknown[]) => preferenceDeleteMock(...args),
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

const { submitPreferenceAction, withdrawPreferenceAction } = await import("../actions.js");

const DEALER_SESSION = {
  user: {
    id: "u_dealer",
    tenantId: "tenant_dl_x",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dl_x",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const FAR_FUTURE = new Date("2099-12-31T23:59:59Z");
const PAST = new Date("2020-01-01T00:00:00Z");

const VALID_INPUT = {
  eventCandidateId: "ec_1",
  relationshipId: "rel_a_x",
  targetMonth: "2026-06",
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventCandidateFindUniqueMock.mockReset();
  visibilityFindUniqueMock.mockReset();
  preferenceFindUniqueMock.mockReset();
  preferenceCreateMock.mockReset();
  preferenceUpdateMock.mockReset();
  preferenceDeleteMock.mockReset();
  revalidatePathMock.mockReset();

  // Default: dealer ctx has rel_a_x in scope, candidate is OPEN with future deadline.
  authMock.mockResolvedValue(DEALER_SESSION);
  relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);
  eventCandidateFindUniqueMock.mockResolvedValue({
    id: "ec_1",
    status: "OPEN",
    deadlineAt: FAR_FUTURE,
    wholesalerId: "tenant_ws_a",
  });
  visibilityFindUniqueMock.mockResolvedValue({ isVisible: true });
});

describe("submitPreferenceAction — create branch", () => {
  it("creates a new DealerPreference row when none exists", async () => {
    preferenceFindUniqueMock.mockResolvedValue(null);
    preferenceCreateMock.mockResolvedValue({ id: "pref_new" });

    const result = await submitPreferenceAction({
      ...VALID_INPUT,
      priority: 2,
      availableDates: [new Date("2026-06-15"), new Date("2026-06-22")],
      staffCount: 3,
      note: "近隣の店舗もまとめて担当希望",
    });

    expect(result).toEqual({ id: "pref_new", created: true });
    const args = preferenceCreateMock.mock.calls[0]![0] as {
      data: {
        eventCandidateId: string;
        relationshipId: string;
        priority: number | null;
        availableDates: string[] | null;
        availablePeople: number | null;
        comment: string | null;
        submittedBy: string;
      };
    };
    expect(args.data.eventCandidateId).toBe("ec_1");
    expect(args.data.relationshipId).toBe("rel_a_x");
    expect(args.data.priority).toBe(2);
    expect(args.data.availablePeople).toBe(3);
    expect(args.data.availableDates).toHaveLength(2);
    expect((args.data.availableDates as string[])[0]).toMatch(/^2026-06-15/);
    expect(args.data.comment).toBe("近隣の店舗もまとめて担当希望");
    expect(args.data.submittedBy).toBe("u_dealer");
    expect(preferenceUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/visible-event-candidates");
    expect(revalidatePathMock).toHaveBeenCalledWith("/visible-event-candidates/ec_1/preference");
  });
});

describe("submitPreferenceAction — update branch", () => {
  it("updates an existing row in place and returns created=false", async () => {
    preferenceFindUniqueMock.mockResolvedValue({ id: "pref_existing" });
    preferenceUpdateMock.mockResolvedValue({ id: "pref_existing" });

    const result = await submitPreferenceAction({
      ...VALID_INPUT,
      priority: 1,
      staffCount: 2,
    });

    expect(result).toEqual({ id: "pref_existing", created: false });
    const args = preferenceUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: {
        priority: number | null;
        availablePeople: number | null;
        submittedBy: string;
      };
    };
    expect(args.where.id).toBe("pref_existing");
    expect(args.data.priority).toBe(1);
    expect(args.data.availablePeople).toBe(2);
    expect(args.data.submittedBy).toBe("u_dealer");
    expect(preferenceCreateMock).not.toHaveBeenCalled();
  });
});

describe("submitPreferenceAction — deadline guard", () => {
  it("throws DealerPreferenceClosedError (409, DEADLINE_PASSED) when deadline already passed", async () => {
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      deadlineAt: PAST,
      wholesalerId: "tenant_ws_a",
    });

    await expect(submitPreferenceAction(VALID_INPUT)).rejects.toBeInstanceOf(
      DealerPreferenceClosedError,
    );
    // DealerPreferenceClosedError extends ConflictError — both checks must hold.
    await expect(submitPreferenceAction(VALID_INPUT)).rejects.toBeInstanceOf(ConflictError);
    await expect(submitPreferenceAction(VALID_INPUT)).rejects.toMatchObject({
      code: "CONFLICT",
      httpStatus: 409,
    });
    expect(preferenceCreateMock).not.toHaveBeenCalled();
    expect(preferenceUpdateMock).not.toHaveBeenCalled();
  });
});

describe("submitPreferenceAction — status guard", () => {
  it("rejects with InvalidStateTransitionError when candidate.status === 'CLOSED' (422)", async () => {
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "CLOSED",
      deadlineAt: FAR_FUTURE,
      wholesalerId: "tenant_ws_a",
    });

    await expect(submitPreferenceAction(VALID_INPUT)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    expect(preferenceCreateMock).not.toHaveBeenCalled();
    expect(preferenceUpdateMock).not.toHaveBeenCalled();
  });
});

describe("submitPreferenceAction — tenant isolation", () => {
  it("rejects when relationshipId is not in caller's ctx.relationshipIds (403)", async () => {
    // ctx.relationshipIds is derived from rel.findMany. Return only rel_a_x —
    // the input asks for rel_foreign which is not in scope.
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      submitPreferenceAction({
        ...VALID_INPUT,
        relationshipId: "rel_foreign",
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);

    expect(preferenceCreateMock).not.toHaveBeenCalled();
    expect(preferenceUpdateMock).not.toHaveBeenCalled();
  });

  it("treats multiple dealers applying to the same candidate as independent (no UNIQUE conflict across relationships)", async () => {
    // Two callers, two relationships — both create their own row. The
    // (eventCandidateId, relationshipId) UNIQUE is per-pair so this is allowed.
    // We assert by running submit twice with different relationshipIds and
    // checking the second create call also goes through (find returns null
    // each time because the lookup is keyed by relationshipId).
    preferenceFindUniqueMock.mockResolvedValue(null);
    preferenceCreateMock.mockResolvedValueOnce({ id: "pref_first" });

    const first = await submitPreferenceAction(VALID_INPUT);
    expect(first.created).toBe(true);

    // Switch to another dealer in scope and submit again.
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_y" }]);
    preferenceCreateMock.mockResolvedValueOnce({ id: "pref_second" });
    const second = await submitPreferenceAction({
      ...VALID_INPUT,
      relationshipId: "rel_a_y",
    });
    expect(second.created).toBe(true);
    expect(preferenceCreateMock).toHaveBeenCalledTimes(2);
  });
});

describe("withdrawPreferenceAction", () => {
  it("deletes the existing row when status='OPEN' and within deadline", async () => {
    preferenceFindUniqueMock.mockResolvedValue({ id: "pref_existing" });
    preferenceDeleteMock.mockResolvedValue({ id: "pref_existing" });

    const result = await withdrawPreferenceAction({
      eventCandidateId: "ec_1",
      relationshipId: "rel_a_x",
    });

    expect(result).toEqual({ ok: true });
    expect(preferenceDeleteMock).toHaveBeenCalledWith({ where: { id: "pref_existing" } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/visible-event-candidates");
  });

  it("throws DealerPreferenceClosedError (409) when deadline already passed", async () => {
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "OPEN",
      deadlineAt: PAST,
      wholesalerId: "tenant_ws_a",
    });

    await expect(
      withdrawPreferenceAction({
        eventCandidateId: "ec_1",
        relationshipId: "rel_a_x",
      }),
    ).rejects.toBeInstanceOf(DealerPreferenceClosedError);
    expect(preferenceDeleteMock).not.toHaveBeenCalled();
  });

  it("throws InvalidStateTransitionError (422) when status !== 'OPEN' even before deadline", async () => {
    eventCandidateFindUniqueMock.mockResolvedValue({
      id: "ec_1",
      status: "CLOSED",
      deadlineAt: FAR_FUTURE,
      wholesalerId: "tenant_ws_a",
    });

    await expect(
      withdrawPreferenceAction({
        eventCandidateId: "ec_1",
        relationshipId: "rel_a_x",
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(preferenceDeleteMock).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when no existing preference row is found", async () => {
    preferenceFindUniqueMock.mockResolvedValue(null);

    await expect(
      withdrawPreferenceAction({
        eventCandidateId: "ec_1",
        relationshipId: "rel_a_x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(preferenceDeleteMock).not.toHaveBeenCalled();
  });
});

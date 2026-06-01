// Unit tests for the venue-negotiation Server Actions (T-03-02 / F-017).
//
// Mocks the auth session and `@solar/db` transaction client; tests run the
// actions end-to-end through `withServerActionContext` → `assertCan` so the
// permission policy added in T-03-02 (dealers 403) is exercised, alongside
// the state-machine guards and the FIXED-only promotion rule.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, InvalidStateTransitionError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const venueNegotiationCreateMock = vi.fn();
const venueNegotiationFindUniqueMock = vi.fn();
const venueNegotiationUpdateMock = vi.fn();
const venueProviderFindUniqueMock = vi.fn();
const eventCandidateCreateMock = vi.fn();
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
    venueNegotiation: {
      create: (...args: unknown[]) => venueNegotiationCreateMock(...args),
      findUnique: (...args: unknown[]) => venueNegotiationFindUniqueMock(...args),
      update: (...args: unknown[]) => venueNegotiationUpdateMock(...args),
    },
    venueProvider: {
      findUnique: (...args: unknown[]) => venueProviderFindUniqueMock(...args),
    },
    eventCandidate: {
      create: (...args: unknown[]) => eventCandidateCreateMock(...args),
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

const {
  createVenueNegotiationAction,
  updateVenueNegotiationAction,
  changeStatusAction,
  promoteToCandidateAction,
} = await import("../actions.js");

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

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  venueNegotiationCreateMock.mockReset();
  venueNegotiationFindUniqueMock.mockReset();
  venueNegotiationUpdateMock.mockReset();
  venueProviderFindUniqueMock.mockReset();
  eventCandidateCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createVenueNegotiationAction", () => {
  it("creates a negotiation for wholesaler_event_team and revalidates the list", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindUniqueMock.mockResolvedValue({ id: "vp_1" });
    venueNegotiationCreateMock.mockResolvedValue({ id: "vn_1" });

    const result = await createVenueNegotiationAction({
      venueProviderId: "vp_1",
      candidateDates: [new Date("2026-06-01"), new Date("2026-06-08")],
      contractType: "FIXED",
      fixedFee: "50000",
    });

    expect(result).toEqual({ id: "vn_1" });
    const call = venueNegotiationCreateMock.mock.calls[0]![0] as {
      data: { wholesalerId: string; venueProviderId: string; candidateDates: unknown };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.venueProviderId).toBe("vp_1");
    expect(call.data.candidateDates).toEqual(["2026-06-01", "2026-06-08"]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/venue-negotiations");
  });

  it("forbids dealer_admin (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      createVenueNegotiationAction({
        venueProviderId: "vp_1",
        candidateDates: [new Date("2026-06-01")],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(venueNegotiationCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateVenueNegotiationAction", () => {
  it("patches the named fields and revalidates list + detail", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({ id: "vn_1", status: "CONTACTING" });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_1" });

    const result = await updateVenueNegotiationAction({
      id: "vn_1",
      patch: { nextAction: "次回 6/1 来店", contractType: "FIXED", fixedFee: "10000" },
    });

    expect(result).toEqual({ id: "vn_1" });
    const args = venueNegotiationUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where.id).toBe("vn_1");
    expect(args.data.nextAction).toBe("次回 6/1 来店");
    expect(args.data.contractType).toBe("FIXED");
    // Untouched fields stay out.
    expect("conditionNote" in args.data).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/venue-negotiations");
    expect(revalidatePathMock).toHaveBeenCalledWith("/venue-negotiations/vn_1");
  });
});

describe("changeStatusAction — state machine", () => {
  it("allows CONTACTING → CONDITION_REVIEW", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({ id: "vn_1", status: "CONTACTING" });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_1", status: "CONDITION_REVIEW" });

    const result = await changeStatusAction({ id: "vn_1", status: "CONDITION_REVIEW" });

    expect(result).toEqual({ id: "vn_1", status: "CONDITION_REVIEW" });
    const args = venueNegotiationUpdateMock.mock.calls[0]![0] as {
      data: { status: string; decidedDate?: Date };
    };
    expect(args.data.status).toBe("CONDITION_REVIEW");
    expect(args.data.decidedDate).toBeUndefined();
  });

  it("stamps decidedDate when transitioning to FIXED", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({ id: "vn_1", status: "FEASIBLE" });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_1", status: "FIXED" });

    await changeStatusAction({ id: "vn_1", status: "FIXED" });

    const args = venueNegotiationUpdateMock.mock.calls[0]![0] as {
      data: { status: string; decidedDate?: Date };
    };
    expect(args.data.status).toBe("FIXED");
    expect(args.data.decidedDate).toBeInstanceOf(Date);
  });

  it("rejects same-state transitions (no-op guard)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({ id: "vn_1", status: "FIXED" });

    await expect(changeStatusAction({ id: "vn_1", status: "FIXED" })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    expect(venueNegotiationUpdateMock).not.toHaveBeenCalled();
  });

  it("allows re-opening from INFEASIBLE (state machine relaxed for demo)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({
      id: "vn_2",
      status: "INFEASIBLE",
      note: null,
    });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_2", status: "CONTACTING" });

    await expect(
      changeStatusAction({ id: "vn_2", status: "CONTACTING" }),
    ).resolves.toEqual({ id: "vn_2", status: "CONTACTING" });
  });

  it("forbids dealer_admin from status changes", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(changeStatusAction({ id: "vn_1", status: "FIXED" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(venueNegotiationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("appends the new status line to the existing note (preserves history)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({
      id: "vn_1",
      status: "CONTACTING",
      note: "preexisting line",
    });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_1", status: "CONDITION_REVIEW" });

    await changeStatusAction({ id: "vn_1", status: "CONDITION_REVIEW", reason: "reason1" });

    const args = venueNegotiationUpdateMock.mock.calls[0]![0] as {
      data: { note?: string };
    };
    expect(typeof args.data.note).toBe("string");
    expect(args.data.note).toMatch(/^preexisting line\n\[[^\]]+\] CONDITION_REVIEW: reason1$/);
  });

  it("omits the note key entirely when reason is undefined", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({
      id: "vn_1",
      status: "CONTACTING",
      note: "preexisting line",
    });
    venueNegotiationUpdateMock.mockResolvedValue({ id: "vn_1", status: "CONDITION_REVIEW" });

    await changeStatusAction({ id: "vn_1", status: "CONDITION_REVIEW" });

    const args = venueNegotiationUpdateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect("note" in args.data).toBe(false);
  });
});

describe("promoteToCandidateAction", () => {
  it("creates an EventCandidate when status is FIXED (atomic with VenueNegotiation)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({
      id: "vn_1",
      status: "FIXED",
      venueProviderId: "vp_1",
      contractType: "FIXED",
      fixedFee: "50000",
      performanceRate: null,
    });
    eventCandidateCreateMock.mockResolvedValue({ id: "ec_1" });

    const result = await promoteToCandidateAction({
      id: "vn_1",
      candidate: {
        targetMonth: "2026-06",
        scheduledDate: new Date("2026-06-15"),
        storeName: "ホームセンター A 店",
        deadlineAt: new Date("2026-06-05"),
      },
    });

    expect(result).toEqual({ eventCandidateId: "ec_1" });
    const args = eventCandidateCreateMock.mock.calls[0]![0] as {
      data: {
        wholesalerId: string;
        venueProviderId: string;
        venueNegotiationId: string;
        targetMonth: string;
        storeName: string;
        contractType: string;
        fixedFee: string;
        createdBy: string;
      };
    };
    expect(args.data.wholesalerId).toBe("tenant_ws_a");
    expect(args.data.venueProviderId).toBe("vp_1");
    expect(args.data.venueNegotiationId).toBe("vn_1");
    expect(args.data.targetMonth).toBe("2026-06");
    expect(args.data.storeName).toBe("ホームセンター A 店");
    expect(args.data.contractType).toBe("FIXED");
    expect(args.data.fixedFee).toBe("50000");
    expect(args.data.createdBy).toBe("u_ws_event");
  });

  it("rejects promotion when status is not FIXED (422 INVALID_STATE_TRANSITION)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueNegotiationFindUniqueMock.mockResolvedValue({
      id: "vn_2",
      status: "FEASIBLE",
      venueProviderId: "vp_2",
      contractType: null,
      fixedFee: null,
      performanceRate: null,
    });

    await expect(
      promoteToCandidateAction({
        id: "vn_2",
        candidate: {
          targetMonth: "2026-06",
          scheduledDate: new Date("2026-06-15"),
          storeName: "店舗",
          deadlineAt: new Date("2026-06-05"),
        },
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(eventCandidateCreateMock).not.toHaveBeenCalled();
  });
});

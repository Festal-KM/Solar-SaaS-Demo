// Unit tests for the event-candidate Server Actions (T-03-03 / F-018).
//
// Mocks the auth session and `@solar/db` transaction client; the actions run
// end-to-end through `withServerActionContext` → `assertCan`. We exercise:
//   - DRAFT create + revalidate path
//   - DRAFT update (full patch)
//   - non-DRAFT update rejects forbidden fields (deadlineAt only allowed)
//   - state machine: DRAFT → OPEN (publish), OPEN → CLOSED (closePreference)
//   - invalid transitions raise InvalidStateTransitionError (422)
//   - dealer 403 (ForbiddenError) on create
//   - DTO: dealer-shaped object physically omits internalNote /
//     fixedFee / performanceRate keys

import { toEventCandidateDealerDto } from "@solar/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from "../../../../lib/errors.js";

import type { EventCandidateForWholesalerDto } from "@solar/contracts";
import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const eventCandidateCreateMock = vi.fn();
const eventCandidateFindUniqueMock = vi.fn();
const eventCandidateUpdateMock = vi.fn();
const venueProviderFindUniqueMock = vi.fn();
const venueNegotiationFindUniqueMock = vi.fn();
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
      create: (...args: unknown[]) => eventCandidateCreateMock(...args),
      findUnique: (...args: unknown[]) => eventCandidateFindUniqueMock(...args),
      update: (...args: unknown[]) => eventCandidateUpdateMock(...args),
    },
    venueProvider: {
      findUnique: (...args: unknown[]) => venueProviderFindUniqueMock(...args),
    },
    venueNegotiation: {
      findUnique: (...args: unknown[]) => venueNegotiationFindUniqueMock(...args),
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
  createEventCandidateAction,
  updateEventCandidateAction,
  publishEventCandidateAction,
  closePreferenceAction,
  cancelEventCandidateAction,
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

const VALID_INPUT = {
  targetMonth: "2026-06",
  scheduledDate: new Date("2026-06-15"),
  storeName: "ホームセンター A 店",
  deadlineAt: new Date("2026-06-05"),
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventCandidateCreateMock.mockReset();
  eventCandidateFindUniqueMock.mockReset();
  eventCandidateUpdateMock.mockReset();
  venueProviderFindUniqueMock.mockReset();
  venueNegotiationFindUniqueMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createEventCandidateAction", () => {
  it("creates a DRAFT row for wholesaler_event_team and revalidates the list", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateCreateMock.mockResolvedValue({ id: "ec_1" });

    const result = await createEventCandidateAction({
      ...VALID_INPUT,
      internalNote: "internal only",
      fixedFee: "50000",
    });

    expect(result).toEqual({ id: "ec_1" });
    const call = eventCandidateCreateMock.mock.calls[0]![0] as {
      data: {
        wholesalerId: string;
        targetMonth: string;
        storeName: string;
        internalNote: string;
        fixedFee: string;
        createdBy: string;
      };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.targetMonth).toBe("2026-06");
    expect(call.data.storeName).toBe("ホームセンター A 店");
    expect(call.data.internalNote).toBe("internal only");
    expect(call.data.fixedFee).toBe("50000");
    expect(call.data.createdBy).toBe("u_ws_event");
    expect(revalidatePathMock).toHaveBeenCalledWith("/event-detail");
  });

  it("forbids dealer_admin (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(createEventCandidateAction(VALID_INPUT)).rejects.toBeInstanceOf(ForbiddenError);

    expect(eventCandidateCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateEventCandidateAction", () => {
  it("patches arbitrary fields when status is DRAFT", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({ id: "ec_1", status: "DRAFT" });
    eventCandidateUpdateMock.mockResolvedValue({ id: "ec_1" });

    const result = await updateEventCandidateAction({
      id: "ec_1",
      patch: {
        storeName: "店舗 B",
        fixedFee: "70000",
        internalNote: "メモ更新",
      },
    });

    expect(result).toEqual({ id: "ec_1" });
    const args = eventCandidateUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where.id).toBe("ec_1");
    expect(args.data.storeName).toBe("店舗 B");
    expect(args.data.fixedFee).toBe("70000");
    expect(args.data.internalNote).toBe("メモ更新");
    expect("targetMonth" in args.data).toBe(false);
  });

  it("rejects non-DRAFT updates that touch sealed fields (400 VALIDATION_FAILED)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({ id: "ec_2", status: "OPEN" });

    await expect(
      updateEventCandidateAction({
        id: "ec_2",
        patch: { storeName: "勝手に変更", fixedFee: "9999" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(eventCandidateUpdateMock).not.toHaveBeenCalled();
  });

  it("allows non-DRAFT updates that only touch deadlineAt / internalNote", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValue({ id: "ec_2", status: "OPEN" });
    eventCandidateUpdateMock.mockResolvedValue({ id: "ec_2" });

    await updateEventCandidateAction({
      id: "ec_2",
      patch: {
        deadlineAt: new Date("2026-06-10T12:00:00Z"),
        internalNote: "期限延長理由を記録",
      },
    });

    const args = eventCandidateUpdateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.deadlineAt).toBeInstanceOf(Date);
    expect(args.data.internalNote).toBe("期限延長理由を記録");
    expect("storeName" in args.data).toBe(false);
    expect("fixedFee" in args.data).toBe(false);
  });
});

describe("status transitions", () => {
  it("publishEventCandidateAction: DRAFT → OPEN stamps publishedAt", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    // first findUnique (transitionStatus existing-row check)
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ id: "ec_1", status: "DRAFT" });
    // second findUnique (publishedAt lookup before write)
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ publishedAt: null });
    eventCandidateUpdateMock.mockResolvedValue({ id: "ec_1", status: "OPEN" });

    const result = await publishEventCandidateAction({ id: "ec_1" });

    expect(result).toEqual({ id: "ec_1", status: "OPEN" });
    const args = eventCandidateUpdateMock.mock.calls[0]![0] as {
      data: { status: string; publishedAt?: Date };
    };
    expect(args.data.status).toBe("OPEN");
    expect(args.data.publishedAt).toBeInstanceOf(Date);
  });

  it("closePreferenceAction: OPEN → CLOSED is allowed", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ id: "ec_1", status: "OPEN" });
    eventCandidateUpdateMock.mockResolvedValue({ id: "ec_1", status: "CLOSED" });

    const result = await closePreferenceAction({ id: "ec_1" });

    expect(result).toEqual({ id: "ec_1", status: "CLOSED" });
  });

  it("rejects publishEventCandidateAction when status is already DECIDED (422)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ id: "ec_d", status: "DECIDED" });

    await expect(publishEventCandidateAction({ id: "ec_d" })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    expect(eventCandidateUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects any transition out of CANCELLED (terminal)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ id: "ec_x", status: "CANCELLED" });

    await expect(cancelEventCandidateAction({ id: "ec_x" })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });

  it("allows CLOSED → OPEN (期限延長 / re-open) without overwriting publishedAt", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    const originalPublishedAt = new Date("2026-06-01T00:00:00Z");
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ id: "ec_r", status: "CLOSED" });
    eventCandidateFindUniqueMock.mockResolvedValueOnce({ publishedAt: originalPublishedAt });
    eventCandidateUpdateMock.mockResolvedValue({ id: "ec_r", status: "OPEN" });

    await publishEventCandidateAction({ id: "ec_r" });

    const args = eventCandidateUpdateMock.mock.calls[0]![0] as {
      data: { status: string; publishedAt?: Date };
    };
    expect(args.data.status).toBe("OPEN");
    // publishedAt is preserved (we don't write it because the row already has
    // a value) → the `publishedAt` key must not appear on the update payload.
    expect("publishedAt" in args.data).toBe(false);
  });
});

describe("toEventCandidateDealerDto", () => {
  it("physically removes internalNote / fixedFee / performanceRate / contractNote keys", () => {
    const wholesalerDto: EventCandidateForWholesalerDto = {
      id: "ec_1",
      wholesalerId: "tenant_ws_a",
      venueProviderId: "vp_1",
      venueNegotiationId: null,
      targetMonth: "2026-06",
      scheduledDate: "2026-06-15T00:00:00.000Z",
      storeName: "店舗 A",
      address: "東京都...",
      area: "関東",
      deadlineAt: "2026-06-05T15:00:00.000Z",
      contractType: "FIXED",
      fixedFee: "50000",
      performanceRate: "10",
      internalNote: "内部メモ - 二次店に絶対漏らさない",
      contractNote: "契約メモ - 二次店に絶対漏らさない",
      status: "OPEN",
      publishedAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    };

    const dealerDto = toEventCandidateDealerDto(wholesalerDto);

    const keys = Object.keys(dealerDto);
    expect(keys).not.toContain("internalNote");
    expect(keys).not.toContain("fixedFee");
    expect(keys).not.toContain("performanceRate");
    expect(keys).not.toContain("contractNote");
    // and the non-sensitive fields are preserved verbatim:
    expect(dealerDto.id).toBe("ec_1");
    expect(dealerDto.storeName).toBe("店舗 A");
    expect(dealerDto.targetMonth).toBe("2026-06");
    expect(dealerDto.status).toBe("OPEN");
  });
});

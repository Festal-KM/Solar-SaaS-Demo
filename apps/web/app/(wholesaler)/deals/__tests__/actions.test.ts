// Unit tests for deal Server Actions (T-05-03 / F-038).
//
// Covers:
//   1. Successful deal creation (wholesaler_admin).
//   2. APPOINTMENT_ONLY dealer → create blocked (ForbiddenError).
//   3. FIRST_VISIT dealer → pitch transition (PROPOSING) blocked (ForbiddenError).
//   4. FIRST_VISIT dealer → visit transition (VISITED) allowed.
//   5. FULL_CLOSING dealer → all operations succeed.
//   6. Valid status transition (VISIT_PLANNED → VISITED).
//   7. Invalid status transition → InvalidStateTransitionError.
//   8. CONTRACTED and LOST are terminal — no further transitions.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, InvalidStateTransitionError, NotFoundError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const dealCreateMock = vi.fn();
const dealFindUniqueMock = vi.fn();
const dealUpdateMock = vi.fn();
const eventDealerFindFirstMock = vi.fn();
const relationshipFindFirstMock = vi.fn();
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
    deal: {
      create: (...args: unknown[]) => dealCreateMock(...args),
      findUnique: (...args: unknown[]) => dealFindUniqueMock(...args),
      update: (...args: unknown[]) => dealUpdateMock(...args),
    },
    eventDealer: {
      findFirst: (...args: unknown[]) => eventDealerFindFirstMock(...args),
    },
    relationship: {
      findFirst: (...args: unknown[]) => relationshipFindFirstMock(...args),
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

const { createDealAction, updateDealAction, changeStatusAction } = await import("../actions.js");

const WS_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

function dealerSession(scope: "APPOINTMENT_ONLY" | "FIRST_VISIT" | "FULL_CLOSING") {
  return {
    user: {
      id: "u_dl_admin",
      tenantId: "tenant_dl_x",
      tenantType: "DEALER",
      wholesalerId: "tenant_ws_a",
      dealerId: "tenant_dl_x",
      roles: ["DEALER_ADMIN"],
      isSaasAdmin: false,
      _scope: scope, // carried for test setup only
    },
  };
}

function setupDealerScope(
  scope: "APPOINTMENT_ONLY" | "FIRST_VISIT" | "FULL_CLOSING",
) {
  relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);
  eventDealerFindFirstMock.mockResolvedValue({ scopeOverride: null });
  relationshipFindFirstMock.mockResolvedValue({ defaultScope: scope });
}

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  dealCreateMock.mockReset();
  dealFindUniqueMock.mockReset();
  dealUpdateMock.mockReset();
  eventDealerFindFirstMock.mockReset();
  relationshipFindFirstMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createDealAction", () => {
  it("1. creates a deal for wholesaler_admin", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealCreateMock.mockResolvedValue({ id: "deal_1" });

    const result = await createDealAction({
      customerId: "cust_1",
      assignedToUserId: "u_ws_admin",
    });

    expect(result).toEqual({ id: "deal_1" });
    const call = dealCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.customerId).toBe("cust_1");
    expect(call.data.ownerType).toBe("WHOLESALER");
    expect(call.data.status).toBe("VISIT_PLANNED");
    expect(revalidatePathMock).toHaveBeenCalledWith("/deals");
  });

  it("2. APPOINTMENT_ONLY dealer → ForbiddenError on create", async () => {
    authMock.mockResolvedValue(dealerSession("APPOINTMENT_ONLY"));
    setupDealerScope("APPOINTMENT_ONLY");

    await expect(
      createDealAction({
        customerId: "cust_1",
        assignedToUserId: "u_dl_admin",
        ownerRelationshipId: "rel_a_x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(dealCreateMock).not.toHaveBeenCalled();
  });

  it("5. FULL_CLOSING dealer → create succeeds", async () => {
    authMock.mockResolvedValue(dealerSession("FULL_CLOSING"));
    setupDealerScope("FULL_CLOSING");
    dealCreateMock.mockResolvedValue({ id: "deal_2" });

    const result = await createDealAction({
      customerId: "cust_2",
      assignedToUserId: "u_dl_admin",
      ownerRelationshipId: "rel_a_x",
    });

    expect(result).toEqual({ id: "deal_2" });
    const call = dealCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.ownerType).toBe("DEALER");
  });
});

describe("changeStatusAction", () => {
  it("6. valid status transition VISIT_PLANNED → VISITED succeeds", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_1",
      status: "VISIT_PLANNED",
      ownerRelationshipId: null,
    });
    dealUpdateMock.mockResolvedValue({ id: "deal_1" });

    const result = await changeStatusAction({ id: "deal_1", status: "VISITED" });

    expect(result).toEqual({ id: "deal_1" });
    const call = dealUpdateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.status).toBe("VISITED");
  });

  it("7. invalid state transition throws InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_1",
      status: "VISIT_PLANNED",
      ownerRelationshipId: null,
    });

    await expect(
      changeStatusAction({ id: "deal_1", status: "CONTRACTED" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(dealUpdateMock).not.toHaveBeenCalled();
  });

  it("8. CONTRACTED is terminal — CONTRACTED → LOST throws InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_1",
      status: "CONTRACTED",
      ownerRelationshipId: null,
    });

    await expect(
      changeStatusAction({ id: "deal_1", status: "LOST" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("3. FIRST_VISIT dealer → pitch (PROPOSING) blocked by scope", async () => {
    authMock.mockResolvedValue(dealerSession("FIRST_VISIT"));
    setupDealerScope("FIRST_VISIT");
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_2",
      status: "VISITED",
      ownerRelationshipId: "rel_a_x",
    });

    await expect(
      changeStatusAction({ id: "deal_2", status: "PROPOSING" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(dealUpdateMock).not.toHaveBeenCalled();
  });

  it("4. FIRST_VISIT dealer → visit transition (VISIT_PLANNED → VISITED) succeeds", async () => {
    authMock.mockResolvedValue(dealerSession("FIRST_VISIT"));
    setupDealerScope("FIRST_VISIT");
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_3",
      status: "VISIT_PLANNED",
      ownerRelationshipId: "rel_a_x",
    });
    dealUpdateMock.mockResolvedValue({ id: "deal_3" });

    const result = await changeStatusAction({ id: "deal_3", status: "VISITED" });
    expect(result).toEqual({ id: "deal_3" });
  });
});

describe("updateDealAction", () => {
  it("2b. APPOINTMENT_ONLY dealer → update blocked (ForbiddenError)", async () => {
    authMock.mockResolvedValue(dealerSession("APPOINTMENT_ONLY"));
    setupDealerScope("APPOINTMENT_ONLY");
    dealFindUniqueMock.mockResolvedValue({
      id: "deal_1",
      status: "VISIT_PLANNED",
      ownerRelationshipId: "rel_a_x",
    });

    await expect(
      updateDealAction({ id: "deal_1", notes: "メモ更新" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(dealUpdateMock).not.toHaveBeenCalled();
  });

  it("deal not found throws NotFoundError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateDealAction({ id: "no_such_deal", notes: "テスト" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

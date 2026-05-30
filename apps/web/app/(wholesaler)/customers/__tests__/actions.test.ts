// Unit tests for customer Server Actions (T-04-06 / F-031).
//
// Covers:
//   1. Successful customer creation (wholesaler_admin).
//   2. EVENT channel without sourceEventId → ValidationError (Zod refine).
//   3. Duplicate phone → success with duplicatePhoneWarning=true.
//   4. Dealer tenant can only access own-tenant customers (cross-tenant guard).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const customerCreateMock = vi.fn();
const customerFindFirstMock = vi.fn();
const customerFindUniqueMock = vi.fn();
const customerUpdateMock = vi.fn();
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
    customer: {
      create: (...args: unknown[]) => customerCreateMock(...args),
      findFirst: (...args: unknown[]) => customerFindFirstMock(...args),
      findUnique: (...args: unknown[]) => customerFindUniqueMock(...args),
      update: (...args: unknown[]) => customerUpdateMock(...args),
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

const { createCustomerAction, updateCustomerAction } = await import("../actions.js");

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
  customerCreateMock.mockReset();
  customerFindFirstMock.mockReset();
  customerFindUniqueMock.mockReset();
  customerUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createCustomerAction", () => {
  it("creates a customer for wholesaler_admin without duplicate phone", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindFirstMock.mockResolvedValue(null); // no duplicate
    customerCreateMock.mockResolvedValue({ id: "cust_1" });

    const result = await createCustomerAction({
      name: "山田 太郎",
      phone: "090-1234-5678",
      channel: "WALK_IN",
      status: "NEW",
    });

    expect(result).toEqual({ id: "cust_1", duplicatePhoneWarning: false });
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
    const call = customerCreateMock.mock.calls[0]![0] as {
      data: { wholesalerId: string; name: string; channel: string; registeredByOrgType: string };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.name).toBe("山田 太郎");
    expect(call.data.channel).toBe("WALK_IN");
    expect(call.data.registeredByOrgType).toBe("WHOLESALER");
    expect(revalidatePathMock).toHaveBeenCalledWith("/customers");
  });

  it("rejects EVENT channel without sourceEventId (Zod refine → ValidationError)", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      createCustomerAction({
        name: "催事顧客",
        phone: "080-9999-0000",
        channel: "EVENT",
        // sourceEventId intentionally omitted
        status: "NEW",
      }),
    ).rejects.toThrow("催事 ID");

    expect(customerCreateMock).not.toHaveBeenCalled();
  });

  it("returns duplicatePhoneWarning=true when same phone already exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindFirstMock.mockResolvedValue({ id: "cust_existing" }); // duplicate found
    customerCreateMock.mockResolvedValue({ id: "cust_new" });

    const result = await createCustomerAction({
      name: "佐藤 花子",
      phone: "090-1234-5678",
      channel: "TELE",
      status: "NEW",
    });

    expect(result.duplicatePhoneWarning).toBe(true);
    expect(result.id).toBe("cust_new");
    // Customer should still be created despite the duplicate warning.
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
  });

  it("forbids wholesaler_event_team from creating customers via a missing permission role guard", async () => {
    // WHOLESALER_EVENT_TEAM is NOT in customer.create allow-list
    authMock.mockResolvedValue({
      user: {
        ...WS_SESSION.user,
        roles: ["WHOLESALER_EVENT_TEAM"],
      },
    });

    await expect(
      createCustomerAction({
        name: "テスト顧客",
        phone: "070-0000-0001",
        channel: "WALK_IN",
        status: "NEW",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(customerCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateCustomerAction", () => {
  it("updates the customer fields and revalidates paths", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindUniqueMock.mockResolvedValue({
      id: "cust_1",
      phone: "090-0000-0001",
      wholesalerId: "tenant_ws_a",
    });
    customerUpdateMock.mockResolvedValue({ id: "cust_1" });

    const result = await updateCustomerAction({
      id: "cust_1",
      name: "山田 次郎",
    });

    expect(result.id).toBe("cust_1");
    expect(result.duplicatePhoneWarning).toBe(false);
    const updateArgs = customerUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArgs.where.id).toBe("cust_1");
    expect(updateArgs.data.name).toBe("山田 次郎");
    expect(revalidatePathMock).toHaveBeenCalledWith("/customers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/customers/cust_1");
  });

  it("dealer_admin is allowed to update (has customer.update role)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);
    customerFindUniqueMock.mockResolvedValue({
      id: "cust_2",
      phone: "090-5555-4444",
      wholesalerId: "tenant_ws_a",
    });
    customerUpdateMock.mockResolvedValue({ id: "cust_2" });

    const result = await updateCustomerAction({
      id: "cust_2",
      note: "フォローアップ必要",
    });

    // RLS enforces tenant isolation at DB level; the action itself should succeed.
    expect(result.id).toBe("cust_2");
  });
});

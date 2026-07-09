// Unit tests for customer list data loaders (T-04-07 / F-032).
//
// Covers:
//   1. Wholesaler sees all matching customers (with PII masking at PARTIAL mode).
//   2. Return shape: manual status columns pass through + masked PII + マエカク.
//   3. Status filters (manual column equality) pushed into the DB where clause.
//   4. Pagination — pageSize (20/50/100) respected, skip/take + totalPages.
//   5. Dealer sees only ownerRelationshipId-filtered customers (unchanged loader).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const customerFindManyMock = vi.fn();
const customerCountMock = vi.fn();
const constructionFindManyMock = vi.fn();
const dealFindManyMock = vi.fn();
const contractFindManyMock = vi.fn();
const appointmentFindManyMock = vi.fn();
const userFindManyMock = vi.fn();
const wholesalerSettingsFindUniqueMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    customer: {
      findMany: (...args: unknown[]) => customerFindManyMock(...args),
      count: (...args: unknown[]) => customerCountMock(...args),
    },
    construction: {
      findMany: (...args: unknown[]) => constructionFindManyMock(...args),
    },
    deal: {
      findMany: (...args: unknown[]) => dealFindManyMock(...args),
    },
    contract: {
      findMany: (...args: unknown[]) => contractFindManyMock(...args),
    },
    appointment: {
      findMany: (...args: unknown[]) => appointmentFindManyMock(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    wholesalerSettings: {
      findUnique: (...args: unknown[]) => wholesalerSettingsFindUniqueMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
      },
      wholesalerSettings: {
        findUnique: (...args: unknown[]) => wholesalerSettingsFindUniqueMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

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

function makeCustomerRow(overrides: Partial<{
  id: string;
  name: string;
  address: string | null;
  area: string | null;
  registeredByUserId: string;
  contractStatus: string;
  constructionStatus: string;
  subsidyStatus: string;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "cust_1",
    name: overrides.name ?? "山田 太郎",
    address: overrides.address ?? "東京都新宿区西新宿1-1",
    area: overrides.area ?? null,
    registeredByUserId: overrides.registeredByUserId ?? "u_assignee",
    contractStatus: overrides.contractStatus ?? "negotiating",
    constructionStatus: overrides.constructionStatus ?? "not_started",
    subsidyStatus: overrides.subsidyStatus ?? "not_applied",
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

// Convenience: by default the related queries return empty arrays. The list
// loader now reads statuses straight off the customer row (manual columns), so
// only appointments (マエカク / next-appt) + user.findMany (assignee names) are
// consumed; deal/contract mocks are kept harmless for the shared prisma surface.
function defaultRelatedEmpty() {
  dealFindManyMock.mockResolvedValue([]);
  contractFindManyMock.mockResolvedValue([]);
  appointmentFindManyMock.mockResolvedValue([]);
  userFindManyMock.mockResolvedValue([]);
  constructionFindManyMock.mockResolvedValue([]);
}

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  customerFindManyMock.mockReset();
  customerCountMock.mockReset();
  constructionFindManyMock.mockReset();
  constructionFindManyMock.mockResolvedValue([]);
  dealFindManyMock.mockReset();
  contractFindManyMock.mockReset();
  appointmentFindManyMock.mockReset();
  userFindManyMock.mockReset();
  wholesalerSettingsFindUniqueMock.mockReset();
});

// ──────────────────────────────────────────────
// Wholesaler data loader
// ──────────────────────────────────────────────

const { listCustomers } = await import("../data.js");

describe("listCustomers (wholesaler)", () => {
  it("returns masked PII + column defaults when no related records", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "PARTIAL" });
    customerFindManyMock.mockResolvedValue([makeCustomerRow()]);
    customerCountMock.mockResolvedValue(1);
    defaultRelatedEmpty();

    const result = await listCustomers();

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    // PARTIAL masking for wholesaler: name = family name only.
    expect(item.name).toBe("山田");
    // エリア = leading 都道府県 of the address.
    expect(item.area).toBe("東京都");
    // Manual columns default to negotiating / not_started / none.
    expect(item.contractStatus).toBe("negotiating");
    expect(item.constructionStatus).toBe("not_started");
    expect(item.subsidyStatus).toBe("not_applied");
    expect(item.maekaku).toBe("absent");
    expect(item.nextAppointmentAt).toBeNull();
    // Unresolved registeredByUserId (dealer registrant / no user) → "—".
    expect(item.assigneeName).toBe("—");
    // phone is NOT exposed in the new list shape.
    expect(item).not.toHaveProperty("phone");
  });

  it("prefers the stored area over the address-derived prefecture", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    // address is 東京都… but a stored area of 千葉県 must win.
    customerFindManyMock.mockResolvedValue([makeCustomerRow({ area: "千葉県" })]);
    customerCountMock.mockResolvedValue(1);
    defaultRelatedEmpty();

    const result = await listCustomers();

    expect(result.items[0]!.area).toBe("千葉県");
  });

  it("resolves assigneeName from registeredByUserId within the tenant", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([
      makeCustomerRow({ id: "cust_a", registeredByUserId: "u_sato" }),
      makeCustomerRow({ id: "cust_b", registeredByUserId: "u_unknown" }),
    ]);
    customerCountMock.mockResolvedValue(2);
    dealFindManyMock.mockResolvedValue([]);
    contractFindManyMock.mockResolvedValue([]);
    appointmentFindManyMock.mockResolvedValue([]);
    // RLS-scoped lookup resolves only the in-tenant user; u_unknown is invisible.
    userFindManyMock.mockResolvedValue([{ id: "u_sato", name: "佐藤 花子" }]);

    const result = await listCustomers();

    expect(result.items[0]!.assigneeName).toBe("佐藤 花子");
    expect(result.items[1]!.assigneeName).toBe("—");
  });

  it("pushes assignee + maekaku filters into the DB where clause", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([]);
    customerCountMock.mockResolvedValue(0);
    defaultRelatedEmpty();

    await listCustomers({ assigneeUserId: "u_sato", maekaku: "present" });

    const callArgs = customerFindManyMock.mock.calls[0]![0] as {
      where: { AND?: unknown[] };
    };
    expect(callArgs.where.AND).toContainEqual({ registeredByUserId: "u_sato" });
    expect(callArgs.where.AND).toContainEqual({
      appointments: { some: { preCall: { isNot: null } } },
    });
  });

  it("maekaku=absent uses appointments none preCall", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([]);
    customerCountMock.mockResolvedValue(0);
    defaultRelatedEmpty();

    await listCustomers({ maekaku: "absent" });

    const callArgs = customerFindManyMock.mock.calls[0]![0] as {
      where: { AND?: unknown[] };
    };
    expect(callArgs.where.AND).toContainEqual({
      appointments: { none: { preCall: { isNot: null } } },
    });
  });

  it("passes through manual columns contracted / done / granted + マエカク", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([
      makeCustomerRow({
        id: "cust_full",
        contractStatus: "contracted",
        constructionStatus: "done",
        subsidyStatus: "completed",
      }),
    ]);
    customerCountMock.mockResolvedValue(1);

    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    appointmentFindManyMock.mockResolvedValue([
      { customerId: "cust_full", scheduledAt: future, preCall: { id: "pc_1" } },
    ]);
    userFindManyMock.mockResolvedValue([]);

    const result = await listCustomers();
    const item = result.items[0]!;

    expect(item.contractStatus).toBe("contracted");
    expect(item.constructionStatus).toBe("done");
    expect(item.subsidyStatus).toBe("completed");
    expect(item.maekaku).toBe("present");
    expect(item.nextAppointmentAt).toBe(future.toISOString());
  });

  it("passes through manual columns negotiating / in_progress / applying", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([
      makeCustomerRow({
        id: "cust_mid",
        contractStatus: "negotiating",
        constructionStatus: "in_progress",
        subsidyStatus: "applied",
      }),
    ]);
    customerCountMock.mockResolvedValue(1);
    appointmentFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);

    const result = await listCustomers();
    const item = result.items[0]!;

    expect(item.contractStatus).toBe("negotiating");
    expect(item.constructionStatus).toBe("in_progress");
    expect(item.subsidyStatus).toBe("applied");
  });

  it("pushes status filters into the DB where clause", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([]);
    customerCountMock.mockResolvedValue(0);
    defaultRelatedEmpty();

    await listCustomers({
      contractStatus: "contracted",
      constructionStatus: "done",
      subsidyStatus: "completed",
    });

    const callArgs = customerFindManyMock.mock.calls[0]![0] as {
      where: { AND?: unknown[] };
    };
    expect(Array.isArray(callArgs.where.AND)).toBe(true);
    expect(callArgs.where.AND).toHaveLength(3);
    // 契約 / 設置申請 are manual columns → direct equality.
    expect(callArgs.where.AND).toContainEqual({ contractStatus: "contracted" });
    expect(callArgs.where.AND).toContainEqual({ subsidyStatus: "completed" });
    // 施工状況 is derived from constructions → buildConstructionStatusWhere("done"):
    // "no in-progress AND has DONE" (fixed priority), OR the 0-construction fallback.
    expect(callArgs.where.AND).toContainEqual({
      OR: [
        {
          AND: [
            {
              NOT: {
                contracts: {
                  some: {
                    constructions: {
                      some: { status: { in: ["REQUESTED", "SURVEYED", "CONSTRUCTING", "PAUSED"] } },
                    },
                  },
                },
              },
            },
            { contracts: { some: { constructions: { some: { status: "DONE" } } } } },
          ],
        },
        {
          AND: [
            { NOT: { contracts: { some: { constructions: { some: {} } } } } },
            { constructionStatus: "done" },
          ],
        },
      ],
    });
  });

  it("derives 施工状況=done from constructions using fixed priority (DONE + newer REQUEST_PENDING → done)", async () => {
    // Regression guard: the derived list label must match the done filter.
    // A customer with DONE + a REQUEST_PENDING (would-be not_started) must be done.
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([
      makeCustomerRow({ id: "cust_multi", constructionStatus: "not_started" }),
    ]);
    customerCountMock.mockResolvedValue(1);
    appointmentFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    constructionFindManyMock.mockResolvedValue([
      { status: "DONE", contract: { customerId: "cust_multi" } },
      { status: "REQUEST_PENDING", contract: { customerId: "cust_multi" } },
    ]);

    const result = await listCustomers();

    expect(result.items[0]!.constructionStatus).toBe("done");
  });

  it("respects pagination: pageSize=50 page=2 skips 50 rows", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([]);
    customerCountMock.mockResolvedValue(120);
    defaultRelatedEmpty();

    const result = await listCustomers({ page: 2, pageSize: 50 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.totalPages).toBe(3); // ceil(120/50)
    const findManyArgs = customerFindManyMock.mock.calls[0]![0] as {
      skip: number;
      take: number;
    };
    expect(findManyArgs.skip).toBe(50);
    expect(findManyArgs.take).toBe(50);
  });

  it("defaults to pageSize 20 for invalid sizes", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "FULL" });
    customerFindManyMock.mockResolvedValue([]);
    customerCountMock.mockResolvedValue(0);
    defaultRelatedEmpty();

    const result = await listCustomers({ pageSize: 999 as unknown as 20 });

    expect(result.pageSize).toBe(20);
  });
});

// ──────────────────────────────────────────────
// Dealer data loader (unchanged loader)
// ──────────────────────────────────────────────

const { listDealerCustomers } = await import("../../../(dealer)/d-customers/data.js");

describe("listDealerCustomers (dealer)", () => {
  it("filters by ownerRelationshipId IN ctx.relationshipIds", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ piiMaskingMode: "MASKED" });
    customerFindManyMock.mockResolvedValue([
      {
        id: "cust_dealer_1",
        name: "山田 太郎",
        phone: "090-1234-5678",
        address: "東京都新宿区西新宿1-1",
        channel: "WALK_IN",
        status: "NEW",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    customerCountMock.mockResolvedValue(1);

    const result = await listDealerCustomers();

    expect(result.items).toHaveLength(1);
    const callWhere = (
      customerFindManyMock.mock.calls[0]![0] as { where: { ownerRelationshipId: { in: string[] } } }
    ).where;
    expect(callWhere.ownerRelationshipId).toEqual({ in: ["rel_a_x"] });
  });

  it("returns empty list when dealer has no active relationships", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([]);

    const result = await listDealerCustomers();

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(customerFindManyMock).not.toHaveBeenCalled();
  });
});

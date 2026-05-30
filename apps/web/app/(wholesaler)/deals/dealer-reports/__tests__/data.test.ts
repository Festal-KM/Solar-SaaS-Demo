// Unit tests for dealer-deal report data loader (T-05-04 / F-039).
//
// Covers:
//   1. Status filter — ownerType=DEALER enforced; status filter passed to query.
//   2. Pagination — page=2 skips first PAGE_SIZE rows and totalPages computed correctly.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const dealFindManyMock = vi.fn();
const dealCountMock = vi.fn();
const relationshipFindManyTxMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    deal: {
      findMany: (...args: unknown[]) => dealFindManyMock(...args),
      count: (...args: unknown[]) => dealCountMock(...args),
    },
    relationship: {
      findMany: (...args: unknown[]) => relationshipFindManyTxMock(...args),
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

function makeDealRow(overrides: Partial<{
  id: string;
  customerId: string;
  status: string;
  ownerRelationshipId: string | null;
  updatedAt: Date;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "deal_1",
    customerId: overrides.customerId ?? "cust_1",
    status: overrides.status ?? "LIKELY_CONTRACT",
    ownerRelationshipId: overrides.ownerRelationshipId ?? "rel_a_x",
    updatedAt: overrides.updatedAt ?? new Date("2026-03-15T10:00:00Z"),
    createdAt: overrides.createdAt ?? new Date("2026-03-01T10:00:00Z"),
    customer: { name: "鈴木 一郎" },
  };
}

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  dealFindManyMock.mockReset();
  dealCountMock.mockReset();
  relationshipFindManyTxMock.mockReset();
});

const { listDealReports } = await import("../data.js");

describe("listDealReports", () => {
  it("1. status filter — ownerType=DEALER enforced and status passed to where clause", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindManyMock.mockResolvedValue([makeDealRow({ status: "LIKELY_CONTRACT" })]);
    dealCountMock.mockResolvedValue(1);
    relationshipFindManyTxMock.mockResolvedValue([
      { id: "rel_a_x", dealer: { name: "二次店 A" } },
    ]);

    const result = await listDealReports({ status: "LIKELY_CONTRACT" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("LIKELY_CONTRACT");

    const callArgs = dealFindManyMock.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    // ownerType must always be DEALER
    expect(callArgs.where.ownerType).toBe("DEALER");
    // status filter is forwarded
    expect(callArgs.where.status).toBe("LIKELY_CONTRACT");
  });

  it("2. pagination — page=2 skips 50 rows and totalPages computed correctly", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindManyMock.mockResolvedValue([]);
    dealCountMock.mockResolvedValue(75);
    relationshipFindManyTxMock.mockResolvedValue([]);

    const result = await listDealReports({ page: 2 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.totalPages).toBe(2); // ceil(75/50)

    const findManyArgs = dealFindManyMock.mock.calls[0]![0] as {
      skip: number;
      take: number;
    };
    expect(findManyArgs.skip).toBe(50);
    expect(findManyArgs.take).toBe(50);
  });
});

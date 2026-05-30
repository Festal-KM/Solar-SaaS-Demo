// Unit tests for dealer incentive data loader (T-06-10 / F-051).
//
// Required cases:
//   1. listDealerIncentives — returns only rows whose relationshipId
//      is in ctx.relationshipIds (self-relation filter).
//   2. listDealerIncentives — only FINALIZED incentives are returned
//      (docs/02 §F-051).
//   3. listDealerIncentives — DTO does NOT expose purchasePrice or any
//      GrossProfit columns (CLAUDE.md rule #5).
//   4. listDealerIncentives — empty relationshipIds → returns [].
//   5. listDealerIncentives — settledMonth filter is forwarded to where.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const incentiveFindManyMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

import type * as DbModule from "@solar/db";

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    incentive: {
      findMany: (...args: unknown[]) => incentiveFindManyMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: () => Promise.resolve([{ id: REL_ID_OWN }]),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { listDealerIncentives } = await import("../data.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REL_ID_OWN = "rel_dealer_a";
const REL_ID_OTHER = "rel_dealer_b";

const DEALER_SESSION = {
  user: {
    id: "u_dealer_admin",
    tenantId: "tenant_dealer",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dealer",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const CONTRACT_DATE = new Date("2026-06-01T00:00:00.000Z");
const FINALIZED_AT = new Date("2026-07-01T00:00:00.000Z");

function makeIncentiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc_1",
    contractId: "contract_1",
    relationshipId: REL_ID_OWN,
    targetProfit: { toString: () => "500000" },
    rate: { toString: () => "10.00" },
    amount: { toString: () => "50000" },
    status: "FINALIZED",
    settledMonth: "2026-06",
    finalizedAt: FINALIZED_AT,
    contract: {
      contractDate: CONTRACT_DATE,
    },
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  incentiveFindManyMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listDealerIncentives", () => {
  it("1. only returns rows whose relationshipId is in ctx.relationshipIds", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    incentiveFindManyMock.mockResolvedValue([makeIncentiveRow()]);

    const result = await listDealerIncentives({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe("inc_1");
    expect(result.items[0]!.relationshipId).toBe(REL_ID_OWN);

    const call = incentiveFindManyMock.mock.calls[0]![0] as {
      where: { relationshipId: { in: string[] } };
    };
    expect(call.where.relationshipId.in).toEqual([REL_ID_OWN]);
    // REL_ID_OTHER is not in the filter
    expect(call.where.relationshipId.in).not.toContain(REL_ID_OTHER);
  });

  it("2. only FINALIZED status is passed to the DB query", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    incentiveFindManyMock.mockResolvedValue([]);

    await listDealerIncentives({});

    const call = incentiveFindManyMock.mock.calls[0]![0] as {
      where: { status: string };
    };
    expect(call.where.status).toBe("FINALIZED");
  });

  it("3. returned DTO does not expose purchasePrice or grossProfit fields", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    incentiveFindManyMock.mockResolvedValue([makeIncentiveRow()]);

    const result = await listDealerIncentives({});
    const item = result.items[0]!;

    // Allowed fields must be present
    expect(item.targetProfit).toBe("500000");
    expect(item.rate).toBe("10.00");
    expect(item.amount).toBe("50000");
    expect(item.contractDate).toBe(CONTRACT_DATE.toISOString());

    // Forbidden fields must be completely absent
    expect(Object.keys(item)).not.toContain("purchasePrice");
    expect(Object.keys(item)).not.toContain("snapshotPurchasePrice");
    expect(Object.keys(item)).not.toContain("purchaseTotal");
    expect(Object.keys(item)).not.toContain("wholesaleProfit");
    expect(Object.keys(item)).not.toContain("projectProfit");
  });

  it("4. empty relationshipIds → returns empty items without querying DB", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    // Patch rawPrisma.relationship.findMany to return [] for this test only.
    const dbMod = await import("@solar/db");
    const originalFindMany = dbMod.rawPrisma.relationship.findMany;
    (dbMod.rawPrisma.relationship as unknown as Record<string, unknown>).findMany = vi
      .fn()
      .mockResolvedValueOnce([]);

    const result = await listDealerIncentives({});

    expect(result.items).toHaveLength(0);
    expect(incentiveFindManyMock).not.toHaveBeenCalled();

    // Restore
    (dbMod.rawPrisma.relationship as unknown as Record<string, unknown>).findMany =
      originalFindMany;
  });

  it("5. settledMonth filter is forwarded to the where clause", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    incentiveFindManyMock.mockResolvedValue([]);

    await listDealerIncentives({ targetMonth: "2026-06" });

    const call = incentiveFindManyMock.mock.calls[0]![0] as {
      where: { settledMonth?: string };
    };
    expect(call.where.settledMonth).toBe("2026-06");
  });
});

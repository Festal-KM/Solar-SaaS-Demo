// Unit tests for dealer monthly performance data loader (T-06-10 / F-051).
//
// Required cases:
//   1. listDealerMonthlyPerformance — returns only rows whose relationshipId
//      is in ctx.relationshipIds (self-relation filter).
//   2. listDealerMonthlyPerformance — aggregated JSON does NOT expose
//      purchaseTotal or wholesaleProfit in the returned DTO (CLAUDE.md rule #5).
//   3. listDealerMonthlyPerformance — empty relationshipIds → returns [].
//   4. listDealerMonthlyPerformance — targetMonth filter is forwarded to where.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const monthlyReportFindManyMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

import type * as DbModule from "@solar/db";

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    monthlyReport: {
      findMany: (...args: unknown[]) => monthlyReportFindManyMock(...args),
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

const { listDealerMonthlyPerformance } = await import("../data.js");

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

function makeReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "report_1",
    wholesalerId: "tenant_ws_a",
    relationshipId: REL_ID_OWN,
    targetMonth: "2026-06",
    scope: "DEALER",
    status: "FINALIZED",
    aggregated: {
      contractCount: 5,
      totalSales: "7500000",
      totalIncentive: "375000",
      averageProfitRate: "0.12",
      purchaseTotal: "4000000",      // must NOT appear in DTO
      wholesaleProfit: "2000000",    // must NOT appear in DTO
    },
    finalizedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  monthlyReportFindManyMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listDealerMonthlyPerformance", () => {
  it("1. only returns rows whose relationshipId is in ctx.relationshipIds", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    monthlyReportFindManyMock.mockResolvedValue([makeReportRow()]);

    const result = await listDealerMonthlyPerformance({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe("report_1");

    // Confirm the where clause filters by ctx.relationshipIds
    const call = monthlyReportFindManyMock.mock.calls[0]![0] as {
      where: { relationshipId: { in: string[] } };
    };
    expect(call.where.relationshipId.in).toEqual([REL_ID_OWN]);
  });

  it("2. aggregated DTO does NOT contain purchaseTotal or wholesaleProfit", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    monthlyReportFindManyMock.mockResolvedValue([makeReportRow()]);

    const result = await listDealerMonthlyPerformance({});
    const item = result.items[0]!;

    // Allowed fields
    expect(item.contractCount).toBe(5);
    expect(item.totalSales).toBe("7500000");
    expect(item.totalIncentive).toBe("375000");
    expect(item.averageProfitRate).toBe("0.12");

    // Forbidden fields must be absent from the DTO shape
    expect(Object.keys(item)).not.toContain("purchaseTotal");
    expect(Object.keys(item)).not.toContain("wholesaleProfit");
  });

  it("3. empty relationshipIds → returns empty items without querying DB", async () => {
    // Simulate a dealer session with no active relationships by providing a
    // separate module-scope mock for rawPrisma.relationship.findMany.
    // We patch the mock definition directly because the mock factory uses a
    // closure-captured vi.fn that is always the same reference.
    authMock.mockResolvedValue(DEALER_SESSION);
    // Replace the findMany mock with one that returns [] for this test only.
    const dbMod = await import("@solar/db");
    const originalFindMany = dbMod.rawPrisma.relationship.findMany;
    (dbMod.rawPrisma.relationship as unknown as Record<string, unknown>).findMany = vi
      .fn()
      .mockResolvedValueOnce([]);

    const result = await listDealerMonthlyPerformance({});

    expect(result.items).toHaveLength(0);
    expect(monthlyReportFindManyMock).not.toHaveBeenCalled();

    // Restore
    (dbMod.rawPrisma.relationship as unknown as Record<string, unknown>).findMany =
      originalFindMany;
  });

  it("4. targetMonth filter is forwarded to the where clause", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    monthlyReportFindManyMock.mockResolvedValue([]);

    await listDealerMonthlyPerformance({ targetMonth: "2026-06" });

    const call = monthlyReportFindManyMock.mock.calls[0]![0] as {
      where: { targetMonth?: string };
    };
    expect(call.where.targetMonth).toBe("2026-06");
  });

  it("5. rows with other relationshipId are filtered out server-side", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    // Return only own rows — other rel rows would never come back from DB
    // because the where clause restricts to ctx.relationshipIds. We verify
    // the filter is set correctly and own rows are returned.
    monthlyReportFindManyMock.mockResolvedValue([
      makeReportRow({ relationshipId: REL_ID_OWN }),
    ]);

    const result = await listDealerMonthlyPerformance({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.relationshipId).toBe(REL_ID_OWN);

    const call = monthlyReportFindManyMock.mock.calls[0]![0] as {
      where: { relationshipId: { in: string[] } };
    };
    // REL_ID_OTHER is not in the filter
    expect(call.where.relationshipId.in).not.toContain(REL_ID_OTHER);
  });
});

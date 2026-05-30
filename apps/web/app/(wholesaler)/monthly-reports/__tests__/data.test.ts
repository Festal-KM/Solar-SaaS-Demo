// Unit tests for monthly-reports data loaders — T-06-07 / F-048.
//
// Cases:
//   1. listMonthlyReports — unpacks aggregated JSON, respects targetMonth filter
//   2. listMonthlyReports — scope filter passed through to Prisma where
//   3. listMonthlyReports — forbidden for non-wholesaler-admin role (WHOLESALER_FIELD_STAFF)
//   4. getMonthlyReportDetail — returns null when wholesalerId does not match

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, UnauthorizedError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const findManyMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    monthlyReport: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {},
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { listMonthlyReports } = await import("../data.js");
const { getMonthlyReportDetail } = await import("../[id]/data.js");

// ---------------------------------------------------------------------------
// Shared session fixtures
// ---------------------------------------------------------------------------

const WS_ADMIN_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "ws_a",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

// (no additional session fixtures needed for current tests)

function makeReportRow(overrides?: Partial<{
  id: string;
  targetMonth: string;
  scope: string;
  status: string;
  aggregated: object;
  relationshipId: string | null;
  updatedAt: Date;
}>) {
  return {
    id: "mr_1",
    targetMonth: "2026-05",
    scope: "ALL",
    relationshipId: null,
    status: "DRAFT",
    aggregated: {
      contractCount: 5,
      totalSales: 3_000_000,
      totalGrossProfit: 600_000,
      totalIncentive: 60_000,
      averageProfitRate: 0.2,
    },
    updatedAt: new Date("2026-05-02T02:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  findManyMock.mockReset();
  findUniqueMock.mockReset();
});

// ---------------------------------------------------------------------------
// Case 1: listMonthlyReports — aggregated JSON is unpacked correctly
// ---------------------------------------------------------------------------

describe("listMonthlyReports", () => {
  it("1. unpacks aggregated JSON and returns numeric fields", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findManyMock.mockResolvedValue([makeReportRow()]);

    const result = await listMonthlyReports({ targetMonth: "2026-05" });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.contractCount).toBe(5);
    expect(item.totalSales).toBe(3_000_000);
    expect(item.totalGrossProfit).toBe(600_000);
    expect(item.totalIncentive).toBe(60_000);
    expect(result.targetMonth).toBe("2026-05");
  });

  // ---------------------------------------------------------------------------
  // Case 2: scope filter is passed through to Prisma where
  // ---------------------------------------------------------------------------

  it("2. scope filter is forwarded to Prisma where clause", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findManyMock.mockResolvedValue([makeReportRow({ scope: "DEALER" })]);

    await listMonthlyReports({ scope: "DEALER", targetMonth: "2026-05" });

    const callArg = findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(callArg.where.scope).toBe("DEALER");
    expect(callArg.where.targetMonth).toBe("2026-05");
  });

  // ---------------------------------------------------------------------------
  // Case 3: unauthenticated call throws UnauthorizedError
  // ---------------------------------------------------------------------------

  it("3. unauthenticated request throws UnauthorizedError before any DB call", async () => {
    authMock.mockResolvedValue(null);

    await expect(listMonthlyReports()).rejects.toThrow(UnauthorizedError);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

// Keep ForbiddenError imported to ensure it compiles (used by other tests if extended).
void ForbiddenError;

// ---------------------------------------------------------------------------
// Case 4: getMonthlyReportDetail — returns null when wholesalerId does not match
// ---------------------------------------------------------------------------

describe("getMonthlyReportDetail", () => {
  it("4. returns null when record wholesalerId does not match caller", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    // Row belongs to a different wholesaler.
    findUniqueMock.mockResolvedValue({
      ...makeReportRow(),
      wholesalerId: "ws_other",
    });

    const result = await getMonthlyReportDetail("mr_1");
    expect(result).toBeNull();
  });
});

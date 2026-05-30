// Unit tests for the BI dashboard data loader (T-06-11 / S-051 / F-056).
//
// Verify:
//   1. wholesaler_admin: aggregates time-series + ranking from mocked DB rows.
//   2. wholesaler_event_team: same read permission.
//   3. dealer_admin: forbidden (CLAUDE.md — no cross-dealer visibility).
//   4. wholesaler_direct_sales: allowed (docs/02 §F-056 関連ロール).
//   5. Scope filter (SELF): filters out DEALER rows.
//   6. Relationship filter: restricts to a single relationship.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const rawRelationshipFindManyMock = vi.fn();
let queryRawMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => rawRelationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const fakeTx = {
        $queryRaw: (..._args: unknown[]) => queryRawMock(),
      };
      return fn(fakeTx);
    },
  };
});

const { getBiDashboardData } = await import("../data.js");

// ---------------------------------------------------------------------------
// Session fixtures
// ---------------------------------------------------------------------------

const WS_ADMIN_SESSION = {
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

const WS_EVENT_TEAM_SESSION = {
  user: {
    id: "u_ws_evt",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_EVENT_TEAM"],
    isSaasAdmin: false,
  },
};

const WS_DIRECT_SALES_SESSION = {
  user: {
    id: "u_ws_ds",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_DIRECT_SALES"],
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

// ---------------------------------------------------------------------------
// DB response fixtures
// ---------------------------------------------------------------------------

const REL_ROWS = [
  { relationship_id: "rel_a", dealer_name: "二次店 A" },
  { relationship_id: "rel_b", dealer_name: "二次店 B" },
];

// Two DEALER-scope contracts for rel_a + one SELF-scope contract.
const CONTRACT_ROWS_MIXED = [
  {
    target_month: "2026-04",
    relationship_id: "rel_a",
    contract_amount: "1000000",
    project_profit: "200000",
    scope_label: "DEALER",
  },
  {
    target_month: "2026-05",
    relationship_id: "rel_a",
    contract_amount: "800000",
    project_profit: "160000",
    scope_label: "DEALER",
  },
  {
    target_month: "2026-05",
    relationship_id: null,
    contract_amount: "500000",
    project_profit: "100000",
    scope_label: "SELF",
  },
];

const EMPTY_CONTRACT_ROWS: unknown[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILTERS_ALL = {
  fromMonth: "2026-04",
  toMonth: "2026-05",
  scope: "ALL" as const,
  relationshipId: null,
};

const FILTERS_SELF = {
  ...FILTERS_ALL,
  scope: "SELF" as const,
};

const FILTERS_REL_A = {
  ...FILTERS_ALL,
  relationshipId: "rel_a",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  authMock.mockReset();
  rawRelationshipFindManyMock.mockReset();
  rawRelationshipFindManyMock.mockResolvedValue([]);
  queryRawMock = vi.fn();
});

describe("getBiDashboardData — permission checks", () => {
  it("allows wholesaler_admin to read BI data", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)          // relationship options
      .mockResolvedValueOnce(EMPTY_CONTRACT_ROWS); // contracts

    const data = await getBiDashboardData(FILTERS_ALL);
    expect(data).toBeDefined();
    expect(data.kpi.contractCount).toBe(0);
    expect(data.dealerRanking).toHaveLength(0);
  });

  it("allows wholesaler_event_team to read BI data", async () => {
    authMock.mockResolvedValue(WS_EVENT_TEAM_SESSION);
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(EMPTY_CONTRACT_ROWS);

    const data = await getBiDashboardData(FILTERS_ALL);
    expect(data).toBeDefined();
  });

  it("allows wholesaler_direct_sales to read BI data", async () => {
    authMock.mockResolvedValue(WS_DIRECT_SALES_SESSION);
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(EMPTY_CONTRACT_ROWS);

    const data = await getBiDashboardData(FILTERS_ALL);
    expect(data).toBeDefined();
  });

  it("forbids dealer_admin (cross-dealer data isolation)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    rawRelationshipFindManyMock.mockResolvedValue([{ id: "rel_x" }]);

    await expect(getBiDashboardData(FILTERS_ALL)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getBiDashboardData — aggregation", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
  });

  it("aggregates KPI totals from all scopes when scope=ALL", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(CONTRACT_ROWS_MIXED);

    const data = await getBiDashboardData(FILTERS_ALL);

    // 3 contracts total (2 DEALER + 1 SELF)
    expect(data.kpi.contractCount).toBe(3);
    expect(data.kpi.totalSales).toBe(1_000_000 + 800_000 + 500_000);
    expect(data.kpi.totalGrossProfit).toBe(200_000 + 160_000 + 100_000);
    expect(data.kpi.averageProfitRate).toBeCloseTo(460_000 / 2_300_000);
  });

  it("filters to SELF scope only when scope=SELF", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(CONTRACT_ROWS_MIXED);

    const data = await getBiDashboardData(FILTERS_SELF);

    // Only the 1 SELF-scope contract
    expect(data.kpi.contractCount).toBe(1);
    expect(data.kpi.totalSales).toBe(500_000);
    expect(data.dealerRanking).toHaveLength(0); // no relationship_id on SELF
  });

  it("restricts to single relationship when relationshipId filter set", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(CONTRACT_ROWS_MIXED);

    const data = await getBiDashboardData(FILTERS_REL_A);

    // Only rel_a contracts (2 rows, DEALER scope)
    expect(data.kpi.contractCount).toBe(2);
    expect(data.kpi.totalSales).toBe(1_000_000 + 800_000);
    expect(data.dealerRanking).toHaveLength(1);
    expect(data.dealerRanking.at(0)?.dealerName).toBe("二次店 A");
  });

  it("includes zero-contract months in time series", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(EMPTY_CONTRACT_ROWS);

    const data = await getBiDashboardData(FILTERS_ALL);

    // fromMonth=2026-04, toMonth=2026-05 → 2 months
    expect(data.timeSeries).toHaveLength(2);
    expect(data.timeSeries.at(0)?.targetMonth).toBe("2026-04");
    expect(data.timeSeries.at(0)?.contractCount).toBe(0);
    expect(data.timeSeries.at(1)?.targetMonth).toBe("2026-05");
  });

  it("builds dealer ranking sorted by contract count desc (top 10)", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(CONTRACT_ROWS_MIXED);

    const data = await getBiDashboardData(FILTERS_ALL);

    // rel_a has 2 contracts, rel_b has 0 → rel_a is #1
    expect(data.dealerRanking.at(0)?.relationshipId).toBe("rel_a");
    expect(data.dealerRanking.at(0)?.contractCount).toBe(2);
  });

  it("populates relationshipOptions from active dealer relationships", async () => {
    queryRawMock
      .mockResolvedValueOnce(REL_ROWS)
      .mockResolvedValueOnce(EMPTY_CONTRACT_ROWS);

    const data = await getBiDashboardData(FILTERS_ALL);

    expect(data.relationshipOptions).toHaveLength(2);
    expect(data.relationshipOptions.at(0)?.dealerName).toBe("二次店 A");
  });
});

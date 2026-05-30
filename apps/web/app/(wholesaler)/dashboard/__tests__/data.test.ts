// Unit tests for the wholesaler dashboard data loader (T-02-11 / S-018).
//
// 検証する観点:
//   1. wholesaler_admin: full DashboardSummary shape returned (all counts 0 / null)
//   2. wholesaler_field_staff: field_staff も読める (ALL_WHOLESALER_ROLES)
//   3. dealer_admin: assertCan で ForbiddenError 落ち (dealer は S-058 別画面)
//   4. SaaS-admin で wholesalerId 未割当: ハブ側の明示 throw で ForbiddenError

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const rawRelationshipFindManyMock = vi.fn();

// Mocks for all Prisma methods used inside withTenant callback
const contractCountMock = vi.fn();
const contractAggregateMock = vi.fn();
const grossProfitAggregateMock = vi.fn();
const notificationCountMock = vi.fn();
const notificationFindManyMock = vi.fn();
const eventFindManyMock = vi.fn();
const eventCountMock = vi.fn();
const appointmentCountMock = vi.fn();
const eventCandidateCountMock = vi.fn();

const tx = {
  contract: {
    count: (...args: unknown[]) => contractCountMock(...args),
    aggregate: (...args: unknown[]) => contractAggregateMock(...args),
  },
  grossProfit: {
    aggregate: (...args: unknown[]) => grossProfitAggregateMock(...args),
  },
  notification: {
    count: (...args: unknown[]) => notificationCountMock(...args),
    findMany: (...args: unknown[]) => notificationFindManyMock(...args),
  },
  event: {
    findMany: (...args: unknown[]) => eventFindManyMock(...args),
    count: (...args: unknown[]) => eventCountMock(...args),
  },
  appointment: {
    count: (...args: unknown[]) => appointmentCountMock(...args),
  },
  eventCandidate: {
    count: (...args: unknown[]) => eventCandidateCountMock(...args),
  },
};

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
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { getDashboardSummary } = await import("../data.js");

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

const WS_FIELD_STAFF_SESSION = {
  user: {
    id: "u_ws_field",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_FIELD_STAFF"],
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

const SAAS_ADMIN_NO_WS_SESSION = {
  user: {
    id: "u_saas_admin",
    tenantId: null,
    tenantType: null,
    wholesalerId: null,
    dealerId: null,
    roles: ["SAAS_ADMIN"],
    isSaasAdmin: true,
  },
};

beforeEach(() => {
  authMock.mockReset();
  rawRelationshipFindManyMock.mockReset();
  rawRelationshipFindManyMock.mockResolvedValue([]);

  contractCountMock.mockReset();
  contractCountMock.mockResolvedValue(0);

  contractAggregateMock.mockReset();
  contractAggregateMock.mockResolvedValue({ _sum: { contractAmount: null } });

  grossProfitAggregateMock.mockReset();
  grossProfitAggregateMock.mockResolvedValue({ _sum: { projectProfit: null } });

  notificationCountMock.mockReset();
  notificationCountMock.mockResolvedValue(0);

  notificationFindManyMock.mockReset();
  notificationFindManyMock.mockResolvedValue([]);

  eventFindManyMock.mockReset();
  eventFindManyMock.mockResolvedValue([]);

  eventCountMock.mockReset();
  eventCountMock.mockResolvedValue(0);

  appointmentCountMock.mockReset();
  appointmentCountMock.mockResolvedValue(0);

  eventCandidateCountMock.mockReset();
  eventCandidateCountMock.mockResolvedValue(0);
});

describe("getDashboardSummary — real DB queries (all zeroes/null via mocks)", () => {
  it("returns full DashboardSummary with 0 counts and null monthly figures for wholesaler_admin", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);

    const summary = await getDashboardSummary();

    expect(summary).toMatchObject({
      notifications: { unreadCount: 0, latest: [] },
      dealerPreference: { pendingDealerCount: 0 },
      precall: { pendingCount: 0 },
      monthlySummary: {
        contractCount: 0,
        prevContractCount: 0,
        contractCountDiff: 0,
        revenueYen: null,
        prevRevenueYen: null,
        grossProfitYen: null,
        prevGrossProfitYen: null,
        incentiveYen: null,
        prevIncentiveYen: null,
      },
      weeklyEvents: { count: 0 },
      weeklyAppointments: { completedCount: 0, scheduledCount: 0 },
      recentEvents: [],
      weekendEvents: [],
    });
    // salesTrend: 12 month array, each with revenue: 0 / grossProfit: 0
    expect(summary.salesTrend).toHaveLength(12);
    expect(summary.salesTrend[0]).toMatchObject({ revenue: 0, grossProfit: 0 });
  });

  it("allows wholesaler_field_staff to read the dashboard (S-018 全ロール可)", async () => {
    authMock.mockResolvedValue(WS_FIELD_STAFF_SESSION);

    const summary = await getDashboardSummary();

    expect(summary.notifications.unreadCount).toBe(0);
    expect(summary.weeklyEvents.count).toBe(0);
  });

  it("forbids dealer_admin (dealer は別ダッシュボード S-058)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    await expect(getDashboardSummary()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids SaaS-admin without a bound wholesalerId (avoids cross-tenant read)", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_NO_WS_SESSION);

    await expect(getDashboardSummary()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// Unit tests for the lane-preference data loader (F-060 / listLanePreferences,
// ボトムアップ構造).
//
// Mocks the auth session and `@solar/db` transaction client; the loader runs
// through auth → assertCan('lane_preference.read') → withTenant. We exercise:
//   - month + relationship filters are pushed into the findMany where-clause
//   - tenant isolation: wholesalerId comes from ctx (RLS handles physical
//     scoping) and dealer roles are blocked with ForbiddenError (no DB read)
//   - items sorted by priority, joined to venueProvider / store / lineEvent names
//   - venueLabel is the primary source; laneCount = items.length

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const lanePreferenceFindManyMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const lineEventFindManyMock = vi.fn();
const venueProviderFindManyMock = vi.fn();
const storeFindManyMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    lanePreference: {
      findMany: (...args: unknown[]) => lanePreferenceFindManyMock(...args),
    },
    relationship: {
      findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
    },
    lineEvent: {
      findMany: (...args: unknown[]) => lineEventFindManyMock(...args),
    },
    venueProvider: {
      findMany: (...args: unknown[]) => venueProviderFindManyMock(...args),
    },
    store: {
      findMany: (...args: unknown[]) => storeFindManyMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: async () => [{ id: "rel_a_x" }],
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { listLanePreferences } = await import("../data.js");

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
  lanePreferenceFindManyMock.mockReset();
  relationshipFindManyMock.mockReset();
  lineEventFindManyMock.mockReset();
  venueProviderFindManyMock.mockReset();
  storeFindManyMock.mockReset();
  relationshipFindManyMock.mockResolvedValue([]);
  lineEventFindManyMock.mockResolvedValue([]);
  venueProviderFindManyMock.mockResolvedValue([]);
  storeFindManyMock.mockResolvedValue([]);
});

describe("listLanePreferences", () => {
  it("filters by month + relationship, sorts items by priority, resolves link names", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lanePreferenceFindManyMock.mockResolvedValue([
      {
        id: "lp_1",
        relationshipId: "rel_alpha",
        targetMonth: "2026-06",
        note: "毎週水曜希望",
        submittedAt: new Date("2026-06-01T01:15:00Z"),
        // Intentionally out of priority order to verify the sort.
        items: [
          {
            priority: 2,
            venueLabel: "コメリ 大宮店",
            venueProviderId: null,
            storeId: "st_1",
            lineEventId: null,
            desiredDates: ["2026-06-06"],
            memo: null,
          },
          {
            priority: 1,
            venueLabel: "カインズ 大宮店",
            venueProviderId: "vp_1",
            storeId: null,
            lineEventId: "le_a",
            desiredDates: ["2026-06-03", "2026-06-10"],
            memo: "駐車場側希望",
          },
        ],
      },
    ]);
    relationshipFindManyMock.mockResolvedValue([
      { id: "rel_alpha", dealer: { name: "株式会社ABCプロモーション" } },
    ]);
    venueProviderFindManyMock.mockResolvedValue([{ id: "vp_1", name: "イオンタウン株式会社" }]);
    storeFindManyMock.mockResolvedValue([{ id: "st_1", name: "コメリ大宮" }]);
    lineEventFindManyMock.mockResolvedValue([{ id: "le_a", name: "イオンモール幕張新都心" }]);

    const rows = await listLanePreferences({
      targetMonth: "2026-06",
      relationshipId: "rel_alpha",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "lp_1",
      relationshipId: "rel_alpha",
      dealerName: "株式会社ABCプロモーション",
      targetMonth: "2026-06",
      note: "毎週水曜希望",
      laneCount: 2,
    });
    // Priority ascending: 1 before 2.
    expect(rows[0]!.items.map((i) => i.priority)).toEqual([1, 2]);
    expect(rows[0]!.items[0]).toMatchObject({
      priority: 1,
      venueLabel: "カインズ 大宮店",
      venueProviderId: "vp_1",
      venueProviderName: "イオンタウン株式会社",
      lineEventId: "le_a",
      lineName: "イオンモール幕張新都心",
      memo: "駐車場側希望",
    });
    expect(rows[0]!.items[0]!.desiredDates).toEqual(["2026-06-03", "2026-06-10"]);
    expect(rows[0]!.items[1]).toMatchObject({
      priority: 2,
      venueLabel: "コメリ 大宮店",
      venueProviderName: null,
      storeId: "st_1",
      storeName: "コメリ大宮",
    });

    const where = lanePreferenceFindManyMock.mock.calls[0]![0] as {
      where: { targetMonth?: string; relationshipId?: string };
    };
    expect(where.where.targetMonth).toBe("2026-06");
    expect(where.where.relationshipId).toBe("rel_alpha");
  });

  it("does not select LineEvent cost fields (fixedFee/performanceRate/scheduledDates)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lanePreferenceFindManyMock.mockResolvedValue([
      {
        id: "lp_2",
        relationshipId: "rel_beta",
        targetMonth: "2026-06",
        note: null,
        submittedAt: new Date("2026-06-02T00:00:00Z"),
        items: [
          {
            priority: 1,
            venueLabel: "ビバホーム",
            venueProviderId: null,
            storeId: null,
            lineEventId: "le_x",
            desiredDates: [],
            memo: null,
          },
        ],
      },
    ]);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_beta", dealer: { name: "B社" } }]);
    lineEventFindManyMock.mockResolvedValue([{ id: "le_x", name: "X" }]);

    await listLanePreferences({ targetMonth: "2026-06" });

    const leArgs = lineEventFindManyMock.mock.calls[0]![0] as {
      select: Record<string, boolean>;
    };
    expect(leArgs.select).toEqual({ id: true, name: true });
    expect("fixedFee" in leArgs.select).toBe(false);
    expect("performanceRate" in leArgs.select).toBe(false);
    expect("scheduledDates" in leArgs.select).toBe(false);
  });

  it("omits an invalid month from the where-clause", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lanePreferenceFindManyMock.mockResolvedValue([]);

    await listLanePreferences({ targetMonth: "2026-13" });

    const where = lanePreferenceFindManyMock.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect("targetMonth" in where.where).toBe(false);
  });

  it("returns [] without secondary lookups when no preferences match", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lanePreferenceFindManyMock.mockResolvedValue([]);

    const rows = await listLanePreferences({ targetMonth: "2026-06" });

    expect(rows).toEqual([]);
    expect(relationshipFindManyMock).not.toHaveBeenCalled();
    expect(lineEventFindManyMock).not.toHaveBeenCalled();
    expect(venueProviderFindManyMock).not.toHaveBeenCalled();
    expect(storeFindManyMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin (ForbiddenError, no DB read)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    await expect(listLanePreferences({ targetMonth: "2026-06" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(lanePreferenceFindManyMock).not.toHaveBeenCalled();
  });
});

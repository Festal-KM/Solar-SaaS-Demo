// Unit tests for the lane-preference data loader (F-060 / listLanePreferences).
//
// Mocks the auth session and `@solar/db` transaction client; the loader runs
// through auth → assertCan('lane_preference.read') → withTenant. We exercise:
//   - month + relationship filters are pushed into the findMany where-clause
//   - tenant isolation: wholesalerId comes from ctx (RLS handles physical
//     scoping) and dealer roles are blocked with ForbiddenError (no DB read)
//   - items are sorted by priority and joined to lineEvent + venueProvider names

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const lanePreferenceFindManyMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const lineEventFindManyMock = vi.fn();
const venueProviderFindManyMock = vi.fn();

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
  relationshipFindManyMock.mockResolvedValue([]);
  lineEventFindManyMock.mockResolvedValue([]);
  venueProviderFindManyMock.mockResolvedValue([]);
});

describe("listLanePreferences", () => {
  it("filters by month + relationship, sorts items by priority, joins names", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lanePreferenceFindManyMock.mockResolvedValue([
      {
        id: "lp_1",
        relationshipId: "rel_alpha",
        targetMonth: "2026-06",
        comment: "毎週水曜希望",
        submittedAt: new Date("2026-06-01T01:15:00Z"),
        // Intentionally out of priority order to verify the sort.
        items: [
          { priority: 2, lineEventId: "le_b" },
          { priority: 1, lineEventId: "le_a" },
        ],
      },
    ]);
    relationshipFindManyMock.mockResolvedValue([
      { id: "rel_alpha", dealer: { name: "株式会社ABCプロモーション" } },
    ]);
    lineEventFindManyMock.mockResolvedValue([
      {
        id: "le_a",
        name: "イオンモール幕張新都心",
        venueProviderId: "vp_1",
        scheduledDates: ["2026-06-03", "2026-06-10"],
      },
      {
        id: "le_b",
        name: "ららぽーとTOKYO-BAY",
        venueProviderId: null,
        scheduledDates: ["2026-06-06"],
      },
    ]);
    venueProviderFindManyMock.mockResolvedValue([{ id: "vp_1", name: "イオンタウン株式会社" }]);

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
      comment: "毎週水曜希望",
    });
    // Priority ascending: 1 (le_a) before 2 (le_b).
    expect(rows[0]!.items.map((i) => i.priority)).toEqual([1, 2]);
    expect(rows[0]!.items[0]).toMatchObject({
      priority: 1,
      lineEventId: "le_a",
      lineName: "イオンモール幕張新都心",
      venueProviderName: "イオンタウン株式会社",
    });
    expect(rows[0]!.items[0]!.scheduledDates).toEqual(["2026-06-03", "2026-06-10"]);
    // le_b has no venue provider → null.
    expect(rows[0]!.items[1]).toMatchObject({
      priority: 2,
      lineEventId: "le_b",
      lineName: "ららぽーとTOKYO-BAY",
      venueProviderName: null,
    });

    const where = lanePreferenceFindManyMock.mock.calls[0]![0] as {
      where: { targetMonth?: string; relationshipId?: string };
    };
    expect(where.where.targetMonth).toBe("2026-06");
    expect(where.where.relationshipId).toBe("rel_alpha");
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
  });

  it("forbids dealer_admin (ForbiddenError, no DB read)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    await expect(listLanePreferences({ targetMonth: "2026-06" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(lanePreferenceFindManyMock).not.toHaveBeenCalled();
  });
});

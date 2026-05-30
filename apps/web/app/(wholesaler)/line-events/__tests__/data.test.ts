// Unit tests for the line-event data loader (F-059 / listLineEvents).
//
// Mocks the auth session and `@solar/db` transaction client; the loader runs
// through auth → assertCan('line_event.read') → withTenant. We exercise:
//   - month filter is pushed into the lineEvent.findMany where-clause
//   - tenant isolation: wholesalerId comes from ctx (RLS handles physical
//     scoping) and dealer roles are blocked with ForbiddenError (no DB read)
//   - scheduledDates JSON is surfaced as string[] and provider names joined

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const lineEventFindManyMock = vi.fn();
const venueProviderFindManyMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
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

const { listLineEvents } = await import("../data.js");

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
  lineEventFindManyMock.mockReset();
  venueProviderFindManyMock.mockReset();
  venueProviderFindManyMock.mockResolvedValue([]);
});

describe("listLineEvents", () => {
  it("filters by targetMonth + venueProviderId and joins provider names", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lineEventFindManyMock.mockResolvedValue([
      {
        id: "le_1",
        name: "イオンモール幕張",
        venueProviderId: "vp_1",
        area: "千葉県",
        scheduledDates: ["2026-06-01", "2026-06-08"],
        status: "CONFIRMED",
        createdAt: new Date("2026-05-20T00:00:00Z"),
        updatedAt: new Date("2026-05-21T00:00:00Z"),
      },
    ]);
    venueProviderFindManyMock.mockResolvedValue([{ id: "vp_1", name: "イオンモール幕張新都心" }]);

    const rows = await listLineEvents({ targetMonth: "2026-06", venueProviderId: "vp_1" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "le_1",
      name: "イオンモール幕張",
      venueProviderName: "イオンモール幕張新都心",
      area: "千葉県",
      status: "CONFIRMED",
    });
    expect(rows[0]!.scheduledDates).toEqual(["2026-06-01", "2026-06-08"]);

    const where = lineEventFindManyMock.mock.calls[0]![0] as {
      where: { targetMonth?: string; venueProviderId?: string };
    };
    expect(where.where.targetMonth).toBe("2026-06");
    expect(where.where.venueProviderId).toBe("vp_1");
  });

  it("omits an invalid month from the where-clause", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lineEventFindManyMock.mockResolvedValue([]);

    await listLineEvents({ targetMonth: "2026-13" });

    const where = lineEventFindManyMock.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect("targetMonth" in where.where).toBe(false);
  });

  it("handles null venueProviderId and missing scheduledDates safely", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    lineEventFindManyMock.mockResolvedValue([
      {
        id: "le_2",
        name: "直営レーン",
        venueProviderId: null,
        area: null,
        scheduledDates: null,
        status: "DRAFT",
        createdAt: new Date("2026-05-21T00:00:00Z"),
        updatedAt: new Date("2026-05-22T00:00:00Z"),
      },
    ]);

    const rows = await listLineEvents({ targetMonth: "2026-06" });

    expect(rows[0]).toMatchObject({ id: "le_2", venueProviderName: null, area: null });
    expect(rows[0]!.scheduledDates).toEqual([]);
    // No provider ids → no venueProvider lookup.
    expect(venueProviderFindManyMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin (ForbiddenError, no DB read)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    await expect(listLineEvents({ targetMonth: "2026-06" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(lineEventFindManyMock).not.toHaveBeenCalled();
  });
});

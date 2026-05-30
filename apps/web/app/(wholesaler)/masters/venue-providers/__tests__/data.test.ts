// Unit tests for the venue-provider data loaders (T-02-02 follow-up).
//
// `data.ts` runs during RSC render — its three-step pipeline (auth →
// assertCan(read) → withTenant) is the same idiom the Server Actions use,
// but with one practical difference: it accepts a name / area filter and
// composes them into the Prisma `where` clause. These tests pin that
// composition down so the docs/04 §S-019 「検索（名称 / エリア）」
// requirement does not regress.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

// `data.ts` opens with `import "server-only"` to prevent client bundlers
// pulling in the module; vitest (jsdom-less Node env) doesn't ship that
// shim so we noop-mock it before the dynamic import below.
vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const venueProviderFindManyMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    venueProvider: {
      findMany: (...args: unknown[]) => venueProviderFindManyMock(...args),
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

const { listVenueProviders } = await import("../data.js");

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

const WS_CALL_TEAM_SESSION = {
  user: {
    id: "u_ws_call",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_CALL_TEAM"],
    isSaasAdmin: false,
  },
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  venueProviderFindManyMock.mockReset();
});

describe("listVenueProviders — filter composition", () => {
  it("ANDs name + area filters into Prisma where (docs/04 §S-019)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindManyMock.mockResolvedValue([]);

    await listVenueProviders({ name: "ホーム", area: "東京" });

    const call = venueProviderFindManyMock.mock.calls[0]![0] as {
      where: {
        name?: { contains: string; mode: string };
        area?: { contains: string; mode: string };
      };
    };
    expect(call.where.name).toEqual({ contains: "ホーム", mode: "insensitive" });
    expect(call.where.area).toEqual({ contains: "東京", mode: "insensitive" });
  });

  it("omits empty filters from the where clause", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindManyMock.mockResolvedValue([]);

    await listVenueProviders({ name: "", area: "" });

    const call = venueProviderFindManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect("name" in call.where).toBe(false);
    expect("area" in call.where).toBe(false);
  });

  it("forbids wholesaler_call_team (docs/04 §S-019 ロール: admin / event_team のみ)", async () => {
    authMock.mockResolvedValue(WS_CALL_TEAM_SESSION);

    await expect(listVenueProviders({ name: "ホーム" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(venueProviderFindManyMock).not.toHaveBeenCalled();
  });
});

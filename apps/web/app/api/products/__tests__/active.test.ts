// Integration tests for `GET /api/products/active` (T-02-04 / F-012 /
// docs/03 §4.3 / docs/05 §6.5).
//
// The route is the documented leak path for the wholesaler's `purchasePrice`,
// so the contract under test is:
//   - wholesaler roles (admin / event team / direct sales)  → key present
//   - dealer roles (dealer_admin / dealer_staff)            → key ABSENT
//   - saas_admin                                            → key present
//                                                            (operator has
//                                                             full visibility;
//                                                             docs/03 §4.3
//                                                             scopes the mask
//                                                             to dealer roles)
//
// We mock the three boundaries the handler touches (`@/auth`,
// `@/lib/tenancy/context`, `@/lib/tenancy/with-tenant`) so the test never
// stands up Postgres. The data layer (Prisma `findMany`) is faked via the
// `withTenant` mock returning a fixed catalogue. `findEffectiveProducts`
// (pure) runs for real — that's the canonical path the route uses to apply
// the `[effectiveFrom, effectiveTo)` window.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const getTenantContextMock = vi.fn();
const withTenantMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/tenancy/context", () => ({
  getTenantContext: () => getTenantContextMock(),
}));

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    withTenantMock(_ctx, fn),
}));

const { GET } = await import("../active/route.js");

// Stable fixture covering one open-ended row whose effectiveFrom predates
// the default `asOf=now()` so `findEffectiveProducts` returns exactly one
// item. The Prisma layer hands back `Decimal` values, which the route then
// stringifies via `.toString()`; we mimic that by passing strings with the
// `toString` shape the actual Prisma client returns.
const FIXTURE_ROWS = [
  {
    id: "prod_1",
    category: "PANEL",
    maker: "Solar Co",
    name: "SC-450W",
    modelNo: null,
    capacity: { toString: () => "0.45" },
    unit: "枚",
    purchasePrice: { toString: () => "30000" },
    dealerPrice: { toString: () => "40000" },
    listPrice: { toString: () => "55000" },
    effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    effectiveTo: null,
    isActive: true,
  },
];

function makeRequest(asOf?: string): Request {
  const url = asOf
    ? `http://localhost/api/products/active?asOf=${asOf}`
    : "http://localhost/api/products/active";
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  authMock.mockReset();
  getTenantContextMock.mockReset();
  withTenantMock.mockReset();

  // Default: the mocked `withTenant` resolves to the fixture catalogue. Each
  // role-specific test sets up `auth` / `getTenantContext` to shape ctx.
  withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    const tx = {
      product: {
        findMany: vi.fn().mockResolvedValue(FIXTURE_ROWS),
      },
    };
    return fn(tx);
  });
});

describe("GET /api/products/active — purchasePrice visibility (T-02-04)", () => {
  it("wholesaler_admin: response includes purchasePrice with the correct value", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_ws_admin",
        tenantId: "tenant_ws_a",
        tenantType: "WHOLESALER",
        wholesalerId: "tenant_ws_a",
        dealerId: null,
        roles: ["WHOLESALER_ADMIN"],
        isSaasAdmin: false,
      },
    });
    getTenantContextMock.mockResolvedValue({
      actorUserId: "u_ws_admin",
      tenantId: "tenant_ws_a",
      wholesalerId: "tenant_ws_a",
      relationshipIds: [],
      isSaasAdmin: false,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      products: Array<Record<string, unknown>>;
    };

    expect(body.products).toHaveLength(1);
    const row = body.products[0]!;
    expect(Object.keys(row)).toContain("purchasePrice");
    expect(row.purchasePrice).toBe("30000");
    expect(row.dealerPrice).toBe("40000");
    expect(row.listPrice).toBe("55000");
  });

  it("wholesaler_event_team and wholesaler_direct_sales: purchasePrice is still included", async () => {
    for (const role of ["WHOLESALER_EVENT_TEAM", "WHOLESALER_DIRECT_SALES"] as const) {
      authMock.mockResolvedValue({
        user: {
          id: `u_ws_${role}`,
          tenantId: "tenant_ws_a",
          tenantType: "WHOLESALER",
          wholesalerId: "tenant_ws_a",
          dealerId: null,
          roles: [role],
          isSaasAdmin: false,
        },
      });
      getTenantContextMock.mockResolvedValue({
        actorUserId: `u_ws_${role}`,
        tenantId: "tenant_ws_a",
        wholesalerId: "tenant_ws_a",
        relationshipIds: [],
        isSaasAdmin: false,
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { products: Array<Record<string, unknown>> };
      expect(body.products).toHaveLength(1);
      expect(Object.keys(body.products[0]!)).toContain("purchasePrice");
      expect(body.products[0]!.purchasePrice).toBe("30000");
    }
  });

  it("dealer_admin: response physically omits purchasePrice (key absent from JSON)", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_dl_admin",
        tenantId: "tenant_dl_x",
        tenantType: "DEALER",
        wholesalerId: "tenant_ws_a",
        dealerId: "tenant_dl_x",
        roles: ["DEALER_ADMIN"],
        isSaasAdmin: false,
      },
    });
    getTenantContextMock.mockResolvedValue({
      actorUserId: "u_dl_admin",
      tenantId: "tenant_dl_x",
      dealerId: "tenant_dl_x",
      wholesalerId: "tenant_ws_a",
      relationshipIds: ["rel_a_x"],
      isSaasAdmin: false,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<Record<string, unknown>> };

    expect(body.products).toHaveLength(1);
    const row = body.products[0]!;
    // The key MUST be physically absent — `undefined` would still leak the
    // shape (and the field exists at all). docs/03 §4.3 forbids the key from
    // appearing in any dealer-visible payload.
    expect(Object.keys(row).includes("purchasePrice")).toBe(false);
    // Non-sensitive fields remain.
    expect(row.dealerPrice).toBe("40000");
    expect(row.listPrice).toBe("55000");
    expect(row.id).toBe("prod_1");
  });

  it("dealer_staff: same mask applies (the mask keys off dealerId, not the role list)", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_dl_staff",
        tenantId: "tenant_dl_x",
        tenantType: "DEALER",
        wholesalerId: "tenant_ws_a",
        dealerId: "tenant_dl_x",
        roles: ["DEALER_STAFF"],
        isSaasAdmin: false,
      },
    });
    getTenantContextMock.mockResolvedValue({
      actorUserId: "u_dl_staff",
      tenantId: "tenant_dl_x",
      dealerId: "tenant_dl_x",
      wholesalerId: "tenant_ws_a",
      relationshipIds: ["rel_a_x"],
      isSaasAdmin: false,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<Record<string, unknown>> };
    expect(body.products).toHaveLength(1);
    expect(Object.keys(body.products[0]!).includes("purchasePrice")).toBe(false);
  });

  it("saas_admin: purchasePrice is included (operator has full visibility, docs/03 §4.3 scopes the mask to dealers)", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_sa",
        tenantId: "tenant_sa",
        tenantType: "WHOLESALER",
        wholesalerId: "tenant_sa",
        dealerId: null,
        roles: ["SAAS_ADMIN"],
        isSaasAdmin: true,
      },
    });
    getTenantContextMock.mockResolvedValue({
      actorUserId: "u_sa",
      isSaasAdmin: true,
      relationshipIds: [],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<Record<string, unknown>> };

    expect(body.products).toHaveLength(1);
    expect(Object.keys(body.products[0]!)).toContain("purchasePrice");
    expect(body.products[0]!.purchasePrice).toBe("30000");
  });
});

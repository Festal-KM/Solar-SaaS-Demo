// Unit tests for the product master Server Actions (T-02-03).
//
// Same shape as `venue-providers/__tests__/actions.test.ts`: mock `@/auth`
// and `@solar/db.withTenant` so the role × tenant matrix is exercised end to
// end without standing up Postgres. The actions run through
// `withServerActionContext` → `assertCan` so the permission policy added in
// `lib/permissions/can.ts` is in the assertion path.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const productCreateMock = vi.fn();
const productFindUniqueMock = vi.fn();
const productUpdateMock = vi.fn();
const productPriceHistoryCreateMock = vi.fn();
const auditLogCreateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    product: {
      create: (...args: unknown[]) => productCreateMock(...args),
      findUnique: (...args: unknown[]) => productFindUniqueMock(...args),
      update: (...args: unknown[]) => productUpdateMock(...args),
    },
    productPriceHistory: {
      create: (...args: unknown[]) => productPriceHistoryCreateMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
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

const { createProductAction, updateProductAction, reviseProductRatesAction, retireProductAction } =
  await import("../actions.js");

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

const WS_EVENT_TEAM_SESSION = {
  user: {
    id: "u_ws_event",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_EVENT_TEAM"],
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
  relationshipFindManyMock.mockReset();
  productCreateMock.mockReset();
  productFindUniqueMock.mockReset();
  productUpdateMock.mockReset();
  productPriceHistoryCreateMock.mockReset();
  auditLogCreateMock.mockReset();
  auditLogCreateMock.mockResolvedValue({ id: BigInt(1) });
  revalidatePathMock.mockReset();
});

describe("createProductAction", () => {
  it("creates a product for wholesaler_admin, stamping wholesalerId + createdBy from ctx", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productCreateMock.mockResolvedValue({ id: "prod_1" });

    const result = await createProductAction({
      category: "PANEL",
      maker: "Solar Co",
      name: "SC-450W",
      unit: "枚",
      purchasePrice: "30000",
      dealerPrice: "40000",
      listPrice: "55000",
      effectiveFrom: new Date("2026-04-01T00:00:00Z"),
    });

    expect(result).toEqual({ id: "prod_1" });
    const call = productCreateMock.mock.calls[0]![0] as {
      data: { wholesalerId: string; createdBy: string; maker: string; name: string };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.createdBy).toBe("u_ws_admin");
    expect(call.data.maker).toBe("Solar Co");
    expect(call.data.name).toBe("SC-450W");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/products");
  });

  it("rejects creation from wholesaler_event_team (product.create wholesaler_admin only)", async () => {
    authMock.mockResolvedValue(WS_EVENT_TEAM_SESSION);

    await expect(
      createProductAction({
        category: "PANEL",
        maker: "Solar Co",
        name: "SC-450W",
        unit: "枚",
        purchasePrice: "30000",
        dealerPrice: "40000",
        listPrice: "55000",
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin (product.create requires wholesaler_admin)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      createProductAction({
        category: "PANEL",
        maker: "Solar Co",
        name: "Sneaky",
        unit: "枚",
        purchasePrice: "1",
        dealerPrice: "1",
        listPrice: "1",
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it("rejects effectiveFrom >= effectiveTo (Zod refine)", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      createProductAction({
        category: "PANEL",
        maker: "Solar Co",
        name: "BadPeriod",
        unit: "枚",
        purchasePrice: "30000",
        dealerPrice: "40000",
        listPrice: "55000",
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
        effectiveTo: new Date("2026-03-01T00:00:00Z"),
      }),
    ).rejects.toThrow();

    expect(productCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateProductAction", () => {
  it("patches only the supplied non-price fields", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productFindUniqueMock.mockResolvedValue({ id: "prod_1" });
    productUpdateMock.mockResolvedValue({ id: "prod_1" });

    await updateProductAction({
      id: "prod_1",
      patch: { name: "改名済 SC-450W", modelNo: "SC-450W-2026" },
    });

    const args = productUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where.id).toBe("prod_1");
    expect(args.data.name).toBe("改名済 SC-450W");
    expect(args.data.modelNo).toBe("SC-450W-2026");
    // Price fields are intentionally NOT writable through update — they belong
    // to `reviseProductRatesAction`. If anyone tries, the schema strips them.
    expect("purchasePrice" in args.data).toBe(false);
    expect("dealerPrice" in args.data).toBe(false);
    expect("listPrice" in args.data).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/products");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/products/prod_1");
  });

  it("raises NotFound when the row is invisible (cross-tenant via RLS)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateProductAction({ id: "prod_other_tenant", patch: { name: "x" } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(productUpdateMock).not.toHaveBeenCalled();
  });
});

describe("reviseProductRatesAction", () => {
  it("closes the previous period, creates a successor row, and writes a history entry in one transaction", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productFindUniqueMock.mockResolvedValue({
      id: "prod_1",
      wholesalerId: "tenant_ws_a",
      category: "PANEL",
      maker: "Solar Co",
      name: "SC-450W",
      modelNo: null,
      capacity: null,
      unit: "枚",
      purchasePrice: { toString: () => "30000" },
      dealerPrice: { toString: () => "40000" },
      listPrice: { toString: () => "55000" },
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: null,
      note: null,
    });
    productUpdateMock.mockResolvedValue({ id: "prod_1" });
    productCreateMock.mockResolvedValue({ id: "prod_2" });
    productPriceHistoryCreateMock.mockResolvedValue({ id: "hist_1" });

    const result = await reviseProductRatesAction({
      id: "prod_1",
      patch: {
        purchasePrice: "28000",
        dealerPrice: "38000",
        listPrice: "52000",
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
        reason: "メーカー値下げ",
      },
    });

    expect(result).toEqual({ newId: "prod_2", previousId: "prod_1" });

    // 1) close previous period
    const updateArgs = productUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { effectiveTo: Date };
    };
    expect(updateArgs.where.id).toBe("prod_1");
    expect(updateArgs.data.effectiveTo).toBeInstanceOf(Date);
    expect(updateArgs.data.effectiveTo.toISOString()).toBe("2026-06-01T00:00:00.000Z");

    // 2) create successor with NEW prices but INHERITED identity
    const createArgs = productCreateMock.mock.calls[0]![0] as {
      data: {
        wholesalerId: string;
        maker: string;
        name: string;
        purchasePrice: string;
        dealerPrice: string;
        listPrice: string;
        effectiveFrom: Date;
        createdBy: string;
      };
    };
    expect(createArgs.data.wholesalerId).toBe("tenant_ws_a");
    expect(createArgs.data.maker).toBe("Solar Co");
    expect(createArgs.data.name).toBe("SC-450W");
    expect(createArgs.data.purchasePrice).toBe("28000");
    expect(createArgs.data.dealerPrice).toBe("38000");
    expect(createArgs.data.listPrice).toBe("52000");
    expect(createArgs.data.createdBy).toBe("u_ws_admin");

    // 3) history row
    const histArgs = productPriceHistoryCreateMock.mock.calls[0]![0] as {
      data: { productId: string; before: Record<string, unknown>; after: Record<string, unknown> };
    };
    expect(histArgs.data.productId).toBe("prod_1");
    expect(histArgs.data.before.purchasePrice).toBe("30000");
    expect(histArgs.data.after.purchasePrice).toBe("28000");
    expect(histArgs.data.after.successorProductId).toBe("prod_2");
    expect(histArgs.data.after.reason).toBe("メーカー値下げ");
  });

  it("rejects a revision whose effectiveFrom is not strictly after the existing one", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productFindUniqueMock.mockResolvedValue({
      id: "prod_1",
      wholesalerId: "tenant_ws_a",
      category: "PANEL",
      maker: "Solar Co",
      name: "SC-450W",
      modelNo: null,
      capacity: null,
      unit: "枚",
      purchasePrice: { toString: () => "30000" },
      dealerPrice: { toString: () => "40000" },
      listPrice: { toString: () => "55000" },
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      effectiveTo: null,
      note: null,
    });

    await expect(
      reviseProductRatesAction({
        id: "prod_1",
        patch: {
          purchasePrice: "10",
          dealerPrice: "10",
          listPrice: "10",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(productUpdateMock).not.toHaveBeenCalled();
    expect(productCreateMock).not.toHaveBeenCalled();
    expect(productPriceHistoryCreateMock).not.toHaveBeenCalled();
  });
});

describe("retireProductAction", () => {
  it("flips isActive=false and stamps effectiveTo at retirement", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    productFindUniqueMock.mockResolvedValue({
      id: "prod_1",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
    productUpdateMock.mockResolvedValue({ id: "prod_1" });

    await retireProductAction({ id: "prod_1" });

    const args = productUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { isActive: boolean; effectiveTo: Date };
    };
    expect(args.where.id).toBe("prod_1");
    expect(args.data.isActive).toBe(false);
    expect(args.data.effectiveTo).toBeInstanceOf(Date);
  });

  it("forbids dealer_admin (product.retire requires wholesaler_admin)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(retireProductAction({ id: "prod_1" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(productUpdateMock).not.toHaveBeenCalled();
  });
});

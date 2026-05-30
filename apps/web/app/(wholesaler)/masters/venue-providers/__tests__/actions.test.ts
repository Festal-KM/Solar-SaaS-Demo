// Unit tests for the venue-provider Server Actions (T-02-02).
//
// We mock `@/auth` (Auth.js session) and `@solar/db` (withTenant) so the test
// shapes the role × tenant matrix without spinning up Postgres. The actions
// run end-to-end through `withServerActionContext` → `assertCan` so the
// permission policy added in this task is exercised.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const venueProviderCreateMock = vi.fn();
const venueProviderFindUniqueMock = vi.fn();
const venueProviderUpdateMock = vi.fn();
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
    venueProvider: {
      create: (...args: unknown[]) => venueProviderCreateMock(...args),
      findUnique: (...args: unknown[]) => venueProviderFindUniqueMock(...args),
      update: (...args: unknown[]) => venueProviderUpdateMock(...args),
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

const { createVenueProviderAction, updateVenueProviderAction, disableVenueProviderAction } =
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
  venueProviderCreateMock.mockReset();
  venueProviderFindUniqueMock.mockReset();
  venueProviderUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createVenueProviderAction", () => {
  it("creates a venue provider for a wholesaler_admin and revalidates the list", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderCreateMock.mockResolvedValue({ id: "vp_1" });

    const result = await createVenueProviderAction({
      name: "ホームセンター A 店",
      address: "東京都新宿区西新宿 1-1-1",
      contractType: "FIXED",
      fixedFee: "50000",
    });

    expect(result).toEqual({ id: "vp_1" });
    expect(venueProviderCreateMock).toHaveBeenCalledTimes(1);
    const call = venueProviderCreateMock.mock.calls[0]![0] as {
      data: { wholesalerId: string; name: string; address: string };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.name).toBe("ホームセンター A 店");
    expect(call.data.address).toBe("東京都新宿区西新宿 1-1-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/venue-providers");
  });

  it("rejects creation without an address (docs/02 §F-011 受け入れ基準: 住所必須)", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      createVenueProviderAction({
        name: "住所欠落店",
        // @ts-expect-error — intentional: address omitted to assert schema rejection
        address: undefined,
        contractType: "OTHER",
      }),
    ).rejects.toThrow();

    expect(venueProviderCreateMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin from creating (ForbiddenError)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      createVenueProviderAction({
        name: "侵入店舗",
        address: "千葉県千葉市中央区 1-1",
        contractType: "FIXED",
        fixedFee: "1000",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(venueProviderCreateMock).not.toHaveBeenCalled();
  });

  it("rejects PERFORMANCE without a performanceRate (Zod refine)", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      createVenueProviderAction({
        name: "成果報酬店舗",
        address: "大阪府大阪市北区 2-3-4",
        contractType: "PERFORMANCE",
      }),
    ).rejects.toThrow();

    expect(venueProviderCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateVenueProviderAction", () => {
  it("updates the patched fields and revalidates list + detail", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindUniqueMock.mockResolvedValue({ id: "vp_1" });
    venueProviderUpdateMock.mockResolvedValue({ id: "vp_1" });

    const result = await updateVenueProviderAction({
      id: "vp_1",
      patch: { name: "改名済 店舗", area: "東京" },
    });

    expect(result).toEqual({ id: "vp_1" });
    const updateArgs = venueProviderUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArgs.where.id).toBe("vp_1");
    expect(updateArgs.data.name).toBe("改名済 店舗");
    expect(updateArgs.data.area).toBe("東京");
    // Fields not present in the patch should NOT be written.
    expect("phone" in updateArgs.data).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/venue-providers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/venue-providers/vp_1");
  });

  it("raises NotFound when the row is invisible (RLS / cross-tenant)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateVenueProviderAction({ id: "vp_other_tenant", patch: { name: "n" } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(venueProviderUpdateMock).not.toHaveBeenCalled();
  });
});

describe("disableVenueProviderAction", () => {
  it("flips isActive=false and revalidates", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    venueProviderFindUniqueMock.mockResolvedValue({ id: "vp_1" });
    venueProviderUpdateMock.mockResolvedValue({ id: "vp_1" });

    await disableVenueProviderAction({ id: "vp_1" });

    const updateArgs = venueProviderUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { isActive: boolean };
    };
    expect(updateArgs.where.id).toBe("vp_1");
    expect(updateArgs.data.isActive).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/venue-providers");
  });

  it("forbids dealer_admin (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(disableVenueProviderAction({ id: "vp_1" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(venueProviderUpdateMock).not.toHaveBeenCalled();
  });
});

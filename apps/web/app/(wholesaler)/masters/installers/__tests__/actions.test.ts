// Unit tests for the installer Server Actions (T-02-05 / F-013).
//
// Mocks `@/auth` and `@solar/db.withTenant` so the role x tenant matrix is
// exercised through the full `withServerActionContext` pipeline (auth →
// assertCan → withTenant) without spinning up Postgres.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const installerCreateMock = vi.fn();
const installerFindUniqueMock = vi.fn();
const installerUpdateMock = vi.fn();
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
    installer: {
      create: (...args: unknown[]) => installerCreateMock(...args),
      findUnique: (...args: unknown[]) => installerFindUniqueMock(...args),
      update: (...args: unknown[]) => installerUpdateMock(...args),
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

const { createInstallerAction, updateInstallerAction, disableInstallerAction } =
  await import("../actions.js");

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
  relationshipFindManyMock.mockReset();
  installerCreateMock.mockReset();
  installerFindUniqueMock.mockReset();
  installerUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createInstallerAction", () => {
  it("creates an installer for a wholesaler_admin and revalidates the list", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    installerCreateMock.mockResolvedValue({ id: "inst_1" });

    const result = await createInstallerAction({
      name: "東京施工株式会社",
      area: "関東",
      phone: "03-1234-5678",
      contactName: "山田太郎",
    });

    expect(result).toEqual({ id: "inst_1" });
    expect(installerCreateMock).toHaveBeenCalledTimes(1);
    const call = installerCreateMock.mock.calls[0]![0] as {
      data: { wholesalerId: string; name: string; area?: string };
    };
    expect(call.data.wholesalerId).toBe("tenant_ws_a");
    expect(call.data.name).toBe("東京施工株式会社");
    expect(call.data.area).toBe("関東");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/installers");
  });

  it("forbids dealer_admin from creating (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      createInstallerAction({
        name: "侵入施工",
        area: "千葉",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(installerCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateInstallerAction", () => {
  it("updates the patched fields and revalidates list + detail", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    installerFindUniqueMock.mockResolvedValue({ id: "inst_1" });
    installerUpdateMock.mockResolvedValue({ id: "inst_1" });

    const result = await updateInstallerAction({
      id: "inst_1",
      patch: { name: "改名済 施工", area: "東京" },
    });

    expect(result).toEqual({ id: "inst_1" });
    const updateArgs = installerUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArgs.where.id).toBe("inst_1");
    expect(updateArgs.data.name).toBe("改名済 施工");
    expect(updateArgs.data.area).toBe("東京");
    // Fields not present in the patch MUST NOT be written.
    expect("phone" in updateArgs.data).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/installers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/installers/inst_1");
  });

  it("raises NotFound when the row is invisible (RLS / cross-tenant)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    installerFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateInstallerAction({ id: "inst_other_tenant", patch: { name: "n" } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(installerUpdateMock).not.toHaveBeenCalled();
  });
});

describe("disableInstallerAction", () => {
  it("flips isActive=false and revalidates (no physical delete)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    installerFindUniqueMock.mockResolvedValue({ id: "inst_1" });
    installerUpdateMock.mockResolvedValue({ id: "inst_1" });

    await disableInstallerAction({ id: "inst_1" });

    const updateArgs = installerUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { isActive: boolean };
    };
    expect(updateArgs.where.id).toBe("inst_1");
    expect(updateArgs.data.isActive).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/installers");
  });

  it("forbids dealer_admin (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(disableInstallerAction({ id: "inst_1" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(installerUpdateMock).not.toHaveBeenCalled();
  });
});

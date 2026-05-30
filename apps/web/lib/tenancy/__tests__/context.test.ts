// `getTenantContext()` unit tests (T-01-08).
//
// We mock both `@/auth` (the Auth.js v5 entry) and `@solar/db.rawPrisma`'s
// `relationship.findMany` so the test can shape every branch — unauth, saas
// admin, wholesaler member, dealer member — without spinning up Postgres.

import { UnauthorizedError } from "@solar/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTenantContext } from "../context.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const findManyMock = vi.fn();

// `vi.mock` is hoisted by Vitest to the top of the module regardless of where
// it sits in source order, so it's safe to keep `import { getTenantContext }`
// above this block.
vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => findManyMock(...args),
      },
    },
  };
});

beforeEach(() => {
  authMock.mockReset();
  findManyMock.mockReset();
});

describe("getTenantContext()", () => {
  it("throws UnauthorizedError when no session is present", async () => {
    authMock.mockResolvedValue(null);

    await expect(getTenantContext()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the session has no user", async () => {
    authMock.mockResolvedValue({ expires: "2099-01-01" });

    await expect(getTenantContext()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("resolves a wholesaler member with wholesalerId from the session JWT", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user_ws_1",
        tenantId: "tenant_ws",
        tenantType: "WHOLESALER",
        wholesalerId: "tenant_ws",
        dealerId: null,
        roles: ["WHOLESALER_ADMIN"],
        isSaasAdmin: false,
      },
    });

    const ctx = await getTenantContext();

    expect(ctx).toEqual({
      actorUserId: "user_ws_1",
      tenantId: "tenant_ws",
      wholesalerId: "tenant_ws",
      relationshipIds: [],
      isSaasAdmin: false,
    });
    // Wholesaler path must NOT touch Relationship.
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("resolves a dealer member with relationshipIds[] from the DB", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user_dl_1",
        tenantId: "tenant_dl",
        tenantType: "DEALER",
        wholesalerId: "tenant_ws_a",
        dealerId: "tenant_dl",
        roles: ["DEALER_ADMIN"],
        isSaasAdmin: false,
      },
    });
    findManyMock.mockResolvedValue([{ id: "rel_1" }, { id: "rel_2" }]);

    const ctx = await getTenantContext();

    expect(ctx).toEqual({
      actorUserId: "user_dl_1",
      tenantId: "tenant_dl",
      dealerId: "tenant_dl",
      wholesalerId: "tenant_ws_a",
      relationshipIds: ["rel_1", "rel_2"],
      isSaasAdmin: false,
    });
    expect(findManyMock).toHaveBeenCalledWith({
      where: { dealerId: "tenant_dl", status: "ACTIVE", wholesalerId: "tenant_ws_a" },
      select: { id: true },
    });
  });

  it("scopes dealer relationships across all wholesalers when none is selected", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user_dl_2",
        tenantId: "tenant_dl",
        tenantType: "DEALER",
        wholesalerId: null,
        dealerId: "tenant_dl",
        roles: ["DEALER_ADMIN"],
        isSaasAdmin: false,
      },
    });
    findManyMock.mockResolvedValue([{ id: "rel_a" }, { id: "rel_b" }, { id: "rel_c" }]);

    const ctx = await getTenantContext();

    expect(ctx.relationshipIds).toEqual(["rel_a", "rel_b", "rel_c"]);
    expect(ctx.wholesalerId).toBeUndefined();
    expect(findManyMock).toHaveBeenCalledWith({
      where: { dealerId: "tenant_dl", status: "ACTIVE" },
      select: { id: true },
    });
  });

  it("returns an isSaasAdmin context that bypasses tenant scope", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user_sa_1",
        tenantId: "tenant_sa",
        tenantType: "WHOLESALER",
        wholesalerId: "tenant_sa",
        dealerId: null,
        roles: ["SAAS_ADMIN"],
        isSaasAdmin: true,
      },
    });

    const ctx = await getTenantContext();

    expect(ctx).toEqual({
      actorUserId: "user_sa_1",
      isSaasAdmin: true,
      relationshipIds: [],
    });
    expect(ctx.tenantId).toBeUndefined();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

// Unit tests for the SaaS-admin tenant Server Actions (T-02-08 / F-004).
//
// `@/auth` (Auth.js session)、`@solar/db.withTenant`、`@solar/email`、
// `@solar/auth` (hashPassword) をモックして、`withServerActionContext` の
// auth → assertCan → withTenant パイプを通してテストする。Postgres / Resend を
// 立ち上げずに role × tenant の挙動を網羅。

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();

const tenantFindUniqueMock = vi.fn();
const tenantCreateMock = vi.fn();
const tenantUpdateMock = vi.fn();
const wholesalerSettingsCreateMock = vi.fn();
const userFindUniqueMock = vi.fn();
const userCreateMock = vi.fn();
const userRoleCreateMock = vi.fn();
const userInvitationCreateMock = vi.fn();
const userInvitationFindFirstMock = vi.fn();
const userInvitationUpdateMock = vi.fn();
const auditLogCreateMock = vi.fn();

const revalidatePathMock = vi.fn();
const sendUserInviteEmailMock = vi.fn();
const hashPasswordMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    tenant: {
      findUnique: (...args: unknown[]) => tenantFindUniqueMock(...args),
      create: (...args: unknown[]) => tenantCreateMock(...args),
      update: (...args: unknown[]) => tenantUpdateMock(...args),
    },
    wholesalerSettings: {
      create: (...args: unknown[]) => wholesalerSettingsCreateMock(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      create: (...args: unknown[]) => userCreateMock(...args),
    },
    userRole: {
      create: (...args: unknown[]) => userRoleCreateMock(...args),
    },
    userInvitation: {
      create: (...args: unknown[]) => userInvitationCreateMock(...args),
      findFirst: (...args: unknown[]) => userInvitationFindFirstMock(...args),
      update: (...args: unknown[]) => userInvitationUpdateMock(...args),
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

vi.mock("@solar/email", () => ({
  defaultEmailClient: { sendEmail: vi.fn(async () => ({ messageId: "stub" })) },
  sendUserInviteEmail: (...args: unknown[]) => sendUserInviteEmailMock(...args),
}));

vi.mock("@solar/auth", () => ({
  hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
}));

const { createTenantAction, resendInvitationAction, updateTenantStatusAction } =
  await import("../actions.js");

const SAAS_ADMIN_SESSION = {
  user: {
    id: "u_saas",
    tenantId: "tenant_saas_ops",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_saas_ops",
    dealerId: null,
    roles: ["SAAS_ADMIN"],
    isSaasAdmin: true,
  },
};

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

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  tenantFindUniqueMock.mockReset();
  tenantCreateMock.mockReset();
  tenantUpdateMock.mockReset();
  wholesalerSettingsCreateMock.mockReset();
  userFindUniqueMock.mockReset();
  userCreateMock.mockReset();
  userRoleCreateMock.mockReset();
  userInvitationCreateMock.mockReset();
  userInvitationFindFirstMock.mockReset();
  userInvitationUpdateMock.mockReset();
  auditLogCreateMock.mockReset();
  revalidatePathMock.mockReset();
  sendUserInviteEmailMock.mockReset();
  hashPasswordMock.mockReset();
  hashPasswordMock.mockResolvedValue("hashed-token");
  sendUserInviteEmailMock.mockResolvedValue({ messageId: "stub" });
});

describe("createTenantAction", () => {
  it("creates Tenant + WholesalerSettings + User + UserInvitation and sends invite", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    userFindUniqueMock.mockResolvedValue(null);
    tenantCreateMock.mockResolvedValue({ id: "tenant_new_1" });
    wholesalerSettingsCreateMock.mockResolvedValue({ wholesalerId: "tenant_new_1" });
    userCreateMock.mockResolvedValue({ id: "user_new_1" });
    userRoleCreateMock.mockResolvedValue({});
    userInvitationCreateMock.mockResolvedValue({ id: "inv_new_1" });
    auditLogCreateMock.mockResolvedValue({});

    const result = await createTenantAction({
      name: "新規卸業者 株式会社",
      type: "WHOLESALER",
      plan: "MEDIUM",
      adminEmail: "Admin@Example.com",
      adminName: "管理者 太郎",
    });

    expect(result.tenantId).toBe("tenant_new_1");
    expect(result.invitationId).toBe("inv_new_1");
    expect(result.inviteUrl).toContain("/invite/");

    // Tenant
    expect(tenantCreateMock).toHaveBeenCalledTimes(1);
    const tenantArg = tenantCreateMock.mock.calls[0]![0] as {
      data: { type: string; name: string; plan: string; status: string };
    };
    expect(tenantArg.data).toMatchObject({
      type: "WHOLESALER",
      name: "新規卸業者 株式会社",
      plan: "MEDIUM",
      status: "ACTIVE",
    });

    // WholesalerSettings
    expect(wholesalerSettingsCreateMock).toHaveBeenCalledWith({
      data: { wholesalerId: "tenant_new_1" },
    });

    // User (INVITED, twoFactorRequired)
    expect(userCreateMock).toHaveBeenCalledTimes(1);
    const userArg = userCreateMock.mock.calls[0]![0] as {
      data: {
        tenantId: string;
        email: string;
        name: string;
        status: string;
        twoFactorRequired: boolean;
      };
    };
    expect(userArg.data).toMatchObject({
      tenantId: "tenant_new_1",
      email: "admin@example.com", // 小文字化
      name: "管理者 太郎",
      status: "INVITED",
      twoFactorRequired: true,
    });

    // UserRole
    expect(userRoleCreateMock).toHaveBeenCalledTimes(1);
    const roleArg = userRoleCreateMock.mock.calls[0]![0] as {
      data: { userId: string; role: string };
    };
    expect(roleArg.data).toMatchObject({ userId: "user_new_1", role: "WHOLESALER_ADMIN" });

    // UserInvitation
    expect(userInvitationCreateMock).toHaveBeenCalledTimes(1);
    const invArg = userInvitationCreateMock.mock.calls[0]![0] as {
      data: { tenantId: string; email: string; role: string; tokenHash: string };
    };
    expect(invArg.data).toMatchObject({
      tenantId: "tenant_new_1",
      email: "admin@example.com",
      role: "WHOLESALER_ADMIN",
      tokenHash: "hashed-token",
    });

    // Email
    expect(sendUserInviteEmailMock).toHaveBeenCalledTimes(1);

    // Audit log
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/tenants");
  });

  it("returns 409 ConflictError when admin email already exists", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    userFindUniqueMock.mockResolvedValue({ id: "user_existing" });

    await expect(
      createTenantAction({
        name: "重複店",
        type: "WHOLESALER",
        plan: "SMALL",
        adminEmail: "dup@example.com",
        adminName: "管理者",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(tenantCreateMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
    expect(sendUserInviteEmailMock).not.toHaveBeenCalled();
  });

  it("forbids non-SAAS_ADMIN (wholesaler_admin → 403)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);

    await expect(
      createTenantAction({
        name: "侵入卸",
        type: "WHOLESALER",
        plan: "SMALL",
        adminEmail: "intruder@example.com",
        adminName: "侵入者",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(tenantCreateMock).not.toHaveBeenCalled();
  });
});

describe("resendInvitationAction", () => {
  it("expires the old invitation and issues a fresh one after the TTL elapsed", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    const expiredAt = new Date(Date.now() - 60_000); // 1 分前に失効
    userInvitationFindFirstMock.mockResolvedValue({
      id: "inv_old",
      email: "admin@example.com",
      role: "WHOLESALER_ADMIN",
      expiresAt: expiredAt,
    });
    userInvitationUpdateMock.mockResolvedValue({});
    userInvitationCreateMock.mockResolvedValue({ id: "inv_new" });
    auditLogCreateMock.mockResolvedValue({});

    const result = await resendInvitationAction({ tenantId: "tenant_x" });

    expect(result.invitationId).toBe("inv_new");
    // 旧招待を失効
    expect(userInvitationUpdateMock).toHaveBeenCalledTimes(1);
    const updateArg = userInvitationUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { acceptedAt: Date };
    };
    expect(updateArg.where.id).toBe("inv_old");
    expect(updateArg.data.acceptedAt).toBeInstanceOf(Date);

    // 新トークン発行
    expect(userInvitationCreateMock).toHaveBeenCalledTimes(1);
    const createArg = userInvitationCreateMock.mock.calls[0]![0] as {
      data: { tenantId: string; email: string; role: string; tokenHash: string };
    };
    expect(createArg.data).toMatchObject({
      tenantId: "tenant_x",
      email: "admin@example.com",
      role: "WHOLESALER_ADMIN",
      tokenHash: "hashed-token",
    });

    expect(sendUserInviteEmailMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
  });

  it("rejects re-issue while the current invitation is still valid", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 日後
    userInvitationFindFirstMock.mockResolvedValue({
      id: "inv_active",
      email: "admin@example.com",
      role: "WHOLESALER_ADMIN",
      expiresAt: future,
    });

    await expect(resendInvitationAction({ tenantId: "tenant_x" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(userInvitationCreateMock).not.toHaveBeenCalled();
    expect(sendUserInviteEmailMock).not.toHaveBeenCalled();
  });

  it("raises NotFound when no pending invitation exists", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    userInvitationFindFirstMock.mockResolvedValue(null);

    await expect(resendInvitationAction({ tenantId: "tenant_x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("updateTenantStatusAction", () => {
  it("toggles ACTIVE → SUSPENDED and writes a STATUS_CHANGE audit log", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    tenantFindUniqueMock.mockResolvedValue({ id: "tenant_x", status: "ACTIVE" });
    tenantUpdateMock.mockResolvedValue({ id: "tenant_x", status: "SUSPENDED" });
    auditLogCreateMock.mockResolvedValue({});

    const result = await updateTenantStatusAction({
      tenantId: "tenant_x",
      status: "SUSPENDED",
    });

    expect(result).toEqual({ tenantId: "tenant_x", status: "SUSPENDED" });
    const auditArg = auditLogCreateMock.mock.calls[0]![0] as {
      data: { action: string; before: { status: string }; after: { status: string } };
    };
    expect(auditArg.data.action).toBe("STATUS_CHANGE");
    expect(auditArg.data.before.status).toBe("ACTIVE");
    expect(auditArg.data.after.status).toBe("SUSPENDED");
    expect(revalidatePathMock).toHaveBeenCalledWith("/tenants");
  });

  it("toggles SUSPENDED → ACTIVE", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    tenantFindUniqueMock.mockResolvedValue({ id: "tenant_x", status: "SUSPENDED" });
    tenantUpdateMock.mockResolvedValue({ id: "tenant_x", status: "ACTIVE" });

    const result = await updateTenantStatusAction({
      tenantId: "tenant_x",
      status: "ACTIVE",
    });

    expect(result.status).toBe("ACTIVE");
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
  });

  it("forbids non-SAAS_ADMIN", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    await expect(
      updateTenantStatusAction({ tenantId: "tenant_x", status: "SUSPENDED" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(tenantUpdateMock).not.toHaveBeenCalled();
  });
});

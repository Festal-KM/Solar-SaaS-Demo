// Unit tests for the SaaS-admin plan management Server Action (T-02-09 / F-005).
//
// `@/auth` (Auth.js session)、`@solar/db.withTenant` をモックして、
// `withServerActionContext` の auth → assertCan → withTenant パイプを通す。
// Postgres を立ち上げずに role 切り分けと no-op 挙動を検証する。

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const tenantFindUniqueMock = vi.fn();
const tenantUpdateMock = vi.fn();
const planHistoryCreateMock = vi.fn();
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
    tenant: {
      findUnique: (...args: unknown[]) => tenantFindUniqueMock(...args),
      update: (...args: unknown[]) => tenantUpdateMock(...args),
    },
    tenantPlanHistory: {
      create: (...args: unknown[]) => planHistoryCreateMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {},
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { updatePlanAction } = await import("../actions.js");

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
  tenantFindUniqueMock.mockReset();
  tenantUpdateMock.mockReset();
  planHistoryCreateMock.mockReset();
  auditLogCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("updatePlanAction", () => {
  it("records before/after into TenantPlanHistory and AuditLog on a real change", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    tenantFindUniqueMock.mockResolvedValue({
      id: "tenant_x",
      plan: "SMALL",
      type: "WHOLESALER",
    });
    tenantUpdateMock.mockResolvedValue({ id: "tenant_x" });
    planHistoryCreateMock.mockResolvedValue({ id: "hist_1" });
    auditLogCreateMock.mockResolvedValue({});

    const result = await updatePlanAction({
      tenantId: "tenant_x",
      plan: "MEDIUM",
      note: "規模拡大に伴うアップグレード",
    });

    expect(result.changed).toBe(true);
    expect(result.planBefore).toBe("SMALL");
    expect(result.planAfter).toBe("MEDIUM");
    expect(result.historyId).toBe("hist_1");

    // Tenant update — 新 plan で更新
    expect(tenantUpdateMock).toHaveBeenCalledTimes(1);
    const upd = tenantUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { plan: string };
    };
    expect(upd.where.id).toBe("tenant_x");
    expect(upd.data.plan).toBe("MEDIUM");

    // History — before=SMALL after=MEDIUM, changedBy=actorUserId, note 保存
    expect(planHistoryCreateMock).toHaveBeenCalledTimes(1);
    const hist = planHistoryCreateMock.mock.calls[0]![0] as {
      data: {
        tenantId: string;
        planBefore: string;
        planAfter: string;
        changedBy: string;
        note?: string;
        effectiveFrom: Date;
      };
    };
    expect(hist.data).toMatchObject({
      tenantId: "tenant_x",
      planBefore: "SMALL",
      planAfter: "MEDIUM",
      changedBy: "u_saas",
      note: "規模拡大に伴うアップグレード",
    });
    expect(hist.data.effectiveFrom).toBeInstanceOf(Date);

    // Audit log — UPDATE with before/after
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const audit = auditLogCreateMock.mock.calls[0]![0] as {
      data: {
        action: string;
        targetType: string;
        targetId: string;
        before: { plan: string };
        after: { plan: string; historyId: string };
      };
    };
    expect(audit.data.action).toBe("UPDATE");
    expect(audit.data.targetType).toBe("Tenant");
    expect(audit.data.targetId).toBe("tenant_x");
    expect(audit.data.before.plan).toBe("SMALL");
    expect(audit.data.after.plan).toBe("MEDIUM");
    expect(audit.data.after.historyId).toBe("hist_1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/plans");
    expect(revalidatePathMock).toHaveBeenCalledWith("/billing");
  });

  it("is a no-op when the requested plan equals the current plan", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    tenantFindUniqueMock.mockResolvedValue({
      id: "tenant_x",
      plan: "MEDIUM",
      type: "WHOLESALER",
    });

    const result = await updatePlanAction({
      tenantId: "tenant_x",
      plan: "MEDIUM",
    });

    expect(result.changed).toBe(false);
    expect(result.planBefore).toBe("MEDIUM");
    expect(result.planAfter).toBe("MEDIUM");
    expect(result.historyId).toBeNull();

    expect(tenantUpdateMock).not.toHaveBeenCalled();
    expect(planHistoryCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the tenant does not exist", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_SESSION);
    tenantFindUniqueMock.mockResolvedValue(null);

    await expect(
      updatePlanAction({ tenantId: "tenant_missing", plan: "SMALL" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(tenantUpdateMock).not.toHaveBeenCalled();
    expect(planHistoryCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("forbids non-SAAS_ADMIN (wholesaler_admin → 403)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);

    await expect(updatePlanAction({ tenantId: "tenant_x", plan: "SMALL" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(tenantFindUniqueMock).not.toHaveBeenCalled();
    expect(tenantUpdateMock).not.toHaveBeenCalled();
    expect(planHistoryCreateMock).not.toHaveBeenCalled();
  });
});

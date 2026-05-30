// Unit tests for the wholesaler-settings Server Action (T-02-07 / F-015 §F-016).
//
// `@/auth` と `@solar/db.withTenant` をモックして、role x tenant matrix を
// `withServerActionContext` のフルパイプ (auth → assertCan → withTenant) で
// 検証する。Postgres を立ち上げずに済むのが狙い。

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, ValidationError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const wholesalerSettingsFindUniqueMock = vi.fn();
const wholesalerSettingsUpsertMock = vi.fn();
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
    wholesalerSettings: {
      findUnique: (...args: unknown[]) => wholesalerSettingsFindUniqueMock(...args),
      upsert: (...args: unknown[]) => wholesalerSettingsUpsertMock(...args),
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

const { updateWholesalerSettingsAction } = await import("../actions.js");

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
  wholesalerSettingsFindUniqueMock.mockReset();
  wholesalerSettingsUpsertMock.mockReset();
  auditLogCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("updateWholesalerSettingsAction", () => {
  it("updates settings for wholesaler_admin and writes an AuditLog row with before/after", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });
    wholesalerSettingsUpsertMock.mockResolvedValue({
      wholesalerId: "tenant_ws_a",
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 1,
      piiMaskingMode: "PARTIAL",
    });

    const result = await updateWholesalerSettingsAction({
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 1,
      piiMaskingMode: "PARTIAL",
    });

    expect(result).toEqual({ wholesalerId: "tenant_ws_a" });
    expect(wholesalerSettingsUpsertMock).toHaveBeenCalledTimes(1);
    const upsertArgs = wholesalerSettingsUpsertMock.mock.calls[0]![0] as {
      where: { wholesalerId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsertArgs.where.wholesalerId).toBe("tenant_ws_a");
    expect(upsertArgs.update.cancelDeadlineDays).toBe(14);
    expect(upsertArgs.update.fiscalYearStartMonth).toBe(1);
    expect(upsertArgs.update.piiMaskingMode).toBe("PARTIAL");
    expect(upsertArgs.create.wholesalerId).toBe("tenant_ws_a");

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const auditArgs = auditLogCreateMock.mock.calls[0]![0] as {
      data: {
        actorUserId: string;
        tenantId: string;
        targetType: string;
        targetId: string;
        action: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      };
    };
    expect(auditArgs.data.actorUserId).toBe("u_ws_admin");
    expect(auditArgs.data.tenantId).toBe("tenant_ws_a");
    expect(auditArgs.data.targetType).toBe("WholesalerSettings");
    expect(auditArgs.data.targetId).toBe("tenant_ws_a");
    expect(auditArgs.data.action).toBe("UPDATE");
    expect(auditArgs.data.before).toEqual({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });
    expect(auditArgs.data.after).toEqual({
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 1,
      piiMaskingMode: "PARTIAL",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/wholesaler-settings");
  });

  it("skips the AuditLog when no value actually changed (no-op patch)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });
    wholesalerSettingsUpsertMock.mockResolvedValue({
      wholesalerId: "tenant_ws_a",
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });

    await updateWholesalerSettingsAction({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });

    expect(wholesalerSettingsUpsertMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("creates a settings row via upsert when none exists, comparing against defaults", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    wholesalerSettingsFindUniqueMock.mockResolvedValue(null);
    wholesalerSettingsUpsertMock.mockResolvedValue({
      wholesalerId: "tenant_ws_a",
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });

    await updateWholesalerSettingsAction({ cancelDeadlineDays: 14 });

    const upsertArgs = wholesalerSettingsUpsertMock.mock.calls[0]![0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    // Only cancelDeadlineDays in update (patch sema).
    expect(upsertArgs.update).toEqual({ cancelDeadlineDays: 14 });
    expect(upsertArgs.create.cancelDeadlineDays).toBe(14);
    expect(upsertArgs.create.wholesalerId).toBe("tenant_ws_a");

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const auditArgs = auditLogCreateMock.mock.calls[0]![0] as {
      data: { before: Record<string, unknown>; after: Record<string, unknown> };
    };
    // before reflects defaults (no row existed).
    expect(auditArgs.data.before).toEqual({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      piiMaskingMode: "MASKED",
    });
    expect(auditArgs.data.after.cancelDeadlineDays).toBe(14);
  });

  it("forbids wholesaler_event_team (wholesaler_admin only)", async () => {
    authMock.mockResolvedValue(WS_EVENT_TEAM_SESSION);

    await expect(updateWholesalerSettingsAction({ cancelDeadlineDays: 14 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(wholesalerSettingsUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(updateWholesalerSettingsAction({ cancelDeadlineDays: 14 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(wholesalerSettingsUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects cancelDeadlineDays out of range (ValidationError)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);

    await expect(updateWholesalerSettingsAction({ cancelDeadlineDays: 0 })).rejects.toThrow();
    await expect(updateWholesalerSettingsAction({ cancelDeadlineDays: 91 })).rejects.toThrow();

    expect(wholesalerSettingsUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects fiscalYearStartMonth out of range (ValidationError)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);

    await expect(updateWholesalerSettingsAction({ fiscalYearStartMonth: 0 })).rejects.toThrow();
    await expect(updateWholesalerSettingsAction({ fiscalYearStartMonth: 13 })).rejects.toThrow();
  });

  it("surfaces a ValidationError when wholesalerId is missing (e.g. saas-admin without selected tenant)", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_saas",
        tenantId: undefined,
        tenantType: "WHOLESALER",
        wholesalerId: undefined,
        dealerId: null,
        roles: ["SAAS_ADMIN"],
        isSaasAdmin: true,
      },
    });

    await expect(updateWholesalerSettingsAction({ cancelDeadlineDays: 14 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

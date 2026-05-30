// Unit tests for the incentive-rate Server Actions (T-02-06 / F-014).
//
// `@/auth` と `@solar/db.withTenant` をモックして、role x tenant matrix を
// `withServerActionContext` のフルパイプ (auth → assertCan → withTenant) で
// 検証する。Postgres を立ち上げずに済むのが狙い。

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const relationshipFindUniqueMock = vi.fn();
const incentiveRateFindManyMock = vi.fn();
const incentiveRateFindUniqueMock = vi.fn();
const incentiveRateUpdateManyMock = vi.fn();
const incentiveRateCreateMock = vi.fn();
const incentiveRateUpdateMock = vi.fn();
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
    relationship: {
      findUnique: (...args: unknown[]) => relationshipFindUniqueMock(...args),
    },
    incentiveRate: {
      findMany: (...args: unknown[]) => incentiveRateFindManyMock(...args),
      findUnique: (...args: unknown[]) => incentiveRateFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => incentiveRateUpdateManyMock(...args),
      create: (...args: unknown[]) => incentiveRateCreateMock(...args),
      update: (...args: unknown[]) => incentiveRateUpdateMock(...args),
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

const { createIncentiveRateAction, updateIncentiveRateAction } = await import("../actions.js");

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
  relationshipFindUniqueMock.mockReset();
  incentiveRateFindManyMock.mockReset();
  incentiveRateFindUniqueMock.mockReset();
  incentiveRateUpdateManyMock.mockReset();
  incentiveRateCreateMock.mockReset();
  incentiveRateUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createIncentiveRateAction", () => {
  it("creates a rate stamping createdBy and revalidating the list", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    relationshipFindUniqueMock.mockResolvedValue({ id: "rel_a", wholesalerId: "tenant_ws_a" });
    incentiveRateFindManyMock.mockResolvedValue([]);
    incentiveRateCreateMock.mockResolvedValue({ id: "ir_1" });

    const result = await createIncentiveRateAction({
      relationshipId: "rel_a",
      targetType: "PROJECT_PROFIT",
      rate: "15",
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    });

    expect(result).toEqual({ id: "ir_1" });
    expect(incentiveRateUpdateManyMock).not.toHaveBeenCalled();
    const call = incentiveRateCreateMock.mock.calls[0]![0] as {
      data: {
        relationshipId: string;
        targetType: string;
        rate: string;
        effectiveFrom: Date;
        createdBy: string;
      };
    };
    expect(call.data.relationshipId).toBe("rel_a");
    expect(call.data.targetType).toBe("PROJECT_PROFIT");
    expect(call.data.rate).toBe("15");
    expect(call.data.createdBy).toBe("u_ws_admin");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/incentive-rates");
  });

  it("closes the previous open row at the new effectiveFrom before inserting (overlap防止)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    relationshipFindUniqueMock.mockResolvedValue({ id: "rel_a", wholesalerId: "tenant_ws_a" });
    incentiveRateFindManyMock.mockResolvedValue([
      { id: "ir_open", effectiveFrom: new Date("2026-01-01T00:00:00Z") },
    ]);
    incentiveRateUpdateManyMock.mockResolvedValue({ count: 1 });
    incentiveRateCreateMock.mockResolvedValue({ id: "ir_new" });

    const newFrom = new Date("2026-07-01T00:00:00Z");
    const result = await createIncentiveRateAction({
      relationshipId: "rel_a",
      targetType: "WHOLESALE_PROFIT",
      rate: "12.5",
      effectiveFrom: newFrom,
    });

    expect(result).toEqual({ id: "ir_new" });
    const updateArgs = incentiveRateUpdateManyMock.mock.calls[0]![0] as {
      where: { relationshipId: string; effectiveTo: null };
      data: { effectiveTo: Date };
    };
    expect(updateArgs.where.relationshipId).toBe("rel_a");
    expect(updateArgs.where.effectiveTo).toBeNull();
    expect(updateArgs.data.effectiveTo.toISOString()).toBe(newFrom.toISOString());
    // create must have happened AFTER updateMany
    expect(
      incentiveRateUpdateManyMock.mock.invocationCallOrder[0]! <
        incentiveRateCreateMock.mock.invocationCallOrder[0]!,
    ).toBe(true);
  });

  it("rejects creation from dealer_admin (ForbiddenError, no DB write)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      createIncentiveRateAction({
        relationshipId: "rel_a",
        targetType: "PROJECT_PROFIT",
        rate: "15",
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(relationshipFindUniqueMock).not.toHaveBeenCalled();
    expect(incentiveRateCreateMock).not.toHaveBeenCalled();
  });

  it("rejects creation from wholesaler_event_team (incentive_rate.create wholesaler_admin only)", async () => {
    authMock.mockResolvedValue(WS_EVENT_TEAM_SESSION);

    await expect(
      createIncentiveRateAction({
        relationshipId: "rel_a",
        targetType: "PROJECT_PROFIT",
        rate: "15",
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(incentiveRateCreateMock).not.toHaveBeenCalled();
  });

  it("raises NotFound when relationshipId is invisible (cross-tenant via RLS)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    relationshipFindUniqueMock.mockResolvedValue(null);

    await expect(
      createIncentiveRateAction({
        relationshipId: "rel_other_tenant",
        targetType: "PROJECT_PROFIT",
        rate: "15",
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(incentiveRateUpdateManyMock).not.toHaveBeenCalled();
    expect(incentiveRateCreateMock).not.toHaveBeenCalled();
  });
});

describe("updateIncentiveRateAction", () => {
  it("patches only the supplied editable fields (rate / effectiveTo / note)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    incentiveRateFindUniqueMock.mockResolvedValue({
      id: "ir_1",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    incentiveRateUpdateMock.mockResolvedValue({ id: "ir_1" });

    await updateIncentiveRateAction({
      id: "ir_1",
      patch: { rate: "10.0", effectiveTo: new Date("2026-12-31T00:00:00Z") },
    });

    const args = incentiveRateUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where.id).toBe("ir_1");
    expect(args.data.rate).toBe("10.0");
    expect((args.data.effectiveTo as Date).toISOString()).toBe("2026-12-31T00:00:00.000Z");
    // targetType / effectiveFrom MUST NOT be in the update payload (immutable).
    expect("targetType" in args.data).toBe(false);
    expect("effectiveFrom" in args.data).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/incentive-rates");
    expect(revalidatePathMock).toHaveBeenCalledWith("/masters/incentive-rates/ir_1");
  });

  it("rejects effectiveTo <= existing.effectiveFrom (ValidationError)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    incentiveRateFindUniqueMock.mockResolvedValue({
      id: "ir_1",
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    });

    await expect(
      updateIncentiveRateAction({
        id: "ir_1",
        patch: { effectiveTo: new Date("2026-06-01T00:00:00Z") },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(incentiveRateUpdateMock).not.toHaveBeenCalled();
  });

  it("raises NotFound when the row is invisible (cross-tenant via RLS)", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    incentiveRateFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateIncentiveRateAction({ id: "ir_other_tenant", patch: { rate: "5" } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(incentiveRateUpdateMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin (incentive_rate.update wholesaler_admin only)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);

    await expect(
      updateIncentiveRateAction({ id: "ir_1", patch: { rate: "5" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(incentiveRateUpdateMock).not.toHaveBeenCalled();
  });
});

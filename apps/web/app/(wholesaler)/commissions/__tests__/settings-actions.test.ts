// Unit tests for the 手数料設定 Server Action (F-049 / S-049).
//
// Covers:
//   1. Happy path — upsert + 履歴 row が non-empty summary で作られる.
//   2. relationship が見えない → NotFoundError.
//   3. 値の変更なし (current と new が同値) → summary="値の変更なし" で履歴 1 行記録.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindUniqueMock = vi.fn();
const rateFindUniqueMock = vi.fn();
const rateUpsertMock = vi.fn();
const rateChangeCreateMock = vi.fn();
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
    dealerCommissionRate: {
      findUnique: (...args: unknown[]) => rateFindUniqueMock(...args),
      upsert: (...args: unknown[]) => rateUpsertMock(...args),
    },
    dealerCommissionRateChange: {
      create: (...args: unknown[]) => rateChangeCreateMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: { findMany: vi.fn() },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { saveDealerCommissionRate } = await import("../settings/actions.js");

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

beforeEach(() => {
  authMock.mockReset();
  relationshipFindUniqueMock.mockReset();
  rateFindUniqueMock.mockReset();
  rateUpsertMock.mockReset();
  rateChangeCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("saveDealerCommissionRate", () => {
  it("upserts the rate and appends a non-empty history row on first save", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    relationshipFindUniqueMock.mockResolvedValue({ id: "rel_a", wholesalerId: "tenant_ws_a" });
    rateFindUniqueMock.mockResolvedValue(null); // no existing row
    rateUpsertMock.mockResolvedValue({ id: "dcr_1" });

    const result = await saveDealerCommissionRate({
      relationshipId: "rel_a",
      tossUpRate: 1.5,
      closingRate: 3.0,
      applyFrom: "2026-04-01",
      applyTo: null,
    });

    expect(result).toEqual({ id: "dcr_1" });
    expect(rateUpsertMock).toHaveBeenCalledTimes(1);
    const upsertArgs = rateUpsertMock.mock.calls[0]![0] as {
      where: { relationshipId: string };
      create: { wholesalerId: string; updatedByUserId: string };
    };
    expect(upsertArgs.where.relationshipId).toBe("rel_a");
    // wholesalerId は relationship から導出（ctx ではなく rel.wholesalerId）。
    expect(upsertArgs.create.wholesalerId).toBe("tenant_ws_a");
    expect(upsertArgs.create.updatedByUserId).toBe("u_ws_admin");

    expect(rateChangeCreateMock).toHaveBeenCalledTimes(1);
    const changeArgs = rateChangeCreateMock.mock.calls[0]![0] as {
      data: { rateId: string; summary: string; changedByUserId: string };
    };
    expect(changeArgs.data.rateId).toBe("dcr_1");
    expect(changeArgs.data.changedByUserId).toBe("u_ws_admin");
    expect(changeArgs.data.summary.length).toBeGreaterThan(0);
    expect(changeArgs.data.summary).not.toBe("値の変更なし"); // 新規作成

    expect(revalidatePathMock).toHaveBeenCalledWith("/commissions/settings");
  });

  it("throws NotFoundError when the relationship is invisible (cross-tenant or missing)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    relationshipFindUniqueMock.mockResolvedValue(null);

    await expect(
      saveDealerCommissionRate({
        relationshipId: "rel_missing",
        tossUpRate: 2.0,
        closingRate: 4.0,
        applyFrom: "2026-05-01",
        applyTo: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(rateUpsertMock).not.toHaveBeenCalled();
    expect(rateChangeCreateMock).not.toHaveBeenCalled();
  });

  it("records a history row with summary='値の変更なし' when nothing changed", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    relationshipFindUniqueMock.mockResolvedValue({ id: "rel_a", wholesalerId: "tenant_ws_a" });
    // Current row holds the exact same values as the incoming save.
    // Use a *local* Date (year/month/day constructor) to ensure
    // toLocalDateString round-trips to "2026-04-01" regardless of CI timezone.
    rateFindUniqueMock.mockResolvedValue({
      tossUpRate: "1.50",
      closingRate: "3.00",
      applyFrom: new Date(2026, 3, 1, 0, 0, 0),
      applyTo: null,
    });
    rateUpsertMock.mockResolvedValue({ id: "dcr_1" });

    await saveDealerCommissionRate({
      relationshipId: "rel_a",
      tossUpRate: 1.5,
      closingRate: 3.0,
      applyFrom: "2026-04-01",
      applyTo: null,
    });

    expect(rateChangeCreateMock).toHaveBeenCalledTimes(1);
    const changeArgs = rateChangeCreateMock.mock.calls[0]![0] as {
      data: { summary: string };
    };
    expect(changeArgs.data.summary).toBe("値の変更なし");
  });
});

// Unit tests for the masters hub data loader (T-02-10 / S-052).
//
// 5-tab 構成 (二次店関係 / 施工業者 / インセンティブ率 / キャンセル期限 /
// 年度開始月) で `getMastersHubSummary` を呼んだときに、各タブの軽量
// サマリが期待通り組み立たることを確認する。
//
// 検証する観点:
//   1. wholesaler_admin: 全タブのサマリが取れる + 各 master の where 句が
//      isActive / status:ACTIVE を絞り込んでいる
//   2. dealer_admin: assertCan で ForbiddenError 落ち（findMany 呼ばれない）
//   3. wholesaler_event_team: 同じく ForbiddenError（S-052 は admin 専用）
//   4. SaaS-admin で wholesalerId 未割当: assertCan は素通すが、ハブ側で
//      明示的に ForbiddenError を投げる（クロステナント読みを発生させない）
//   5. インセンティブ率の現在有効率判定: effectiveFrom <= now < effectiveTo

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const rawRelationshipFindManyMock = vi.fn();
const relationshipCountMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const installerCountMock = vi.fn();
const installerFindManyMock = vi.fn();
const incentiveRateFindManyMock = vi.fn();
const wholesalerSettingsFindUniqueMock = vi.fn();
const areaCountMock = vi.fn();
const areaFindManyMock = vi.fn();
const storeCountMock = vi.fn();
const storeFindManyMock = vi.fn();
const venueProviderCountMock = vi.fn();
const venueProviderFindManyMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    relationship: {
      count: (...args: unknown[]) => relationshipCountMock(...args),
      findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
    },
    installer: {
      count: (...args: unknown[]) => installerCountMock(...args),
      findMany: (...args: unknown[]) => installerFindManyMock(...args),
    },
    incentiveRate: {
      findMany: (...args: unknown[]) => incentiveRateFindManyMock(...args),
    },
    wholesalerSettings: {
      findUnique: (...args: unknown[]) => wholesalerSettingsFindUniqueMock(...args),
    },
    area: {
      count: (...args: unknown[]) => areaCountMock(...args),
      findMany: (...args: unknown[]) => areaFindManyMock(...args),
    },
    store: {
      count: (...args: unknown[]) => storeCountMock(...args),
      findMany: (...args: unknown[]) => storeFindManyMock(...args),
    },
    venueProvider: {
      count: (...args: unknown[]) => venueProviderCountMock(...args),
      findMany: (...args: unknown[]) => venueProviderFindManyMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => rawRelationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { getMastersHubSummary } = await import("../data.js");

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

const SAAS_ADMIN_NO_WS_SESSION = {
  user: {
    id: "u_saas_admin",
    tenantId: null,
    tenantType: null,
    wholesalerId: null,
    dealerId: null,
    roles: ["SAAS_ADMIN"],
    isSaasAdmin: true,
  },
};

beforeEach(() => {
  authMock.mockReset();
  rawRelationshipFindManyMock.mockReset();
  rawRelationshipFindManyMock.mockResolvedValue([]);
  relationshipCountMock.mockReset();
  installerCountMock.mockReset();
  installerFindManyMock.mockReset();
  incentiveRateFindManyMock.mockReset();
  wholesalerSettingsFindUniqueMock.mockReset();
  areaCountMock.mockReset();
  areaCountMock.mockResolvedValue(0);
  areaFindManyMock.mockReset();
  areaFindManyMock.mockResolvedValue([]);
  storeCountMock.mockReset();
  storeCountMock.mockResolvedValue(0);
  storeFindManyMock.mockReset();
  storeFindManyMock.mockResolvedValue([]);
  relationshipFindManyMock.mockReset();
  relationshipFindManyMock.mockResolvedValue([]);
  venueProviderCountMock.mockReset();
  venueProviderCountMock.mockResolvedValue(0);
  venueProviderFindManyMock.mockReset();
  venueProviderFindManyMock.mockResolvedValue([]);
});

describe("getMastersHubSummary — 5-tab summary", () => {
  it("aggregates all 5 tabs for wholesaler_admin and gates active rows only", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    relationshipCountMock.mockResolvedValue(3);
    installerCountMock.mockResolvedValue(2);
    installerFindManyMock.mockResolvedValue([
      {
        id: "inst_1",
        name: "施工業者 A",
        area: "東京",
        updatedAt: new Date("2026-05-20T00:00:00Z"),
      },
      {
        id: "inst_2",
        name: "施工業者 B",
        area: null,
        updatedAt: new Date("2026-05-10T00:00:00Z"),
      },
    ]);
    // Two relationships; rel_a has a row currently in effect, rel_b's row is
    // already past its effectiveTo so currentRate is null.
    incentiveRateFindManyMock.mockResolvedValue([
      {
        id: "rate_a",
        relationshipId: "rel_a",
        targetType: "PROJECT_PROFIT",
        rate: { toString: () => "12.5" },
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: null,
        relationship: { dealer: { name: "二次店 A" } },
      },
      {
        id: "rate_b",
        relationshipId: "rel_b",
        targetType: "WHOLESALE_PROFIT",
        rate: { toString: () => "8" },
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
        effectiveTo: new Date("2025-12-31T00:00:00Z"),
        relationship: { dealer: { name: "二次店 B" } },
      },
    ]);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 4,
      updatedAt: new Date("2026-03-15T00:00:00Z"),
    });
    areaCountMock.mockResolvedValue(2);
    areaFindManyMock.mockResolvedValue([
      {
        id: "area_1",
        name: "東京都",
        type: "EVENT",
        isActive: true,
        updatedAt: new Date("2026-05-22T00:00:00Z"),
      },
      {
        id: "area_2",
        name: "神奈川県",
        type: "EVENT",
        isActive: true,
        updatedAt: new Date("2026-05-21T00:00:00Z"),
      },
    ]);
    storeCountMock.mockResolvedValue(2);
    storeFindManyMock.mockResolvedValue([
      { id: "store_1", name: "テスト店舗A", updatedAt: new Date("2026-05-22T00:00:00Z") },
      { id: "store_2", name: "テスト店舗B", updatedAt: new Date("2026-05-21T00:00:00Z") },
    ]);

    const summary = await getMastersHubSummary();

    expect(summary.dealerRelationships).toEqual({ activeCount: 3, preview: [] });
    expect(summary.installers.totalActiveCount).toBe(2);
    expect(summary.installers.preview).toHaveLength(2);
    expect(summary.installers.preview[0]).toMatchObject({ id: "inst_1", name: "施工業者 A" });
    expect(summary.incentiveRates.totalRelationships).toBe(2);
    expect(summary.incentiveRates.preview).toHaveLength(2);
    const relA = summary.incentiveRates.preview.find((r) => r.relationshipId === "rel_a");
    expect(relA).toMatchObject({
      dealerName: "二次店 A",
      currentRate: "12.5",
      currentTargetType: "PROJECT_PROFIT",
    });
    const relB = summary.incentiveRates.preview.find((r) => r.relationshipId === "rel_b");
    expect(relB).toMatchObject({
      dealerName: "二次店 B",
      currentRate: null,
      currentTargetType: null,
    });
    expect(summary.wholesalerSettings).toEqual({
      cancelDeadlineDays: 14,
      fiscalYearStartMonth: 4,
      lastUpdatedAt: "2026-03-15T00:00:00.000Z",
    });

    // Active-only filtering at the query layer.
    const relCall = relationshipCountMock.mock.calls[0]![0] as {
      where: { status: string };
    };
    expect(relCall.where.status).toBe("ACTIVE");
    const instCountCall = installerCountMock.mock.calls[0]![0] as {
      where: { isActive: boolean };
    };
    expect(instCountCall.where.isActive).toBe(true);
    const instCall = installerFindManyMock.mock.calls[0]![0] as {
      where: { isActive: boolean };
    };
    expect(instCall.where.isActive).toBe(true);

    // Area tab summary + active-only filtering.
    expect(summary.areas.totalActiveCount).toBe(2);
    expect(summary.areas.preview).toHaveLength(2);
    expect(summary.areas.preview[0]).toMatchObject({ id: "area_1", name: "東京都" });
    const areaCountCall = areaCountMock.mock.calls[0]![0] as {
      where: { isActive: boolean };
    };
    expect(areaCountCall.where.isActive).toBe(true);

    // Store tab summary + active-only filtering.
    expect(summary.stores.totalActiveCount).toBe(2);
    expect(summary.stores.preview).toHaveLength(2);
    expect(summary.stores.preview[0]).toMatchObject({ id: "store_1", name: "テスト店舗A" });
    const storeCountCall = storeCountMock.mock.calls[0]![0] as {
      where: { isActive: boolean };
    };
    expect(storeCountCall.where.isActive).toBe(true);
  });

  it("falls back to WHOLESALER_SETTINGS_DEFAULTS when no row exists", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    relationshipCountMock.mockResolvedValue(0);
    installerCountMock.mockResolvedValue(0);
    installerFindManyMock.mockResolvedValue([]);
    incentiveRateFindManyMock.mockResolvedValue([]);
    wholesalerSettingsFindUniqueMock.mockResolvedValue(null);

    const summary = await getMastersHubSummary();

    expect(summary.wholesalerSettings).toEqual({
      cancelDeadlineDays: 8,
      fiscalYearStartMonth: 4,
      lastUpdatedAt: null,
    });
    expect(summary.installers.preview).toEqual([]);
    expect(summary.incentiveRates.preview).toEqual([]);
    expect(summary.dealerRelationships).toEqual({ activeCount: 0, preview: [] });
    expect(summary.areas).toEqual({
      totalActiveCount: 0,
      eventAreas: [],
      customerAreas: [],
      preview: [],
    });
    expect(summary.stores).toEqual({ totalActiveCount: 0, preview: [] });
    expect(summary.venueProviders).toEqual({
      totalActiveCount: 0,
      totalStoreCount: 0,
      preview: [],
    });
  });

  it("forbids wholesaler_event_team (S-052 ハブは admin 専用 / docs/04 §1.3)", async () => {
    authMock.mockResolvedValue(WS_EVENT_TEAM_SESSION);

    await expect(getMastersHubSummary()).rejects.toBeInstanceOf(ForbiddenError);
    expect(relationshipCountMock).not.toHaveBeenCalled();
    expect(installerCountMock).not.toHaveBeenCalled();
    expect(incentiveRateFindManyMock).not.toHaveBeenCalled();
    expect(areaCountMock).not.toHaveBeenCalled();
    expect(storeCountMock).not.toHaveBeenCalled();
  });

  it("forbids dealer_admin", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    await expect(getMastersHubSummary()).rejects.toBeInstanceOf(ForbiddenError);
    expect(relationshipCountMock).not.toHaveBeenCalled();
    expect(installerCountMock).not.toHaveBeenCalled();
  });

  it("forbids SaaS-admin without a bound wholesalerId (avoids cross-tenant read)", async () => {
    authMock.mockResolvedValue(SAAS_ADMIN_NO_WS_SESSION);

    await expect(getMastersHubSummary()).rejects.toBeInstanceOf(ForbiddenError);
    // assertCan は SaaS-admin を素通すが、ハブ側の明示 throw により以下は呼ばれない
    expect(relationshipCountMock).not.toHaveBeenCalled();
    expect(installerCountMock).not.toHaveBeenCalled();
    expect(installerFindManyMock).not.toHaveBeenCalled();
    expect(incentiveRateFindManyMock).not.toHaveBeenCalled();
    expect(wholesalerSettingsFindUniqueMock).not.toHaveBeenCalled();
    expect(areaCountMock).not.toHaveBeenCalled();
    expect(areaFindManyMock).not.toHaveBeenCalled();
    expect(storeCountMock).not.toHaveBeenCalled();
    expect(storeFindManyMock).not.toHaveBeenCalled();
  });
});

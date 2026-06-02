// Server-side data loader for the masters hub page (S-052 / T-02-10).
//
// S-052 is a 5-tab integrated screen: 二次店関係 / 施工業者 / インセンティブ率 /
// キャンセル期限 / 年度開始月 (docs/04 §1.3 S-052). 各タブは個別 master の
// 軽量サマリ（件数 + 最終更新）と先頭数件を表示する。詳細編集は既存の独立
// 画面 (`/masters/installers`, `/masters/incentive-rates`,
// `/masters/wholesaler-settings`) へ遷移する設計。
//
// 場所提供元 (S-019/S-020 / F-011) と 商品・価格 (S-042/S-043 / F-012) は
// S-052 のスコープ外なのでここでは集計しない。
//
// SaaS-admin 経由で `wholesalerId` 未割当のセッションが届いた場合は明示的に
// ForbiddenError を投げる（assertCan は SaaS-admin を素通しするため、
// withTenant 内でのクロステナント読み出しが発生しないようハブ自体で弾く）。

import "server-only";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface MasterCardSummary {
  count: number;
  lastUpdatedAt: string | null;
}

export interface DealerRelationshipsTabSummary {
  activeCount: number;
  preview: DealerRelationshipPreviewRow[];
}

export interface DealerRelationshipPreviewRow {
  id: string;
  dealerName: string;
  status: "ACTIVE" | "SUSPENDED";
  defaultScope: "APPOINTMENT_ONLY" | "FIRST_VISIT" | "FULL_CLOSING";
  updatedAt: string;
}

export interface VenueProviderTabRow {
  id: string;
  name: string;
  area: string | null;
  storeCount: number;
  stores: { id: string; name: string }[]; // 先頭 3 件
  updatedAt: string;
}

export interface VenueProviderTabSummary {
  totalActiveCount: number;
  totalStoreCount: number;
  preview: VenueProviderTabRow[];
}

export interface InstallerTabRow {
  id: string;
  name: string;
  area: string | null;
  updatedAt: string;
}

export interface InstallerTabSummary {
  totalActiveCount: number;
  preview: InstallerTabRow[];
}

export interface IncentiveRateTabRow {
  relationshipId: string;
  dealerName: string;
  currentRate: string | null;
  currentTargetType: "PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL" | null;
}

export interface IncentiveRateTabSummary {
  totalRelationships: number;
  preview: IncentiveRateTabRow[];
}

export interface WholesalerSettingsTabSummary {
  cancelDeadlineDays: number;
  fiscalYearStartMonth: number;
  // 設定レコードが既に upsert 済みなら lastUpdatedAt を持つ。デフォルト値で
  // 運用中（レコード未生成）の場合は null。
  lastUpdatedAt: string | null;
}

export interface AreaTabRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface AreaTabSummary {
  totalActiveCount: number;
  eventAreas: AreaTabRow[];
  customerAreas: AreaTabRow[];
  /** 後方互換: 先頭 5 件のみのプレビュー（旧コードが参照する）。 */
  preview: AreaTabRow[];
}

export interface StoreTabRow {
  id: string;
  name: string;
  updatedAt: string;
}

export interface StoreTabSummary {
  totalActiveCount: number;
  preview: StoreTabRow[];
}

export interface MastersHubSummary {
  dealerRelationships: DealerRelationshipsTabSummary;
  installers: InstallerTabSummary;
  incentiveRates: IncentiveRateTabSummary;
  wholesalerSettings: WholesalerSettingsTabSummary;
  areas: AreaTabSummary;
  stores: StoreTabSummary;
  venueProviders: VenueProviderTabSummary;
}

const INSTALLER_PREVIEW_LIMIT = 5;
const INCENTIVE_RATE_PREVIEW_LIMIT = 5;
const AREA_PREVIEW_LIMIT = 5;
const STORE_PREVIEW_LIMIT = 5;
const VENUE_PROVIDER_PREVIEW_LIMIT = 5;
const RELATIONSHIP_PREVIEW_LIMIT = 5;

async function requireHubCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  // S-052 ハブは `wholesaler_admin` 専用 (docs/04 §1.3)。
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action: "masters.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  // assertCan は SaaS-admin を素通しする。ハブは「特定の wholesaler の運用
  // 設定を編集する画面」なので、wholesalerId が無いセッション（SaaS-admin が
  // /masters に直接到達した等）はここで明示的に弾く。
  if (!ctx.wholesalerId) {
    throw new ForbiddenError("wholesalerId 未割当のユーザーはマスタハブを参照できません");
  }
  return ctx;
}

export async function getMastersHubSummary(): Promise<MastersHubSummary> {
  const ctx = await requireHubCtx();
  const wholesalerId = ctx.wholesalerId!;
  const now = new Date();

  return withTenant(ctx, async (tx) => {
    const [
      activeRelationshipCount,
      relationshipPreview,
      installerActiveCount,
      installerPreview,
      rateRows,
      settings,
      areaActiveCount,
      areaPreview,
      storeActiveCount,
      storePreview,
      venueProviderActiveCount,
      venueProviderPreview,
      storesTotalActiveCount,
    ] = await Promise.all([
        tx.relationship.count({ where: { status: "ACTIVE" } }),
        tx.relationship.findMany({
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
          take: RELATIONSHIP_PREVIEW_LIMIT,
          select: {
            id: true,
            status: true,
            defaultScope: true,
            updatedAt: true,
            dealer: { select: { name: true } },
          },
        }),
        tx.installer.count({ where: { isActive: true } }),
        tx.installer.findMany({
          where: { isActive: true },
          orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
          take: INSTALLER_PREVIEW_LIMIT,
          select: {
            id: true,
            name: true,
            area: true,
            updatedAt: true,
          },
        }),
        tx.incentiveRate.findMany({
          orderBy: [{ relationshipId: "asc" }, { effectiveFrom: "desc" }],
          select: {
            id: true,
            relationshipId: true,
            targetType: true,
            rate: true,
            effectiveFrom: true,
            effectiveTo: true,
            relationship: {
              select: {
                dealer: { select: { name: true } },
              },
            },
          },
        }),
        tx.wholesalerSettings.findUnique({
          where: { wholesalerId },
          select: {
            cancelDeadlineDays: true,
            fiscalYearStartMonth: true,
            updatedAt: true,
          },
        }),
        tx.area.count({ where: { isActive: true } }),
        // ハブのエリア設定タブはイベント・顧客の両一覧をその場で表示する
        // ため、prefix=AREA_PREVIEW_LIMIT には縛られず両 type を全件取る。
        tx.area.findMany({
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            isActive: true,
            updatedAt: true,
          },
        }),
        tx.store.count({ where: { isActive: true } }),
        tx.store.findMany({
          where: { isActive: true },
          orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
          take: STORE_PREVIEW_LIMIT,
          select: {
            id: true,
            name: true,
            updatedAt: true,
          },
        }),
        tx.venueProvider.count({ where: { isActive: true } }),
        tx.venueProvider.findMany({
          where: { isActive: true },
          orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
          take: VENUE_PROVIDER_PREVIEW_LIMIT,
          select: {
            id: true,
            name: true,
            area: true,
            updatedAt: true,
            stores: {
              where: { isActive: true },
              orderBy: { name: "asc" },
              select: { id: true, name: true },
            },
          },
        }),
        tx.store.count({ where: { isActive: true } }),
      ]);

    // Group incentive rates by relationship and pick the row currently in
    // effect (effectiveFrom <= now < effectiveTo? null).
    const groups = new Map<
      string,
      {
        relationshipId: string;
        dealerName: string;
        current: IncentiveRateTabRow["currentRate"];
        currentTargetType: IncentiveRateTabRow["currentTargetType"];
      }
    >();
    for (const r of rateRows) {
      const isCurrent = r.effectiveFrom <= now && (r.effectiveTo === null || r.effectiveTo > now);
      const existing = groups.get(r.relationshipId);
      if (!existing) {
        groups.set(r.relationshipId, {
          relationshipId: r.relationshipId,
          dealerName: r.relationship.dealer.name,
          current: isCurrent ? r.rate.toString() : null,
          currentTargetType: isCurrent
            ? (r.targetType as IncentiveRateTabRow["currentTargetType"])
            : null,
        });
      } else if (isCurrent && existing.current === null) {
        existing.current = r.rate.toString();
        existing.currentTargetType = r.targetType as IncentiveRateTabRow["currentTargetType"];
      }
    }
    const allGroups = Array.from(groups.values()).sort((a, b) =>
      a.dealerName.localeCompare(b.dealerName, "ja"),
    );

    return {
      dealerRelationships: {
        activeCount: activeRelationshipCount,
        preview: relationshipPreview.map((r) => ({
          id: r.id,
          dealerName: r.dealer.name,
          status: r.status,
          defaultScope: r.defaultScope,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
      installers: {
        totalActiveCount: installerActiveCount,
        preview: installerPreview.map((r) => ({
          id: r.id,
          name: r.name,
          area: r.area,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
      incentiveRates: {
        totalRelationships: allGroups.length,
        preview: allGroups.slice(0, INCENTIVE_RATE_PREVIEW_LIMIT).map((g) => ({
          relationshipId: g.relationshipId,
          dealerName: g.dealerName,
          currentRate: g.current,
          currentTargetType: g.currentTargetType,
        })),
      },
      wholesalerSettings: {
        cancelDeadlineDays: settings?.cancelDeadlineDays ?? 8,
        fiscalYearStartMonth: settings?.fiscalYearStartMonth ?? 4,
        lastUpdatedAt: settings ? settings.updatedAt.toISOString() : null,
      },
      areas: (() => {
        const rows = areaPreview.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          description: r.description,
          isActive: r.isActive,
          updatedAt: r.updatedAt.toISOString(),
        }));
        const eventAreas = rows
          .filter((r) => r.type === "EVENT")
          .map(({ type: _t, ...rest }) => rest);
        const customerAreas = rows
          .filter((r) => r.type === "CUSTOMER")
          .map(({ type: _t, ...rest }) => rest);
        return {
          totalActiveCount: areaActiveCount,
          eventAreas,
          customerAreas,
          preview: eventAreas.slice(0, AREA_PREVIEW_LIMIT),
        };
      })(),
      stores: {
        totalActiveCount: storeActiveCount,
        preview: storePreview.map((r) => ({
          id: r.id,
          name: r.name,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
      venueProviders: {
        totalActiveCount: venueProviderActiveCount,
        totalStoreCount: storesTotalActiveCount,
        preview: venueProviderPreview.map((r) => ({
          id: r.id,
          name: r.name,
          area: r.area,
          storeCount: r.stores.length,
          stores: r.stores.slice(0, 3),
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
    };
  });
}

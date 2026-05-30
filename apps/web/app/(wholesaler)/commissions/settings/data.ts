// 手数料設定 — 二次店ごとの手数料率設定 (F-049 / S-049).
//
// 三段イディオム: auth → assertCan('commission_setting.read') → withTenant。
// RLS は DealerCommissionRate.wholesalerId と Relationship 双方に直接適用される。
// 未設定の relationship（commissionRate=null）はデフォルト値（トスアップ 1.5%,
// クロージング 3.0%, 適用開始 = 当日, 適用終了 = null）で行を返す — 画面側で
// そのまま編集 → 初回保存で row を作成する。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

// 過去の率変更 1 行（日付 / 変更者 / 内容サマリ）。
export interface RateChange {
  id: string;
  date: string; // ISO timestamp (createdAt)
  changedBy: string;
  summary: string;
}

export interface DealerRateSetting {
  // 行の安定キーとして relationshipId を使う（設定が未保存の場合 commissionRate
  // 自体が存在しないため）。settings-panel はこの id を保存リクエストの
  // relationshipId としてそのまま使う。
  id: string;
  dealerName: string;
  tossUpRate: number; // percent, e.g. 1.5
  closingRate: number; // percent, e.g. 3.0
  applyFrom: string; // YYYY-MM-DD
  applyTo: string | null; // YYYY-MM-DD or null = 現在適用中
  history: RateChange[];
}

// 既定値（commissionRate が未設定の relationship 向け）。
const DEFAULT_TOSS_UP = 1.5;
const DEFAULT_CLOSING = 3.0;

// Local-TZ-safe YYYY-MM-DD 変換（toISOString は UTC 変換で JST 越境すると日付が
// ずれるため、明示的に getFullYear/Month/Date を使う）。
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function requireWholesalerCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
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
    action: "commission_setting.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function listDealerRateSettings(): Promise<DealerRateSetting[]> {
  const ctx = await requireWholesalerCtx();
  const today = toLocalDateString(new Date());

  return withTenant(ctx, async (tx) => {
    const rels = await tx.relationship.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        dealer: { select: { name: true } },
        commissionRate: {
          select: {
            id: true,
            tossUpRate: true,
            closingRate: true,
            applyFrom: true,
            applyTo: true,
            changes: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                createdAt: true,
                changedByUserId: true,
                summary: true,
              },
            },
          },
        },
      },
    });

    if (rels.length === 0) return [];

    // 変更者名は一括解決（cross-tenant は RLS で見えないため "—" にフォールバック）。
    const userIds = Array.from(
      new Set(
        rels.flatMap((r) => r.commissionRate?.changes.map((c) => c.changedByUserId) ?? []),
      ),
    );
    const users =
      userIds.length > 0
        ? await tx.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

    return rels.map<DealerRateSetting>((r) => {
      const rate = r.commissionRate;
      if (!rate) {
        return {
          id: r.id,
          dealerName: r.dealer.name,
          tossUpRate: DEFAULT_TOSS_UP,
          closingRate: DEFAULT_CLOSING,
          applyFrom: today,
          applyTo: null,
          history: [],
        };
      }
      return {
        id: r.id,
        dealerName: r.dealer.name,
        tossUpRate: Number(rate.tossUpRate),
        closingRate: Number(rate.closingRate),
        applyFrom: toLocalDateString(rate.applyFrom),
        applyTo: rate.applyTo ? toLocalDateString(rate.applyTo) : null,
        history: rate.changes.map((c) => ({
          id: c.id,
          date: c.createdAt.toISOString(),
          changedBy: nameByUserId.get(c.changedByUserId) ?? "—",
          summary: c.summary,
        })),
      };
    });
  });
}

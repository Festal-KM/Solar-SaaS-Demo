// Server-side loader + action for 二次店レーン希望 (F-060 / ボトムアップ構造 / docs/05 §3.4.5).
//
// listLanePreferences: 卸業者の一覧確認 (S-089)。三段イディオム auth →
// assertCan('lane_preference.read') → withTenant。RLS (SET LOCAL) が cross-tenant 行を
// 不可視化し、assertCan が dealer ロールを ForbiddenError で弾く。
// 任意リンク (venueProviderId / storeId / lineEventId) の name は同一 withTenant tx 内の
// bulk findMany → Map で解決（別テナント id をリンクしても name は null＝漏えいなし）。
// LineEvent は name のみ select し fixedFee / performanceRate / scheduledDates は select しない
// （卸非公開・不要 / CLAUDE.md #5）。
//
// saveLanePreference: 二次店提出 (F-021 連動)。assertCan('lane_preference.write')。
// relationshipId は ctx 由来（送信値不信用）、対象月 × relationship 一意で upsert、
// priority はサーバ再採番。

import "server-only";

import {
  SaveLanePreferenceInputSchema,
  type LanePreferenceDto,
  type LanePreferenceItemDto,
  type SaveLanePreferenceInput,
} from "@solar/contracts";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

// 二次店プルダウンは line-events と同じ ACTIVE relationship 一覧を再利用する。
export { listActiveDealers as listActiveRelationships } from "../event-detail/data";
export type { DealerOption } from "../event-detail/data";

// data.ts では DTO の重複定義をやめ contracts の型を re-export する（§3.4.4）。
export type {
  LanePreferenceDto,
  LanePreferenceItemDto,
  DesiredDates,
  SaveLanePreferenceInput,
} from "@solar/contracts";

async function buildActor() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  return {
    ctx,
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
  };
}

async function requireWholesalerCtx() {
  const { ctx, user } = await buildActor();
  assertCan({
    user,
    action: "lane_preference.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface LanePreferenceFilter {
  targetMonth?: string;
  relationshipId?: string;
}

export async function listLanePreferences(
  filter: LanePreferenceFilter = {},
): Promise<LanePreferenceDto[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const prefs = await tx.lanePreference.findMany({
      where: {
        ...(filter.targetMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(filter.targetMonth)
          ? { targetMonth: filter.targetMonth }
          : {}),
        ...(filter.relationshipId ? { relationshipId: filter.relationshipId } : {}),
      },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        relationshipId: true,
        targetMonth: true,
        note: true,
        submittedAt: true,
        items: {
          select: {
            priority: true,
            venueLabel: true,
            venueProviderId: true,
            storeId: true,
            lineEventId: true,
            desiredDates: true,
            memo: true,
          },
        },
      },
    });

    if (prefs.length === 0) return [];

    // 任意リンクの name 解決（同一 withTenant tx 内 bulk findMany → Map。各マスタの
    // 自テナント RLS が二重に効くため、別テナント id をリンクしても name は null）。
    const relationshipIds = Array.from(new Set(prefs.map((p) => p.relationshipId)));
    const venueProviderIds = Array.from(
      new Set(
        prefs.flatMap((p) =>
          p.items
            .map((i) => i.venueProviderId)
            .filter((v): v is string => v !== null && v !== undefined),
        ),
      ),
    );
    const storeIds = Array.from(
      new Set(
        prefs.flatMap((p) =>
          p.items.map((i) => i.storeId).filter((v): v is string => v !== null && v !== undefined),
        ),
      ),
    );
    const lineEventIds = Array.from(
      new Set(
        prefs.flatMap((p) =>
          p.items
            .map((i) => i.lineEventId)
            .filter((v): v is string => v !== null && v !== undefined),
        ),
      ),
    );

    const [rels, venueProviders, stores, lineEvents] = await Promise.all([
      tx.relationship.findMany({
        where: { id: { in: relationshipIds } },
        select: { id: true, dealer: { select: { name: true } } },
      }),
      venueProviderIds.length > 0
        ? tx.venueProvider.findMany({
            where: { id: { in: venueProviderIds } },
            select: { id: true, name: true },
          })
        : [],
      storeIds.length > 0
        ? tx.store.findMany({
            where: { id: { in: storeIds } },
            select: { id: true, name: true },
          })
        : [],
      // LineEvent は name のみ — fixedFee / performanceRate / scheduledDates は select しない。
      lineEventIds.length > 0
        ? tx.lineEvent.findMany({
            where: { id: { in: lineEventIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const dealerNameByRel = new Map(rels.map((r) => [r.id, r.dealer.name]));
    const providerNameById = new Map(venueProviders.map((p) => [p.id, p.name]));
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
    const lineNameById = new Map(lineEvents.map((le) => [le.id, le.name]));

    return prefs.map((p) => {
      const items: LanePreferenceItemDto[] = p.items
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map((i) => ({
          priority: i.priority,
          venueLabel: i.venueLabel,
          venueProviderId: i.venueProviderId ?? null,
          venueProviderName: i.venueProviderId
            ? (providerNameById.get(i.venueProviderId) ?? null)
            : null,
          storeId: i.storeId ?? null,
          storeName: i.storeId ? (storeNameById.get(i.storeId) ?? null) : null,
          lineEventId: i.lineEventId ?? null,
          lineName: i.lineEventId ? (lineNameById.get(i.lineEventId) ?? null) : null,
          desiredDates: Array.isArray(i.desiredDates) ? (i.desiredDates as string[]) : [],
          memo: i.memo ?? null,
        }));
      return {
        id: p.id,
        relationshipId: p.relationshipId,
        dealerName: dealerNameByRel.get(p.relationshipId) ?? "—",
        targetMonth: p.targetMonth,
        note: p.note,
        laneCount: items.length, // 導出（§3.4.1-(5)）
        submittedAt: p.submittedAt.toISOString(),
        items,
      };
    });
  });
}

// 二次店提出 (F-021 連動 / §3.4.5)。upsert(対象月 × relationship 一意)・priority サーバ再採番。
export async function saveLanePreference(
  rawInput: SaveLanePreferenceInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { ctx, user } = await buildActor();
  assertCan({
    user,
    action: "lane_preference.write",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const parsed = SaveLanePreferenceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input" };
  }
  const input = parsed.data;

  // relationshipId は ctx 由来（送信値を信用しない）。二次店は当該卸業者との関係を
  // 1 つ持つ前提。複数解決される場合は曖昧として弾く（明示選択は Phase 2）。
  if (ctx.relationshipIds.length !== 1) {
    return { ok: false, error: "ambiguous_relationship" };
  }
  const relationshipId = ctx.relationshipIds[0]!;

  return withTenant(ctx, async (tx) => {
    const rel = await tx.relationship.findUnique({
      where: { id: relationshipId },
      select: { wholesalerId: true },
    });
    if (!rel) {
      throw new ForbiddenError("Relationship not visible in tenant context");
    }

    // priority はフォーム行順で 1..N にサーバ再採番（クライアント送信 priority は無視）。
    const itemCreate = input.items.map((it, idx) => ({
      priority: idx + 1,
      venueLabel: it.venueLabel,
      venueProviderId: it.venueProviderId ?? null,
      storeId: it.storeId ?? null,
      lineEventId: it.lineEventId ?? null,
      desiredDates: it.desiredDates,
      memo: it.memo ?? null,
    }));

    const pref = await tx.lanePreference.upsert({
      where: {
        relationshipId_targetMonth: {
          relationshipId,
          targetMonth: input.targetMonth,
        },
      },
      create: {
        wholesalerId: rel.wholesalerId,
        relationshipId,
        targetMonth: input.targetMonth,
        note: input.note ?? null,
        submittedBy: ctx.actorUserId,
        items: { create: itemCreate },
      },
      update: {
        note: input.note ?? null,
        submittedBy: ctx.actorUserId,
        submittedAt: new Date(),
        // 再提出は全件入れ替え（差分管理しない）。
        items: { deleteMany: {}, create: itemCreate },
      },
      select: { id: true },
    });

    return { ok: true as const, id: pref.id };
  });
}

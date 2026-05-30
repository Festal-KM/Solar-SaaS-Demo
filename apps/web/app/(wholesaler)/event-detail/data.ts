// Server-side data loaders for the event-candidate screens (S-023 / S-024).
//
// Same three-step idiom as the venue-negotiation loaders: auth →
// assertCan('event_candidate.read') → withTenant. RLS via SET LOCAL keeps
// cross-tenant rows invisible and `assertCan` raises ForbiddenError so dealer
// roles invoking these wholesaler-side loaders are blocked (the parallel
// dealer-view loader lands in T-03-05 with a separate DTO).

import "server-only";

import { toEventCandidateWholesalerDto } from "@solar/contracts";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { EventCandidateForWholesalerDto, EventCandidateStatus } from "@solar/contracts";

export interface EventCandidateListItem {
  id: string;
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  area: string | null;
  deadlineAt: string;
  status: EventCandidateStatus;
  publishedAt: string | null;
  updatedAt: string;
  venueProviderName: string | null;
}

export interface AssigneeRow {
  id: string;
  name: string;
  affiliation: string;
  assignStatus: "confirmed" | "adjusting";
}

export interface EventCandidateDetail extends EventCandidateForWholesalerDto {
  venueProviderName: string | null;
  venueProviderArea: string | null;
  venueProviderAddress: string | null;
  venueProviderNote: string | null;
  venueProviderContractType: string | null;
  venueProviderFixedFee: string | null;
  venueProviderPerformanceRate: string | null;
  eventId: string | null;
  eventMode: string | null;
  eventNote: string | null;
  assignees: AssigneeRow[];
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
    action: "event_candidate.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  status?: EventCandidateStatus;
  targetMonth?: string;
}

export async function listEventCandidates(
  filter: ListFilter = {},
): Promise<EventCandidateListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.eventCandidate.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.targetMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(filter.targetMonth)
          ? { targetMonth: filter.targetMonth }
          : {}),
      },
      orderBy: [{ scheduledDate: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        venueProviderId: true,
        targetMonth: true,
        scheduledDate: true,
        storeName: true,
        area: true,
        deadlineAt: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
    // VenueProvider はテーブル間に明示的な relation が無い (EventCandidate.venueProviderId
    // は string? の柔リンク) ため、必要分だけまとめて引いて map で結合する。
    const providerIds = Array.from(
      new Set(rows.map((r) => r.venueProviderId).filter((v): v is string => v !== null)),
    );
    const providers =
      providerIds.length > 0
        ? await tx.venueProvider.findMany({
            where: { id: { in: providerIds } },
            select: { id: true, name: true },
          })
        : [];
    const providerNameById = new Map(providers.map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      id: r.id,
      targetMonth: r.targetMonth,
      scheduledDate: r.scheduledDate.toISOString(),
      storeName: r.storeName,
      area: r.area,
      deadlineAt: r.deadlineAt.toISOString(),
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      venueProviderName: r.venueProviderId
        ? (providerNameById.get(r.venueProviderId) ?? null)
        : null,
    }));
  });
}

export async function getEventCandidate(id: string): Promise<EventCandidateDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.eventCandidate.findUnique({
      where: { id },
      select: {
        id: true,
        wholesalerId: true,
        venueProviderId: true,
        venueNegotiationId: true,
        targetMonth: true,
        scheduledDate: true,
        storeName: true,
        address: true,
        area: true,
        deadlineAt: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
        internalNote: true,
        contractNote: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        event: {
          select: {
            id: true,
            mode: true,
            shifts: {
              orderBy: { startPlanned: "asc" as const },
              select: { id: true, userId: true, role: true, status: true },
            },
            dealers: {
              orderBy: { assignedAt: "asc" as const },
              select: { relationshipId: true, scopeOverride: true },
            },
          },
        },
      },
    });
    if (!r) return null;
    // VenueProvider は relation を持たないので別クエリで読み込む。null 許容。
    const provider = r.venueProviderId
      ? await tx.venueProvider.findUnique({
          where: { id: r.venueProviderId },
          select: { name: true, area: true, address: true, note: true, contractType: true, fixedFee: true, performanceRate: true },
        })
      : null;
    // Build the canonical wholesaler DTO first so the wire format is identical
    // to what API routes return; then attach the joined venue-provider labels
    // for the detail header.
    const dto = toEventCandidateWholesalerDto({
      id: r.id,
      wholesalerId: r.wholesalerId,
      venueProviderId: r.venueProviderId,
      venueNegotiationId: r.venueNegotiationId,
      targetMonth: r.targetMonth,
      scheduledDate: r.scheduledDate.toISOString(),
      storeName: r.storeName,
      address: r.address,
      area: r.area,
      deadlineAt: r.deadlineAt.toISOString(),
      contractType: r.contractType,
      fixedFee: r.fixedFee?.toString() ?? null,
      performanceRate: r.performanceRate?.toString() ?? null,
      internalNote: r.internalNote,
      contractNote: r.contractNote,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
    // Build assignee rows from Event shifts + dealers
    const assignees: AssigneeRow[] = [];
    const ev = r.event;
    if (ev) {
      // Resolve user names for shifts
      const shiftUserIds = ev.shifts.map((s) => s.userId);
      const dealerRelIds = ev.dealers.map((d) => d.relationshipId);

      const [users, rels] = await Promise.all([
        shiftUserIds.length > 0
          ? tx.user.findMany({ where: { id: { in: shiftUserIds } }, select: { id: true, name: true } })
          : [],
        dealerRelIds.length > 0
          ? tx.relationship.findMany({ where: { id: { in: dealerRelIds } }, select: { id: true, dealer: { select: { name: true } } } })
          : [],
      ]);
      const userName = new Map(users.map((u) => [u.id, u.name]));
      const dealerName = new Map(rels.map((r2) => [r2.id, r2.dealer.name]));

      for (const s of ev.shifts) {
        assignees.push({
          id: s.id,
          name: userName.get(s.userId) ?? s.userId,
          affiliation: "self",
          assignStatus: s.status === "ASSIGNED" ? "adjusting" : "confirmed",
        });
      }
      for (const d of ev.dealers) {
        assignees.push({
          id: d.relationshipId,
          name: dealerName.get(d.relationshipId) ?? d.relationshipId,
          affiliation: "dealer",
          assignStatus: "confirmed",
        });
      }
    }

    return {
      ...dto,
      venueProviderName: provider?.name ?? null,
      venueProviderArea: provider?.area ?? null,
      venueProviderAddress: provider?.address ?? null,
      venueProviderNote: provider?.note ?? null,
      venueProviderContractType: provider?.contractType ?? null,
      venueProviderFixedFee: provider?.fixedFee?.toString() ?? null,
      venueProviderPerformanceRate: provider?.performanceRate?.toString() ?? null,
      eventId: ev?.id ?? null,
      eventMode: ev?.mode ?? null,
      eventNote: null,
      assignees,
    };
  });
}

// 自社ユーザー一覧（アサイン用）
export interface WholesalerUserOption {
  id: string;
  name: string;
}

export async function listWholesalerUsers(): Promise<WholesalerUserOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return rows;
  });
}

// 二次店一覧（アサイン用、ACTIVE な relationship 経由）
export interface DealerOption {
  relationshipId: string;
  dealerName: string;
}

export async function listActiveDealers(): Promise<DealerOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.relationship.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, dealer: { select: { name: true } } },
    });
    return rows.map((r) => ({ relationshipId: r.id, dealerName: r.dealer.name }));
  });
}

// 場所提供元一覧（新規イベント候補登録時の参照用、有効なもののみ）
export interface ActiveVenueProviderOption {
  id: string;
  name: string;
  area: string | null;
}

export async function listActiveVenueProviders(): Promise<ActiveVenueProviderOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.venueProvider.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, area: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, area: r.area }));
  });
}

// エリアマスタ一覧（新規イベント候補登録時のエリア選択肢、有効なもののみ）。
// 同じ三段 idiom（requireWholesalerCtx = auth → assertCan('event_candidate.read')
// → withTenant）を踏襲する。エリアマスタの CRUD は /masters/areas が担う。
export interface AreaOption {
  id: string;
  name: string;
}

export async function listActiveAreas(): Promise<AreaOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.area.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return rows;
  });
}

// 店舗マスタ一覧（新規イベント候補登録時の店舗選択肢、有効なもののみ）。
// listActiveAreas と同じ三段 idiom（requireWholesalerCtx = auth →
// assertCan('event_candidate.read') → withTenant）を踏襲する。店舗マスタの
// CRUD は /masters/stores が担う。
export interface StoreOption {
  id: string;
  name: string;
}

export async function listActiveStores(): Promise<StoreOption[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.store.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return rows;
  });
}

// T-03-04 / F-019 — 二次店共有 UI 用 loader.
//
// 自テナント (wholesalerId) 配下の ACTIVE な二次店関係を列挙し、対象イベント
// 候補に対する現在の公開状態を join した行を返す。
//   isVisible === true  : 公開中
//   isVisible === false : 公開取消済み（行は残るが UI 上「未公開扱い」）
//   行が無い            : 未公開（一度も公開対象になっていない）
//
// 二次店向け閲覧 API のフィルタは T-03-05 で実装。本 loader は卸業者画面の
// チェックボックス UI 構築のためだけに使う。
export type VisibilityState = "PUBLISHED" | "REVOKED" | "NOT_PUBLISHED";

export interface EventCandidateVisibilityRow {
  relationshipId: string;
  dealerId: string;
  dealerName: string;
  state: VisibilityState;
}

export async function getEventCandidateVisibility(
  eventCandidateId: string,
): Promise<EventCandidateVisibilityRow[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const relationships = await tx.relationship.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        dealerId: true,
        dealer: { select: { name: true } },
      },
    });
    if (relationships.length === 0) return [];

    const visibilities = await tx.eventCandidateVisibility.findMany({
      where: {
        eventCandidateId,
        relationshipId: { in: relationships.map((r) => r.id) },
      },
      select: { relationshipId: true, isVisible: true },
    });
    const byRel = new Map(visibilities.map((v) => [v.relationshipId, v.isVisible]));

    return relationships.map<EventCandidateVisibilityRow>((r) => {
      const isVisible = byRel.get(r.id);
      const state: VisibilityState =
        isVisible === undefined ? "NOT_PUBLISHED" : isVisible ? "PUBLISHED" : "REVOKED";
      return {
        relationshipId: r.id,
        dealerId: r.dealerId,
        dealerName: r.dealer.name,
        state,
      };
    });
  });
}

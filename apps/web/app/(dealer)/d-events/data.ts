// Server-side data loaders for the dealer-facing event screens (T-04-02 /
// F-027 / docs/04 §1.5 S-061 / docs/05 §4.6).
//
// Dealer sees ONLY events where EventDealer.relationshipId IN ctx.relationshipIds.
// 仕入値 (purchasePrice) は絶対に dealer DTO に含めない — このローダは
// EventCandidate の contract terms (fixedFee/performanceRate) も返さない。

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { EventMode, EventReportType, EventStatus } from "@solar/db";

export interface DealerEventListFilter {
  status?: EventStatus;
  from?: string;
  to?: string;
}

export interface DealerEventListRow {
  id: string;
  mode: EventMode;
  status: EventStatus;
  storeName: string;
  area: string | null;
  scheduledDate: string;
  targetMonth: string;
  wholesalerName: string | null;
  scopeOverride: string | null;
  reportCount: number;
  updatedAt: string;
}

export interface DealerEventDetail {
  id: string;
  mode: EventMode;
  status: EventStatus;
  requiredPeople: number | null;
  note: string | null;
  decidedAt: string;
  updatedAt: string;
  wholesalerName: string | null;
  scopeOverride: string | null;
  eventCandidate: {
    id: string;
    storeName: string;
    area: string | null;
    address: string | null;
    scheduledDate: string;
    targetMonth: string;
  };
  reports: Array<{
    id: string;
    type: EventReportType;
    reporterOrgType: "WHOLESALER" | "DEALER";
    createdAt: string;
  }>;
}

async function requireDealerCtx() {
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
    action: "event.read",
  });
  return ctx;
}

/**
 * 二次店ロールが自社担当のイベント一覧を取得する。
 * EventDealer.relationshipId IN ctx.relationshipIds でフィルタし、
 * 他社のイベントは絶対に返さない。
 */
export async function listDealerEvents(
  filter: DealerEventListFilter = {},
): Promise<DealerEventListRow[]> {
  const ctx = await requireDealerCtx();

  if (!ctx.isSaasAdmin && (!ctx.relationshipIds || ctx.relationshipIds.length === 0)) {
    return [];
  }

  return withTenant(ctx, async (tx) => {
    // EventDealer rows where this dealer is assigned.
    const eventDealerRows = await tx.eventDealer.findMany({
      where: {
        ...(ctx.relationshipIds && ctx.relationshipIds.length > 0
          ? { relationshipId: { in: ctx.relationshipIds } }
          : {}),
      },
      select: {
        eventId: true,
        relationshipId: true,
        scopeOverride: true,
      },
    });
    if (eventDealerRows.length === 0) return [];

    const eventIds = Array.from(new Set(eventDealerRows.map((ed) => ed.eventId)));
    const scopeByEventId = new Map(
      eventDealerRows.map((ed) => [ed.eventId, ed.scopeOverride]),
    );

    const events = await tx.event.findMany({
      where: {
        id: { in: eventIds },
        ...(filter.status ? { status: filter.status } : {}),
        eventCandidate: {
          ...(filter.from || filter.to
            ? {
                scheduledDate: {
                  ...(filter.from ? { gte: new Date(filter.from) } : {}),
                  ...(filter.to ? { lte: new Date(filter.to) } : {}),
                },
              }
            : {}),
        },
      },
      orderBy: [{ eventCandidate: { scheduledDate: "desc" } }],
      select: {
        id: true,
        wholesalerId: true,
        mode: true,
        status: true,
        updatedAt: true,
        eventCandidate: {
          select: {
            storeName: true,
            area: true,
            scheduledDate: true,
            targetMonth: true,
          },
        },
        _count: {
          select: { reports: true },
        },
      },
    });
    if (events.length === 0) return [];

    // Fetch wholesaler names for display.
    const wholesalerIds = Array.from(new Set(events.map((e) => e.wholesalerId)));
    const wholesalers = await tx.tenant.findMany({
      where: { id: { in: wholesalerIds } },
      select: { id: true, name: true },
    });
    const wholesalerNameById = new Map(wholesalers.map((w) => [w.id, w.name]));

    return events.map((e) => ({
      id: e.id,
      mode: e.mode,
      status: e.status,
      storeName: e.eventCandidate.storeName,
      area: e.eventCandidate.area,
      scheduledDate: e.eventCandidate.scheduledDate.toISOString(),
      targetMonth: e.eventCandidate.targetMonth,
      wholesalerName: wholesalerNameById.get(e.wholesalerId) ?? null,
      scopeOverride: scopeByEventId.get(e.id) ?? null,
      reportCount: e._count.reports,
      updatedAt: e.updatedAt.toISOString(),
    }));
  });
}

/**
 * 二次店ロールがイベント詳細を取得する。
 * 自社が担当 (EventDealer.relationshipId IN ctx.relationshipIds) しているかを確認し、
 * そうでなければ NotFoundError を投げる。仕入値・卸業者内部メモは返さない。
 */
export async function getDealerEventDetail(eventId: string): Promise<DealerEventDetail> {
  const ctx = await requireDealerCtx();

  if (!ctx.isSaasAdmin && (!ctx.relationshipIds || ctx.relationshipIds.length === 0)) {
    throw new NotFoundError("イベントが見つかりません");
  }

  return withTenant(ctx, async (tx) => {
    // Check dealer is assigned to this event.
    const eventDealer = ctx.isSaasAdmin
      ? null
      : await tx.eventDealer.findFirst({
          where: {
            eventId,
            ...(ctx.relationshipIds && ctx.relationshipIds.length > 0
              ? { relationshipId: { in: ctx.relationshipIds } }
              : {}),
          },
          select: { scopeOverride: true },
        });

    if (!ctx.isSaasAdmin && !eventDealer) {
      throw new NotFoundError("イベントが見つかりません");
    }

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        wholesalerId: true,
        mode: true,
        status: true,
        requiredPeople: true,
        note: true,
        decidedAt: true,
        updatedAt: true,
        eventCandidate: {
          select: {
            id: true,
            storeName: true,
            area: true,
            address: true,
            scheduledDate: true,
            targetMonth: true,
            // fixedFee / performanceRate / internalNote は意図的に select しない
          },
        },
        reports: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            reporterOrgType: true,
            createdAt: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }

    const wholesalerTenant = await tx.tenant.findUnique({
      where: { id: event.wholesalerId },
      select: { name: true },
    });

    return {
      id: event.id,
      mode: event.mode,
      status: event.status,
      requiredPeople: event.requiredPeople,
      note: event.note,
      decidedAt: event.decidedAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      wholesalerName: wholesalerTenant?.name ?? null,
      scopeOverride: eventDealer?.scopeOverride ?? null,
      eventCandidate: {
        id: event.eventCandidate.id,
        storeName: event.eventCandidate.storeName,
        area: event.eventCandidate.area,
        address: event.eventCandidate.address,
        scheduledDate: event.eventCandidate.scheduledDate.toISOString(),
        targetMonth: event.eventCandidate.targetMonth,
      },
      reports: event.reports.map((r) => ({
        id: r.id,
        type: r.type,
        reporterOrgType: r.reporterOrgType,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}

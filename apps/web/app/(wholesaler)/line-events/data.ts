// Server-side data loaders for the line-event screens (F-059 / レーン一覧・詳細).
//
// Same three-step idiom as the event-candidate loaders: auth →
// assertCan('line_event.read') → withTenant. RLS via SET LOCAL keeps
// cross-tenant rows invisible and `assertCan` raises ForbiddenError so dealer
// roles invoking these wholesaler-side loaders are blocked.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { LineEventStatus } from "@solar/contracts";

// listActiveVenueProviders / listActiveAreas / アサイン候補 loader は単発側を再利用する。
export {
  listActiveVenueProviders,
  listActiveAreas,
  listActiveStores,
  listWholesalerUsers,
  listActiveDealers,
  type ActiveVenueProviderOption,
  type AreaOption,
  type StoreOption,
  type WholesalerUserOption,
  type DealerOption,
} from "../event-detail/data";

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
    action: "line_event.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface LineEventListRow {
  id: string;
  name: string;
  venueProviderName: string | null;
  area: string | null;
  scheduledDates: string[];
  status: LineEventStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LineEventListFilter {
  targetMonth?: string;
  venueProviderId?: string;
}

export async function listLineEvents(
  filter: LineEventListFilter = {},
): Promise<LineEventListRow[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.lineEvent.findMany({
      where: {
        ...(filter.targetMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(filter.targetMonth)
          ? { targetMonth: filter.targetMonth }
          : {}),
        ...(filter.venueProviderId ? { venueProviderId: filter.venueProviderId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        venueProviderId: true,
        area: true,
        scheduledDates: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // VenueProvider はテーブル間に明示的な relation が無いため、必要分だけ
    // まとめて引いて map で結合する（単発の listEventCandidates と同じ手法）。
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
      name: r.name,
      venueProviderName: r.venueProviderId
        ? (providerNameById.get(r.venueProviderId) ?? null)
        : null,
      area: r.area,
      scheduledDates: (r.scheduledDates as string[]) ?? [],
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export interface LineAssigneeRow {
  id: string;
  name: string;
  affiliation: "self" | "dealer";
}

export interface LineEventDetail {
  id: string;
  name: string;
  venueProviderId: string | null;
  venueProviderName: string | null;
  area: string | null;
  targetMonth: string;
  scheduledDates: string[];
  contractType: string | null;
  fixedFee: string | null;
  performanceRate: string | null;
  contractNote: string | null;
  status: LineEventStatus;
  assignMode: string | null;
  assignStatus: "CONFIRMED" | "ADJUSTING" | null;
  assignStaffIds: string[];
  assignDealerIds: string[];
  assignees: LineAssigneeRow[];
  assignNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getLineEvent(id: string): Promise<LineEventDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.lineEvent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        venueProviderId: true,
        area: true,
        targetMonth: true,
        scheduledDates: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
        contractNote: true,
        status: true,
        assignMode: true,
        assignStatus: true,
        assignStaffIds: true,
        assignDealerIds: true,
        assignNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!r) return null;
    const provider = r.venueProviderId
      ? await tx.venueProvider.findUnique({
          where: { id: r.venueProviderId },
          select: { name: true },
        })
      : null;

    // Resolve assignee display names. assignStaffIds → User.name (self),
    // assignDealerIds → Relationship.dealer.name (dealer)。単発の event-detail
    // と同じ手法（findMany → Map 化）。venueProvider 同様 relation を張らない
    // 柔リンクなので別クエリで解決する。
    const staffIds = Array.isArray(r.assignStaffIds) ? (r.assignStaffIds as string[]) : [];
    const dealerIds = Array.isArray(r.assignDealerIds) ? (r.assignDealerIds as string[]) : [];
    const [users, rels] = await Promise.all([
      staffIds.length > 0
        ? tx.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
        : [],
      dealerIds.length > 0
        ? tx.relationship.findMany({
            where: { id: { in: dealerIds } },
            select: { id: true, dealer: { select: { name: true } } },
          })
        : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const dealerName = new Map(rels.map((rel) => [rel.id, rel.dealer.name]));
    const assignees: LineAssigneeRow[] = [
      ...staffIds.map<LineAssigneeRow>((sid) => ({
        id: sid,
        name: userName.get(sid) ?? sid,
        affiliation: "self",
      })),
      ...dealerIds.map<LineAssigneeRow>((did) => ({
        id: did,
        name: dealerName.get(did) ?? did,
        affiliation: "dealer",
      })),
    ];

    return {
      id: r.id,
      name: r.name,
      venueProviderId: r.venueProviderId,
      venueProviderName: provider?.name ?? null,
      area: r.area,
      targetMonth: r.targetMonth,
      scheduledDates: (r.scheduledDates as string[]) ?? [],
      contractType: r.contractType,
      fixedFee: r.fixedFee?.toString() ?? null,
      performanceRate: r.performanceRate?.toString() ?? null,
      contractNote: r.contractNote,
      status: r.status,
      assignMode: r.assignMode,
      assignStatus: r.assignStatus,
      assignStaffIds: staffIds,
      assignDealerIds: dealerIds,
      assignees,
      assignNote: r.assignNote,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

// Server-side data loaders for the venue-negotiation screens (S-021 / S-022).
//
// Same three-step idiom as the venue-provider master loaders: auth →
// assertCan('venue_negotiation.read') → withTenant. RLS via SET LOCAL keeps
// cross-tenant rows invisible and `assertCan` raises ForbiddenError so dealer
// roles never reach the DB.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { VenueNegotiationStatus } from "@solar/contracts";

export interface VenueNegotiationListItem {
  id: string;
  venueProviderId: string;
  venueProviderName: string;
  venueProviderArea: string | null;
  status: VenueNegotiationStatus;
  nextAction: string | null;
  assigneeId: string | null;
  updatedAt: string;
}

export interface VenueNegotiationDetail extends VenueNegotiationListItem {
  candidateDates: string[];
  decidedDate: string | null;
  contractType: "FIXED" | "PERFORMANCE" | "OTHER" | null;
  fixedFee: string | null;
  performanceRate: string | null;
  conditionNote: string | null;
  note: string | null;
  createdAt: string;
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
    action: "venue_negotiation.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  status?: VenueNegotiationStatus;
  storeName?: string;
}

export async function listVenueNegotiations(
  filter: ListFilter = {},
): Promise<VenueNegotiationListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.venueNegotiation.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        // 店舗名は VenueNegotiation 自体には持たず、関連 VenueProvider.name で
        // 部分一致する (docs/04 §S-021 検索: 場所提供元名 / 店舗名 / エリア)。
        ...(filter.storeName && filter.storeName.length > 0
          ? {
              venueProvider: {
                is: { name: { contains: filter.storeName, mode: "insensitive" } },
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        venueProviderId: true,
        status: true,
        nextAction: true,
        assigneeId: true,
        updatedAt: true,
        venueProvider: {
          select: { id: true, name: true, area: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      venueProviderId: r.venueProviderId,
      venueProviderName: r.venueProvider.name,
      venueProviderArea: r.venueProvider.area,
      status: r.status,
      nextAction: r.nextAction,
      assigneeId: r.assigneeId,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getVenueNegotiation(id: string): Promise<VenueNegotiationDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.venueNegotiation.findUnique({
      where: { id },
      select: {
        id: true,
        venueProviderId: true,
        candidateDates: true,
        decidedDate: true,
        contractType: true,
        fixedFee: true,
        performanceRate: true,
        conditionNote: true,
        status: true,
        nextAction: true,
        assigneeId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        venueProvider: {
          select: { id: true, name: true, area: true },
        },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      venueProviderId: r.venueProviderId,
      venueProviderName: r.venueProvider.name,
      venueProviderArea: r.venueProvider.area,
      status: r.status,
      nextAction: r.nextAction,
      assigneeId: r.assigneeId,
      candidateDates: parseCandidateDates(r.candidateDates),
      decidedDate: r.decidedDate?.toISOString() ?? null,
      contractType: r.contractType,
      fixedFee: r.fixedFee?.toString() ?? null,
      performanceRate: r.performanceRate?.toString() ?? null,
      conditionNote: r.conditionNote,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

function parseCandidateDates(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.map((d) => (typeof d === "string" ? d : null)).filter((d): d is string => d !== null);
}

// 場所提供元一覧（イベント候補昇格時のドロップダウン用、有効なもののみ）
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

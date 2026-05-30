// Server-side data loaders for the lane-preference screen (F-060 / 二次店希望一覧).
//
// Same three-step idiom as the line-event loaders: auth →
// assertCan('lane_preference.read') → withTenant. RLS via SET LOCAL keeps
// cross-tenant rows invisible and `assertCan` raises ForbiddenError so dealer
// roles invoking this wholesaler-side loader are blocked.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

// 二次店プルダウンは line-events と同じ ACTIVE relationship 一覧を再利用する。
export { listActiveDealers as listActiveRelationships } from "../event-detail/data";
export type { DealerOption } from "../event-detail/data";

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
    action: "lane_preference.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface LanePreferenceItemRow {
  priority: number;
  lineEventId: string;
  lineName: string | null;
  venueProviderName: string | null;
  scheduledDates: string[];
}

export interface LanePreferenceRow {
  id: string;
  relationshipId: string;
  dealerName: string;
  targetMonth: string;
  comment: string | null;
  submittedAt: string;
  items: LanePreferenceItemRow[];
}

export interface LanePreferenceFilter {
  targetMonth?: string;
  relationshipId?: string;
}

export async function listLanePreferences(
  filter: LanePreferenceFilter = {},
): Promise<LanePreferenceRow[]> {
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
        comment: true,
        submittedAt: true,
        items: {
          select: { priority: true, lineEventId: true },
        },
      },
    });

    if (prefs.length === 0) return [];

    // Resolve dealer names per relationship (LanePreference has no relation to
    // Relationship), the referenced LineEvents, and their venue providers — all
    // via bulk findMany → Map joins (same flat-link technique as line-events).
    const relationshipIds = Array.from(new Set(prefs.map((p) => p.relationshipId)));
    const lineEventIds = Array.from(
      new Set(prefs.flatMap((p) => p.items.map((i) => i.lineEventId))),
    );

    const [rels, lineEvents] = await Promise.all([
      tx.relationship.findMany({
        where: { id: { in: relationshipIds } },
        select: { id: true, dealer: { select: { name: true } } },
      }),
      lineEventIds.length > 0
        ? tx.lineEvent.findMany({
            where: { id: { in: lineEventIds } },
            select: {
              id: true,
              name: true,
              venueProviderId: true,
              scheduledDates: true,
            },
          })
        : [],
    ]);

    const dealerNameByRel = new Map(rels.map((r) => [r.id, r.dealer.name]));
    const lineEventById = new Map(lineEvents.map((le) => [le.id, le]));

    const providerIds = Array.from(
      new Set(
        lineEvents
          .map((le) => le.venueProviderId)
          .filter((v): v is string => v !== null),
      ),
    );
    const providers =
      providerIds.length > 0
        ? await tx.venueProvider.findMany({
            where: { id: { in: providerIds } },
            select: { id: true, name: true },
          })
        : [];
    const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

    return prefs.map((p) => {
      const items: LanePreferenceItemRow[] = p.items
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map((i) => {
          const le = lineEventById.get(i.lineEventId);
          return {
            priority: i.priority,
            lineEventId: i.lineEventId,
            lineName: le?.name ?? null,
            venueProviderName: le?.venueProviderId
              ? (providerNameById.get(le.venueProviderId) ?? null)
              : null,
            scheduledDates: le ? ((le.scheduledDates as string[]) ?? []) : [],
          };
        });
      return {
        id: p.id,
        relationshipId: p.relationshipId,
        dealerName: dealerNameByRel.get(p.relationshipId) ?? "—",
        targetMonth: p.targetMonth,
        comment: p.comment,
        submittedAt: p.submittedAt.toISOString(),
        items,
      };
    });
  });
}

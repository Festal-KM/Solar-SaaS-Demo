// Server-side data loader for the wholesaler event detail screen (T-04-02 /
// F-027 / docs/04 §1.3 S-030 / docs/05 §4.6).
//
// Returns Event + EventCandidate + EventDealer list + EventShift list +
// EventReport list + related Customer count. Wholesaler-only view —仕入値など
// は表示するが dealer ロールはこの loader を呼ばない (dealer/events/[id]/data.ts が別)。

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { EventMode, EventReportType, EventStatus, ShiftRole, ShiftStatus, TenantType, VenueContractType } from "@solar/db";

export interface EventDetailReport {
  id: string;
  type: EventReportType;
  reporterOrgType: TenantType;
  createdAt: string;
}

export interface EventDetailShift {
  id: string;
  userId: string;
  userName: string;
  role: ShiftRole;
  startPlanned: string;
  endPlanned: string;
  status: ShiftStatus;
}

export interface EventDetailDealer {
  relationshipId: string;
  dealerName: string;
  scopeOverride: string | null;
  assignedAt: string;
}

export interface EventDetailVenueProvider {
  name: string;
  area: string | null;
  address: string | null;
  note: string | null;
  contractType: VenueContractType | null;
  fixedFee: string | null;
  performanceRate: string | null;
}

export interface EventDetail {
  id: string;
  wholesalerId: string;
  mode: EventMode;
  status: EventStatus;
  requiredPeople: number | null;
  note: string | null;
  decidedAt: string;
  updatedAt: string;
  decidedByName: string | null;
  eventCandidate: {
    id: string;
    storeName: string;
    area: string | null;
    address: string | null;
    scheduledDate: string;
    targetMonth: string;
    venueProviderId: string | null;
  };
  venueProvider: EventDetailVenueProvider | null;
  dealers: EventDetailDealer[];
  shifts: EventDetailShift[];
  reports: EventDetailReport[];
  customerCount: number;
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
    action: "event.read",
  });
  return ctx;
}

export async function getWholesalerEventDetail(eventId: string): Promise<EventDetail> {
  const ctx = await requireWholesalerCtx();

  return withTenant(ctx, async (tx) => {
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
        decidedBy: true,
        eventCandidate: {
          select: {
            id: true,
            storeName: true,
            area: true,
            address: true,
            scheduledDate: true,
            targetMonth: true,
            venueProviderId: true,
          },
        },
        dealers: {
          orderBy: { assignedAt: "asc" },
          select: {
            relationshipId: true,
            scopeOverride: true,
            assignedAt: true,
          },
        },
        shifts: {
          orderBy: { startPlanned: "asc" },
          select: {
            id: true,
            userId: true,
            role: true,
            startPlanned: true,
            endPlanned: true,
            status: true,
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
        _count: {
          select: { customers: true },
        },
      },
    });

    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    // Tenant isolation: non-saas-admin must own this event's wholesaler.
    if (!ctx.isSaasAdmin && ctx.wholesalerId !== event.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Resolve dealer names from Relationship → dealer Tenant.
    const relationshipIds = event.dealers.map((d) => d.relationshipId);
    const relationships =
      relationshipIds.length > 0
        ? await tx.relationship.findMany({
            where: { id: { in: relationshipIds } },
            select: {
              id: true,
              dealer: { select: { name: true } },
            },
          })
        : [];
    const dealerNameById = new Map(relationships.map((r) => [r.id, r.dealer.name]));

    // Resolve shift user names and decidedBy name.
    const shiftUserIds = event.shifts.map((s) => s.userId);
    const userIdsToFetch = Array.from(new Set([...shiftUserIds, event.decidedBy]));
    const users =
      userIdsToFetch.length > 0
        ? await tx.user.findMany({
            where: { id: { in: userIdsToFetch } },
            select: { id: true, name: true },
          })
        : [];
    const userNameById = new Map(users.map((u) => [u.id, u.name]));

    // Resolve VenueProvider via EventCandidate.venueProviderId (no direct relation on Event).
    const venueProviderId = event.eventCandidate.venueProviderId;
    const venueProviderRaw = venueProviderId
      ? await tx.venueProvider.findUnique({
          where: { id: venueProviderId },
          select: {
            name: true,
            area: true,
            address: true,
            note: true,
            contractType: true,
            fixedFee: true,
            performanceRate: true,
          },
        })
      : null;
    const venueProvider = venueProviderRaw
      ? {
          name: venueProviderRaw.name,
          area: venueProviderRaw.area,
          address: venueProviderRaw.address,
          note: venueProviderRaw.note,
          contractType: venueProviderRaw.contractType,
          fixedFee: venueProviderRaw.fixedFee?.toString() ?? null,
          performanceRate: venueProviderRaw.performanceRate?.toString() ?? null,
        }
      : null;

    return {
      id: event.id,
      wholesalerId: event.wholesalerId,
      mode: event.mode,
      status: event.status,
      requiredPeople: event.requiredPeople,
      note: event.note,
      decidedAt: event.decidedAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      decidedByName: userNameById.get(event.decidedBy) ?? null,
      eventCandidate: {
        id: event.eventCandidate.id,
        storeName: event.eventCandidate.storeName,
        area: event.eventCandidate.area,
        address: event.eventCandidate.address,
        scheduledDate: event.eventCandidate.scheduledDate.toISOString(),
        targetMonth: event.eventCandidate.targetMonth,
        venueProviderId: event.eventCandidate.venueProviderId,
      },
      venueProvider,
      dealers: event.dealers.map((d) => ({
        relationshipId: d.relationshipId,
        dealerName: dealerNameById.get(d.relationshipId) ?? d.relationshipId,
        scopeOverride: d.scopeOverride,
        assignedAt: d.assignedAt.toISOString(),
      })),
      shifts: event.shifts.map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: userNameById.get(s.userId) ?? s.userId,
        role: s.role,
        startPlanned: s.startPlanned.toISOString(),
        endPlanned: s.endPlanned.toISOString(),
        status: s.status,
      })),
      reports: event.reports.map((r) => ({
        id: r.id,
        type: r.type,
        reporterOrgType: r.reporterOrgType,
        createdAt: r.createdAt.toISOString(),
      })),
      customerCount: event._count.customers,
    };
  });
}

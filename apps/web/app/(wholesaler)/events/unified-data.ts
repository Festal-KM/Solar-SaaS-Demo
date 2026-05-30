// Unified event list data loader — combines EventCandidate (pre-decision)
// and Event (post-decision) into weekly / monthly views for the イベント一覧 page.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { getHolidaySet } from "@/lib/holidays-jp";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant, type TxClient } from "@/lib/tenancy/with-tenant";

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

export type HoldingStatus = "confirmed" | "pending" | "cancelled";
export type AssignStatus = "confirmed" | "pending";

export interface UnifiedEventRow {
  id: string;
  kind: "candidate" | "event";
  scheduledDate: string;
  area: string | null;
  venue: string | null;
  holdingStatus: HoldingStatus;
  assignStatus: AssignStatus;
  detailHref: string;
}

export interface DaySummary {
  date: string;
  dayOfWeek: number;
  isHoliday: boolean;
  total: number;
  confirmed: number;
  prospective: number;
  unassigned: number;
}

export interface UnifiedEventListResult {
  weekStart: string;
  weekEnd: string;
  daySummaries: DaySummary[];
  events: UnifiedEventRow[];
}

export interface MonthlyFilter {
  from?: string;
  to?: string;
  venue?: string;
  holdingStatus?: HoldingStatus;
  assignStatus?: AssignStatus;
}

export interface MonthlyListResult {
  events: UnifiedEventRow[];
  venues: string[];
}

// ── Date utilities (timezone-safe) ──

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date {
  const parts = s.split("-").map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
}

function getMondayStr(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return localDateStr(monday);
}

function getSundayStr(mondayStr: string): string {
  const d = parseLocalDate(mondayStr);
  d.setDate(d.getDate() + 6);
  return localDateStr(d);
}

function deriveHoldingStatus(kind: "candidate" | "event", status: string): HoldingStatus {
  if (status === "CANCELLED") return "cancelled";
  if (kind === "event") return "confirmed";
  return "pending";
}

function deriveAssignStatus(kind: "candidate" | "event", hasDealers: boolean): AssignStatus {
  if (kind === "event" && hasDealers) return "confirmed";
  return "pending";
}

// ── Shared DB query → UnifiedEventRow[] ──

async function queryUnifiedRows(
  tx: TxClient,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ rows: UnifiedEventRow[]; venues: string[] }> {
  const candidates = await tx.eventCandidate.findMany({
    where: {
      scheduledDate: { gte: rangeStart, lte: rangeEnd },
      status: { notIn: ["DECIDED"] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      scheduledDate: true,
      area: true,
      status: true,
      venueProviderId: true,
      event: { select: { id: true } },
    },
  });

  const events = await tx.event.findMany({
    where: {
      eventCandidate: {
        scheduledDate: { gte: rangeStart, lte: rangeEnd },
      },
    },
    orderBy: { eventCandidate: { scheduledDate: "asc" } },
    select: {
      id: true,
      mode: true,
      status: true,
      eventCandidateId: true,
      eventCandidate: {
        select: {
          scheduledDate: true,
          area: true,
          venueProviderId: true,
        },
      },
      _count: { select: { dealers: true } },
    },
  });

  // Resolve venue provider names
  const vpIds = new Set<string>();
  for (const c of candidates) {
    if (c.venueProviderId) vpIds.add(c.venueProviderId);
  }
  for (const e of events) {
    if (e.eventCandidate.venueProviderId) vpIds.add(e.eventCandidate.venueProviderId);
  }
  const providers =
    vpIds.size > 0
      ? await tx.venueProvider.findMany({
          where: { id: { in: [...vpIds] } },
          select: { id: true, name: true },
        })
      : [];
  const vpNameById = new Map(providers.map((p) => [p.id, p.name]));

  const rows: UnifiedEventRow[] = [];

  for (const c of candidates) {
    if (c.event) continue;
    rows.push({
      id: c.id,
      kind: "candidate",
      scheduledDate: c.scheduledDate.toISOString(),
      area: c.area,
      venue: c.venueProviderId ? (vpNameById.get(c.venueProviderId) ?? null) : null,
      holdingStatus: deriveHoldingStatus("candidate", c.status),
      assignStatus: deriveAssignStatus("candidate", false),
      detailHref: `/event-detail/${c.id}`,
    });
  }

  for (const e of events) {
    rows.push({
      id: e.id,
      kind: "event",
      scheduledDate: e.eventCandidate.scheduledDate.toISOString(),
      area: e.eventCandidate.area,
      venue: e.eventCandidate.venueProviderId
        ? (vpNameById.get(e.eventCandidate.venueProviderId) ?? null)
        : null,
      holdingStatus: deriveHoldingStatus("event", e.status),
      assignStatus: deriveAssignStatus("event", e._count.dealers > 0),
      detailHref: `/event-detail/${e.eventCandidateId}`,
    });
  }

  rows.sort(
    (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(),
  );

  const venues = [...new Set(rows.map((r) => r.venue).filter((v): v is string => v != null))].sort();

  return { rows, venues };
}

// ── Weekly view ──

export async function listUnifiedEvents(weekOf?: string): Promise<UnifiedEventListResult> {
  const ctx = await requireWholesalerCtx();

  const baseDate = weekOf ? parseLocalDate(weekOf) : new Date();
  const mondayStr = getMondayStr(baseDate);
  const sundayStr = getSundayStr(mondayStr);
  const monday = parseLocalDate(mondayStr);
  const sunday = parseLocalDate(sundayStr);
  sunday.setHours(23, 59, 59, 999);

  return withTenant(ctx, async (tx) => {
    const { rows } = await queryUnifiedRows(tx, monday, sunday);

    const yearStart = parseLocalDate(mondayStr).getFullYear();
    const yearEnd = parseLocalDate(sundayStr).getFullYear();
    const holidays = getHolidaySet(yearStart);
    if (yearEnd !== yearStart) {
      for (const h of getHolidaySet(yearEnd)) holidays.add(h);
    }

    const daySummaries: DaySummary[] = [];
    for (let i = 0; i < 7; i++) {
      const d = parseLocalDate(mondayStr);
      d.setDate(d.getDate() + i);
      const dateStr = localDateStr(d);
      const dayRows = rows.filter((r) => r.scheduledDate.slice(0, 10) === dateStr);
      daySummaries.push({
        date: dateStr,
        dayOfWeek: d.getDay(),
        isHoliday: holidays.has(dateStr),
        total: dayRows.length,
        confirmed: dayRows.filter((r) => r.holdingStatus === "confirmed").length,
        prospective: dayRows.filter((r) => r.holdingStatus === "pending").length,
        unassigned: dayRows.filter(
          (r) => r.holdingStatus === "pending" && r.assignStatus === "pending",
        ).length,
      });
    }

    return { weekStart: mondayStr, weekEnd: sundayStr, daySummaries, events: rows };
  });
}

// ── Monthly view ──

export async function listUnifiedEventsMonthly(
  filter: MonthlyFilter = {},
): Promise<MonthlyListResult> {
  const ctx = await requireWholesalerCtx();

  const now = new Date();
  const from = filter.from
    ? parseLocalDate(filter.from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = filter.to
    ? parseLocalDate(filter.to)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  to.setHours(23, 59, 59, 999);

  return withTenant(ctx, async (tx) => {
    const { rows, venues } = await queryUnifiedRows(tx, from, to);

    let filtered = rows;
    if (filter.venue) {
      filtered = filtered.filter((r) => r.venue === filter.venue);
    }
    if (filter.holdingStatus) {
      filtered = filtered.filter((r) => r.holdingStatus === filter.holdingStatus);
    }
    if (filter.assignStatus) {
      filtered = filtered.filter((r) => r.assignStatus === filter.assignStatus);
    }

    return { events: filtered, venues };
  });
}

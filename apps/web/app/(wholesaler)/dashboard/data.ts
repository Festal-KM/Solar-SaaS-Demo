import "server-only";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { SalesTrendPoint } from "./sales-trend-chart";

export interface RecentEvent {
  id: string;
  date: string;
  name: string;
  mode: string;
  status: string;
  statusVariant: string;
}

export interface WeekendEvent {
  id: string;
  date: string;
  name: string;
  venue: string;
  mode: string;
  dealerCount: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface DashboardSummary {
  notifications: { unreadCount: number; latest: NotificationItem[] };
  dealerPreference: { pendingDealerCount: number };
  precall: { pendingCount: number };
  monthlySummary: {
    contractCount: number | null;
    prevContractCount: number | null;
    contractCountDiff: number | null;
    revenueYen: number | null;
    prevRevenueYen: number | null;
    grossProfitYen: number | null;
    prevGrossProfitYen: number | null;
    incentiveYen: number | null;
    prevIncentiveYen: number | null;
  };
  weeklyEvents: { count: number };
  weeklyAppointments: { completedCount: number; scheduledCount: number };
  recentEvents: RecentEvent[];
  weekendEvents: WeekendEvent[];
  salesTrend: SalesTrendPoint[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
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
    action: "dashboard.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  if (!ctx.wholesalerId) {
    throw new ForbiddenError("wholesalerId 未割当のユーザーはダッシュボードを参照できません");
  }

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Week boundaries: Monday 00:00 → Sunday 23:59:59
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);

  // Weekend boundaries: this coming Saturday 00:00 → Sunday+1 00:00
  const daysToSaturday = dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
  const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSaturday);
  const mondayAfterWeekend = new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + 2);

  return withTenant(ctx, async (tx) => {
    const [
      contractCount,
      prevContractCount,
      revenueAgg,
      prevRevenueAgg,
      grossProfitAgg,
      prevGrossProfitAgg,
      unreadCount,
      latestNotifications,
      recentEvents,
      precallCount,
      prefCount,
      weeklyEventCount,
      weeklyApptCompleted,
      weeklyApptScheduled,
      weekendEventsRaw,
    ] = await Promise.all([
      tx.contract.count({
        where: { contractDate: { gte: new Date(`${thisMonth}-01`), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } },
      }),
      tx.contract.count({
        where: { contractDate: { gte: new Date(`${prevMonth}-01`), lt: new Date(`${thisMonth}-01`) } },
      }),
      tx.contract.aggregate({
        _sum: { contractAmount: true },
        where: { contractDate: { gte: new Date(`${thisMonth}-01`), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } },
      }),
      tx.contract.aggregate({
        _sum: { contractAmount: true },
        where: { contractDate: { gte: new Date(`${prevMonth}-01`), lt: new Date(`${thisMonth}-01`) } },
      }),
      tx.grossProfit.aggregate({
        _sum: { projectProfit: true },
        where: { contract: { contractDate: { gte: new Date(`${thisMonth}-01`), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } } },
      }),
      tx.grossProfit.aggregate({
        _sum: { projectProfit: true },
        where: { contract: { contractDate: { gte: new Date(`${prevMonth}-01`), lt: new Date(`${thisMonth}-01`) } } },
      }),
      tx.notification.count({
        where: { recipientUserId: ctx.actorUserId, readAt: null },
      }),
      tx.notification.findMany({
        where: { recipientUserId: ctx.actorUserId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, body: true, createdAt: true, readAt: true },
      }),
      tx.event.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { eventCandidate: { select: { storeName: true, scheduledDate: true } } },
      }),
      tx.appointment.count({
        where: { status: "UNCONFIRMED" },
      }),
      tx.eventCandidate.count({
        where: { status: "OPEN" },
      }),
      tx.event.count({
        where: { eventCandidate: { scheduledDate: { gte: weekStart, lt: weekEnd } } },
      }),
      tx.appointment.count({
        where: {
          scheduledAt: { gte: weekStart, lt: weekEnd },
          status: "VISITED",
        },
      }),
      tx.appointment.count({
        where: {
          scheduledAt: { gte: weekStart, lt: weekEnd },
          status: { in: ["UNCONFIRMED", "PRE_CALL_DONE"] },
        },
      }),
      tx.event.findMany({
        where: {
          eventCandidate: { scheduledDate: { gte: saturday, lt: mondayAfterWeekend } },
          status: { not: "CANCELLED" },
        },
        orderBy: { eventCandidate: { scheduledDate: "asc" } },
        include: {
          eventCandidate: { select: { storeName: true, scheduledDate: true, address: true } },
          _count: { select: { dealers: true } },
        },
      }),
    ]);

    const revenueYen = revenueAgg._sum.contractAmount ? Number(revenueAgg._sum.contractAmount) : null;
    const prevRevenueYen = prevRevenueAgg._sum.contractAmount ? Number(prevRevenueAgg._sum.contractAmount) : null;
    const grossProfitYen = grossProfitAgg._sum.projectProfit ? Number(grossProfitAgg._sum.projectProfit) : null;
    const prevGrossProfitYen = prevGrossProfitAgg._sum.projectProfit ? Number(prevGrossProfitAgg._sum.projectProfit) : null;

    const modeLabel: Record<string, string> = { SELF: "自社", DEALER: "二次店", JOINT: "共同", CANCELLED: "中止" };
    const statusLabel: Record<string, string> = { PLANNED: "開催予定", ONGOING: "開催中", CLOSED: "終了", CANCELLED: "中止" };

    const trendMonths: SalesTrendPoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const agg = await tx.contract.aggregate({
        _sum: { contractAmount: true },
        where: { contractDate: { gte: d, lt: mEnd } },
      });
      const gpAgg = await tx.grossProfit.aggregate({
        _sum: { projectProfit: true },
        where: { contract: { contractDate: { gte: d, lt: mEnd } } },
      });
      trendMonths.push({
        month: `${d.getMonth() + 1}月`,
        revenue: agg._sum.contractAmount ? Number(agg._sum.contractAmount) : 0,
        grossProfit: gpAgg._sum.projectProfit ? Number(gpAgg._sum.projectProfit) : 0,
      });
    }

    return {
      notifications: {
        unreadCount,
        latest: latestNotifications.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          createdAt: n.createdAt.toISOString().slice(0, 10),
          readAt: n.readAt ? n.readAt.toISOString().slice(0, 10) : null,
        })),
      },
      dealerPreference: { pendingDealerCount: prefCount },
      precall: { pendingCount: precallCount },
      monthlySummary: {
        contractCount,
        prevContractCount,
        contractCountDiff: contractCount - prevContractCount,
        revenueYen,
        prevRevenueYen,
        grossProfitYen,
        prevGrossProfitYen,
        incentiveYen: null,
        prevIncentiveYen: null,
      },
      weeklyEvents: { count: weeklyEventCount },
      weeklyAppointments: { completedCount: weeklyApptCompleted, scheduledCount: weeklyApptScheduled },
      recentEvents: recentEvents.map((ev) => ({
        id: ev.id,
        date: ev.eventCandidate?.scheduledDate
          ? new Date(ev.eventCandidate.scheduledDate).toISOString().slice(0, 10)
          : ev.createdAt.toISOString().slice(0, 10),
        name: ev.eventCandidate?.storeName ?? "—",
        mode: modeLabel[ev.mode] ?? ev.mode,
        status: statusLabel[ev.status] ?? ev.status,
        statusVariant: ev.status === "CANCELLED" ? "badge-destructive" : "badge-default",
      })),
      weekendEvents: weekendEventsRaw.map((ev) => ({
        id: ev.id,
        date: ev.eventCandidate?.scheduledDate
          ? new Date(ev.eventCandidate.scheduledDate).toISOString().slice(0, 10)
          : "",
        name: ev.eventCandidate?.storeName ?? "—",
        venue: ev.eventCandidate?.address ?? "—",
        mode: modeLabel[ev.mode] ?? ev.mode,
        dealerCount: ev._count.dealers,
      })),
      salesTrend: trendMonths,
    };
  });
}

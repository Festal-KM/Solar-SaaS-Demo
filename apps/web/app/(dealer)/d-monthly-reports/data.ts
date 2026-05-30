// Server-side data loader for S-068 二次店 月次報告一覧 (T-06-08 / F-049).
//
// listDealerMonthlyReports — fetches MonthlyReport rows whose relationshipId
//   is within ctx.relationshipIds (DEALER_ADMIN's own scope).
//   wholesalerName is not available as a join here; grouped by wholesalerId for
//   display purposes.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface DealerMonthlyReportItem {
  id: string;
  wholesalerId: string;
  targetMonth: string;
  scope: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  commentsRaw: Record<string, unknown> | null;
}

export interface DealerMonthlyReportListResult {
  items: DealerMonthlyReportItem[];
}

export async function listDealerMonthlyReports(): Promise<DealerMonthlyReportListResult> {
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
    action: "monthly_report.read",
  });

  const relationshipIds = ctx.relationshipIds ?? [];
  if (relationshipIds.length === 0) {
    return { items: [] };
  }

  return withTenant(ctx, async (tx) => {
    const rows = await tx.monthlyReport.findMany({
      where: {
        relationshipId: { in: relationshipIds },
      },
      orderBy: [{ targetMonth: "desc" }],
      select: {
        id: true,
        wholesalerId: true,
        targetMonth: true,
        scope: true,
        status: true,
        comments: true,
        submittedAt: true,
        reviewedAt: true,
        updatedAt: true,
      },
    });

    const items: DealerMonthlyReportItem[] = rows.map((r) => ({
      id: r.id,
      wholesalerId: r.wholesalerId,
      targetMonth: r.targetMonth,
      scope: r.scope,
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      commentsRaw:
        r.comments && typeof r.comments === "object" && !Array.isArray(r.comments)
          ? (r.comments as Record<string, unknown>)
          : null,
    }));

    return { items };
  });
}

// RSC data loader for the wholesaler audit-log page (T-07-09 / F-055 /
// docs/04 §1.3 S-084 / docs/05 §4.9).
//
// Only WHOLESALER_ADMIN may call this. Results are scoped to the caller's
// tenantId via `withTenant` + RLS. PII fields in before/after JSON are
// masked at the service layer (`redactPii` from audit-service).

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { redactPii } from "@/lib/audit/audit-service";

import type { AuditAction } from "@solar/db";

export const PAGE_SIZE = 50;

export interface AuditLogFilter {
  actor?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  page?: number;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string | null;
  tenantId: string;
  targetType: string;
  targetId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface PagedAuditLogResult {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listAuditLogs(
  filter: AuditLogFilter = {},
): Promise<PagedAuditLogResult> {
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
    action: "audit_log.read",
  });

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  const fromDate = filter.from ? new Date(filter.from) : undefined;
  const toDate = filter.to ? new Date(filter.to) : undefined;

  return withTenant(ctx, async (tx) => {
    const where = {
      // Scope to own tenant; saas_admin has no tenantId so no filter applies.
      ...(ctx.isSaasAdmin
        ? {}
        : { tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "" }),
      ...(filter.actor ? { actorUserId: filter.actor } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          actorUserId: true,
          tenantId: true,
          targetType: true,
          targetId: true,
          action: true,
          before: true,
          after: true,
          ip: true,
          createdAt: true,
        },
      }),
      tx.auditLog.count({ where }),
    ]);

    const items: AuditLogItem[] = rows.map((r) => ({
      id: r.id.toString(),
      actorUserId: r.actorUserId,
      tenantId: r.tenantId,
      targetType: r.targetType,
      targetId: r.targetId,
      action: r.action,
      before: r.before ? redactPii(r.before as Record<string, unknown>) : null,
      after: r.after ? redactPii(r.after as Record<string, unknown>) : null,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
  });
}

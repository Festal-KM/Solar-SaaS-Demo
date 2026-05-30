// GET /api/audit-logs?actor=&action=&from=&to=&page=
// — paged audit log viewer (T-07-09 / F-055 / docs/05 §4.9).
//
// Accessible only by WHOLESALER_ADMIN (own tenant) and SAAS_ADMIN (all tenants).
// PII keys (phone/address/name) in `before`/`after` JSON are masked before
// returning so the response never leaks raw PII (CLAUDE.md Hard Rule #6).
//
// Pagination: PAGE_SIZE = 50 rows, ordered by createdAt DESC.

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { redactPii } from "@/lib/audit/audit-service";

import type { AuditAction } from "@solar/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// AuditAction values known at compile time (from the Prisma enum).
const VALID_AUDIT_ACTIONS: AuditAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "PUBLISH",
  "UNPUBLISH",
  "CANCEL",
  "FINALIZE",
  "UNLOCK",
  "MANUAL_ADJUST",
  "REVEAL_PII",
  "ROLE_CHANGE",
  "RELATION_SUSPEND",
  "RELATION_RESUME",
];

function maskJsonField(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return redactPii(value as Record<string, unknown>);
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "サインインが必要です" },
      { status: 401 },
    );
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
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
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const actorFilter = url.searchParams.get("actor")?.trim() || undefined;
  const actionRaw = url.searchParams.get("action") || "";
  const actionFilter = VALID_AUDIT_ACTIONS.includes(actionRaw as AuditAction)
    ? (actionRaw as AuditAction)
    : undefined;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const pageRaw = url.searchParams.get("page");
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1;

  const fromDate = fromRaw ? new Date(fromRaw) : undefined;
  const toDate = toRaw ? new Date(toRaw) : undefined;

  const { items, total } = await withTenant(ctx, async (tx) => {
    const where = {
      // Wholesaler-admin: scope to own tenantId. SaaS-admin: no tenant filter.
      ...(ctx.isSaasAdmin
        ? {}
        : { tenantId: ctx.tenantId ?? ctx.wholesalerId ?? "" }),
      ...(actorFilter ? { actorUserId: actorFilter } : {}),
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      tx.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
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
          userAgent: true,
          createdAt: true,
        },
      }),
      tx.auditLog.count({ where }),
    ]);

    return { items: rows, total: count };
  });

  const maskedItems = items.map((row) => ({
    id: row.id.toString(),
    actorUserId: row.actorUserId,
    tenantId: row.tenantId,
    targetType: row.targetType,
    targetId: row.targetId,
    action: row.action,
    before: maskJsonField(row.before),
    after: maskJsonField(row.after),
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  }));

  return NextResponse.json({
    items: maskedItems,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  });
}

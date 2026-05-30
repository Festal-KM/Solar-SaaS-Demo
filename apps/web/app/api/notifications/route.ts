// GET /api/notifications?page=&unreadOnly=
// — paged inbox for the authenticated user (T-07-04 / F-052 / docs/05 §4.9).
//
// Returns 20 notifications per page ordered by createdAt DESC.
// Only the caller's own notifications are returned (`recipientUserId = actorUserId`).

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

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
      action: "notification.read",
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const pageRaw = url.searchParams.get("page");
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1;

  const userId = ctx.actorUserId;

  const { notifications, total } = await withTenant(ctx, async (tx) => {
    const where = {
      recipientUserId: userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [items, count] = await Promise.all([
      tx.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          payload: true,
          readAt: true,
          createdAt: true,
        },
      }),
      tx.notification.count({ where }),
    ]);

    return { notifications: items, total: count };
  });

  return NextResponse.json({
    notifications,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  });
}

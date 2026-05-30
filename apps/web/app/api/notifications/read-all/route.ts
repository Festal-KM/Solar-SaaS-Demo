// POST /api/notifications/read-all
// — mark all unread notifications as read for the caller (T-07-04 / F-052).
//
// No request body required. Updates all unread rows where
// `recipientUserId = actorUserId` and `readAt IS NULL`.

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
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
      action: "notification.mark_read",
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const now = new Date();

  const result = await withTenant(ctx, (tx) =>
    tx.notification.updateMany({
      where: {
        recipientUserId: ctx.actorUserId,
        readAt: null,
      },
      data: { readAt: now },
    }),
  );

  return NextResponse.json({ ok: true, updatedCount: result.count });
}

// POST /api/notifications/read
// — mark specific notification(s) as read (T-07-04 / F-052).
//
// Body: { notificationId: string }
// Sets readAt = now() on the Notification row, but only if it belongs to
// the caller (`recipientUserId = actorUserId`).

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "リクエストボディが不正です" },
      { status: 400 },
    );
  }

  const notificationId =
    body && typeof body === "object" && "notificationId" in body
      ? String((body as { notificationId: unknown }).notificationId)
      : null;

  if (!notificationId) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "notificationId を指定してください" },
      { status: 400 },
    );
  }

  const now = new Date();

  await withTenant(ctx, (tx) =>
    tx.notification.updateMany({
      where: {
        id: notificationId,
        recipientUserId: ctx.actorUserId,
        readAt: null,
      },
      data: { readAt: now },
    }),
  );

  return NextResponse.json({ ok: true });
}

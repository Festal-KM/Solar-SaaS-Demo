// GET /api/notifications/unread-count
// — lightweight unread count for the notification bell (T-07-04 / F-052).
//
// Polled every 30 seconds by NotificationBell. Returns `{ count: number }`.
// Only the caller's own unread notifications are counted.

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
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

  const count = await withTenant(ctx, (tx) =>
    tx.notification.count({
      where: {
        recipientUserId: ctx.actorUserId,
        readAt: null,
      },
    }),
  );

  return NextResponse.json({ count });
}

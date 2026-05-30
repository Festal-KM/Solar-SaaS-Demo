// `GET /api/me/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD`
// — own-shift listing for field staff (T-03-11 / F-026 / docs/05 §4.6).
//
// Returns EventShift rows where `userId = session.user.id` and
// `startPlanned >= from AND startPlanned <= to(end of day)`.
// Both `from` and `to` are optional; when omitted the current ISO date is used
// (i.e. today's shifts by default).
//
// Permission: WHOLESALER_FIELD_STAFF is the primary consumer but any
// wholesaler role can call this for their own shifts (`shift.read_own`).
// The userId=actorUserId filter is the tenant-isolation mechanism —
// no other user's shifts can be returned even if the caller forges params.
//
// Include:
//   event { id, status, eventCandidate { storeName, scheduledDate, area } }

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

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
      action: "shift.read_own",
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "FORBIDDEN";
    const message = (err as Error).message ?? "この情報にアクセスできません";
    return NextResponse.json({ code, message }, { status: 403 });
  }

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  if (fromRaw && !DATE_RE.test(fromRaw)) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "from は YYYY-MM-DD 形式で指定してください" },
      { status: 400 },
    );
  }
  if (toRaw && !DATE_RE.test(toRaw)) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "to は YYYY-MM-DD 形式で指定してください" },
      { status: 400 },
    );
  }

  // Default to today when no range is specified.
  const todayIso = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(`${fromRaw ?? todayIso}T00:00:00Z`);
  // "to" is inclusive — expand to end of day.
  const toDate = new Date(`${toRaw ?? todayIso}T23:59:59.999Z`);

  if (fromDate > toDate) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "from は to 以前の日付を指定してください" },
      { status: 400 },
    );
  }

  const userId = ctx.actorUserId;

  const shifts = await withTenant(ctx, async (tx) => {
    return tx.eventShift.findMany({
      where: {
        userId,
        startPlanned: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { startPlanned: "asc" },
      include: {
        event: {
          select: {
            id: true,
            status: true,
            eventCandidate: {
              select: {
                storeName: true,
                scheduledDate: true,
                area: true,
                address: true,
              },
            },
          },
        },
      },
    });
  });

  return NextResponse.json({ shifts });
}

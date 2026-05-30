// Shared data-fetching helper for S-053 / S-054 field-staff shift screens
// (T-03-11 / F-026 / docs/05 §4.6).
//
// RSC pages (`page.tsx`) use `fetchMyShifts` directly so they can remain pure
// Server Components with Suspense boundaries.  The same function is used by
// the dashboard and the shift-list page to avoid duplicating the DB access
// logic.
//
// `withTenant(ctx, ...)` is required per docs/CLAUDE.md §Hard rules.
// `server-only` ensures this module is never bundled into the client.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface MyShiftDto {
  id: string;
  eventId: string;
  userId: string;
  role: string;
  startPlanned: string; // ISO string
  endPlanned: string;
  startActual: string | null;
  endActual: string | null;
  status: string;
  note: string | null;
  event: {
    id: string;
    status: string;
    eventCandidate: {
      storeName: string;
      scheduledDate: string; // ISO string
      area: string | null;
      address: string | null;
    };
  };
}

export async function fetchMyShifts({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<{ shifts: MyShiftDto[] }> {
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
    action: "shift.read_own",
  });
  const userId = ctx.actorUserId;
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);

  const rows = await withTenant(ctx, (tx) =>
    tx.eventShift.findMany({
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
    }),
  );

  const shifts: MyShiftDto[] = rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    userId: r.userId,
    role: r.role,
    startPlanned: r.startPlanned.toISOString(),
    endPlanned: r.endPlanned.toISOString(),
    startActual: r.startActual?.toISOString() ?? null,
    endActual: r.endActual?.toISOString() ?? null,
    status: r.status,
    note: r.note,
    event: {
      id: r.event.id,
      status: r.event.status,
      eventCandidate: {
        storeName: r.event.eventCandidate.storeName,
        scheduledDate: r.event.eventCandidate.scheduledDate.toISOString(),
        area: r.event.eventCandidate.area,
        address: r.event.eventCandidate.address,
      },
    },
  }));

  return { shifts };
}

// Data loader for dealer pre-call notification list (F-037 / S-077).
// Lists PreCallNotification rows for the current dealer's relationships,
// joined with appointment customer info and pre-call result.
// Guard: auth → assertCan(pre_call_notification.acknowledge) → withTenant.
//
// Note: we use `pre_call_notification.acknowledge` permission to verify the
// caller is a dealer role. Listing is a read operation but reuses the same
// role set as acknowledge (DEALER_ADMIN / DEALER_STAFF). If finer-grained
// read vs. write separation is needed later, add a `pre_call_notification.read`
// policy key without breaking the acknowledge gate.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { PreCallNotificationStatus, PreCallResult } from "@solar/db";

export interface PreCallNotificationListItem {
  id: string;
  preCallId: string;
  relationshipId: string;
  status: PreCallNotificationStatus;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  preCallResult: PreCallResult;
  calledAt: string;
  customerName: string;
  scheduledAt: string;
}

async function requireCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing",
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
    action: "pre_call_notification.acknowledge",
    resource: undefined,
  });
  return ctx;
}

export async function listDealerPreCallNotifications(
  statusFilter?: PreCallNotificationStatus,
): Promise<PreCallNotificationListItem[]> {
  const ctx = await requireCtx();

  if (ctx.relationshipIds.length === 0) {
    return [];
  }

  return withTenant(ctx, async (tx) => {
    const rows = await tx.preCallNotification.findMany({
      where: {
        relationshipId: { in: ctx.relationshipIds },
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { preCall: { calledAt: "desc" } },
      select: {
        id: true,
        preCallId: true,
        relationshipId: true,
        status: true,
        notifiedAt: true,
        acknowledgedAt: true,
        preCall: {
          select: {
            result: true,
            calledAt: true,
            appointment: {
              select: {
                scheduledAt: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      preCallId: r.preCallId,
      relationshipId: r.relationshipId,
      status: r.status,
      notifiedAt: r.notifiedAt?.toISOString() ?? null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      preCallResult: r.preCall.result,
      calledAt: r.preCall.calledAt.toISOString(),
      customerName: r.preCall.appointment.customer.name,
      scheduledAt: r.preCall.appointment.scheduledAt.toISOString(),
    }));
  });
}

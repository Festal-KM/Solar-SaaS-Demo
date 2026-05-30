// Server-side data loader for pre-call detail and history (T-04-09 / F-035 /
// docs/05 §4.7).
//
// Returns the appointment with its pre-call record (if any).
// Only WHOLESALER-role callers reach this page; assertCan ensures dealers are
// excluded before any DB read.

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { AppointmentStatus, PreCallResult } from "@solar/db";

export interface PreCallDetail {
  id: string;
  calledAt: string;
  result: PreCallResult;
  note: string | null;
  calledByUserId: string;
}

export interface AppointmentWithPreCall {
  id: string;
  scheduledAt: string;
  status: AppointmentStatus;
  customerName: string;
  preCall: PreCallDetail | null;
}

export async function getAppointmentWithPreCall(
  appointmentId: string,
): Promise<AppointmentWithPreCall> {
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
    action: "pre_call.read",
  });

  return withTenant(ctx, async (tx) => {
    const row = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        customer: { select: { name: true, wholesalerId: true } },
        preCall: {
          select: {
            id: true,
            calledAt: true,
            result: true,
            note: true,
            calledByUserId: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundError("アポが見つかりません");
    }

    return {
      id: row.id,
      scheduledAt: row.scheduledAt.toISOString(),
      status: row.status,
      customerName: row.customer.name,
      preCall: row.preCall
        ? {
            id: row.preCall.id,
            calledAt: row.preCall.calledAt.toISOString(),
            result: row.preCall.result,
            note: row.preCall.note,
            calledByUserId: row.preCall.calledByUserId,
          }
        : null,
    };
  });
}

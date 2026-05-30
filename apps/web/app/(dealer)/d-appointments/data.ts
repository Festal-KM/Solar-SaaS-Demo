// Server-side data loader for the dealer appointment list (T-04-08 / F-034 /
// docs/04 §1.5 S-074 / docs/05 §4.7).
//
// Dealer sees ONLY appointments where
//   acquiredRelationshipId IN ctx.relationshipIds.
// This aligns with the pattern used for dealer customers (T-04-07).

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { AppointmentStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface AppointmentListFilter {
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  page?: number;
}

export interface AppointmentListItem {
  id: string;
  customerId: string;
  customerName: string;
  scheduledAt: string;
  status: AppointmentStatus;
  createdAt: string;
}

export interface PagedAppointmentResult {
  items: AppointmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDealerAppointments(
  filter: AppointmentListFilter = {},
): Promise<PagedAppointmentResult> {
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
    action: "appointment.read",
  });

  if (ctx.relationshipIds.length === 0) {
    const page = Math.max(1, filter.page ?? 1);
    return { items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 0 };
  }

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  return withTenant(ctx, async (tx) => {
    const where = {
      acquiredRelationshipId: { in: ctx.relationshipIds },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? {
            scheduledAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.appointment.findMany({
        where,
        orderBy: [{ scheduledAt: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          customerId: true,
          scheduledAt: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      }),
      tx.appointment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return {
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.name,
        scheduledAt: r.scheduledAt.toISOString(),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

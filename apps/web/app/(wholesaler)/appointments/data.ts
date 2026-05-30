// Server-side data loader for the wholesaler appointment list (T-04-08 /
// F-034 / docs/04 §1.3 S-034 / docs/05 §4.7).
//
// Wholesaler sees all appointments linked to their wholesaler tenant via the
// Customer.wholesalerId FK. Filters: customerId / status / date range.
// Pagination: PAGE_SIZE rows per page.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { AppointmentStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface AppointmentListFilter {
  customerId?: string;
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
  acquiredOrgType: "WHOLESALER" | "DEALER";
  createdAt: string;
}

export interface PagedAppointmentResult {
  items: AppointmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listAppointments(
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

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  return withTenant(ctx, async (tx) => {
    const where = {
      customer: { wholesalerId: ctx.wholesalerId! },
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
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
          acquiredOrgType: true,
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
        acquiredOrgType: r.acquiredOrgType as "WHOLESALER" | "DEALER",
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

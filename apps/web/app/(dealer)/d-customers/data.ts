// Server-side data loader for the dealer customer list (T-04-07 / F-032 /
// docs/04 §1.5 S-064 / docs/05 §4.7).
//
// Dealer sees ONLY customers where `ownerRelationshipId IN ctx.relationshipIds`.
// PII (phone / address / name) is always masked for dealers:
//   - tenantType = "DEALER", isSelfTenant = true → piiMaskingMode from
//     WholesalerSettings determines the masking level.
//
// Pagination: 50 rows per page (PAGE_SIZE).

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { maskPhone, maskAddress, maskName } from "@solar/contracts/services/masking";
import type { ViewerContext } from "@solar/contracts/services/masking";

import type { AcquisitionChannel, CustomerStatus } from "@solar/db";
import { rawPrisma } from "@solar/db";

export const PAGE_SIZE = 50;

export interface CustomerListFilter {
  query?: string;
  status?: CustomerStatus;
  channel?: AcquisitionChannel;
  page?: number;
}

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  channel: AcquisitionChannel;
  status: CustomerStatus;
  createdAt: string;
}

export interface PagedCustomerResult {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDealerCustomers(
  filter: CustomerListFilter = {},
): Promise<PagedCustomerResult> {
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
    action: "customer.read",
  });

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Dealers with no active relationships see an empty list.
  if (ctx.relationshipIds.length === 0) {
    return { items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 0 };
  }

  // Resolve piiMaskingMode from the wholesaler associated with this dealer's
  // active context. When multiple wholesalers, use the one from the session.
  const wholesalerId = ctx.wholesalerId;
  const settings = wholesalerId
    ? await rawPrisma.wholesalerSettings.findUnique({
        where: { wholesalerId },
        select: { piiMaskingMode: true },
      })
    : null;

  const piiMaskingMode = (settings?.piiMaskingMode ?? "MASKED") as "FULL" | "PARTIAL" | "MASKED";
  const role = (session.user.roles[0] ?? "DEALER_ADMIN") as ViewerContext["role"];
  const viewer: ViewerContext = {
    role,
    tenantType: "DEALER",
    isSelfTenant: true,
    piiMaskingMode,
  };

  return withTenant(ctx, async (tx) => {
    const queryStr = filter.query?.trim();
    const where = {
      ownerRelationshipId: { in: ctx.relationshipIds },
      ...(queryStr
        ? {
            OR: [
              { name: { contains: queryStr, mode: "insensitive" as const } },
              { phone: { contains: queryStr, mode: "insensitive" as const } },
              { address: { contains: queryStr, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.channel ? { channel: filter.channel } : {}),
    };

    const [rows, total] = await Promise.all([
      tx.customer.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          channel: true,
          status: true,
          createdAt: true,
        },
      }),
      tx.customer.count({ where }),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: maskName(r.name, viewer),
        phone: maskPhone(r.phone, viewer),
        address: r.address ? maskAddress(r.address, viewer) : null,
        channel: r.channel,
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

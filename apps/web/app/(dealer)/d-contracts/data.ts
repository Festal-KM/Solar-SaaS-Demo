// Server-side data loaders for the dealer contract list (T-05-09 / F-040 /
// docs/04 §1.5 S-065).
//
// Dealers see only contracts where ownerRelationshipId is in their
// ctx.relationshipIds (self-relation filter). snapshotPurchasePrice is
// physically excluded at the DTO boundary (CLAUDE.md rule #5).

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { toContractItemDealerDto } from "@solar/contracts";
import type { ContractItemForDealerDto } from "@solar/contracts";
import type { ContractStatus } from "@solar/db";

export const PAGE_SIZE = 50;

export interface DealerContractListFilter {
  status?: ContractStatus;
  from?: string;
  to?: string;
  page?: number;
}

export interface DealerContractListItem {
  id: string;
  customerName: string;
  contractDate: string;
  contractAmount: string;
  status: ContractStatus;
  cancelDeadline: string;
}

export interface PagedDealerContractResult {
  items: DealerContractListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listDealerContracts(
  filter: DealerContractListFilter = {},
): Promise<PagedDealerContractResult> {
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
    action: "contract.read",
  });

  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * PAGE_SIZE;

  return withTenant(ctx, async (tx) => {
    // Filter by ownerRelationshipId IN ctx.relationshipIds (self-relation only).
    const where = {
      ownerRelationshipId: { in: ctx.relationshipIds },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? {
            contractDate: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.contract.findMany({
        where,
        orderBy: [{ contractDate: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          contractDate: true,
          contractAmount: true,
          status: true,
          cancelDeadline: true,
          customer: { select: { name: true } },
        },
      }),
      tx.contract.count({ where }),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return {
      items: rows.map((r) => ({
        id: r.id,
        customerName: r.customer.name,
        contractDate: r.contractDate.toISOString(),
        contractAmount: r.contractAmount.toString(),
        status: r.status,
        cancelDeadline: r.cancelDeadline.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    };
  });
}

export interface DealerContractDetail {
  id: string;
  customerId: string;
  customerName: string;
  contractDate: string;
  contractAmount: string;
  status: ContractStatus;
  cancelDeadline: string;
  // snapshotPurchasePrice physically absent from items (CLAUDE.md rule #5)
  items: ContractItemForDealerDto[];
  incentivePlaceholder: true;
}

export async function getDealerContractDetail(id: string): Promise<DealerContractDetail | null> {
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
    action: "contract.read",
  });

  return withTenant(ctx, async (tx) => {
    const row = await tx.contract.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        contractDate: true,
        contractAmount: true,
        status: true,
        cancelDeadline: true,
        ownerRelationshipId: true,
        customer: { select: { name: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            contractId: true,
            productId: true,
            productName: true,
            maker: true,
            modelNo: true,
            qty: true,
            unit: true,
            snapshotPurchasePrice: true,
            snapshotDealerPrice: true,
            snapshotListPrice: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) return null;

    // Verify the contract belongs to one of the dealer's relationships.
    if (
      row.ownerRelationshipId === null ||
      !ctx.relationshipIds.includes(row.ownerRelationshipId)
    ) {
      return null;
    }

    // Physical exclusion of snapshotPurchasePrice at the DTO boundary.
    const items: ContractItemForDealerDto[] = row.items.map((r) => {
      const qty = Number(r.qty);
      const listPrice = Number(r.snapshotListPrice.toString());
      const subtotal = (qty * listPrice).toFixed(2);
      return toContractItemDealerDto({
        id: r.id,
        contractId: r.contractId,
        productId: r.productId,
        productName: r.productName,
        maker: r.maker,
        modelNo: r.modelNo,
        qty: r.qty.toString(),
        unit: r.unit,
        snapshotPurchasePrice: r.snapshotPurchasePrice.toString(),
        snapshotDealerPrice: r.snapshotDealerPrice.toString(),
        snapshotListPrice: r.snapshotListPrice.toString(),
        subtotal,
        createdAt: r.createdAt.toISOString(),
      });
    });

    return {
      id: row.id,
      customerId: row.customerId,
      customerName: row.customer.name,
      contractDate: row.contractDate.toISOString(),
      contractAmount: row.contractAmount.toString(),
      status: row.status,
      cancelDeadline: row.cancelDeadline.toISOString(),
      items,
      incentivePlaceholder: true,
    };
  });
}

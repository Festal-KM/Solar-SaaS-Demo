// Server-side data loaders for the area master pages (エリアマスタ).
//
// RSC ローダー: Server Action と同じ三段ガード (auth → assertCan(area.read)
// → withTenant) を踏み、許可外ロールは assertCan で 403 落ち、他テナント行は
// RLS により findUnique で null になる。installer の data.ts と同じ構造。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface AreaListItem {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

export interface AreaDetail extends AreaListItem {
  createdAt: string;
}

async function requireWholesalerCtx() {
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
    action: "area.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  name?: string;
  isActive?: boolean;
}

export async function listAreas(filter: ListFilter = {}): Promise<AreaListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.area.findMany({
      where: {
        ...(filter.name && filter.name.length > 0
          ? { name: { contains: filter.name, mode: "insensitive" } }
          : {}),
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getArea(id: string): Promise<AreaDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.area.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

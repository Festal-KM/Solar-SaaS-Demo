// Server-side data loaders for the installer master pages (S-052 sub / F-013).
//
// RSC ローダー: Server Action と同じ三段ガード (auth → assertCan(installer.read)
// → withTenant) を踏み、dealer ロールは assertCan で 403 落ち、他テナント行は
// RLS により findUnique で null になる。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface InstallerListItem {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  area: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface InstallerDetail extends InstallerListItem {
  email: string | null;
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
    action: "installer.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export interface ListFilter {
  name?: string;
  isActive?: boolean;
}

export async function listInstallers(filter: ListFilter = {}): Promise<InstallerListItem[]> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.installer.findMany({
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
        contactName: true,
        phone: true,
        area: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      phone: r.phone,
      area: r.area,
      isActive: r.isActive,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getInstaller(id: string): Promise<InstallerDetail | null> {
  const ctx = await requireWholesalerCtx();
  return withTenant(ctx, async (tx) => {
    const r = await tx.installer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        contactName: true,
        phone: true,
        email: true,
        area: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      area: r.area,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

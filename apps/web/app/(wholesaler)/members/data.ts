// Data loader for wholesaler member management (F-006 / S-018 sub).
// Lists all Users that have a UserRole scoped to this wholesaler's tenant.
// Guard: auth → assertCan(member.read) → withTenant.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { AppRole, UserStatus } from "@solar/db";

export interface MemberListItem {
  id: string;
  name: string;
  email: string;
  roles: AppRole[];
  twoFactorRequired: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
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
    action: "member.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function listWholesalerMembers(): Promise<MemberListItem[]> {
  const ctx = await requireCtx();
  return withTenant(ctx, async (tx) => {
    const users = await tx.user.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        twoFactorRequired: true,
        status: true,
        lastLoginAt: true,
        roles: { select: { role: true } },
      },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles.map((r) => r.role),
      twoFactorRequired: u.twoFactorRequired,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    }));
  });
}

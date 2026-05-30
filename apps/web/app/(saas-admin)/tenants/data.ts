// RSC data loaders for SaaS-admin tenant pages (S-013 / S-014 / S-015 / T-02-08).
//
// `getTenantContext()` の SaaS-admin 分岐は `{isSaasAdmin: true}` を返し、
// `withTenant` は RLS をバイパスする。`assertCan("tenant.read")` は SAAS_ADMIN
// で即 allow するので、非 saas_admin は ForbiddenError を投げる。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { TenantPlanValue, TenantStatusValue, TenantTypeValue } from "@solar/contracts";

export interface TenantListItem {
  id: string;
  name: string;
  type: TenantTypeValue;
  plan: TenantPlanValue | null;
  status: TenantStatusValue;
  userCount: number;
  pendingInvitations: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantInvitationSummary {
  id: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface TenantDetail extends TenantListItem {
  adminEmail: string | null;
  adminName: string | null;
  latestInvitation: TenantInvitationSummary | null;
  canResendInvitation: boolean;
}

async function requireSaasAdminCtx() {
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
    action: "tenant.read",
  });
  return ctx;
}

export interface TenantListFilter {
  type?: TenantTypeValue;
  plan?: TenantPlanValue;
  status?: TenantStatusValue;
}

export async function listTenants(filter: TenantListFilter = {}): Promise<TenantListItem[]> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const rows = await tx.tenant.findMany({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.plan ? { plan: filter.plan } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        type: true,
        plan: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    // 未受諾招待の数はテナント単位の集計が欲しいので、一括 groupBy で取得し
    // クライアント側でテナント ID → 件数 map を作る（N+1 を避ける）。
    const pending = await tx.userInvitation.groupBy({
      by: ["tenantId"],
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      _count: { _all: true },
    });
    const pendingByTenant = new Map<string, number>();
    for (const p of pending) {
      pendingByTenant.set(p.tenantId, p._count._all);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      plan: r.plan,
      status: r.status,
      userCount: r._count.users,
      pendingInvitations: pendingByTenant.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getTenant(id: string): Promise<TenantDetail | null> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        plan: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { users: true } },
      },
    });
    if (!t) return null;

    // 全体管理者 = WHOLESALER_ADMIN ロールを持つ User（複数いる可能性は MVP では
    // 想定しないが、最初の 1 件を表示する）。
    const admin = await tx.user.findFirst({
      where: {
        tenantId: id,
        roles: { some: { role: "WHOLESALER_ADMIN" } },
      },
      orderBy: { createdAt: "asc" },
      select: { email: true, name: true },
    });

    const latest = await tx.userInvitation.findFirst({
      where: { tenantId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    });

    const pendingCount = await tx.userInvitation.count({
      where: { tenantId: id, acceptedAt: null, expiresAt: { gt: new Date() } },
    });

    const canResend = latest
      ? latest.acceptedAt === null && latest.expiresAt.getTime() <= Date.now()
      : false;

    return {
      id: t.id,
      name: t.name,
      type: t.type,
      plan: t.plan,
      status: t.status,
      userCount: t._count.users,
      pendingInvitations: pendingCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      adminEmail: admin?.email ?? null,
      adminName: admin?.name ?? null,
      latestInvitation: latest
        ? {
            id: latest.id,
            email: latest.email,
            expiresAt: latest.expiresAt.toISOString(),
            acceptedAt: latest.acceptedAt ? latest.acceptedAt.toISOString() : null,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      canResendInvitation: canResend,
    };
  });
}

export interface SaasAdminDashboardSummary {
  totalTenants: number;
  activeTenants: number;
  totalActiveUsers: number;
  pendingInvitations: number;
  planDistribution: Array<{ plan: TenantPlanValue | "UNSET"; count: number }>;
  recentTenants: TenantListItem[];
}

export async function getSaasAdminDashboardSummary(): Promise<SaasAdminDashboardSummary> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const [totalTenants, activeTenants, totalActiveUsers, pendingInvitations, planRows, recent] =
      await Promise.all([
        tx.tenant.count(),
        tx.tenant.count({ where: { status: "ACTIVE" } }),
        tx.user.count({ where: { status: "ACTIVE" } }),
        tx.userInvitation.count({
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        }),
        tx.tenant.groupBy({
          by: ["plan"],
          where: { type: "WHOLESALER" },
          _count: { _all: true },
        }),
        tx.tenant.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            name: true,
            type: true,
            plan: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { users: true } },
          },
        }),
      ]);

    const planDistribution = planRows.map((p) => ({
      plan: (p.plan ?? "UNSET") as TenantPlanValue | "UNSET",
      count: p._count._all,
    }));

    return {
      totalTenants,
      activeTenants,
      totalActiveUsers,
      pendingInvitations,
      planDistribution,
      recentTenants: recent.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        plan: r.plan,
        status: r.status,
        userCount: r._count.users,
        pendingInvitations: 0,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });
}

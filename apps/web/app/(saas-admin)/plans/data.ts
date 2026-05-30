// RSC data loaders for SaaS-admin plan + billing pages (S-016 / S-017 / T-02-09).
//
// `getTenantContext()` の SAAS_ADMIN 分岐は `{isSaasAdmin: true}` を返し、
// `withTenant` は RLS をバイパスする。`assertCan("tenant.read")` で SAAS_ADMIN
// を allow にしておく。非 saas_admin は ForbiddenError を投げる。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { TenantPlanValue, TenantStatusValue, TenantTypeValue } from "@solar/contracts";

export interface PlanRow {
  id: string;
  name: string;
  type: TenantTypeValue;
  plan: TenantPlanValue | null;
  status: TenantStatusValue;
  lastChangedAt: string | null;
  createdAt: string;
}

export interface PlanHistoryRow {
  id: string;
  planBefore: TenantPlanValue | null;
  planAfter: TenantPlanValue;
  effectiveFrom: string;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

export interface PlanDetail {
  id: string;
  name: string;
  type: TenantTypeValue;
  plan: TenantPlanValue | null;
  status: TenantStatusValue;
  history: PlanHistoryRow[];
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

/** S-016 一覧。各 WHOLESALER テナントの現在プラン + 直近 plan 変更日。 */
export async function listPlanRows(): Promise<PlanRow[]> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const tenants = await tx.tenant.findMany({
      where: { type: "WHOLESALER" },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        type: true,
        plan: true,
        status: true,
        createdAt: true,
      },
    });

    // 各テナントの直近 plan 変更レコードを 1 つの groupBy で取り出す。
    const tenantIds = tenants.map((t) => t.id);
    const lastChanges =
      tenantIds.length === 0
        ? []
        : await tx.tenantPlanHistory.groupBy({
            by: ["tenantId"],
            where: { tenantId: { in: tenantIds } },
            _max: { createdAt: true },
          });
    const byTenant = new Map<string, Date | null>();
    for (const r of lastChanges) {
      byTenant.set(r.tenantId, r._max.createdAt ?? null);
    }

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      plan: t.plan,
      status: t.status,
      lastChangedAt: byTenant.get(t.id)?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  });
}

/** S-016 詳細 — 該当テナントの plan 履歴 + 現在状態。 */
export async function getPlanDetail(tenantId: string): Promise<PlanDetail | null> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        type: true,
        plan: true,
        status: true,
      },
    });
    if (!t) return null;

    const history = await tx.tenantPlanHistory.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        planBefore: true,
        planAfter: true,
        effectiveFrom: true,
        changedBy: true,
        note: true,
        createdAt: true,
      },
    });

    return {
      id: t.id,
      name: t.name,
      type: t.type,
      plan: t.plan,
      status: t.status,
      history: history.map((h) => ({
        id: h.id,
        planBefore: h.planBefore,
        planAfter: h.planAfter,
        effectiveFrom: h.effectiveFrom.toISOString(),
        changedBy: h.changedBy,
        note: h.note,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  });
}

/**
 * S-017 請求状況一覧。請求は外部運用なので、MVP では「テナント名 / 現在プラン /
 * 直近プラン変更日 / 直近変更メモ（内部メモ）」を表示する。本格的な
 * `BillingNote` テーブルは後続スプリント。
 */
export interface BillingRow extends PlanRow {
  latestNote: string | null;
}

export async function listBillingRows(): Promise<BillingRow[]> {
  const ctx = await requireSaasAdminCtx();
  return withTenant(ctx, async (tx) => {
    const tenants = await tx.tenant.findMany({
      where: { type: "WHOLESALER" },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        type: true,
        plan: true,
        status: true,
        createdAt: true,
      },
    });

    const tenantIds = tenants.map((t) => t.id);
    // 各テナントの最新 plan 履歴 1 行（plan 変更日 + メモ）を引いてくる。
    // N+1 を避けるため tenantId IN (...) で広く取得し、後で in-memory に
    // 最新だけ畳む。
    const recent =
      tenantIds.length === 0
        ? []
        : await tx.tenantPlanHistory.findMany({
            where: { tenantId: { in: tenantIds } },
            orderBy: { createdAt: "desc" },
            select: { tenantId: true, createdAt: true, note: true },
          });
    const latestByTenant = new Map<string, { createdAt: Date; note: string | null }>();
    for (const r of recent) {
      if (!latestByTenant.has(r.tenantId)) {
        latestByTenant.set(r.tenantId, { createdAt: r.createdAt, note: r.note });
      }
    }

    return tenants.map((t) => {
      const last = latestByTenant.get(t.id);
      return {
        id: t.id,
        name: t.name,
        type: t.type,
        plan: t.plan,
        status: t.status,
        lastChangedAt: last?.createdAt.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        latestNote: last?.note ?? null,
      };
    });
  });
}

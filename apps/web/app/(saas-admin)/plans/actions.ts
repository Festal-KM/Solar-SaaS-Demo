"use server";

// SaaS-admin plan management Server Actions (T-02-09 / F-005 / docs/05 §3.2 §4.3).
//
// `updatePlanAction(input)`:
//   1. Tenant.plan を新値で更新する。
//   2. 旧値と新値が同一なら no-op で履歴/監査ログは書かない（タスク仕様）。
//   3. `TenantPlanHistory` に 1 行 INSERT（before/after/effectiveFrom/changedBy/note）。
//   4. `AuditLog` に `UPDATE` を before={plan} / after={plan} で記録。
//
// 権限: `tenant.update_plan` = SAAS_ADMIN only。`withServerActionContext` の
// 三段ガード（auth → assertCan → withTenant）を通す。SAAS_ADMIN のとき
// `getTenantContext()` は `{isSaasAdmin: true}` を返し、`withTenant` は RLS を
// バイパスするので、`TenantPlanHistory` のポリシー (`is_saas_admin = 'true'`) も
// 通る。請求は外部運用なので、本 Action では Billing 関連の更新は行わない。

import { UpdatePlanSchema, type UpdatePlanInput } from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";
import { recordAudit } from "@/lib/audit/audit-service";

const PLANS_LIST_PATH = "/plans";
const BILLING_PATH = "/billing";
const TENANTS_LIST_PATH = "/tenants";

export interface UpdatePlanResult {
  tenantId: string;
  changed: boolean;
  planBefore: "PILOT" | "SMALL" | "MEDIUM" | "LARGE" | null;
  planAfter: "PILOT" | "SMALL" | "MEDIUM" | "LARGE";
  historyId: string | null;
}

export const updatePlanAction = withServerActionContext<UpdatePlanInput, UpdatePlanResult>(
  { action: "tenant.update_plan" },
  async ({ tx, ctx, input }) => {
    const parsed = UpdatePlanSchema.parse(input);

    const existing = await tx.tenant.findUnique({
      where: { id: parsed.tenantId },
      select: { id: true, plan: true, type: true },
    });
    if (!existing) {
      throw new NotFoundError("テナントが見つかりません");
    }

    // 同一プランへの変更は no-op。履歴も監査ログも書かずに早期 return する。
    if (existing.plan === parsed.plan) {
      return {
        tenantId: existing.id,
        changed: false,
        planBefore: existing.plan,
        planAfter: parsed.plan,
        historyId: null,
      };
    }

    const effectiveFrom = parsed.effectiveFrom ?? new Date();

    await tx.tenant.update({
      where: { id: parsed.tenantId },
      data: { plan: parsed.plan },
      select: { id: true },
    });

    const history = await tx.tenantPlanHistory.create({
      data: {
        tenantId: parsed.tenantId,
        planBefore: existing.plan,
        planAfter: parsed.plan,
        effectiveFrom,
        changedBy: ctx.actorUserId,
        note: parsed.note,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      actorUserId: ctx.actorUserId,
      action: "UPDATE",
      targetType: "Tenant",
      targetId: parsed.tenantId,
      tenantId: parsed.tenantId,
      before: { plan: existing.plan },
      after: {
        plan: parsed.plan,
        effectiveFrom: effectiveFrom.toISOString(),
        historyId: history.id,
        ...(parsed.note ? { note: parsed.note } : {}),
      },
    });

    revalidatePath(PLANS_LIST_PATH);
    revalidatePath(`${PLANS_LIST_PATH}/${parsed.tenantId}`);
    revalidatePath(BILLING_PATH);
    revalidatePath(TENANTS_LIST_PATH);
    revalidatePath(`${TENANTS_LIST_PATH}/${parsed.tenantId}`);

    return {
      tenantId: parsed.tenantId,
      changed: true,
      planBefore: existing.plan,
      planAfter: parsed.plan,
      historyId: history.id,
    };
  },
);

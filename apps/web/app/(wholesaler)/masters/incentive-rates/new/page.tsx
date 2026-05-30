import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { listAvailableRelationships } from "../data";
import { IncentiveRateForm } from "../incentive-rate-form";

// インセンティブ率マスタ 新規作成 (S-052 sub / F-014). Page-level guard で
// `incentive_rate.create` を assertCan するため、wholesaler_admin 以外は
// URL 直叩きでも 403。

export const dynamic = "force-dynamic";

export default async function NewIncentiveRatePage() {
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
    action: "incentive_rate.create",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const relationshipOptions = await listAvailableRelationships();

  const t = labels.incentiveRate;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <IncentiveRateForm mode={{ kind: "create", relationshipOptions }} />
    </div>
  );
}

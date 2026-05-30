import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { AreaForm } from "../area-form";

// エリアマスタ 新規作成. Page-level guard checks `area.create` so non-admin
// wholesaler roles are 403'd even if they typed the URL directly — they can
// read the list but only the admin can create.

export const dynamic = "force-dynamic";

export default async function NewAreaPage() {
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
    action: "area.create",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const t = labels.areaMaster;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <AreaForm mode={{ kind: "create" }} />
    </div>
  );
}

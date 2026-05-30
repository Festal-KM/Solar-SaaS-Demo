import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { VenueProviderForm } from "../venue-provider-form";

// S-020 — 場所提供元マスタ新規作成. The page itself enforces `venue_provider.create`
// so dealer roles get a hard 403 even if they typed the URL.

export const dynamic = "force-dynamic";

export default async function NewVenueProviderPage() {
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
    action: "venue_provider.create",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const t = labels.venueProvider;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <VenueProviderForm mode={{ kind: "create" }} />
    </div>
  );
}
